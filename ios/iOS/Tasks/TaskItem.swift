import Foundation

struct TaskItem: Identifiable, Hashable, Sendable {
    enum State: String, Sendable { case todo, inProgress = "in_progress", waiting, done, dropped, failed }
    enum Kind: String, Sendable { case `do`, decide, read, waitingOutside = "waiting-outside" }

    struct Automation: Hashable, Sendable {
        var kind: String
        var role: String
        var count: Int
        var severity: String?
    }

    var id: String
    var title: String
    var why: String
    var owner: String
    var state: State
    var kind: Kind
    var options: [String]
    var needs: String?
    var priority: LoopItem.Priority
    var conversation: String?
    var project: String?
    var area: String?
    var due: Date?
    var trigger: LoopItem.Trigger
    var snoozed: Bool
    var queue: String?
    var step: String?
    var line: String?
    var workers: [String]
    var parentId: String?
    var scheduleText: String?
    var schedulePaused: Bool
    var cardKind: String?
    var cardDismissed: Bool
    var automation: Automation?
    var stale: Bool
    var origin: String
    var createdAt: Date
    var updatedAt: Date
    var closedAt: Date?
    var closedBy: String?

    init(id: String, title: String, why: String = "", owner: String = TaskItem.user, state: State = .todo, kind: Kind = .do,
         options: [String] = [], needs: String? = nil, priority: LoopItem.Priority = .normal, conversation: String? = nil,
         area: String? = nil, due: Date? = nil, trigger: LoopItem.Trigger = .none, snoozed: Bool = false, queue: String? = "surfaced",
         step: String? = nil, line: String? = nil, workers: [String] = [], cardKind: String? = nil, automation: Automation? = nil,
         stale: Bool = false, origin: String = "task", createdAt: Date = .now, updatedAt: Date? = nil, closedAt: Date? = nil, closedBy: String? = nil) {
        self.id = id
        self.title = title
        self.why = why
        self.owner = owner
        self.state = state
        self.kind = kind
        self.options = options
        self.needs = needs
        self.priority = priority
        self.conversation = conversation
        self.project = nil
        self.area = area
        self.due = due
        self.trigger = trigger
        self.snoozed = snoozed
        self.queue = queue
        self.step = step
        self.line = line
        self.workers = workers
        self.parentId = nil
        self.scheduleText = nil
        self.schedulePaused = false
        self.cardKind = cardKind
        self.cardDismissed = false
        self.automation = automation
        self.stale = stale
        self.origin = origin
        self.createdAt = createdAt
        self.updatedAt = updatedAt ?? createdAt
        self.closedAt = closedAt
        self.closedBy = closedBy
    }

    init(_ task: Studio.TasksGetOutputTask) {
        id = task.id ?? ""
        title = task.title ?? ""
        why = task.why ?? ""
        owner = task.owner ?? Self.user
        state = State(rawValue: task.state.map(Self.raw) ?? "") ?? .todo
        kind = Kind(rawValue: task.kind.map(Self.raw) ?? "") ?? .do
        options = task.options ?? []
        needs = task.needs
        priority = LoopItem.Priority(rawValue: task.priority.map(Self.raw) ?? "") ?? .normal
        conversation = task.conversation
        project = task.project
        area = task.area
        due = task.timing?.due.map(Date.init(milliseconds:))
        let trigger = task.timing?.trigger
        self.trigger = switch trigger?.type.map(Self.raw) {
        case "time": trigger?.at.map { .time(Date(milliseconds: $0)) } ?? .none
        case "event": trigger?.event.map { .event($0) } ?? .none
        case "place": trigger?.place.map { .place($0, arrive: trigger?.direction.map(Self.raw) != "leave") } ?? .none
        default: .none
        }
        snoozed = task.timing?.snoozed ?? false
        queue = task.attention?.queue.map(Self.raw)
        step = task.progress?.step
        line = task.progress?.line
        workers = task.workers ?? []
        parentId = task.parentId
        scheduleText = task.schedule?.text
        schedulePaused = task.schedule?.paused ?? false
        cardKind = task.card?.kind.map(Self.raw)
        cardDismissed = task.card?.dismissedAt != nil
        automation = task.automation.flatMap { auto in
            guard let kind = auto.kind.map(Self.raw), let role = auto.role.map(Self.raw) else { return nil }
            return Automation(kind: kind, role: role, count: auto.count ?? 0, severity: auto.severity.map(Self.raw))
        }
        stale = task.stale ?? false
        origin = task.origin.map(Self.raw) ?? "task"
        createdAt = Date(milliseconds: task.createdAt ?? 0)
        updatedAt = Date(milliseconds: task.updatedAt ?? 0)
        closedAt = task.closedAt.map(Date.init(milliseconds:))
        closedBy = task.closedBy
    }

    init(loop: LoopItem) {
        let closed = loop.isClosed
        self.init(id: loop.id, title: loop.title, why: loop.why, owner: LoopItem.isYou(loop.owner) ? Self.user : loop.owner,
                  state: loop.status == .done ? .done : loop.status == .dropped ? .dropped : loop.status == .inProgress ? .inProgress : loop.kind == .waiting ? .waiting : .todo,
                  kind: loop.kind == .waiting ? .waitingOutside : Kind(rawValue: loop.kind.rawValue) ?? .do,
                  options: loop.options, priority: loop.priority, area: loop.area, due: loop.due, trigger: loop.trigger,
                  snoozed: loop.status == .snoozed, queue: loop.status == .surfaced ? "surfaced" : loop.status == .queued || loop.status == .snoozed ? "queued" : nil,
                  origin: "loop", createdAt: loop.createdAt, updatedAt: loop.updatedAt, closedAt: closed ? loop.closedAt ?? loop.updatedAt : nil, closedBy: loop.closedBy)
    }

    private static func raw<T: Encodable>(_ value: T) -> String {
        (try? JSONDecoder().decode(String.self, from: JSONEncoder().encode(value))) ?? ""
    }

    static let user = "patrick"
    static func isYou(_ owner: String?) -> Bool { owner == "patrick" || owner == "user" }

    var isClosed: Bool { [.done, .dropped, .failed].contains(state) }
    var isMine: Bool { Self.isYou(owner) }
    var needsYou: Bool { isMine && state == .waiting && kind != .waitingOutside }
    var isRecurring: Bool { automation?.role == "schedule" }
    var ownerThreadId: String? { owner.hasPrefix("thread:") ? String(owner.dropFirst(7)) : nil }
    var isTodo: Bool { automation != nil ? isMine : origin != "work" }
    var canSnooze: Bool { isTodo && isMine && !isClosed }

    var date: Date? {
        if let due { return due }
        if case .time(let at) = trigger { return at }
        return nil
    }
}

struct TaskStatus: Equatable {
    enum Glyph: Equatable { case needsYou, running, waiting, done, failed, todo, dropped }
    enum Tone: Equatable { case warning, destructive, muted, plain, success }
    var id: String
    var label: String
    var glyph: Glyph
    var tone: Tone
    var stale = false
}

enum TaskSection: String, CaseIterable, Identifiable {
    case today, later, agents, waiting, scheduled, done

    var id: String { rawValue }

    var title: String {
        switch self {
        case .today: "Today"
        case .later: "Later"
        case .agents: "Agents on it"
        case .waiting: "Waiting"
        case .scheduled: "Scheduled & recurring"
        case .done: "Done"
        }
    }
}

enum TaskRules {
    static func status(_ task: TaskItem) -> TaskStatus {
        if task.isRecurring && !task.isClosed {
            return task.schedulePaused ? .init(id: "paused", label: "Paused", glyph: .waiting, tone: .muted) : .init(id: "active", label: "Active", glyph: .running, tone: .plain)
        }
        if task.stale { return .init(id: "ended", label: "Ended", glyph: .done, tone: .muted, stale: true) }
        switch task.state {
        case .failed: return .init(id: "failed", label: "Failed", glyph: .failed, tone: .destructive)
        case .dropped: return .init(id: "dropped", label: "Dismissed", glyph: .dropped, tone: .muted)
        case .done: return .init(id: "done", label: "Done", glyph: .done, tone: .success)
        default: break
        }
        if task.needsYou { return .init(id: "needs-you", label: "Needs you", glyph: .needsYou, tone: .warning) }
        if task.isMine {
            if task.kind == .waitingOutside { return .init(id: "waiting-outside", label: "Waiting on others", glyph: .waiting, tone: .muted) }
            if task.snoozed { return .init(id: "snoozed", label: "Snoozed", glyph: .waiting, tone: .muted) }
            return .init(id: "todo", label: "To do", glyph: .todo, tone: .plain)
        }
        if task.state == .inProgress { return .init(id: "running", label: "Running", glyph: .running, tone: .plain) }
        if task.state == .todo { return .init(id: "scheduled", label: "Scheduled", glyph: .waiting, tone: .muted) }
        return .init(id: "waiting", label: "Waiting", glyph: .waiting, tone: .muted)
    }

    static func kind(_ task: TaskItem) -> (label: String, symbol: String) {
        if let auto = task.automation {
            let recurring: (String, String) = switch auto.kind {
            case "runner": ("Runner", "repeat")
            case "watcher": ("Watcher", "eye")
            default: ("Check-in", "clock")
            }
            switch auto.role {
            case "schedule": return recurring
            case "run": return ("Run", recurring.1)
            default: return ("Finding", "eye")
            }
        }
        switch task.cardKind {
        case "worker": return ("Worker", "hammer")
        case "lead": return ("Lead", "person.crop.circle")
        case "release": return ("Release", "shippingbox")
        default: break
        }
        switch task.kind {
        case .do: return ("Do", "checkmark.circle")
        case .decide: return ("Decide", "arrow.triangle.branch")
        case .read: return ("Read", "book")
        case .waitingOutside: return ("Waiting", "hourglass")
        }
    }

    static func severity(_ task: TaskItem) -> (label: String, tone: TaskStatus.Tone)? {
        switch task.automation?.severity {
        case "critical": ("Critical", .destructive)
        case "warn": ("Warning", .warning)
        case "info": ("Info", .muted)
        default: nil
        }
    }

    static func section(_ task: TaskItem, now: Date = .now, calendar: Calendar = .current) -> TaskSection {
        if task.isClosed { return .done }
        if task.scheduleText != nil || task.isRecurring { return .scheduled }
        if task.kind == .waitingOutside { return .waiting }
        if !task.isMine {
            let waits = task.state != .inProgress && (task.queue == "queued" || task.snoozed) && task.trigger != .none
            return waits ? .scheduled : .agents
        }
        if task.needsYou || task.queue == "surfaced" { return .today }
        if let at = task.date, calendar.startOfDay(for: at) <= calendar.startOfDay(for: now) { return .today }
        return .later
    }

    static func sections(_ tasks: [TaskItem], now: Date = .now, calendar: Calendar = .current) -> [TaskSection: [TaskItem]] {
        var out: [TaskSection: [TaskItem]] = [:]
        for task in tasks { out[section(task, now: now, calendar: calendar), default: []].append(task) }
        for (id, list) in out {
            out[id] = list.sorted { a, b in
                switch id {
                case .done: return (a.closedAt ?? .distantPast) > (b.closedAt ?? .distantPast)
                case .agents: return a.updatedAt > b.updatedAt
                default:
                    if a.needsYou != b.needsYou { return a.needsYou }
                    let da = a.date ?? .distantFuture, db = b.date ?? .distantFuture
                    if da != db { return da < db }
                    if rank(a.priority) != rank(b.priority) { return rank(a.priority) < rank(b.priority) }
                    return a.createdAt < b.createdAt
                }
            }
        }
        return out
    }

    static func rank(_ priority: LoopItem.Priority) -> Int {
        switch priority {
        case .urgent: 0
        case .normal: 1
        case .low: 2
        }
    }

    static func today(_ tasks: [TaskItem], now: Date = .now) -> [TaskItem] {
        sections(tasks, now: now)[.today] ?? []
    }

    static func inFlightOrder(_ tasks: [TaskItem]) -> [TaskItem] {
        func rank(_ t: TaskItem) -> Int { t.isClosed ? 3 : t.isMine ? (t.needsYou ? 0 : 1) : 2 }
        return tasks.sorted { a, b in
            if rank(a) != rank(b) { return rank(a) < rank(b) }
            if a.isClosed { return (a.closedAt ?? .distantPast) > (b.closedAt ?? .distantPast) }
            if a.createdAt != b.createdAt { return a.createdAt < b.createdAt }
            return a.id < b.id
        }
    }

    static func detail(_ task: TaskItem) -> String? {
        if task.needsYou, let needs = task.needs, !needs.isEmpty { return needs }
        let parts = [task.isClosed ? nil : task.step, task.line].compactMap { $0 }.filter { !$0.isEmpty }
        return parts.isEmpty ? nil : parts.joined(separator: " · ")
    }

    static func roomLine(_ task: TaskItem, now: Date = .now) -> String? {
        if task.needsYou, let needs = task.needs, !needs.isEmpty { return [severity(task)?.label, needs].compactMap { $0 }.joined(separator: " · ") }
        if task.kind == .decide, !task.options.isEmpty { return nil }
        let severity = severity(task).map { $0.label }
        if let due = task.date {
            let day = LoopFormat.day(due, now: now)
            return [severity, day == "Today" ? day : "Due \(day)"].compactMap { $0 }.joined(separator: " · ")
        }
        return severity
    }
}

struct TaskThreadName: Hashable, Sendable {
    var owner: String
    var name: String
    var threadId: String?
}

struct TaskHistoryLine: Hashable, Sendable {
    var at: Date
    var text: String
    var type: String
}

@MainActor
struct TaskNames {
    var bot: String
    var leads: [(id: String, title: String)] = []
    var threads: [TaskThreadName] = []
    var botThreadId: String?

    func label(_ owner: String?) -> String {
        guard let owner, !owner.isEmpty else { return "" }
        if TaskItem.isYou(owner) { return "You" }
        if owner == "cos" { return bot }
        let id = owner.hasPrefix("thread:") ? String(owner.dropFirst(7)) : owner
        if let botThreadId, id == botThreadId { return bot }
        if let lead = leads.first(where: { $0.id == id }) { return lead.title }
        if let thread = threads.first(where: { $0.owner == "thread:\(id)" }) { return thread.name }
        return ThreadTitles.titles[id] ?? "A thread"
    }

    func short(_ task: TaskItem) -> String {
        let name = label(task.owner)
        guard task.owner.hasPrefix("thread:") else { return name }
        let a = name.trimmingCharacters(in: .whitespaces).lowercased(), b = task.title.trimmingCharacters(in: .whitespaces).lowercased()
        guard !a.isEmpty, !b.isEmpty, a == b || a.contains(b) || b.contains(a) else { return name }
        return task.cardKind == "lead" ? "Its lead" : task.cardKind == "release" ? "Its release worker" : "Its worker"
    }

    func threadId(_ owner: String) -> String? {
        if owner == "cos" { return botThreadId }
        guard owner.hasPrefix("thread:") else { return nil }
        if let found = threads.first(where: { $0.owner == owner }) { return found.threadId }
        return String(owner.dropFirst(7))
    }

    func targets(for task: TaskItem) -> [(owner: String, name: String)] {
        var out: [(owner: String, name: String)] = []
        func add(_ owner: String, _ name: String) {
            if owner != task.owner, !out.contains(where: { $0.owner == owner }) { out.append((owner, name)) }
        }
        add("cos", bot)
        for lead in leads.sorted(by: { $0.title < $1.title }) { add("thread:\(lead.id)", lead.title) }
        for id in task.workers + [task.conversation].compactMap({ $0 }) where id != botThreadId {
            if let thread = threads.first(where: { $0.owner == "thread:\(id)" }), thread.threadId != nil { add("thread:\(id)", thread.name) }
        }
        return out
    }

    func history(_ events: [(type: String, at: Date, data: String)]) -> [TaskHistoryLine] {
        func parse(_ data: String) -> [String: Any] {
            (try? JSONSerialization.jsonObject(with: Data(data.utf8))) as? [String: Any] ?? [:]
        }
        func who(_ value: Any?) -> String? { (value as? String).map { label($0) } }
        var out: [TaskHistoryLine] = []
        for event in events {
            let d = parse(event.data)
            var text: String?
            switch event.type {
            case "created":
                let by = who(d["by"]) ?? "An agent"
                let forWhom = label(d["owner"] as? String)
                text = forWhom == by ? "\(by) created it" : "\(by) created it for \(forWhom == "You" ? "you" : forWhom)"
            case "added_by_you": text = "You added it"
            case "handed_off":
                let to = label(d["owner"] as? String)
                let by = who(d["by"]) ?? who(d["from"])
                if to == "You" && by == "You" {
                    let from = who(d["from"])
                    text = from.map { $0 != "You" ? "You took it back from \($0)" : "You took it back" } ?? "You took it back"
                } else {
                    let needs = (d["needs"] as? String).map { ": \($0)" } ?? ""
                    text = "\(by.map { "\($0) handed it to " } ?? "Handed to ")\(to == "You" ? "you" : to)\(needs)"
                }
            case "closed":
                var line = d["action"] as? String == "drop" ? "Dismissed" : d["action"] as? String == "failed" ? "Failed" : (d["option"] as? String).map { "Chose \($0)" } ?? "Done"
                if let by = who(d["by"]), by != "You" { line += " by \(by)" }
                text = line
            case "reopened": text = "Reopened"
            case "snoozed": text = "Snoozed"
            case "surfaced", "surfaced_by_you": text = "Came up in Today"
            case "acted":
                if d["action"] as? String == "choose", let option = d["option"] as? String { text = "You chose \(option)" }
                else if d["action"] as? String == "nudge" { text = "You asked for a nudge" }
            case "state":
                text = switch d["state"] as? String {
                case "waiting": "Waiting"
                case "in_progress": "In progress"
                case "todo": "To do"
                default: nil
                }
            case "progress":
                let joined = [d["step"] as? String, d["line"] as? String].compactMap { $0 }.joined(separator: " · ")
                text = joined.isEmpty ? nil : joined + (d["kept"] as? Bool == true ? " (after it was closed)" : "")
            case "started": text = "Started"
            case "found_again":
                let count = (d["count"] as? Int).map { " (\($0) times in all)" } ?? ""
                text = "Found again\(count)\((d["line"] as? String).map { ": \($0)" } ?? "")"
            case "cleared": text = "Cleared: the watcher stopped finding it"
            default: text = nil
            }
            if let text { out.append(.init(at: event.at, text: text, type: event.type)) }
        }
        let chosen = { (line: TaskHistoryLine) in line.type == "acted" && line.text.hasPrefix("You chose") }
        let kept = out.enumerated().filter { i, line in
            if line.type == "closed", line.text.hasPrefix("Chose "),
               (i > 0 && chosen(out[i - 1])) || (i + 1 < out.count && chosen(out[i + 1])) { return false }
            if line.type == "progress", line.text.hasPrefix("Chose: "),
               out.contains(where: { chosen($0) && abs($0.at.timeIntervalSince(line.at)) < 1 }) { return false }
            return true
        }
        return kept.map(\.element).reversed()
    }
}
