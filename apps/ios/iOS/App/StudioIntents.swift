import AppIntents

struct TaskEntity: AppEntity {
    static let typeDisplayRepresentation: TypeDisplayRepresentation = "BB task"
    static let defaultQuery = TaskQuery()
    var id: String
    var title: String
    var displayRepresentation: DisplayRepresentation { DisplayRepresentation(title: "\(title)") }
}

struct TaskQuery: EntityStringQuery {
    func entities(for identifiers: [String]) async throws -> [TaskEntity] {
        try await all().filter { identifiers.contains($0.id) }
    }
    func entities(matching string: String) async throws -> [TaskEntity] {
        try await all().filter { $0.title.localizedCaseInsensitiveContains(string) }
    }
    func suggestedEntities() async throws -> [TaskEntity] { Array(try await all().prefix(20)) }
    private func all() async throws -> [TaskEntity] {
        try await BBClient().tasksBoard().filter { !$0.archived }.map { TaskEntity(id: $0.id, title: $0.displayTitle) }
    }
}

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

struct AddTaskIntent: AppIntent {
    static let title: LocalizedStringResource = "Add BB task"
    static let description = IntentDescription("Add a task to the Studio board.")
    @Parameter(title: "Title") var title: String
    @Parameter(title: "Description") var description: String?

    func perform() async throws -> some IntentResult & ReturnsValue<String> {
        let task = try await BBClient().createTask(title: title, description: description ?? "", projectId: nil, due: nil, assignee: nil)
        return .result(value: task.id)
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

struct OpenTaskIntent: AppIntent {
    static let title: LocalizedStringResource = "Open BB task"
    static let openAppWhenRun = true
    @Parameter(title: "Task") var task: TaskEntity
    @MainActor func perform() async throws -> some IntentResult {
        AppModel.shared.openStudio(kind: nil, .task(id: task.id))
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
