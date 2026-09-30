import Foundation

/// A task on the Studio Tasks board: a title, a Markdown description, a due
/// day, who it's for, and the threads it was handed to.
public struct StudioTask: Codable, Identifiable, Hashable, Sendable {
    public var id: String
    public var title: String
    public var description: String
    public var status: String
    public var projectId: String?
    /// A day, "2026-10-01".
    public var due: String?
    /// "me", "agent" or nil.
    public var assignee: String?
    public var createdAt: Double
    public var updatedAt: Double
    public var updatedBy: String?
    public var doneAt: Double?
    public var archived: Bool
    /// The newest handoff, which is the one that moves the task.
    public var handoff: TaskHandoff?
    /// Handoffs whose thread is still around.
    public var openThreads: Int
    public var links: Int

    public var displayTitle: String { title.isEmpty ? "Untitled task" : title }

    public static let statuses = ["todo", "in_progress", "review", "done"]

    public static func statusLabel(_ status: String) -> String {
        ["todo": "To do", "in_progress": "In progress", "review": "Review", "done": "Done"][status] ?? status
    }

    public static func isId(_ value: String) -> Bool { value.wholeMatch(of: /tsk_[0-9a-z]{16}/) != nil }

    /// Past due and not done. Days compare as text.
    public var isOverdue: Bool {
        guard let due, status != "done" else { return false }
        return due < Self.day(Date())
    }

    public static func day(_ date: Date) -> String {
        let parts = Calendar.current.dateComponents([.year, .month, .day], from: date)
        return String(format: "%04d-%02d-%02d", parts.year ?? 0, parts.month ?? 0, parts.day ?? 0)
    }

    public static func date(_ day: String) -> Date? {
        let parts = day.split(separator: "-").compactMap { Int($0) }
        guard parts.count == 3 else { return nil }
        return Calendar.current.date(from: DateComponents(year: parts[0], month: parts[1], day: parts[2], hour: 12))
    }

    /// "Today", "Tomorrow", "Yesterday", "Oct 3", or "Oct 3, 2027" in another year.
    public static func formatDue(_ day: String) -> String {
        guard let date = date(day) else { return day }
        let calendar = Calendar.current
        if calendar.isDateInToday(date) { return "Today" }
        if calendar.isDateInTomorrow(date) { return "Tomorrow" }
        if calendar.isDateInYesterday(date) { return "Yesterday" }
        let sameYear = calendar.component(.year, from: date) == calendar.component(.year, from: Date())
        return date.formatted(sameYear ? .dateTime.month(.abbreviated).day() : .dateTime.month(.abbreviated).day().year())
    }
}

/// A thread a task was handed to, and where it stands.
public struct TaskHandoff: Codable, Hashable, Sendable {
    public var threadId: String
    /// starting, working, needs-input, replied, ready, failed, archived, deleted.
    public var state: String
    public var note: String?
    public var agent: String?
    public var createdAt: Double
    public var updatedAt: Double

    public var label: String {
        [
            "starting": "Starting agent", "working": "Agent working", "needs-input": "Agent needs your input",
            "replied": "Agent replied, check its answer", "ready": "Agent says it's ready for review",
            "failed": "Agent failed", "archived": "Thread archived", "deleted": "Thread deleted",
        ][state] ?? state
    }

    /// The short form for rows.
    public var shortLabel: String {
        [
            "starting": "Starting", "working": "Agent working", "needs-input": "Needs your input",
            "replied": "Agent replied", "ready": "Ready for review", "failed": "Agent failed",
            "archived": "Thread archived", "deleted": "Thread deleted",
        ][state] ?? state
    }

    public var isOpen: Bool { state != "archived" && state != "deleted" }
}

/// A thread or another Studio item a task links to.
public struct TaskLink: Codable, Hashable, Sendable {
    /// "thread" or "item".
    public var target: String
    public var pluginId: String?
    public var itemId: String
    public var label: String
    public var href: String?

    public init(target: String, pluginId: String?, itemId: String, label: String, href: String?) {
        self.target = target
        self.pluginId = pluginId
        self.itemId = itemId
        self.label = label
        self.href = href
    }
}

/// Something a task can link to, from `linkables`: a Studio item or a thread.
public struct TaskLinkable: Decodable, Hashable, Identifiable, Sendable {
    public var target: String
    public var pluginId: String?
    public var itemId: String
    public var label: String
    public var href: String?
    /// "Page", "Drawing", "Thread" and so on.
    public var kind: String
    public var id: String { "\(target):\(pluginId ?? ""):\(itemId)" }
    public var link: TaskLink { TaskLink(target: target, pluginId: pluginId, itemId: itemId, label: label, href: href) }
}

public struct TaskDetail: Sendable {
    public var task: StudioTask?
    public var links: [TaskLink]
    public var handoffs: [TaskHandoff]
}

extension BBClient {
    private struct OK: Decodable { var ok: Bool }

    public func tasksBoard(includeArchived: Bool = false) async throws -> [StudioTask] {
        struct Result: Decodable { var tasks: [StudioTask] }
        let result: Result = try await rpc("studio-tasks", "board", ["includeArchived": .bool(includeArchived)])
        return result.tasks
    }

    public func task(_ id: String) async throws -> TaskDetail {
        struct Result: Decodable {
            var task: StudioTask?
            var links: [TaskLink]
            var handoffs: [TaskHandoff]
        }
        let result: Result = try await rpc("studio-tasks", "get", ["id": .string(id)])
        return TaskDetail(task: result.task, links: result.links, handoffs: result.handoffs)
    }

    public func createTask(
        title: String, description: String, status: String = "todo", projectId: String?, due: String?, assignee: String?
    ) async throws -> StudioTask {
        struct Result: Decodable { var task: StudioTask }
        let result: Result = try await rpc("studio-tasks", "create", [
            "title": .string(title), "description": .string(description), "status": .string(status),
            "projectId": projectId.map(JSONValue.string) ?? .null, "due": due.map(JSONValue.string) ?? .null,
            "assignee": assignee.map(JSONValue.string) ?? .null,
        ])
        return result.task
    }

    /// Saves every field; the board has no partial edits worth the extra calls.
    public func updateTask(
        _ id: String, title: String, description: String, projectId: String?, due: String?, assignee: String?
    ) async throws {
        let _: OK = try await rpc("studio-tasks", "update", [
            "id": .string(id), "title": .string(title), "description": .string(description),
            "projectId": projectId.map(JSONValue.string) ?? .null, "due": due.map(JSONValue.string) ?? .null,
            "assignee": assignee.map(JSONValue.string) ?? .null,
        ])
    }

    /// Puts the task in a column. Returns how many handed-off threads BB archived with it.
    @discardableResult
    public func moveTask(_ id: String, to status: String) async throws -> Int {
        struct Result: Decodable { var archivedThreads: Int }
        let result: Result = try await rpc("studio-tasks", "move", ["id": .string(id), "status": .string(status)])
        return result.archivedThreads
    }

    public func archiveTask(_ id: String, archived: Bool) async throws {
        let _: OK = try await rpc("studio-tasks", "archive", ["id": .string(id), "archived": .bool(archived)])
    }

    public func deleteTask(_ id: String) async throws {
        let _: OK = try await rpc("studio-tasks", "delete", ["id": .string(id)])
    }

    public func unlinkTask(_ id: String, link: TaskLink) async throws {
        let _: OK = try await rpc("studio-tasks", "unlink", [
            "id": .string(id), "target": .string(link.target), "itemId": .string(link.itemId),
        ])
    }

    /// Pages, drawings, artifacts, recordings and the project's recent threads.
    public func taskLinkables(projectId: String?) async throws -> [TaskLinkable] {
        struct Result: Decodable { var items: [TaskLinkable] }
        let result: Result = try await rpc("studio-tasks", "linkables", ["projectId": projectId.map(JSONValue.string) ?? .null])
        return result.items
    }

    public func linkTask(_ id: String, link: TaskLink) async throws {
        let _: OK = try await rpc("studio-tasks", "link", [
            "id": .string(id),
            "link": [
                "target": .string(link.target), "pluginId": link.pluginId.map(JSONValue.string) ?? .null,
                "itemId": .string(link.itemId), "label": .string(link.label), "href": link.href.map(JSONValue.string) ?? .null,
            ],
        ])
    }

    /// Starts a thread on the task; nil agent settings mean the project's default. "worktree" keeps its changes apart.
    public func handOffTask(
        _ id: String, projectId: String?, providerId: String? = nil, model: String? = nil, reasoningLevel: String? = nil,
        note: String?, workspace: String
    ) async throws -> String {
        struct Result: Decodable { var threadId: String }
        let result: Result = try await rpc("studio-tasks", "handOff", [
            "id": .string(id), "projectId": projectId.map(JSONValue.string) ?? .null,
            "providerId": providerId.map(JSONValue.string) ?? .null, "model": model.map(JSONValue.string) ?? .null,
            "reasoningLevel": reasoningLevel.map(JSONValue.string) ?? .null,
            "note": note.map(JSONValue.string) ?? .null, "workspace": .string(workspace),
        ])
        return result.threadId
    }

    /// Review feedback into the latest handoff's thread.
    public func sendBackTask(_ id: String, message: String) async throws -> String {
        struct Result: Decodable { var threadId: String }
        let result: Result = try await rpc("studio-tasks", "sendBack", ["id": .string(id), "message": .string(message)])
        return result.threadId
    }

    public func archiveTaskThreads(_ id: String) async throws -> (archived: Int, failed: Int) {
        struct Result: Decodable {
            var archived: Int
            var failed: Int
        }
        let result: Result = try await rpc("studio-tasks", "archiveThreads", ["id": .string(id)])
        return (result.archived, result.failed)
    }

    public func tasksSettings() async throws -> Bool {
        struct Result: Decodable { var archiveThreadsOnDone: Bool }
        let result: Result = try await rpc("studio-tasks", "settings")
        return result.archiveThreadsOnDone
    }
}
