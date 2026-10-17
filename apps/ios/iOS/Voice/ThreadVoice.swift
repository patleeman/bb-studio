import Foundation
import SwiftUI

/// Voice mode in one open thread: whether it's on (`voice.state`, `voice.set`),
/// Studio's conversational switch, and playing the thread's spoken replies as
/// Studio announces them on the "studio-voice" signal. Replies play only where
/// the thread is open, through the app's one `VoicePlayer`.
@MainActor
final class ThreadVoice: ObservableObject {
    /// Nil until known; false on a server whose Studio has no voice mode, which hides the controls.
    @Published private(set) var available: Bool?
    @Published private(set) var on: Bool
    @Published private(set) var conversational = true
    @Published private(set) var speechProblem: String?
    /// Speech's playback speed, shared with Settings.
    @Published private(set) var speed: Double = 1

    let threadId: String
    /// True while the user is talking: a reply that arrives then isn't played over them.
    var isListening: () -> Bool = { false }
    /// Shows a short message, like Studio's toasts.
    var flash: (String) -> Void = { _ in }

    private let player: VoicePlayer
    private var client: BBClient?
    private var realtime: BBRealtime?
    private var listener: UUID?

    /// Threads just started as voice chats: voice is on before `voice.state` answers, so the greeting plays.
    static var startedOn: Set<String> = []
    /// Whether the last thread opened had voice mode, so the next one shows its controls at once.
    private static var knownAvailable: Bool?

    init(threadId: String, player: VoicePlayer? = nil) {
        self.threadId = threadId
        self.player = player ?? .shared
        on = Self.startedOn.contains(threadId)
        available = Self.knownAvailable
    }

    func attach(client: BBClient, realtime: BBRealtime) {
        detach()
        self.client = client
        self.realtime = realtime
        listener = realtime.listen { [weak self] event in
            guard let self else { return }
            switch event {
            case .pluginSignal("studio", VoiceSpoken.channel, let payload):
                if let spoken = VoiceSpoken(payload) { self.handle(spoken) }
            case .connected:
                Task { await self.load() }
            default:
                break
            }
        }
        Task { await load() }
    }

    func detach() {
        if let listener { realtime?.removeListener(listener) }
        listener = nil
        VoiceBackground.shared.close(threadId)
    }

    func load() async {
        guard let client else { return }
        do {
            apply(try await client.voiceState(threadId))
            available = true
            Self.knownAvailable = true
        } catch where BBClient.isMissingRPC(error) {
            available = false
            Self.knownAvailable = false
            on = false
        } catch {
            // Offline or a slow server: keep what's showing.
        }
        if available == true, let settings = try? await client.speechSettings(), let speed = settings.speed {
            self.speed = speed
            player.setRate(speed)
        }
    }

    func toggle() {
        set(!on)
    }

    func set(_ next: Bool) {
        guard let client else { return }
        on = next
        if !next, player.threadId == threadId { player.stop() }
        Task {
            do {
                let state = try await client.setVoice(threadId, on: next)
                apply(state)
                if state.on == true, let problem = state.speechProblem {
                    flash("Voice mode is on, but replies can't be spoken yet. \(problem)")
                }
            } catch {
                on = !next
                flash("Couldn't change voice mode: \(BBClient.describe(error, plugin: "Studio", server: client.baseURL))")
            }
        }
    }

    func setConversational(_ next: Bool) {
        guard let client else { return }
        conversational = next
        Task {
            do {
                apply(try await client.setVoiceConversational(threadId, on: next))
            } catch {
                conversational = !next
                flash("Couldn't change that: \(BBClient.describe(error, server: client.baseURL))")
            }
        }
    }

    /// The speed button: the next step, saved for every reply (and Settings).
    func cycleSpeed() {
        setSpeed(VoiceText.nextSpeed(after: speed))
    }

    func setSpeed(_ next: Double) {
        speed = next
        player.setRate(next)
        guard let client else { return }
        Task {
            do {
                _ = try await client.updateSpeech(VoiceRequests.update(speed: next))
            } catch {
                flash("Couldn't save the speed: \(BBClient.describe(error, server: client.baseURL))")
            }
        }
    }

    /// The speed was saved elsewhere (the voice settings): just follow it.
    func follow(speed: Double) {
        self.speed = speed
        player.setRate(speed)
    }

    /// What `send` says along with a spoken message. Studio picks it: the
    /// conversational note while that's on, a one-time "it's off" note after
    /// it's turned off, then none. An older Studio without that falls back to
    /// the conversational note alone.
    func agentNote() async -> String? {
        guard let client else { return conversational ? VoiceText.turnNote : nil }
        do {
            return try await client.voiceTurnNote(threadId)
        } catch {
            return conversational ? VoiceText.turnNote : nil
        }
    }

    /// Studio announced a spoken reply.
    func handle(_ spoken: VoiceSpoken) {
        guard on, spoken.threadId == threadId else { return }
        if let problem = spoken.problem {
            flash("Couldn't speak the reply: \(problem)")
            return
        }
        guard !isListening(), let client else { return }
        let urls = spoken.urls.compactMap { SpeechURL.resolve($0, against: client.baseURL) }
        player.play(threadId: threadId, urls: urls, pieces: spoken.pieces)
    }

    /// Reads a message aloud in Speech's voice and speed; again while it reads stops it.
    func readAloud(rowId: String, text: String) {
        guard let client else { return }
        player.setRate(speed)
        player.readAloud(threadId: threadId, rowId: rowId, text: text) { piece in
            try await client.prepareSpeech(piece)
        }
    }

    /// Whether a thread open on screen keeps voice going with the screen locked.
    func report(running: Bool) {
        if on, available != false {
            VoiceBackground.shared.open(threadId, running: running)
        } else {
            VoiceBackground.shared.close(threadId)
        }
    }

    private func apply(_ state: VoiceModeState) {
        on = state.on ?? on
        conversational = state.conversational ?? conversational
        speechProblem = state.speechProblem
        if on { Self.startedOn.remove(threadId) }
    }
}

/// Voice threads open on screen, and keeping the app running for them with
/// the screen locked: the socket stays open and silence plays, so a reply that
/// arrives can still be spoken. It lets go a minute after the thread stops
/// working and nothing is speaking.
@MainActor
final class VoiceBackground {
    static let shared = VoiceBackground()

    /// Open voice threads, and whether each is working.
    private(set) var threads: [String: Bool] = [:]
    private var watch: Task<Void, Never>?
    /// How long it stays once nothing is going on.
    var grace: Duration = .seconds(60)

    var hasOpenThread: Bool { !threads.isEmpty }

    func open(_ threadId: String, running: Bool) {
        threads[threadId] = running
    }

    func close(_ threadId: String) {
        threads[threadId] = nil
    }

    /// The app went to the background. Returns whether it stays connected; `release` closes the socket later.
    func enteredBackground(release: @escaping @MainActor () -> Void) -> Bool {
        guard hasOpenThread else { return false }
        VoiceAudioSession.shared.keepAlive = true
        watch?.cancel()
        watch = Task { [weak self] in
            var lastBusy = ContinuousClock.now
            while let self, !Task.isCancelled {
                if self.threads.values.contains(true) || VoicePlayer.shared.isActive { lastBusy = .now }
                if !self.hasOpenThread || ContinuousClock.now - lastBusy > self.grace {
                    VoiceAudioSession.shared.keepAlive = false
                    release()
                    return
                }
                try? await Task.sleep(for: .seconds(5))
            }
        }
        return true
    }

    func becameActive() {
        watch?.cancel()
        watch = nil
        VoiceAudioSession.shared.keepAlive = false
    }
}

/// Studio's speech settings (`speech.state`, `speech.models`, `speech.update`),
/// for Settings and the composer's voice menu.
@MainActor
final class SpeechSettingsModel: ObservableObject {
    @Published private(set) var settings: SpeechSettings?
    @Published private(set) var models: [SpeechModel] = []
    @Published private(set) var loading = false
    @Published var error: String?
    /// False when the server's Studio has no speech settings.
    @Published private(set) var available = true

    private var client: BBClient { AppModel.shared.client }

    func load() async {
        loading = true
        defer { loading = false }
        do {
            settings = try await client.speechSettings()
            available = true
            error = nil
        } catch where BBClient.isMissingRPC(error) {
            available = false
            return
        } catch {
            self.error = BBClient.describe(error, server: client.baseURL)
            return
        }
        await loadModels()
    }

    func loadModels() async {
        do {
            models = try await client.speechModels()
        } catch {
            models = []
        }
    }

    var engine: String { settings?.engine.map(Self.engineId) ?? "" }
    var model: String { settings?.model ?? "" }
    var voice: String { settings?.voice ?? "" }
    var speed: Double { settings?.speed ?? 1 }

    var currentModel: SpeechModel? { models.first { $0.id == model } }

    /// The current model's voices with their display names, or none when it doesn't list them.
    var voices: [Choice] {
        guard let model = currentModel, let voices = model.voices else { return [] }
        return voices.map { Choice(id: $0, label: model.voiceNames?[$0] ?? $0) }
    }

    struct Choice: Identifiable, Hashable {
        var id: String
        var label: String
    }

    static func engineId(_ engine: Studio.SpeechStateOutputEngine) -> String {
        switch engine {
        case .openrouter: "openrouter"
        case .custom: "custom"
        case .local: "local"
        case .unknown(let value): value
        }
    }

    static func engineId(_ engine: Studio.SpeechStateOutputEnginesItemId) -> String {
        switch engine {
        case .openrouter: "openrouter"
        case .custom: "custom"
        case .local: "local"
        case .unknown(let value): value
        }
    }

    var engines: [Choice] {
        (settings?.engines ?? []).compactMap { item in item.id.map { Choice(id: Self.engineId($0), label: item.label ?? Self.engineId($0)) } }
    }

    func update(engine: String? = nil, model: String? = nil, voice: String? = nil, speed: Double? = nil) async {
        do {
            settings = try await client.updateSpeech(VoiceRequests.update(engine: engine, model: model, voice: voice, speed: speed))
            error = nil
            if speed != nil, let saved = settings?.speed { VoicePlayer.shared.setRate(saved) }
            if engine != nil || model != nil { await loadModels() }
        } catch {
            self.error = BBClient.describe(error, server: client.baseURL)
        }
    }

    /// Plays a short sentence in the chosen voice, through the same player as replies.
    func playSample() {
        let client = client
        VoicePlayer.shared.setRate(speed)
        VoicePlayer.shared.readAloud(threadId: "speech-sample", rowId: "sample", text: Self.sample) { piece in
            try await client.prepareSpeech(piece)
        }
    }

    static let sample = "Hi! This is how replies sound in voice mode."
}
