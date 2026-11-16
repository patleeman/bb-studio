import Foundation

struct TaskRowRef: Hashable, Sendable {
    var id: String
    var home: String?
    var under: String?
    var depth = 0
    var open = true
    var workers: [String] = []
    var hasWorkers = false
    var needsYou = false
    var stalled = false
    var startedAt: Date?

    init(id: String, home: String? = nil, under: String? = nil, depth: Int = 0, open: Bool = true, workers: [String] = [],
         hasWorkers: Bool = false, needsYou: Bool = false, stalled: Bool = false, startedAt: Date? = nil) {
        self.id = id
        self.home = home
        self.under = under
        self.depth = depth
        self.open = open
        self.workers = workers
        self.hasWorkers = hasWorkers
        self.needsYou = needsYou
        self.stalled = stalled
        self.startedAt = startedAt
    }

    init(_ row: Studio.TasksFlightOutputRowsItem) {
        self.init(id: row.id ?? "", home: row.home, under: row.under, depth: row.depth ?? 0, open: row.open ?? true, workers: row.workers ?? [],
                  hasWorkers: row.hasWorkers ?? false, needsYou: row.needsYou ?? false, stalled: row.stalled ?? false,
                  startedAt: row.startedAt.map(Date.init(milliseconds:)))
    }

    static func legacy(_ task: TaskItem) -> TaskRowRef {
        TaskRowRef(id: task.id, open: !task.isClosed, needsYou: task.needsYou)
    }
}

struct TaskWorkerInfo: Hashable, Sendable {
    var threadId: String
    var name: String
    var status: String?
    var archived = false

    init(threadId: String, name: String, status: String? = nil, archived: Bool = false) {
        self.threadId = threadId
        self.name = name
        self.status = status
        self.archived = archived
    }

    init(_ item: Studio.TasksFlightOutputWorkersItem) {
        self.init(threadId: item.threadId ?? "", name: item.name ?? "", status: item.status, archived: item.archived ?? false)
    }
}

struct TaskCounts: Hashable, Sendable {
    var open = 0, running = 0, waiting = 0, todo = 0, needsYou = 0, done = 0, workers = 0

    init(open: Int = 0, running: Int = 0, waiting: Int = 0, todo: Int = 0, needsYou: Int = 0, done: Int = 0, workers: Int = 0) {
        self.open = open
        self.running = running
        self.waiting = waiting
        self.todo = todo
        self.needsYou = needsYou
        self.done = done
        self.workers = workers
    }

    init(_ counts: Studio.TasksFlightOutputCounts) {
        self.init(open: counts.open ?? 0, running: counts.running ?? 0, waiting: counts.waiting ?? 0, todo: counts.todo ?? 0,
                  needsYou: counts.needsYou ?? 0, done: counts.done ?? 0, workers: counts.workers ?? 0)
    }
}

struct FlightNode: Identifiable, Hashable, Sendable {
    var row: TaskRowRef
    var task: TaskItem
    var children: [FlightNode] = []
    var workers: [TaskWorkerInfo] = []

    var id: String { task.id }
    var isRunning: Bool { task.state == .inProgress && !task.stale && !row.stalled }
    var look: FlightLook { FlightLook(task, needsYou: row.needsYou, stalled: row.stalled) }

    var below: (subtasks: Int, workers: Int) {
        var subtasks = 0
        var seen = Set(workers.map(\.threadId))
        func walk(_ node: FlightNode) {
            for child in node.children {
                subtasks += 1
                for worker in child.workers { seen.insert(worker.threadId) }
                walk(child)
            }
        }
        walk(self)
        return (subtasks, seen.count)
    }

    var belowText: String? {
        let (subtasks, workers) = below
        let parts = [subtasks > 0 ? TaskTree.plural(subtasks, "subtask") : nil, workers > 0 ? TaskTree.plural(workers, "worker") : nil].compactMap { $0 }
        return parts.isEmpty ? nil : parts.joined(separator: " · ")
    }
}

enum FlightLook: String, Sendable {
    case running, waiting, needsYou = "needs-you", todo, done, failed

    init(_ task: TaskItem, needsYou: Bool = false, stalled: Bool = false) {
        if task.state == .failed { self = .failed }
        else if task.stale || task.isClosed { self = .done }
        else if task.needsYou || (needsYou && task.state != .inProgress) { self = .needsYou }
        else if task.state == .inProgress && !stalled { self = .running }
        else if task.state == .todo && task.isMine { self = .todo }
        else { self = .waiting }
    }

    var label: String {
        switch self {
        case .running: "Running"
        case .waiting: "Waiting"
        case .needsYou: "Needs you"
        case .todo: "To do"
        case .done: "Done"
        case .failed: "Failed"
        }
    }
}

struct StepProgress: Equatable, Sendable {
    var at: Int
    var of: Int
    var rest: String?

    var label: String { "\(at) of \(of)" }
    var fraction: Double { of > 0 ? Double(at) / Double(of) : 0 }

    init?(_ step: String?) {
        guard let step, let match = step.firstMatch(of: /(\d+)\s*(?:\/|[oO][fF])\s*(\d+)/),
              let at = Int(match.output.1), let of = Int(match.output.2), of > 0, at >= 0, at <= of else { return nil }
        self.at = at
        self.of = of
        var text = String(step[..<match.range.lowerBound]) + String(step[match.range.upperBound...])
        text = text.trimmingCharacters(in: .whitespaces)
        if text.lowercased().hasPrefix("step") { text = String(text.dropFirst(4)) }
        let edges = CharacterSet(charactersIn: " :·.-").union(.whitespaces)
        text = text.trimmingCharacters(in: edges)
        rest = text.isEmpty ? nil : text
    }
}

struct FlightText: Equatable, Sendable {
    var look: FlightLook
    var line: String?
    var right: String
    var elapsed: String?
    var aria: String
    var value: String
}

enum TaskTree {
    static func plural(_ n: Int, _ one: String) -> String { "\(n) \(one)\(n == 1 ? "" : "s")" }

    static func nodes(_ list: TaskList) -> [FlightNode] {
        let rows = list.rows ?? list.tasks.map(TaskRowRef.legacy)
        var byId: [String: TaskItem] = [:]
        for task in list.tasks where byId[task.id] == nil { byId[task.id] = task }
        var named: [String: TaskWorkerInfo] = [:]
        for worker in list.workers where named[worker.threadId] == nil { named[worker.threadId] = worker }
        var kids: [String: [TaskRowRef]] = [:]
        var roots: [TaskRowRef] = []
        var placed = Set<String>()
        for row in rows where byId[row.id] != nil && !placed.contains(row.id) {
            if let under = row.under, placed.contains(under) { kids[under, default: []].append(row) } else { roots.append(row) }
            placed.insert(row.id)
        }
        func make(_ row: TaskRowRef) -> FlightNode {
            FlightNode(row: row, task: byId[row.id]!, children: (kids[row.id] ?? []).map(make),
                       workers: row.workers.map { named[$0] ?? TaskWorkerInfo(threadId: $0, name: "A worker thread") })
        }
        return roots.map(make)
    }

    static func pageFlight(_ list: TaskList) -> [FlightNode] {
        let open = nodes(list).filter { $0.row.open && !isUserTodo($0.task) }
        return open.filter(\.isRunning) + open.filter { !$0.isRunning }
    }

    static func isUserTodo(_ task: TaskItem) -> Bool { task.isMine && task.kind != .waitingOutside }

    static func waitLabel(_ task: TaskItem, titleOf: (String) -> String? = { _ in nil }) -> (short: String, long: String) {
        let on = task.waitingOn ?? (task.kind == .waitingOutside ? .init(kind: "outside") : task.needsYou ? .init(kind: "user") : nil)
        guard let on else {
            if case .event(let event) = task.trigger { return ("waiting on an event", "Waiting on: \(LoopFormat.event(event))") }
            return task.state == .todo ? ("queued", "Queued") : ("waiting", "Waiting")
        }
        switch on.kind {
        case "user": return ("waiting on you", "Waiting on you")
        case "ci": return ("waiting on CI", on.text.map { "Waiting on CI: \($0)" } ?? on.ref.map { "Waiting on CI: \($0)" } ?? "Waiting on CI")
        case "task":
            let title = on.ref.flatMap(titleOf)
            return ("waiting on a task", title.map { "Waiting on \($0)" } ?? on.text.map { "Waiting on \($0)" } ?? "Waiting on another task")
        default:
            let who = on.text?.trimmingCharacters(in: .whitespaces)
            guard let who, !who.isEmpty else { return ("waiting on someone", "Waiting on someone outside") }
            return ("waiting on \(who)", "Waiting on \(who)")
        }
    }

    static func age(_ since: Date, now: Date) -> String {
        let seconds = max(0, now.timeIntervalSince(since))
        if seconds < 60 { return "now" }
        if seconds < 3600 { return "\(Int(seconds / 60))m" }
        if seconds < 86_400 { return "\(Int(seconds / 3600))h" }
        return "\(Int(seconds / 86_400))d"
    }

    static func text(_ node: FlightNode, owner: String?, now: Date = .now, titleOf: (String) -> String? = { _ in nil }) -> FlightText {
        let task = node.task
        let look = node.look
        let progress = StepProgress(task.step)
        let stalled = node.row.stalled && task.state == .inProgress
        let wait = stalled ? (short: "stalled", long: "Stalled: nothing has moved on it for over six hours") : waitLabel(task, titleOf: titleOf)
        let value = task.stale ? "ended" : look == .needsYou ? "needs-you" : stalled ? "stalled" : TaskRules.status(task).id
        if task.stale {
            let aria = [task.title, "ended without a final update", owner].compactMap { $0 }.joined(separator: ", ")
            return FlightText(look: look, line: task.line ?? "Ended without a final update", right: "Ended", elapsed: nil, aria: aria, value: value)
        }
        let line: String? = switch look {
        case .needsYou: task.needs.flatMap { $0.isEmpty ? nil : $0 } ?? task.line
        case .running: [progress.map(\.rest) ?? task.step, task.line].compactMap { $0 }.filter { !$0.isEmpty }.joined(separator: " · ").nilIfEmpty
        case .waiting: task.line ?? (wait.long.lowercased() == wait.short.lowercased() ? nil : wait.long)
        default: task.line
        }
        let right: String = switch look {
        case .done, .failed: look.label
        case .running: progress?.label ?? "Running"
        case .needsYou: "Needs you"
        case .todo: "To do"
        case .waiting: wait.short.prefix(1).uppercased() + wait.short.dropFirst()
        }
        let elapsed = look == .running ? age(node.row.startedAt ?? task.createdAt, now: now) : nil
        let state: String = switch look {
        case .running: progress.map { "running, step \($0.label)" } ?? "running"
        case .needsYou: "needs you"
        case .done, .failed, .todo: look.label.lowercased()
        case .waiting: wait.short
        }
        let aria = [task.title, state, owner, line, elapsed.map { "for \($0)" }].compactMap { $0 }.joined(separator: ", ")
        return FlightText(look: look, line: line, right: right, elapsed: elapsed, aria: aria, value: value)
    }

    static func merge(board: TaskList, list: TaskList?) -> TaskList {
        let open = board.tasks.filter { !$0.isClosed }
        let ids = Set(open.map(\.id))
        let rest = (list?.tasks ?? board.tasks.filter(\.isClosed)).filter { !ids.contains($0.id) && ($0.isClosed || $0.isRecurring) }
        var seen = Set<String>()
        let threads = (board.threads + (list?.threads ?? [])).filter { seen.insert($0.owner).inserted }
        return TaskList(tasks: open + rest, threads: threads)
    }
}

struct AreaItem: Hashable, Sendable {
    var title: String
    var since: String?
    var sinceAt: Date?
    var needsUser: Bool
    var taskId: String?
}

struct AreaSummary: Decodable, Hashable, Sendable {
    var id: String
    var name: String
    var status: String
    var ownerKind: String?
    var ownerThread: String?
    var open: [AreaItem]

    init(id: String, name: String, status: String = "ok", ownerKind: String? = nil, ownerThread: String? = nil, open: [AreaItem] = []) {
        self.id = id
        self.name = name
        self.status = status
        self.ownerKind = ownerKind
        self.ownerThread = ownerThread
        self.open = open
    }

    private enum Keys: String, CodingKey { case id, name, status, owner, open, kind, thread, title, since, sinceAt, needsUser, taskId }

    init(from decoder: Decoder) throws {
        let c = try decoder.container(keyedBy: Keys.self)
        id = try c.decodeIfPresent(String.self, forKey: .id) ?? ""
        name = try c.decodeIfPresent(String.self, forKey: .name) ?? ""
        status = try c.decodeIfPresent(String.self, forKey: .status) ?? "unknown"
        if let owner = try? c.nestedContainer(keyedBy: Keys.self, forKey: .owner) {
            ownerKind = try? owner.decodeIfPresent(String.self, forKey: .kind)
            ownerThread = try? owner.decodeIfPresent(String.self, forKey: .thread)
        }
        var items: [AreaItem] = []
        if var list = try? c.nestedUnkeyedContainer(forKey: .open) {
            while !list.isAtEnd {
                guard let item = try? list.nestedContainer(keyedBy: Keys.self) else { _ = try? list.decode(StudioJSONValue.self); continue }
                let title = (try? item.decodeIfPresent(String.self, forKey: .title)) ?? nil
                guard let title, !title.isEmpty else { continue }
                items.append(AreaItem(title: title, since: (try? item.decodeIfPresent(String.self, forKey: .since)) ?? nil,
                                      sinceAt: ((try? item.decodeIfPresent(Double.self, forKey: .sinceAt)) ?? nil).map(Date.init(milliseconds:)),
                                      needsUser: ((try? item.decodeIfPresent(Bool.self, forKey: .needsUser)) ?? nil) ?? false,
                                      taskId: (try? item.decodeIfPresent(String.self, forKey: .taskId)) ?? nil))
            }
        }
        open = items
    }
}

struct AreaList: Decodable, Sendable {
    var areas: [AreaSummary]

    private enum Keys: String, CodingKey { case areas }

    init(from decoder: Decoder) throws {
        let c = try decoder.container(keyedBy: Keys.self)
        areas = (try c.decodeIfPresent([AreaSummary].self, forKey: .areas) ?? []).filter { !$0.id.isEmpty }
    }
}

struct AreaAsk: Identifiable, Hashable, Sendable {
    var id: String
    var areaId: String
    var area: String
    var title: String
    var since: String?
    var sinceAt: Date?
    var taskId: String?
    var ownerThread: String?
}

enum AreaRules {
    static func rank(_ status: String) -> Int {
        switch status {
        case "broken": 0
        case "flagged": 1
        case "ok": 2
        default: 3
        }
    }

    static func order(_ areas: [AreaSummary]) -> [AreaSummary] {
        areas.enumerated().sorted { a, b in
            let ra = rank(a.element.status), rb = rank(b.element.status)
            if ra != rb { return ra < rb }
            let byName = a.element.name.localizedCompare(b.element.name)
            return byName == .orderedSame ? a.offset < b.offset : byName == .orderedAscending
        }.map(\.element)
    }

    static func asks(_ areas: [AreaSummary], tasks: [TaskItem]) -> [AreaAsk] {
        let mine = Set(tasks.filter { $0.owner == TaskItem.user }.map(\.id))
        return order(areas).flatMap { area in
            area.open.filter { item in item.needsUser && !(item.taskId.map(mine.contains) ?? false) }.enumerated().map { n, item in
                AreaAsk(id: "\(area.id):\(n):\(item.title)", areaId: area.id, area: area.name, title: item.title, since: item.since,
                        sinceAt: item.sinceAt, taskId: item.taskId, ownerThread: area.ownerThread)
            }
        }
    }

    static func age(_ ask: AreaAsk, now: Date = .now, calendar: Calendar = .current) -> String {
        guard let at = ask.sinceAt else { return ask.since?.trimmingCharacters(in: .whitespaces) ?? "" }
        let days = calendar.dateComponents([.day], from: calendar.startOfDay(for: at), to: calendar.startOfDay(for: now)).day ?? 0
        if days <= 0 { return "today" }
        if days == 1 { return "1 day" }
        if days < 7 { return "\(days) days" }
        let style = Date.FormatStyle(locale: Locale(identifier: "en_US"), calendar: calendar, timeZone: calendar.timeZone).month(.abbreviated).day()
        return at.formatted(style)
    }

    static func label(_ ask: AreaAsk, now: Date = .now, calendar: Calendar = .current) -> String {
        let age = age(ask, now: now, calendar: calendar)
        return "\(ask.title), needs you, from \(ask.area)\(age.isEmpty ? "" : ", \(age)")"
    }
}

private extension String {
    var nilIfEmpty: String? { isEmpty ? nil : self }
}
