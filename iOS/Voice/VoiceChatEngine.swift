import AVFoundation
import Foundation
import Speech

/// Hands-free voice chat with one thread: listen → send → wait for the turn →
/// speak the reply → listen again. Recognition runs on device; the thread is
/// the brain, so replies come from whatever provider the thread uses.
@MainActor
final class VoiceChatEngine: NSObject, ObservableObject, AVSpeechSynthesizerDelegate {
    enum State: Equatable {
        case idle, listening, sending, waiting, speaking
        case failed(String)
    }

    struct Turn: Identifiable, Hashable {
        let id = UUID()
        var fromUser: Bool
        var text: String
    }

    @Published private(set) var state: State = .idle
    @Published private(set) var partial = ""
    @Published private(set) var turns: [Turn] = []
    @Published private(set) var threadTitle = ""
    @Published var paused = false

    let threadId: String
    private let client: BBClient
    private let realtime: BBRealtime
    private let engine = AVAudioEngine()
    private let recognizer = SFSpeechRecognizer(locale: Locale(identifier: "en-US"))
    private var request: SFSpeechAudioBufferRecognitionRequest?
    private var recognition: SFSpeechRecognitionTask?
    private var silenceTask: Task<Void, Never>?
    /// Bumped whenever recognition stops, so callbacks from a cancelled task are ignored.
    private var generation = 0
    private let synthesizer = AVSpeechSynthesizer()
    private var listener: UUID?
    private var baselineReplyId: String?
    private var checkTask: Task<Void, Never>?
    /// What is being read aloud, to tell your voice from the speaker's echo.
    private var speakingText = ""

    /// How long a pause ends your turn.
    private let endOfTurn: Duration = .milliseconds(1600)

    init(threadId: String, client: BBClient, realtime: BBRealtime) {
        self.threadId = threadId
        self.client = client
        self.realtime = realtime
        super.init()
        synthesizer.delegate = self
    }

    func start() async {
        let speech = await withCheckedContinuation { continuation in
            SFSpeechRecognizer.requestAuthorization { continuation.resume(returning: $0) }
        }
        guard speech == .authorized, await AVAudioApplication.requestRecordPermission() else {
            state = .failed("Speech recognition or microphone access is off.")
            return
        }
        do {
            let session = AVAudioSession.sharedInstance()
            try session.setCategory(.playAndRecord, mode: .voiceChat, options: [.defaultToSpeaker, .allowBluetoothHFP])
            try session.setActive(true)
            // Echo cancellation, so the mic can keep listening while a reply plays.
            try? engine.inputNode.setVoiceProcessingEnabled(true)
        } catch {
            state = .failed(error.localizedDescription)
            return
        }
        realtime.subscribeThread(threadId)
        listener = realtime.listen { [weak self] event in
            guard let self, self.state == .waiting else { return }
            if case .changed(let entity, let id, _) = event, entity == "thread", id == self.threadId {
                self.scheduleCheck()
            }
        }
        if let thread = try? await client.thread(threadId) { threadTitle = thread.displayTitle }
        baselineReplyId = try? await latestReply()?.id
        listen()
    }

    func end() {
        stopListening()
        synthesizer.stopSpeaking(at: .immediate)
        checkTask?.cancel()
        if let listener { realtime.removeListener(listener) }
        realtime.unsubscribeThread(threadId)
        state = .idle
        try? AVAudioSession.sharedInstance().setActive(false, options: .notifyOthersOnDeactivation)
    }

    /// The main button: send now while listening, interrupt while speaking.
    func tap() {
        switch state {
        case .listening: Task { await sendTurn() }
        case .speaking:
            synthesizer.stopSpeaking(at: .immediate)
            listen()
        case .idle, .failed: listen()
        default: break
        }
    }

    func togglePause() {
        paused.toggle()
        if paused {
            stopListening()
            synthesizer.stopSpeaking(at: .immediate)
            state = .idle
        } else {
            listen()
        }
    }

    // MARK: Listening

    private func listen() {
        guard startRecognition() else { return }
        state = .listening
    }

    /// Runs the recognizer. While a reply is being spoken it listens for
    /// barge-in: speech that isn't the reply's own echo interrupts it.
    @discardableResult
    private func startRecognition() -> Bool {
        guard !paused else { return false }
        stopListening()
        guard let recognizer, recognizer.isAvailable else {
            state = .failed("Speech recognition is unavailable.")
            return false
        }
        let request = SFSpeechAudioBufferRecognitionRequest()
        request.shouldReportPartialResults = true
        request.requiresOnDeviceRecognition = recognizer.supportsOnDeviceRecognition
        request.addsPunctuation = true
        self.request = request
        partial = ""
        let current = generation

        let input = engine.inputNode
        input.installTap(onBus: 0, bufferSize: 2048, format: input.outputFormat(forBus: 0)) { buffer, _ in
            request.append(buffer)
        }
        do {
            engine.prepare()
            try engine.start()
        } catch {
            state = .failed(error.localizedDescription)
            return false
        }
        recognition = recognizer.recognitionTask(with: request) { [weak self] result, error in
            let text = result?.bestTranscription.formattedString
            Task { @MainActor in
                guard let self, self.generation == current else { return }
                if self.state == .speaking, let text, self.isBargeIn(text) {
                    self.synthesizer.stopSpeaking(at: .immediate)
                    self.state = .listening
                }
                guard self.state == .listening else { return }
                if let text, !text.isEmpty {
                    self.partial = text
                    self.armSilenceTimer()
                }
                // Recognition ends on its own after long silence; start a fresh task.
                if error != nil, self.partial.isEmpty {
                    try? await Task.sleep(for: .seconds(1))
                    if self.generation == current, self.state == .listening { self.listen() }
                }
            }
        }
        return true
    }

    /// At least two words, most of which aren't in the reply being spoken.
    private func isBargeIn(_ heard: String) -> Bool {
        let words = heard.lowercased().split(whereSeparator: { !$0.isLetter && !$0.isNumber })
        guard words.count >= 2 else { return false }
        let spoken = speakingText.lowercased()
        let foreign = words.filter { !spoken.contains($0) }
        return Double(foreign.count) / Double(words.count) > 0.5
    }

    private func armSilenceTimer() {
        silenceTask?.cancel()
        silenceTask = Task {
            try? await Task.sleep(for: endOfTurn)
            guard !Task.isCancelled else { return }
            await sendTurn()
        }
    }

    private func stopListening() {
        generation += 1
        silenceTask?.cancel()
        if engine.isRunning {
            engine.inputNode.removeTap(onBus: 0)
            engine.stop()
        }
        request?.endAudio()
        recognition?.cancel()
        request = nil
        recognition = nil
    }

    // MARK: Sending and waiting

    private func sendTurn() async {
        let text = partial.trimmingCharacters(in: .whitespacesAndNewlines)
        guard state == .listening, !text.isEmpty else { return }
        stopListening()
        state = .sending
        turns.append(Turn(fromUser: true, text: text))
        do {
            baselineReplyId = try await latestReply()?.id
            try await client.send(threadId, text: text)
            state = .waiting
            scheduleCheck()
        } catch {
            state = .failed(error.localizedDescription)
        }
    }

    /// Realtime changes trigger a check right away; the slow poll covers a dropped socket.
    private func scheduleCheck() {
        checkTask?.cancel()
        checkTask = Task {
            try? await Task.sleep(for: .milliseconds(500))
            while !Task.isCancelled, state == .waiting {
                await checkForReply()
                try? await Task.sleep(for: .seconds(4))
            }
        }
    }

    /// The turn is over when the thread is no longer running and a new assistant reply exists.
    private func checkForReply() async {
        guard state == .waiting,
            let thread = try? await client.thread(threadId), !thread.isRunning,
            let reply = try? await latestReply(), reply.id != baselineReplyId, let text = reply.text
        else { return }
        baselineReplyId = reply.id
        turns.append(Turn(fromUser: false, text: text))
        speak(text)
    }

    private func latestReply() async throws -> TimelineRow? {
        try await client.latestReply(threadId)
    }

    // MARK: Speaking

    private func speak(_ markdown: String) {
        speakingText = Self.speakable(markdown)
        startRecognition()
        state = .speaking
        let utterance = AVSpeechUtterance(string: speakingText)
        utterance.voice = Self.voice
        let rate = UserDefaults.standard.double(forKey: Self.rateKey)
        utterance.rate = AVSpeechUtteranceDefaultSpeechRate * Float(rate > 0 ? rate : 1.08)
        synthesizer.speak(utterance)
    }

    nonisolated func speechSynthesizer(_ synthesizer: AVSpeechSynthesizer, didFinish utterance: AVSpeechUtterance) {
        Task { @MainActor in
            if self.state == .speaking { self.listen() }
        }
    }

    nonisolated static let voiceKey = "voiceIdentifier"
    nonisolated static let rateKey = "voiceRate"

    /// English voices, best quality first. Premium and enhanced voices are
    /// downloaded in Settings → Accessibility → Spoken Content → Voices.
    nonisolated static var voices: [AVSpeechSynthesisVoice] {
        AVSpeechSynthesisVoice.speechVoices()
            .filter { $0.language.hasPrefix("en") }
            .sorted { ($0.quality.rawValue, $0.language == "en-US" ? 1 : 0) > ($1.quality.rawValue, $1.language == "en-US" ? 1 : 0) }
    }

    /// The voice picked in Settings, or the best installed one.
    private static var voice: AVSpeechSynthesisVoice? {
        if let id = UserDefaults.standard.string(forKey: voiceKey), let voice = AVSpeechSynthesisVoice(identifier: id) {
            return voice
        }
        return voices.first ?? AVSpeechSynthesisVoice(language: "en-US")
    }

    /// Code blocks and markdown syntax read badly aloud.
    nonisolated static func speakable(_ markdown: String) -> String {
        var text = markdown.replacing(/```[\s\S]*?```/, with: " (code omitted) ")
        text = text.replacing(/\[([^\]]+)\]\([^)]+\)/) { String($0.output.1) }
        text = text.replacing(/[`*_#>|]/, with: "")
        return text
    }
}
