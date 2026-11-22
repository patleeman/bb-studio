import Foundation
import Observation

struct TaskEvent: Hashable, Sendable {
    var type: String
    var at: Date
    var data: String
}

struct TaskView: Sendable, Equatable {
    var task: TaskItem
    var history: [TaskEvent]
    var todo: Bool
    var threads: [TaskThreadName]
    var runs: [TaskItem]
}

struct TaskGetPayload: Decodable {
    var view: TaskView?

    private enum CodingKeys: String, CodingKey { case task, history, todo, threads, runs }

    init(from decoder: Decoder) throws {
        let c = try decoder.container(keyedBy: CodingKeys.self)
        guard let task = try c.decodeIfPresent(Studio.TasksGetOutputTask.self, forKey: .task).map(TaskItem.init), !task.id.isEmpty else {
            view = nil
            return
        }
        let history = (try c.decodeIfPresent([Studio.TasksGetOutputHistoryItem].self, forKey: .history) ?? []).map {
            TaskEvent(type: $0.type ?? "", at: Date(milliseconds: $0.at ?? 0), data: $0.data ?? "")
        }
        view = TaskView(task: task, history: history, todo: try c.decodeIfPresent(Bool.self, forKey: .todo) ?? false,
                        threads: (try c.decodeIfPresent([Studio.TasksGetOutputThreadsItem].self, forKey: .threads) ?? []).map(TaskThreadName.init),
                        runs: (try c.decodeIfPresent([Studio.TasksGetOutputTask].self, forKey: .runs) ?? []).map(TaskItem.init))
    }
}

private struct TaskActPayload: Decodable {
    var task: TaskItem?
    var note: String?

    private enum CodingKeys: String, CodingKey { case task, note }

    init(from decoder: Decoder) throws {
        let c = try decoder.container(keyedBy: CodingKeys.self)
        task = try c.decodeIfPresent(Studio.TasksGetOutputTask.self, forKey: .task).map(TaskItem.init)
        note = try c.decodeIfPresent(String.self, forKey: .note)
    }
}

extension TaskThreadName {
    init(_ item: Studio.TasksGetOutputThreadsItem) {
        self.init(owner: item.owner ?? "", name: item.name ?? "", threadId: item.threadId)
    }
}

enum TaskAction: Equatable, Hashable, Sendable {
    case done, gotIt, drop, keep, reopen, takeBack
    case choose(String)
    case snooze(LoopSnooze)
    case handOff(String)

    var wire: Studio.TasksActInputAction {
        switch self {
        case .done: .done
        case .gotIt: .got_it
        case .drop: .drop
        case .keep: .keep
        case .reopen: .reopen
        case .takeBack: .take_back
        case .choose: .choose
        case .snooze: .snooze
        case .handOff: .hand_off
        }
    }

    var input: Studio.TasksActInput {
        switch self {
        case .choose(let option): .init(action: wire, option: option)
        case .handOff(let to): .init(action: wire, to: to)
        case .snooze(let snooze):
            if let preset = snooze.preset {
                .init(action: wire, snooze: Studio.TasksActInputSnooze(from: preset))
            } else {
                .init(action: wire, at: snooze.date()?.milliseconds)
            }
        default: .init(action: wire)
        }
    }
}

extension Studio.TasksActInputSnooze {
    init(from preset: Studio.LoopsActInputSnooze) {
        self = switch preset {
        case .later_today: .later_today
        case .tonight: .tonight
        case .tomorrow_morning: .tomorrow_morning
        case .this_weekend: .this_weekend
        case .home: .home
        case .mac: .mac
        case .unknown(let value): .unknown(value)
        }
    }
}

/// The lock screen's loop buttons (`LoopNotifications`) still act on a task.
enum TaskRequests {
    static func get(_ id: String) -> JSONValue { json(Studio.TasksGetInput(id: id)) }

    static func act(_ id: String, _ action: TaskAction) -> JSONValue {
        var input = action.input
        input.id = id
        return json(input)
    }

    static func json<T: Encodable>(_ value: T) -> JSONValue {
        (try? JSONDecoder().decode(JSONValue.self, from: JSONEncoder().encode(value))) ?? .null
    }
}

extension BBClient {
    /// One task, read only (`tasks.get`): an old `::loop` or `::work` card.
    func task(_ id: String) async throws -> TaskView {
        let payload: TaskGetPayload = try await rpc("studio", Studio.Method.tasks_get, TaskRequests.get(id))
        guard let view = payload.view else { throw BBError(status: 404, message: "Task not found") }
        return view
    }

    func taskAction(_ id: String, _ action: TaskAction) async throws -> (task: TaskItem?, note: String?) {
        let payload: TaskActPayload = try await rpc("studio", Studio.Method.tasks_act, TaskRequests.act(id, action))
        return (payload.task, payload.note)
    }
}

/// Old `::loop` and `::work` cards in messages, read only: personal to-dos
/// and In flight are gone, and Studio still answers `tasks.get`.
@MainActor @Observable
final class TasksModel {
    static let shared = TasksModel()

    private(set) var views: [String: TaskView] = [:]
    private(set) var failures: [String: String] = [:]
    private var server: URL?
    private let fixed: BBClient?

    init(client: BBClient? = nil) {
        fixed = client
    }

    private var client: BBClient {
        #if DEBUG
        TasksDemo.installIfNeeded()
        #endif
        let client = fixed ?? AppModel.shared.client
        if server != client.baseURL {
            server = client.baseURL
            views = [:]
            failures = [:]
        }
        return client
    }

    var names: TaskNames {
        TaskNames(bot: BotSpacesStore.shared.spaces?.current?.name ?? BotInfo.defaultName,
                  threads: views.values.flatMap(\.threads),
                  botThreadId: BotSpacesStore.shared.spaces?.current?.mainThreadId)
    }

    func task(_ id: String) -> TaskItem? { views[id]?.task }

    func load(_ id: String) async {
        let client = client
        do {
            let view = try await client.task(id)
            guard client.baseURL == server else { return }
            if views[id] != view { views[id] = view }
            if failures[id] != nil { failures[id] = nil }
        } catch where BBClient.isCancellation(error) {
        } catch {
            guard views[id] == nil else { return }
            let message = BBClient.isUnknownRPC(error) ? "This task was removed." : BBClient.describe(error)
            if failures[id] != message { failures[id] = message }
        }
    }
}
