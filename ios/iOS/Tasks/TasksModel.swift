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

struct TaskList: Decodable, Sendable, Equatable {
    var tasks: [TaskItem]
    var threads: [TaskThreadName]

    private enum CodingKeys: String, CodingKey { case tasks, threads }

    init(tasks: [TaskItem], threads: [TaskThreadName]) {
        self.tasks = tasks
        self.threads = threads
    }

    init(from decoder: Decoder) throws {
        let c = try decoder.container(keyedBy: CodingKeys.self)
        tasks = (try c.decodeIfPresent([Studio.TasksGetOutputTask].self, forKey: .tasks) ?? []).map(TaskItem.init).filter { !$0.id.isEmpty }
        threads = (try c.decodeIfPresent([Studio.TasksGetOutputThreadsItem].self, forKey: .threads) ?? []).map(TaskThreadName.init)
    }
}

private struct TaskGetPayload: Decodable {
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

enum TaskRequests {
    static func get(_ id: String) -> JSONValue { json(Studio.TasksGetInput(id: id)) }
    static func inFlight(_ threadId: String) -> JSONValue { json(Studio.TasksInFlightInput(threadId: threadId)) }
    static func dismiss(_ id: String) -> JSONValue { json(Studio.WorkDismissInput(id: id)) }
    static func clear(_ threadId: String) -> JSONValue { json(Studio.WorkClearInput(threadId: threadId)) }

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
    func taskList() async throws -> TaskList {
        try await rpc("studio", Studio.Method.tasks_list, .object([:]))
    }

    func task(_ id: String) async throws -> TaskView {
        let payload: TaskGetPayload = try await rpc("studio", Studio.Method.tasks_get, TaskRequests.get(id))
        guard let view = payload.view else { throw BBError(status: 404, message: "Task not found") }
        return view
    }

    func taskAction(_ id: String, _ action: TaskAction) async throws -> (task: TaskItem?, note: String?) {
        let payload: TaskActPayload = try await rpc("studio", Studio.Method.tasks_act, TaskRequests.act(id, action))
        return (payload.task, payload.note)
    }

    func tasksInFlight(_ threadId: String) async throws -> TaskList {
        try await rpc("studio", Studio.Method.tasks_inFlight, TaskRequests.inFlight(threadId))
    }

    func dismissWork(_ id: String) async throws {
        let _: JSONValue = try await rpc("studio", Studio.Method.work_dismiss, TaskRequests.dismiss(id))
    }

    func clearDoneWork(_ threadId: String) async throws {
        let _: JSONValue = try await rpc("studio", Studio.Method.work_clear, TaskRequests.clear(threadId))
    }
}

@MainActor @Observable
final class TasksModel {
    static let shared = TasksModel()

    private(set) var supported: Bool?
    private(set) var list: TaskList?
    private(set) var listError: String?
    private(set) var views: [String: TaskView] = [:]
    private(set) var failures: [String: String] = [:]
    private(set) var flights: [String: TaskList] = [:]
    private(set) var flightErrors: [String: String] = [:]
    private(set) var handedOff: [String: Date] = [:]
    var focus: String?
    var botThreadId: String?
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
            supported = nil
            list = nil
            listError = nil
            views = [:]
            failures = [:]
            flights = [:]
            flightErrors = [:]
            handedOff = [:]
        }
        return client
    }

    var tasks: [TaskItem] { list?.tasks ?? [] }

    var names: TaskNames {
        var threads = list?.threads ?? []
        for flight in flights.values { threads += flight.threads }
        for view in views.values { threads += view.threads }
        return TaskNames(bot: LoopsModel.shared.botName, leads: LoopsModel.shared.leads, threads: threads, botThreadId: botThreadId)
    }

    func task(_ id: String) -> TaskItem? {
        views[id]?.task ?? list?.tasks.first { $0.id == id } ?? flights.values.lazy.compactMap { $0.tasks.first { $0.id == id } }.first
    }

    var today: [TaskItem] { TaskRules.today(tasks) }

    func roomCards(now: Date = .now) -> [TaskItem] {
        let today = TaskRules.today(tasks, now: now)
        let recent = tasks.filter { task in
            guard let at = handedOff[task.id], now.timeIntervalSince(at) < 600, !task.isMine, !task.isClosed else { return false }
            return !today.contains { $0.id == task.id }
        }
        return recent + today
    }

    private func learn(_ error: Error) {
        if BBClient.isUnknownRPC(error), supported != false { supported = false }
    }

    private func reached() {
        if supported != true { supported = true }
    }

    func refresh() async {
        let client = client
        do {
            let next = try await client.taskList()
            guard client.baseURL == server else { return }
            reached()
            if listError != nil { listError = nil }
            guard next != list else { return }
            list = next
            for task in next.tasks where views[task.id].map({ $0.task != task }) == true { views[task.id]?.task = task }
        } catch where BBClient.isCancellation(error) {
        } catch {
            learn(error)
            let message = BBClient.describe(error)
            if listError != message { listError = message }
        }
    }

    func load(_ id: String) async {
        let client = client
        do {
            let view = try await client.task(id)
            guard client.baseURL == server else { return }
            reached()
            if views[id] != view { views[id] = view }
            if failures[id] != nil { failures[id] = nil }
        } catch where BBClient.isCancellation(error) {
        } catch {
            let missing = BBClient.isUnknownRPC(error)
            if missing && supported == nil { await refresh() }
            guard !(missing && supported == false), views[id] == nil else { return }
            let message = missing ? "This task was removed." : BBClient.describe(error)
            if failures[id] != message { failures[id] = message }
        }
    }

    @discardableResult
    func perform(_ id: String, _ action: TaskAction) async throws -> String? {
        let client = client
        let answer = try await client.taskAction(id, action)
        if let task = answer.task { store(task) }
        switch action {
        case .handOff: handedOff[id] = .now
        case .takeBack: handedOff[id] = nil
        default: break
        }
        await load(id)
        await refresh()
        for threadId in flights.keys { await loadFlight(threadId) }
        return answer.note
    }

    func add(_ text: String) async throws {
        try await client.addLoop(text)
        await refresh()
    }

    func loadFlight(_ threadId: String) async {
        let client = client
        do {
            let next = try await client.tasksInFlight(threadId)
            guard client.baseURL == server else { return }
            reached()
            if flightErrors[threadId] != nil { flightErrors[threadId] = nil }
            if flights[threadId] != next { flights[threadId] = next }
        } catch where BBClient.isCancellation(error) {
        } catch {
            learn(error)
            let message = BBClient.describe(error)
            if flightErrors[threadId] != message { flightErrors[threadId] = message }
        }
    }

    func dismiss(_ id: String, in threadId: String) async throws {
        try await client.dismissWork(id)
        await loadFlight(threadId)
    }

    func clearDone(in threadId: String) async throws {
        try await client.clearDoneWork(threadId)
        await loadFlight(threadId)
    }

    private func store(_ task: TaskItem) {
        views[task.id]?.task = task
        if var list, let index = list.tasks.firstIndex(where: { $0.id == task.id }) {
            list.tasks[index] = task
            self.list = list
        }
        for (threadId, var flight) in flights {
            guard let index = flight.tasks.firstIndex(where: { $0.id == task.id }) else { continue }
            flight.tasks[index] = task
            flights[threadId] = flight
        }
        failures[task.id] = nil
    }

}
