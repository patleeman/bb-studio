import AVFoundation
import Foundation
import os

private let log = Logger(subsystem: "nyc.plee.bbgo", category: "talk")

/// Native capture for the Talk plugin, following its web client's lifecycle:
/// `recording_create` → `segment_put` per cut → heartbeat every 20s →
/// `recording_state: finishing` → poll `recording_get` until the transcript is done.
/// Segments are 16 kHz mono AAC, cut at a pause once they pass the target length
/// (Talk's segmenter policy), and pass through an on-disk outbox so a dropped
/// connection loses nothing.
@MainActor
final class TalkRecorder: ObservableObject {
    enum Phase: Equatable {
        case idle, recording, finishing, done, failed(String)
    }

    @Published private(set) var phase: Phase = .idle
    @Published private(set) var level: Float = 0
    @Published private(set) var startedAt: Date?
    @Published private(set) var transcript = ""
    @Published private(set) var recordingId: String?
    /// Set while recording when the microphone has sent only silence for a few seconds.
    @Published private(set) var silentInput: String?

    private let client: BBClient
    private let outbox = TalkOutbox.shared
    private let capture = SegmentCapture()
    private var heartbeatTask: Task<Void, Never>?
    /// Segments the capture has handed to the outbox. Finishing waits for all of
    /// them: Talk deletes a recording that finishes with no audio.
    private var handedOff = 0

    init(client: BBClient) {
        self.client = client
        outbox.kick()
    }

    func start(kind: String = "dictation", threadId: String? = nil, projectId: String? = nil) async {
        guard phase == .idle || phase == .done || phase.isFailure else { return }
        transcript = ""
        do {
            guard await AVAudioApplication.requestRecordPermission() else {
                phase = .failed("Microphone access is off. Enable it in Settings.")
                return
            }
            let session = AVAudioSession.sharedInstance()
            // The iPhone mic: switching to AirPods' hands-free mic mid-start stalls the engine and sends silence.
            try session.setCategory(.playAndRecord, mode: .default, options: [.defaultToSpeaker, .allowBluetoothA2DP])
            try session.setActive(true)

            let recording = try await client.createRecording(kind: kind, threadId: threadId, projectId: projectId)
            recordingId = recording.id
            let sessionId = Self.clientId()
            handedOff = 0
            try capture.start(
                onLevel: { [weak self] level in Task { @MainActor in self?.level = level } },
                onSegment: { [weak self] segment in
                    Task { @MainActor in
                        self?.outbox.add(segment, recordingId: recording.id, sessionId: sessionId)
                        self?.handedOff += 1
                    }
                })
            startedAt = Date()
            silentInput = nil
            phase = .recording
            if kind == "recording" { LiveItems.recordingStarted(recording.id) }
            _ = try? await client.setRecordingState(recording.id, "recording")
            startHeartbeat(recording.id)
            watchInput()
        } catch {
            log.error("start failed: \(error.localizedDescription, privacy: .public)")
            _ = capture.stop()
            try? AVAudioSession.sharedInstance().setActive(false, options: .notifyOthersOnDeactivation)
            phase = .failed(error.localizedDescription)
        }
    }

    /// Stops capture and waits for Talk to transcribe every segment.
    @discardableResult
    func finish() async -> String? {
        guard phase == .recording, let id = recordingId else { return nil }
        phase = .finishing
        LiveItems.recordingEnded(id)
        let segments = capture.stop()
        heartbeatTask?.cancel()
        try? AVAudioSession.sharedInstance().setActive(false, options: .notifyOthersOnDeactivation)
        await waitForHandoff(segments)
        let stats = capture.stats()
        outbox.finishWhenSent(id)
        guard await outbox.waitForFinish(id, until: Date().addingTimeInterval(120)) else {
            phase = .failed("Still uploading. The transcript will show up in Studio once the audio reaches BB.")
            return nil
        }
        guard segments > 0 else {
            // Too short to keep; Talk discards the empty recording.
            phase = .failed(stats.heardNothing ? silenceMessage : "Nothing was recorded. Try again.")
            return nil
        }
        do {
            let deadline = Date().addingTimeInterval(180)
            while Date() < deadline {
                let detail = try await client.recording(id)
                transcript = detail.transcript
                if detail.recording.status == "done" { break }
                try await Task.sleep(for: .seconds(1.5))
            }
            phase = .done
            return transcript
        } catch let error as BBError where error.message.hasPrefix("No recording") {
            // Talk deletes a recording that finishes without a word.
            phase = .failed(stats.heardNothing ? silenceMessage : "Talk didn't catch any words. Try again, a little closer to the microphone.")
            return nil
        } catch {
            phase = .failed(error.localizedDescription)
            return nil
        }
    }

    /// Stops without waiting; the recording stays in Talk and finishes transcribing on the server.
    func cancel() {
        guard phase == .recording, let id = recordingId else { return }
        let segments = capture.stop()
        heartbeatTask?.cancel()
        // An active session with the audio background mode keeps the app awake.
        try? AVAudioSession.sharedInstance().setActive(false, options: .notifyOthersOnDeactivation)
        phase = .idle
        LiveItems.recordingEnded(id)
        Task {
            await waitForHandoff(segments)
            outbox.finishWhenSent(id)
        }
    }

    /// The input the microphone audio comes from, like "AirPods Pro".
    private var inputName: String? {
        AVAudioSession.sharedInstance().currentRoute.inputs.first?.portName
    }

    private var silenceMessage: String {
        let from = inputName.map { " from \($0)" } ?? ""
        return "The microphone sent only silence\(from). Check that BB Studio has microphone access in Settings and no other app is using the mic, then try again."
    }

    /// The last segment reaches the outbox a hop after capture stops.
    private func waitForHandoff(_ segments: Int) async {
        let deadline = Date().addingTimeInterval(5)
        while handedOff < segments, Date() < deadline {
            try? await Task.sleep(for: .milliseconds(20))
        }
    }

    /// Flags a microphone that sends only silence, and restarts a capture whose
    /// audio stopped arriving (an interruption or a route change it missed).
    private func watchInput() {
        Task { [weak self] in
            while let self, self.phase == .recording {
                try? await Task.sleep(for: .seconds(1))
                guard self.phase == .recording, let startedAt = self.startedAt else { return }
                let stats = self.capture.stats()
                if stats.stalled, Date().timeIntervalSince(startedAt) > 2 {
                    log.error("capture: no audio for 2s, restarting")
                    self.capture.restart()
                }
                let silent = Date().timeIntervalSince(startedAt) > 3 && stats.heardNothing
                self.silentInput = silent ? (self.inputName ?? "the microphone") : nil
            }
        }
    }

    private func startHeartbeat(_ id: String) {
        heartbeatTask?.cancel()
        heartbeatTask = Task { [client] in
            while !Task.isCancelled {
                try? await Task.sleep(for: .seconds(20))
                try? await client.heartbeat(id)
            }
        }
    }

    private static func clientId() -> String {
        let alphabet = Array("abcdefghijklmnopqrstuvwxyz0123456789")
        return String((0..<12).map { _ in alphabet.randomElement()! })
    }
}

extension TalkRecorder.Phase {
    var isFailure: Bool { if case .failed = self { true } else { false } }
}

struct CaptureStats: Sendable {
    var peakRMS: Float
    var lastAudioAt: Date

    /// Digital silence: a quiet room still reads well above this.
    var heardNothing: Bool { peakRMS < 0.0003 }
    /// The engine stopped delivering audio.
    var stalled: Bool { Date().timeIntervalSince(lastAudioAt) > 2 }
}

struct CapturedSegment: Sendable {
    var url: URL
    var index: Int
    var startedAt: Int
    var durationMs: Int
}

/// Runs on the engine's tap thread. All segment state lives on `queue`.
final class SegmentCapture: @unchecked Sendable {
    private let engine = AVAudioEngine()
    private let queue = DispatchQueue(label: "talk.capture")
    private let format = AVAudioFormat(commonFormat: .pcmFormatFloat32, sampleRate: 16_000, channels: 1, interleaved: false)!
    private var converter: AVAudioConverter?
    private var file: AVAudioFile?
    private var fileURL: URL?
    private var index = 0
    private var segmentStarted = Date()
    private var segmentFrames: AVAudioFramePosition = 0
    private var tracker = LevelTracker()
    private var onSegment: ((CapturedSegment) -> Void)?
    private var onLevel: ((Float) -> Void)?
    private var capturing = false
    private var observers: [NSObjectProtocol] = []
    private var peakRMS: Float = 0
    private var lastAudioAt = Date()

    // Talk's default policy: 25s target, 40s hard max, 350ms of quiet counts as a pause.
    private let targetMs = 25_000.0
    private let maxMs = 40_000.0
    private let pauseMs = 350.0

    func start(onLevel: @escaping (Float) -> Void, onSegment: @escaping (CapturedSegment) -> Void) throws {
        self.onSegment = onSegment
        self.onLevel = onLevel
        try queue.sync {
            index = 0
            peakRMS = 0
            lastAudioAt = Date()
            try openSegment()
        }
        capturing = true
        do {
            try startEngine()
        } catch {
            _ = stop()
            throw error
        }
        // A route change (AirPods, a call, another app's audio) stops the engine
        // and can change the input format; pick up where it left off.
        let center = NotificationCenter.default
        observers = [
            center.addObserver(forName: .AVAudioEngineConfigurationChange, object: engine, queue: .main) { [weak self] _ in
                log.info("capture: audio configuration changed")
                self?.restart()
            },
            center.addObserver(forName: AVAudioSession.interruptionNotification, object: nil, queue: .main) {
                [weak self] note in
                let type = (note.userInfo?[AVAudioSessionInterruptionTypeKey] as? UInt)
                    .flatMap(AVAudioSession.InterruptionType.init(rawValue:))
                log.info("capture: interruption \(type == .began ? "began" : "ended", privacy: .public)")
                if type == .ended { self?.restart() }
            },
        ]
    }

    func stats() -> CaptureStats {
        queue.sync { CaptureStats(peakRMS: peakRMS, lastAudioAt: lastAudioAt) }
    }

    /// Starts the engine again after it stopped, retrying while a new route settles.
    func restart() {
        guard capturing else { return }
        engine.stop()
        engine.inputNode.removeTap(onBus: 0)
        queue.sync { lastAudioAt = Date() }
        try? AVAudioSession.sharedInstance().setActive(true)
        Task { @MainActor [weak self] in
            for delay in [0, 200, 600, 1500] {
                try? await Task.sleep(for: .milliseconds(delay))
                guard let self, self.capturing else { return }
                if self.engine.isRunning { return }
                do {
                    self.engine.inputNode.removeTap(onBus: 0)
                    try self.startEngine()
                    return
                } catch {
                    log.error("capture restart failed: \(error.localizedDescription, privacy: .public)")
                }
            }
        }
    }

    private func startEngine() throws {
        let input = engine.inputNode
        let inputFormat = input.outputFormat(forBus: 0)
        log.info("capture start: input \(inputFormat.description, privacy: .public)")
        guard inputFormat.sampleRate > 0, inputFormat.channelCount > 0 else {
            throw NSError(domain: "Talk", code: 1, userInfo: [NSLocalizedDescriptionKey: "No microphone is available."])
        }
        let converter = AVAudioConverter(from: inputFormat, to: format)
        queue.sync { self.converter = converter }
        input.installTap(onBus: 0, bufferSize: 4096, format: inputFormat) { [weak self] buffer, _ in
            guard let self else { return }
            self.queue.sync {
                guard let converted = self.convert(buffer) else { return }
                self.write(converted)
            }
        }
        engine.prepare()
        try engine.start()
    }

    /// Stops capture and hands off the last segment. Returns how many segments
    /// were handed off in total.
    func stop() -> Int {
        guard capturing else { return queue.sync { index } }
        capturing = false
        observers.forEach(NotificationCenter.default.removeObserver)
        observers = []
        log.info("capture stop: engine running \(self.engine.isRunning), frames \(self.segmentFrames)")
        engine.inputNode.removeTap(onBus: 0)
        engine.stop()
        return queue.sync {
            closeSegment()
            return index
        }
    }

    private func convert(_ buffer: AVAudioPCMBuffer) -> AVAudioPCMBuffer? {
        guard let converter else { return nil }
        let ratio = format.sampleRate / buffer.format.sampleRate
        let capacity = AVAudioFrameCount(Double(buffer.frameLength) * ratio) + 32
        guard let output = AVAudioPCMBuffer(pcmFormat: format, frameCapacity: capacity) else { return nil }
        var consumed = false
        var error: NSError?
        converter.convert(to: output, error: &error) { _, status in
            if consumed {
                status.pointee = .noDataNow
                return nil
            }
            consumed = true
            status.pointee = .haveData
            return buffer
        }
        return error == nil ? output : nil
    }

    private func write(_ buffer: AVAudioPCMBuffer) {
        guard let file else { return }
        try? file.write(from: buffer)
        segmentFrames += AVAudioFramePosition(buffer.frameLength)

        let dtMs = Double(buffer.frameLength) / format.sampleRate * 1000
        let rms = Self.rms(buffer)
        peakRMS = max(peakRMS, rms)
        lastAudioAt = Date()
        let quietMs = tracker.push(rms: rms, dtMs: dtMs)
        onLevel?(tracker.level)

        let elapsedMs = Double(segmentFrames) / format.sampleRate * 1000
        if elapsedMs >= maxMs || (elapsedMs >= targetMs && quietMs >= pauseMs) {
            closeSegment()
            try? openSegment()
        }
    }

    private func openSegment() throws {
        let url = FileManager.default.temporaryDirectory.appendingPathComponent("talk-\(UUID().uuidString).m4a")
        let settings: [String: Any] = [
            AVFormatIDKey: kAudioFormatMPEG4AAC,
            AVSampleRateKey: 16_000,
            AVNumberOfChannelsKey: 1,
            AVEncoderBitRateKey: 32_000,
        ]
        file = try AVAudioFile(forWriting: url, settings: settings, commonFormat: .pcmFormatFloat32, interleaved: false)
        fileURL = url
        segmentStarted = Date()
        segmentFrames = 0
        tracker.resetQuiet()
    }

    private func closeSegment() {
        guard let file, let fileURL else { return }
        file.close()
        self.file = nil
        self.fileURL = nil
        let durationMs = Int(Double(segmentFrames) / format.sampleRate * 1000)
        log.info("segment \(self.index) closed: \(durationMs)ms peak level \(self.tracker.level)")
        guard durationMs > 300 else {
            try? FileManager.default.removeItem(at: fileURL)
            return
        }
        onSegment?(
            CapturedSegment(
                url: fileURL, index: index, startedAt: Int(segmentStarted.timeIntervalSince1970 * 1000),
                durationMs: durationMs))
        index += 1
    }

    private static func rms(_ buffer: AVAudioPCMBuffer) -> Float {
        guard let samples = buffer.floatChannelData?[0], buffer.frameLength > 0 else { return 0 }
        var sum: Float = 0
        for i in 0..<Int(buffer.frameLength) { sum += samples[i] * samples[i] }
        return (sum / Float(buffer.frameLength)).squareRoot()
    }
}

/// Port of Talk's `LevelTracker`: an adaptive noise floor so a noisy room does not read as constant speech.
struct LevelTracker {
    private var floor: Float = 0.004
    private var quietMs: Double = 0
    private(set) var level: Float = 0

    mutating func push(rms: Float, dtMs: Double) -> Double {
        floor = rms < floor ? rms : floor + (rms - floor) * Float(min(1, dtMs / 8000))
        floor = max(0.001, floor)
        let threshold = max(0.008, floor * 2.5)
        quietMs = rms < threshold ? quietMs + dtMs : 0
        let target = min(1, rms.squareRoot() * 2.2)
        level = target > level ? target : level * 0.85 + target * 0.15
        return quietMs
    }

    mutating func resetQuiet() {
        quietMs = 0
    }
}
