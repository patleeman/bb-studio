import AVFoundation
import MediaPlayer

/// Plays a Talk recording's segments back to back as one timeline, like the
/// web player. Segments are fetched and decoded one ahead, so playback runs on
/// without a gap. Browser segments are WebM/Opus, which AVFoundation can't open,
/// so those are demuxed here and only the Opus is handed to Core Audio.
@MainActor
final class RecordingPlayer: ObservableObject {
    @Published private(set) var playing = false
    @Published private(set) var loading = false
    /// Where playback is, in recorded time.
    @Published private(set) var positionMs: Double = 0
    @Published private(set) var error: String?
    @Published var rate: Float = 1 {
        didSet {
            timePitch.rate = rate
            updateNowPlaying()
        }
    }

    private(set) var segments: [Segment] = []
    var durationMs: Double { segments.last.map { start($0) + ($0.durationMs ?? 0) } ?? 0 }
    /// The segment under the playhead, once playback has started.
    var currentSegmentId: String? {
        playing || positionMs > 0 ? index(at: positionMs).map { segments[$0].id } : nil
    }

    private let engine = AVAudioEngine()
    private let node = AVAudioPlayerNode()
    private let timePitch = AVAudioUnitTimePitch()
    private let format = AVAudioFormat(standardFormatWithSampleRate: 48000, channels: 1)!
    private var client: BBClient?
    private var recordingId = ""
    private var title = ""
    private var buffers: [String: AVAudioPCMBuffer] = [:]
    private var loads: [String: Task<Decoded, Error>] = [:]
    /// What's on the node: each segment's first sample there, and the recorded time it stands for.
    private var queue: [(index: Int, sample: AVAudioFramePosition, ms: Double)] = []
    private var queuedFrames: AVAudioFramePosition = 0
    /// The node ran out while the next segment was still loading.
    private var drained = false
    /// Bumped on every play, seek and pause, so stale callbacks drop out.
    private var generation = 0
    private var ticker: Timer?
    private var observers: [NSObjectProtocol] = []
    private var remoteTargets: [(MPRemoteCommand, Any)] = []

    init() {
        engine.attach(node)
        engine.attach(timePitch)
        engine.connect(node, to: timePitch, format: format)
        engine.connect(timePitch, to: engine.mainMixerNode, format: format)
        let center = NotificationCenter.default
        let halt: @Sendable (Notification) -> Void = { [weak self] note in
            Task { @MainActor in
                guard let self else { return }
                if note.name == AVAudioSession.interruptionNotification,
                    (note.userInfo?[AVAudioSessionInterruptionTypeKey] as? UInt) != AVAudioSession.InterruptionType.began.rawValue
                {
                    return
                }
                if self.playing { self.pause() }
            }
        }
        observers = [
            center.addObserver(forName: .AVAudioEngineConfigurationChange, object: engine, queue: nil, using: halt),
            center.addObserver(forName: AVAudioSession.interruptionNotification, object: nil, queue: nil, using: halt),
        ]
    }

    deinit {
        observers.forEach(NotificationCenter.default.removeObserver)
    }

    func configure(client: BBClient, recordingId: String, title: String, segments: [Segment]) {
        if self.recordingId != recordingId {
            buffers = [:]
            loads = [:]
        }
        self.client = client
        self.recordingId = recordingId
        self.title = title
        self.segments = segments.filter { ($0.durationMs ?? 0) > 0 }
        if playing { updateNowPlaying() }
    }

    func toggle() {
        if playing {
            pause()
        } else {
            play(from: positionMs >= durationMs - 250 ? 0 : positionMs)
        }
    }

    func play(segment id: String) {
        guard let segment = segments.first(where: { $0.id == id }) else { return }
        play(from: start(segment))
    }

    func skip(seconds: Double) {
        seek(to: positionMs + seconds * 1000)
    }

    func seek(to ms: Double) {
        let ms = min(max(0, ms), durationMs)
        if playing || loading { play(from: ms) } else { positionMs = ms }
    }

    func play(from ms: Double) {
        guard let first = index(at: ms) else { return }
        reset()
        positionMs = ms
        error = nil
        loading = true
        let generation = generation
        Task {
            do {
                try activate()
                let buffer = try await buffer(first)
                guard generation == self.generation else { return }
                schedule(first, buffer: buffer, fromMs: ms - start(segments[first]))
                node.play()
                loading = false
                playing = true
                startTicker()
                updateNowPlaying()
                queueAfter(first)
            } catch {
                guard generation == self.generation else { return }
                loading = false
                self.error = "Couldn't play this recording: \(client.map { BBClient.describe(error, server: $0.baseURL) } ?? error.localizedDescription)"
            }
        }
    }

    func pause() {
        positionMs = currentPosition()
        reset()
        updateNowPlaying()
    }

    /// Stops for good: leaving the recording.
    func stop() {
        reset()
        engine.stop()
        remoteTargets.forEach { $0.0.removeTarget($0.1) }
        remoteTargets = []
        MPNowPlayingInfoCenter.default().nowPlayingInfo = nil
        try? AVAudioSession.sharedInstance().setActive(false, options: .notifyOthersOnDeactivation)
    }

    // MARK: Scheduling

    private func reset() {
        generation += 1
        node.stop()
        queue = []
        queuedFrames = 0
        drained = false
        playing = false
        loading = false
        ticker?.invalidate()
        ticker = nil
    }

    private func schedule(_ index: Int, buffer: AVAudioPCMBuffer, fromMs: Double) {
        let skip = AVAudioFrameCount(max(0, fromMs) * format.sampleRate / 1000)
        let part = skip == 0 ? buffer : Self.slice(buffer, from: skip)
        let generation = generation
        node.scheduleBuffer(part, completionCallbackType: .dataPlayedBack) { [weak self] _ in
            Task { @MainActor in self?.finished(index, generation: generation) }
        }
        queue.append((index, queuedFrames, start(segments[index]) + Double(skip) * 1000 / format.sampleRate))
        queuedFrames += AVAudioFramePosition(part.frameLength)
        let keep = Set(segments[max(0, index - 1)...min(segments.count - 1, index + 1)].map(\.id))
        buffers = buffers.filter { keep.contains($0.key) }
    }

    /// Loads the segment after `index` and queues it behind the one playing.
    /// One that won't load or decode is skipped.
    private func queueAfter(_ index: Int) {
        let next = index + 1
        guard next < segments.count else { return }
        let generation = generation
        Task {
            let buffer = try? await buffer(next)
            guard generation == self.generation else { return }
            guard let buffer else { return queueAfter(next) }
            if drained {
                play(from: start(segments[next]))
            } else {
                schedule(next, buffer: buffer, fromMs: 0)
            }
        }
    }

    private func finished(_ index: Int, generation: Int) {
        guard generation == self.generation else { return }
        if queue.last?.index == index {
            if index + 1 < segments.count {
                drained = true
                loading = true
            } else {
                positionMs = durationMs
                reset()
                updateNowPlaying()
            }
        } else {
            queueAfter(queue.last?.index ?? index)
        }
    }

    private func currentPosition() -> Double {
        guard playing, let now = node.lastRenderTime, let time = node.playerTime(forNodeTime: now),
            let item = queue.last(where: { $0.sample <= time.sampleTime })
        else { return positionMs }
        let played = min(time.sampleTime, queuedFrames) - item.sample
        return min(durationMs, item.ms + Double(played) * 1000 / format.sampleRate)
    }

    private func startTicker() {
        ticker?.invalidate()
        ticker = Timer.scheduledTimer(withTimeInterval: 0.2, repeats: true) { [weak self] _ in
            MainActor.assumeIsolated {
                guard let self, self.playing else { return }
                self.positionMs = self.currentPosition()
            }
        }
    }

    private func activate() throws {
        let session = AVAudioSession.sharedInstance()
        // A recording in progress owns the session; playing through it is fine.
        if session.category != .playAndRecord {
            try session.setCategory(.playback, mode: .spokenAudio)
        }
        try session.setActive(true)
        if !engine.isRunning { try engine.start() }
        registerRemote()
    }

    // MARK: Segments

    /// A decoded segment, handed over once from the decoding task.
    private struct Decoded: @unchecked Sendable { let buffer: AVAudioPCMBuffer }

    private func start(_ segment: Segment) -> Double { segment.offsetMs ?? 0 }

    private func index(at ms: Double) -> Int? {
        guard !segments.isEmpty else { return nil }
        return segments.lastIndex { start($0) <= ms } ?? 0
    }

    private func buffer(_ index: Int) async throws -> AVAudioPCMBuffer {
        let segment = segments[index]
        if let buffer = buffers[segment.id] { return buffer }
        let task: Task<Decoded, Error>
        if let running = loads[segment.id] {
            task = running
        } else {
            guard let client else { throw CancellationError() }
            let (recordingId, format) = (recordingId, format)
            task = Task {
                let data = try await client.recordingAudio(recordingId, segment: segment.id)
                return try await Task.detached(priority: .userInitiated) {
                    Decoded(buffer: try Self.decode(data, mimeType: segment.mimeType ?? "", to: format))
                }.value
            }
            loads[segment.id] = task
        }
        defer { loads[segment.id] = nil }
        let buffer = try await task.value.buffer
        buffers[segment.id] = buffer
        return buffer
    }

    nonisolated private static func decode(_ data: Data, mimeType: String, to format: AVAudioFormat) throws -> AVAudioPCMBuffer {
        let pcm: AVAudioPCMBuffer
        if mimeType.contains("webm") {
            pcm = try WebMOpus(data).decode()
        } else {
            // Core Audio reads both older AAC captures and journal-recovered WAV.
            let extensionName = mimeType.contains("wav") ? "wav" : "m4a"
            let url = FileManager.default.temporaryDirectory.appendingPathComponent("talk-play-\(UUID().uuidString).\(extensionName)")
            try data.write(to: url)
            defer { try? FileManager.default.removeItem(at: url) }
            let file = try AVAudioFile(forReading: url)
            guard let buffer = AVAudioPCMBuffer(pcmFormat: file.processingFormat, frameCapacity: AVAudioFrameCount(file.length)) else {
                throw CocoaError(.fileReadCorruptFile)
            }
            try file.read(into: buffer)
            pcm = buffer
        }
        return try conform(pcm, to: format)
    }

    /// The node plays one format, so every segment is converted to it.
    nonisolated private static func conform(_ buffer: AVAudioPCMBuffer, to format: AVAudioFormat) throws -> AVAudioPCMBuffer {
        if buffer.format == format { return buffer }
        guard let converter = AVAudioConverter(from: buffer.format, to: format),
            let out = AVAudioPCMBuffer(
                pcmFormat: format,
                frameCapacity: AVAudioFrameCount(Double(buffer.frameLength) * format.sampleRate / buffer.format.sampleRate) + 4096)
        else { throw CocoaError(.featureUnsupported) }
        var fed = false
        var failure: NSError?
        let status = converter.convert(to: out, error: &failure) { _, state in
            if fed {
                state.pointee = .endOfStream
                return nil
            }
            fed = true
            state.pointee = .haveData
            return buffer
        }
        if status == .error { throw failure ?? CocoaError(.fileReadCorruptFile) }
        return out
    }

    private static func slice(_ buffer: AVAudioPCMBuffer, from frame: AVAudioFrameCount) -> AVAudioPCMBuffer {
        let count = buffer.frameLength > frame ? buffer.frameLength - frame : 0
        guard count > 0, let part = AVAudioPCMBuffer(pcmFormat: buffer.format, frameCapacity: count),
            let from = buffer.floatChannelData, let to = part.floatChannelData
        else { return AVAudioPCMBuffer(pcmFormat: buffer.format, frameCapacity: 1) ?? buffer }
        for channel in 0..<Int(buffer.format.channelCount) {
            to[channel].update(from: from[channel] + Int(frame), count: Int(count))
        }
        part.frameLength = count
        return part
    }

    // MARK: Lock screen

    private func registerRemote() {
        guard remoteTargets.isEmpty else { return }
        let center = MPRemoteCommandCenter.shared()
        func on(_ command: MPRemoteCommand, _ action: @escaping @MainActor (MPRemoteCommandEvent) -> Void) {
            let target = command.addTarget { event in
                MainActor.assumeIsolated { action(event) }
                return .success
            }
            remoteTargets.append((command, target))
        }
        on(center.playCommand) { [weak self] _ in if self?.playing == false { self?.toggle() } }
        on(center.pauseCommand) { [weak self] _ in if self?.playing == true { self?.pause() } }
        on(center.togglePlayPauseCommand) { [weak self] _ in self?.toggle() }
        center.skipForwardCommand.preferredIntervals = [15]
        center.skipBackwardCommand.preferredIntervals = [15]
        on(center.skipForwardCommand) { [weak self] _ in self?.skip(seconds: 15) }
        on(center.skipBackwardCommand) { [weak self] _ in self?.skip(seconds: -15) }
        on(center.changePlaybackPositionCommand) { [weak self] event in
            guard let event = event as? MPChangePlaybackPositionCommandEvent else { return }
            self?.seek(to: event.positionTime * 1000)
        }
    }

    private func updateNowPlaying() {
        guard !remoteTargets.isEmpty else { return }
        MPNowPlayingInfoCenter.default().nowPlayingInfo = [
            MPMediaItemPropertyTitle: title,
            MPMediaItemPropertyArtist: "Talk",
            MPMediaItemPropertyPlaybackDuration: durationMs / 1000,
            MPNowPlayingInfoPropertyElapsedPlaybackTime: positionMs / 1000,
            MPNowPlayingInfoPropertyPlaybackRate: playing ? Double(rate) : 0,
            MPNowPlayingInfoPropertyDefaultPlaybackRate: 1.0,
        ]
    }
}
