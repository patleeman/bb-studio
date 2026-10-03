import AVFoundation
import Foundation
import os

private let log = Logger(subsystem: "nyc.plee.bbgo", category: "talk")

/// Native capture for the Talk plugin, following its web client's lifecycle:
/// `recording_create` → `segment_put` per cut → heartbeat every 20s →
/// `recording_state: finishing` → poll `recording_get` until the transcript is done.
/// Segments are 16 kHz mono PCM, cut at a pause once they pass the target length
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
    @Published private(set) var needsRecovery = false

    private let client: BBClient
    private let outbox = TalkOutbox.shared
    private let capture = SegmentCapture()
    private var heartbeatTask: Task<Void, Never>?
    private var handoff: TalkHandoff?
    private var stoppedSegments: Int?
    private var completing = false
    private var captureSession: TalkCaptureJournal.Session?

    init(client: BBClient) {
        self.client = client
        outbox.kick()
    }

    func start(kind: String = "dictation", threadId: String? = nil, projectId: String? = nil) async {
        guard !needsRecovery, phase == .idle || phase == .done || phase.isFailure else { return }
        transcript = ""
        captureSession = nil
        stoppedSegments = nil
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
            let captureSession = try outbox.beginCapture(recordingId: recording.id, sessionId: sessionId, serverURL: client.baseURL)
            self.captureSession = captureSession
            let handoff = TalkHandoff { [outbox, client] segment in
                try outbox.add(segment, recordingId: recording.id, sessionId: sessionId, serverURL: client.baseURL)
            }
            self.handoff = handoff
            stoppedSegments = nil
            try capture.start(journal: outbox.captureJournal, session: captureSession,
                onError: { [weak self] error in Task { @MainActor in
                    guard let self else { return }
                    self.needsRecovery = true
                    _ = self.stopCapture()
                    self.phase = .failed("Audio could not be written. Free some storage and retry saving. Interrupted audio is preserved for recovery in Settings.")
                } },
                onLevel: { [weak self] level in Task { @MainActor in self?.level = level } },
                onSegment: { [weak self] segment in
                    Task { @MainActor in
                        guard let self, self.handoff === handoff else { return }
                        handoff.receive(segment)
                        if handoff.failedCount > 0 {
                            // Stop producing more audio when storage fails, but
                            // retain every failed source file for Retry saving.
                            self.needsRecovery = true
                            _ = self.stopCapture()
                            self.phase = .failed("Couldn't save the audio on this phone. Keep this screen open, free some storage if needed, then retry saving.")
                        }
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
            _ = stopCapture()
            needsRecovery = captureSession != nil
            try? AVAudioSession.sharedInstance().setActive(false, options: .notifyOthersOnDeactivation)
            phase = .failed(error.localizedDescription)
        }
    }

    /// Stops capture and waits for Talk to transcribe every segment.
    @discardableResult
    func finish() async -> String? {
        guard !completing, (phase == .recording || needsRecovery), let id = recordingId else { return nil }
        completing = true
        defer { completing = false }
        phase = .finishing
        needsRecovery = true
        let segments = stopCapture()
        guard await saveHandoff(segments) else { return nil }
        let stats = capture.stats()
        outbox.finishWhenSent(id, serverURL: client.baseURL)
        guard await outbox.waitForFinish(id, serverURL: client.baseURL, until: Date().addingTimeInterval(120)) else {
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

    /// Waits for local persistence before closing; uploads and transcription
    /// continue through the outbox after this view leaves.
    func cancel() async -> Bool {
        if completing { return !needsRecovery }
        guard phase == .recording || needsRecovery, let id = recordingId else { return true }
        completing = true
        defer { completing = false }
        phase = .finishing
        needsRecovery = true
        let segments = stopCapture()
        guard await saveHandoff(segments) else { return false }
        outbox.finishWhenSent(id, serverURL: client.baseURL)
        phase = .idle
        return true
    }

    /// Always releases the microphone, including when enqueueing failed.
    private func stopCapture() -> Int {
        if let stoppedSegments { return stoppedSegments }
        let segments = capture.stop()
        stoppedSegments = segments
        heartbeatTask?.cancel()
        try? AVAudioSession.sharedInstance().setActive(false, options: .notifyOthersOnDeactivation)
        if let recordingId { LiveItems.recordingEnded(recordingId) }
        return segments
    }

    /// The input the microphone audio comes from, like "AirPods Pro".
    private var inputName: String? {
        AVAudioSession.sharedInstance().currentRoute.inputs.first?.portName
    }

    private var silenceMessage: String {
        let from = inputName.map { " from \($0)" } ?? ""
        return "The microphone sent only silence\(from). Check that BB Studio has microphone access in Settings and no other app is using the mic, then try again."
    }

    private func saveHandoff(_ segments: Int) async -> Bool {
        guard let handoff else { return false }
        handoff.retry()
        do {
            try await handoff.waitUntilDurable(segments)
            needsRecovery = false
            return true
        } catch {
            needsRecovery = true
            phase = .failed(error.localizedDescription)
            return false
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
    private var file: FileHandle?
    private var journal: TalkCaptureJournal?
    private var session: TalkCaptureJournal.Session?
    private var onError: ((Error) -> Void)?
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

    func start(journal: TalkCaptureJournal, session: TalkCaptureJournal.Session, onError: @escaping (Error) -> Void, onLevel: @escaping (Float) -> Void, onSegment: @escaping (CapturedSegment) -> Void) throws {
        self.journal = journal
        self.session = session
        self.onError = onError
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
        guard let samples = buffer.floatChannelData?[0] else { return }
        let pcm = (0..<Int(buffer.frameLength)).map { i -> Int16 in
            let value = samples[i].isFinite ? min(1, max(-1, samples[i])) : 0
            return Int16(value * 32767).littleEndian
        }
        do {
            try pcm.withUnsafeBytes { try file.write(contentsOf: Data($0)) }
            if segmentFrames / 16_000 != (segmentFrames + AVAudioFramePosition(buffer.frameLength)) / 16_000 { try file.synchronize() }
            segmentFrames += AVAudioFramePosition(buffer.frameLength)
        } catch { onError?(error); return }

        let dtMs = Double(buffer.frameLength) / format.sampleRate * 1000
        let rms = Self.rms(buffer)
        peakRMS = max(peakRMS, rms)
        lastAudioAt = Date()
        let quietMs = tracker.push(rms: rms, dtMs: dtMs)
        onLevel?(tracker.level)

        let elapsedMs = Double(segmentFrames) / format.sampleRate * 1000
        if elapsedMs >= maxMs || (elapsedMs >= targetMs && quietMs >= pauseMs) {
            closeSegment()
            do { try openSegment() } catch { onError?(error) }
        }
    }

    private func openSegment() throws {
        guard let journal, let session else { throw CocoaError(.fileWriteUnknown) }
        segmentStarted = Date()
        let url = try journal.open(session, index: index, startedAt: Int(segmentStarted.timeIntervalSince1970 * 1000))
        fileURL = url
        file = try FileHandle(forWritingTo: url)
        segmentFrames = 0
        tracker.resetQuiet()
    }

    private func closeSegment() {
        guard let file, let fileURL else { return }
        try? file.synchronize()
        try? file.close()
        self.file = nil
        self.fileURL = nil
        let durationMs = (try? TalkCaptureJournal.duration(of: fileURL)) ?? Int(Double(segmentFrames) / format.sampleRate * 1000)
        log.info("segment \(self.index) closed: \(durationMs)ms peak level \(self.tracker.level)")
        guard durationMs > 0 else {
            journal?.discardEmpty(fileURL)
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
