import AppIntents

struct PageEntity: AppEntity {
    static let typeDisplayRepresentation: TypeDisplayRepresentation = "BB page"
    static let defaultQuery = PageQuery()
    var id: String
    var title: String
    var displayRepresentation: DisplayRepresentation { DisplayRepresentation(title: "\(title)") }
}

struct PageQuery: EntityStringQuery {
    func entities(for identifiers: [String]) async throws -> [PageEntity] {
        try await all().filter { identifiers.contains($0.id) }
    }
    func entities(matching string: String) async throws -> [PageEntity] {
        try await all().filter { $0.title.localizedCaseInsensitiveContains(string) }
    }
    func suggestedEntities() async throws -> [PageEntity] { Array(try await all().prefix(20)) }
    private func all() async throws -> [PageEntity] {
        try await BBClient().pages().filter { $0.archived != true }.map { PageEntity(id: $0.id, title: $0.displayTitle) }
    }
}

struct OpenPageIntent: AppIntent {
    static let title: LocalizedStringResource = "Open BB page"
    static let openAppWhenRun = true
    @Parameter(title: "Page") var page: PageEntity
    @MainActor func perform() async throws -> some IntentResult {
        AppModel.shared.openPage(page.id)
        return .result()
    }
}

struct SendToThreadIntent: AppIntent {
    static let title: LocalizedStringResource = "Send to BB thread"
    @Parameter(title: "Thread") var thread: ThreadEntity
    @Parameter(title: "Message") var message: String
    func perform() async throws -> some IntentResult {
        _ = try await BBClient().send(thread.id, text: message)
        return .result()
    }
}

struct StartRecordingIntent: AppIntent {
    static let title: LocalizedStringResource = "Start BB recording"
    static let openAppWhenRun = true
    @MainActor func perform() async throws -> some IntentResult {
        AppModel.shared.sheet = .recording
        return .result()
    }
}
