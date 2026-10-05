import AppIntents

// Shortcuts the Action button (Settings → Action Button → Shortcut) and Siri can run.
// Each one opens the app straight into the matching screen.

struct ThreadEntity: AppEntity {
    static let typeDisplayRepresentation: TypeDisplayRepresentation = "BB Thread"
    static let defaultQuery = ThreadQuery()

    var id: String
    var title: String

    init(threadId: String, title: String, serverURL: URL) {
        id = ServerScope.namespace(serverURL) + "|" + threadId
        self.title = title
    }

    func threadId(on serverURL: URL) throws -> String {
        let parts = id.split(separator: "|", maxSplits: 1)
        guard parts.count == 2, parts[0] == ServerScope.namespace(serverURL) else {
            throw BBError(status: 409, message: "This shortcut belongs to another server. Choose its thread again.")
        }
        return String(parts[1])
    }

    var displayRepresentation: DisplayRepresentation { DisplayRepresentation(title: "\(title)") }
}

struct ThreadQuery: EntityStringQuery {
    func entities(for identifiers: [String]) async throws -> [ThreadEntity] {
        try await recent().filter { identifiers.contains($0.id) }
    }

    func entities(matching string: String) async throws -> [ThreadEntity] {
        try await recent().filter { $0.title.localizedCaseInsensitiveContains(string) }
    }

    func suggestedEntities() async throws -> [ThreadEntity] {
        Array(try await recent().prefix(20))
    }

    private func recent() async throws -> [ThreadEntity] {
        let client = BBClient()
        let threads = try await client.threads()
        guard client.baseURL == ServerScope.selectedURL else { return [] }
        return threads
            .filter { $0.parentThreadId == nil && $0.visibility != "hidden" }
            .sorted { ($0.latestAttentionAt ?? $0.updatedAt) > ($1.latestAttentionAt ?? $1.updatedAt) }
            .map { ThreadEntity(threadId: $0.id, title: $0.displayTitle, serverURL: client.baseURL) }
    }
}

struct DictateIntent: AppIntent {
    static let title: LocalizedStringResource = "Dictate to BB"
    static let description = IntentDescription("Start a Talk dictation.")
    static let openAppWhenRun = true

    @MainActor
    func perform() async throws -> some IntentResult {
        AppModel.shared.startDictation()
        return .result()
    }
}

struct VoiceChatIntent: AppIntent {
    static let title: LocalizedStringResource = "Voice chat with BB"
    static let description = IntentDescription("Talk hands-free with a thread. Defaults to the last thread you opened.")
    static let openAppWhenRun = true

    @Parameter(title: "Thread")
    var thread: ThreadEntity?

    @MainActor
    func perform() async throws -> some IntentResult {
        AppModel.shared.startVoiceChat(threadId: try thread?.threadId(on: AppModel.shared.serverURL))
        return .result()
    }
}

struct OpenThreadIntent: AppIntent {
    static let title: LocalizedStringResource = "Open BB thread"
    static let openAppWhenRun = true

    @Parameter(title: "Thread")
    var thread: ThreadEntity

    @MainActor
    func perform() async throws -> some IntentResult {
        AppModel.shared.openThread(try thread.threadId(on: AppModel.shared.serverURL))
        return .result()
    }
}

/// Hands-free: Siri asks for the message, sends it, and reads the reply back
/// without opening the app.
struct AskBBIntent: AppIntent {
    static let title: LocalizedStringResource = "Ask BB"
    static let description = IntentDescription(
        "Send a message to BB and hear the reply. Without a thread, it starts a new one in your default project.")

    @Parameter(title: "Message", requestValueDialog: "What should I ask BB?")
    var message: String

    @Parameter(title: "Thread")
    var thread: ThreadEntity?

    func perform() async throws -> some IntentResult & ProvidesDialog & ReturnsValue<String> {
        let client = BBClient()
        let threadId: String
        var baseline: String?
        if let thread {
            threadId = try thread.threadId(on: client.baseURL)
            baseline = try await client.latestReply(threadId)?.id
            try await client.send(threadId, text: message)
        } else {
            guard let projectId = try await defaultProjectId(client) else {
                return .result(value: "", dialog: "BB has no projects to start a thread in.")
            }
            threadId = try await client.createThread(projectId: projectId, text: message).id
            baseline = nil
        }
        guard let reply = try await client.waitForReply(threadId, after: baseline, timeout: .seconds(25)) else {
            return .result(value: "", dialog: "Sent. BB is still working, and you'll get a notification when it's done.")
        }
        guard client.baseURL == ServerScope.selectedURL else {
            return .result(value: "", dialog: "The server changed. Your message was sent to the original server.")
        }
        let spoken = VoiceChatEngine.speakable(reply)
        let dialog = spoken.count > 700 ? String(spoken.prefix(700)) + "… The rest is in the app." : spoken
        return .result(value: reply, dialog: IntentDialog(stringLiteral: dialog))
    }

    private func defaultProjectId(_ client: BBClient) async throws -> String? {
        let projects = try await client.projects()
        let saved = AppGroup.defaults.string(forKey: ServerScope.key("newThreadProjectId", serverURL: client.baseURL))
        return projects.first { $0.id == saved }?.id ?? projects.first?.id
    }
}

struct NewThreadIntent: AppIntent {
    static let title: LocalizedStringResource = "New BB thread"
    static let openAppWhenRun = true

    @MainActor
    func perform() async throws -> some IntentResult {
        AppModel.shared.newThread()
        return .result()
    }
}

struct CaptureIntent: AppIntent {
    static let title: LocalizedStringResource = "Capture to BB"
    static let description = IntentDescription("Choose what to save in BB Studio.")
    static let openAppWhenRun = true

    @MainActor
    func perform() async throws -> some IntentResult {
        AppModel.shared.sheet = .capture
        return .result()
    }
}

struct WriteIntent: AppIntent {
    static let title: LocalizedStringResource = "Write in BB Studio"
    static let description = IntentDescription("Open a blank note to save as a page or start a thread.")
    static let openAppWhenRun = true

    @MainActor
    func perform() async throws -> some IntentResult {
        AppModel.shared.sheet = .write
        return .result()
    }
}

struct BBShortcuts: AppShortcutsProvider {
    // Symbol names must be literals here; they match StudioKind and Symbols.
    static var appShortcuts: [AppShortcut] {
        AppShortcut(intent: CaptureIntent(), phrases: ["Capture in \(.applicationName)"], shortTitle: "Capture", systemImageName: "square.and.arrow.down")
        AppShortcut(intent: OpenPageIntent(), phrases: ["Open a page in \(.applicationName)"], shortTitle: "Open page", systemImageName: "doc.richtext")
        AppShortcut(intent: SendToThreadIntent(), phrases: ["Send to a thread in \(.applicationName)"], shortTitle: "Send to thread", systemImageName: "paperplane")
        AppShortcut(intent: StartRecordingIntent(), phrases: ["Start recording in \(.applicationName)"], shortTitle: "Record", systemImageName: "record.circle")
        AppShortcut(
            intent: AskBBIntent(), phrases: ["Ask \(.applicationName)", "Ask \(.applicationName) in \(\.$thread)"],
            shortTitle: "Ask BB", systemImageName: "bubble.left.and.text.bubble.right")
        AppShortcut(
            intent: DictateIntent(), phrases: ["Dictate to \(.applicationName)"], shortTitle: "Dictate",
            systemImageName: "mic.fill")
        AppShortcut(
            intent: VoiceChatIntent(), phrases: ["Voice chat with \(.applicationName)"], shortTitle: "Voice chat",
            systemImageName: "waveform.and.person.filled")
        AppShortcut(
            intent: NewThreadIntent(), phrases: ["New \(.applicationName) thread"], shortTitle: "New thread",
            systemImageName: "square.and.pencil")
        AppShortcut(
            intent: WriteIntent(), phrases: ["Write in \(.applicationName)", "Take a note in \(.applicationName)"],
            shortTitle: "Write", systemImageName: "square.and.pencil")
    }
}
