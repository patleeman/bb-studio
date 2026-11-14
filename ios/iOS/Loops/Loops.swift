import Foundation

/// The Attention Router's open loops (`loops.*`, packages/bb-studio/src/loops):
/// one record per thing the Chief of Staff tracks for you, released into its
/// chat as `::loop{id}` cards. Requests and responses use the generated
/// contract (`Studio.Loops…`); the app reads them as `LoopItem`.
struct LoopItem: Identifiable, Hashable, Sendable {
    enum Kind: String, Sendable { case `do`, decide, read, waiting }
    enum Priority: String, Sendable { case urgent, normal, low }
    enum Status: String, Sendable { case queued, surfaced, snoozed, inProgress = "in_progress", done, dropped }

    enum Trigger: Hashable, Sendable {
        case none
        case time(Date)
        case event(String)
        case place(String, arrive: Bool)
    }

    struct Source: Hashable, Sendable {
        var kind: String
        var ref: String
        var url: String?
    }

    var id: String
    var title: String
    var why: String
    var source: Source?
    var kind: Kind
    var options: [String]
    /// `user` (`patrick` from older servers), `cos` or `thread:<id>`.
    var owner: String
    var trigger: Trigger
    var priority: Priority
    /// Push to the phone when its trigger fires.
    var push: Bool
    var status: Status
    var due: Date?
    var area: String?
    var createdAt: Date
    var updatedAt: Date
    var closedAt: Date?
    var closedBy: String?

    var isClosed: Bool { closedAt != nil || status == .done || status == .dropped }
    var isYours: Bool { LoopItem.isYou(owner) }
    static func isYou(_ who: String?) -> Bool { who == "user" || who == "patrick" }
    /// A lead thread's id when one owns it.
    var ownerThreadId: String? { owner.hasPrefix("thread:") ? String(owner.dropFirst("thread:".count)) : nil }

    init(_ loop: Studio.LoopsGetOutputLoop) {
        id = loop.id ?? ""
        title = loop.title ?? ""
        why = loop.why ?? ""
        source = loop.source.flatMap { source in
            source.kind.map { Source(kind: $0, ref: source.ref ?? "", url: source.url) }
        }
        kind = switch loop.kind {
        case .decide: .decide
        case .read: .read
        case .waiting: .waiting
        default: .do
        }
        options = loop.options ?? []
        owner = loop.owner ?? "patrick"
        let trigger = loop.trigger
        self.trigger = switch trigger?.type {
        case .time: trigger?.at.map { .time(Date(milliseconds: $0)) } ?? .none
        case .event: trigger?.event.map { .event($0) } ?? .none
        case .place: trigger?.place.map { .place($0, arrive: trigger?.direction != .leave) } ?? .none
        default: .none
        }
        priority = switch loop.priority {
        case .urgent: .urgent
        case .low: .low
        default: .normal
        }
        push = loop.push ?? false
        status = switch loop.status {
        case .surfaced: .surfaced
        case .snoozed: .snoozed
        case .in_progress: .inProgress
        case .done: .done
        case .dropped: .dropped
        default: .queued
        }
        due = loop.due.map(Date.init(milliseconds:))
        area = loop.area
        createdAt = Date(milliseconds: loop.createdAt ?? 0)
        updatedAt = Date(milliseconds: loop.updatedAt ?? 0)
        closedAt = loop.closedAt.map(Date.init(milliseconds:))
        closedBy = loop.closedBy
    }
}

extension Date {
    init(milliseconds: Double) { self.init(timeIntervalSince1970: milliseconds / 1000) }
    var milliseconds: Double { (timeIntervalSince1970 * 1000).rounded() }
}

/// `loops.list`: the Loops screen's five sections. The items have the same
/// shape as `Studio.LoopsGetOutputLoop`, so they decode as it.
struct LoopGroups: Decodable, Equatable, Sendable {
    var needsYouNow: [LoopItem]
    var comingUp: [LoopItem]
    var agentsOnIt: [LoopItem]
    var waitingOnOthers: [LoopItem]
    var done: [LoopItem]
    var listedAreas: [String]?

    static let empty = LoopGroups(needsYouNow: [], comingUp: [], agentsOnIt: [], waitingOnOthers: [], done: [])

    init(needsYouNow: [LoopItem], comingUp: [LoopItem], agentsOnIt: [LoopItem], waitingOnOthers: [LoopItem], done: [LoopItem], areas: [String]? = nil) {
        self.needsYouNow = needsYouNow
        self.comingUp = comingUp
        self.agentsOnIt = agentsOnIt
        self.waitingOnOthers = waitingOnOthers
        self.done = done
        self.listedAreas = areas
    }

    private enum CodingKeys: String, CodingKey { case needsYouNow, comingUp, agentsOnIt, waitingOnOthers, done, areas }

    init(from decoder: Decoder) throws {
        let c = try decoder.container(keyedBy: CodingKeys.self)
        func items(_ key: CodingKeys) throws -> [LoopItem] {
            (try c.decodeIfPresent([Studio.LoopsGetOutputLoop].self, forKey: key) ?? []).map(LoopItem.init)
        }
        needsYouNow = try items(.needsYouNow)
        comingUp = try items(.comingUp)
        agentsOnIt = try items(.agentsOnIt)
        waitingOnOthers = try items(.waitingOnOthers)
        done = try items(.done)
        listedAreas = try c.decodeIfPresent([String].self, forKey: .areas)
    }

    var all: [LoopItem] { needsYouNow + comingUp + agentsOnIt + waitingOnOthers + done }

    var areas: [String] {
        if let listedAreas { return listedAreas }
        var counts: [String: Int] = [:]
        for loop in all {
            guard let area = loop.area?.trimmingCharacters(in: .whitespaces), !area.isEmpty else { continue }
            counts[area, default: 0] += 1
        }
        return counts.sorted { $0.value != $1.value ? $0.value > $1.value : $0.key.localizedCompare($1.key) == .orderedAscending }.map(\.key)
    }

    var isEmpty: Bool { all.isEmpty }
}

/// A snooze choice. The presets resolve on the server in its time zone
/// (`loops.act` snooze); Pick a time sets a time trigger.
enum LoopSnooze: Hashable, Sendable {
    case laterToday, tonight, tomorrow, weekend, home
    case at(Date)

    static let presets: [LoopSnooze] = [.laterToday, .tonight, .tomorrow, .weekend, .home]

    var preset: Studio.LoopsActInputSnooze? {
        switch self {
        case .laterToday: .later_today
        case .tonight: .tonight
        case .tomorrow: .tomorrow_morning
        case .weekend: .this_weekend
        case .home: .home
        case .at: nil
        }
    }

    var label: String {
        switch self {
        case .laterToday: "Later today"
        case .tonight: "Tonight"
        case .tomorrow: "Tomorrow"
        case .weekend: "This weekend"
        case .home: "When I'm home"
        case .at: "Pick a time…"
        }
    }

    var symbol: String {
        switch self {
        case .laterToday: "clock"
        case .tonight: "moon"
        case .tomorrow: "sun.max"
        case .weekend: "calendar"
        case .home: "house"
        case .at: "calendar.badge.clock"
        }
    }

    /// When a time preset comes back, as the server resolves it: +3 h, 19:00,
    /// 08:00 tomorrow, Saturday 10:00. Nil for Home.
    func date(now: Date = .now, calendar: Calendar = .current) -> Date? {
        func at(_ hour: Int, daysAhead: Int) -> Date? {
            let day = calendar.date(byAdding: .day, value: daysAhead, to: calendar.startOfDay(for: now))
            return day.flatMap { calendar.date(bySettingHour: hour, minute: 0, second: 0, of: $0) }
        }
        switch self {
        case .laterToday: return now.addingTimeInterval(3 * 3600)
        case .tonight: return at(19, daysAhead: calendar.component(.hour, from: now) >= 19 ? 1 : 0)
        case .tomorrow: return at(8, daysAhead: 1)
        case .weekend:
            let weekday = calendar.component(.weekday, from: now)  // 7 is Saturday
            var days = (7 - weekday + 7) % 7
            if days == 0, calendar.component(.hour, from: now) >= 10 { days = 7 }
            return at(10, daysAhead: days)
        case .home: return nil
        case .at(let date): return date
        }
    }
}

/// Everything a card, a Loops row or a notification can do to a loop.
enum LoopAction: Hashable, Sendable {
    case done, gotIt, drop, keep, nudge
    case choose(String)
    case snooze(LoopSnooze)
    /// To the Chief of Staff (`cos`) or a lead (`thread:<id>`).
    case handOff(owner: String)
    /// A handed-off loop comes back to you.
    case takeBack
    /// Reopens a loop you just closed.
    case undo

    var label: String {
        switch self {
        case .done: "Done"
        case .gotIt: "Got it"
        case .drop: "Drop"
        case .keep: "Keep"
        case .nudge: "Nudge them"
        case .choose(let option): LoopOption(option).title
        case .snooze: "Snooze"
        case .handOff: "Hand off"
        case .takeBack: "Take back"
        case .undo: "Undo"
        }
    }

    /// Closes the loop: the card collapses to one line.
    var closes: Bool {
        switch self {
        case .done, .gotIt, .drop, .choose: true
        default: false
        }
    }
}

/// A decision's option, drawn as a title and a detail: "Bayside Decks · $4,200
/// · starts Nov 9" is "Bayside Decks" over "$4,200 · starts Nov 9".
struct LoopOption: Hashable {
    var title: String
    var detail: String?

    init(_ raw: String) {
        for separator in [" · ", " — ", ": "] {
            if let range = raw.range(of: separator) {
                title = String(raw[..<range.lowerBound])
                let rest = raw[range.upperBound...].trimmingCharacters(in: .whitespaces)
                detail = rest.isEmpty ? nil : rest
                return
            }
        }
        title = raw
        detail = nil
    }
}

/// The `loops.*` request bodies, from the generated contract.
enum LoopRequests {
    static func list(area: String? = nil, owner: String? = nil) -> JSONValue {
        json(Studio.LoopsListInput(area: area, owner: owner))
    }

    static func get(_ id: String) -> JSONValue { json(Studio.LoopsGetInput(id: id)) }

    static func add(_ text: String) -> JSONValue { json(Studio.LoopsAddInput(text: text)) }

    static func place(_ name: String, arrive: Bool) -> JSONValue {
        json(Studio.LoopsPlaceInput(place: name, direction: arrive ? .arrive : .leave))
    }

    static func setPlaces(_ names: [String]) -> JSONValue { json(Studio.LoopsSetPlacesInput(names: names)) }

    static func surfaceNow(_ id: String) -> JSONValue { json(Studio.LoopsUpdateInput(id: id, surfaceNow: true)) }

    /// A new trigger, and whether it pushes to the phone when it fires.
    static func trigger(_ id: String, _ trigger: LoopItem.Trigger, push: Bool) -> JSONValue {
        let value: Studio.LoopsUpdateInputChangesTrigger = switch trigger {
        case .none: .init(type: Studio.LoopsUpdateInputChangesTriggerType.none)
        case .time(let date): .init(type: .time, at: date.milliseconds)
        case .event(let event): .init(type: .event, event: event)
        case .place(let place, let arrive): .init(type: .place, place: place, direction: arrive ? .arrive : .leave)
        }
        return json(Studio.LoopsUpdateInput(id: id, changes: .init(trigger: value, push: push, status: .queued)))
    }

    /// The request an action makes: `loops.act`, or `loops.update` for a
    /// picked time, Take back and Undo. Nil for Nudge, which only drafts.
    static func request(_ id: String, _ action: LoopAction) -> (method: String, body: JSONValue)? {
        func act(_ action: Studio.LoopsActInputAction, option: String? = nil, owner: String? = nil,
                 snooze: Studio.LoopsActInputSnooze? = nil) -> (String, JSONValue) {
            (Studio.Method.loops_act, json(Studio.LoopsActInput(id: id, action: action, option: option, owner: owner, snooze: snooze)))
        }
        func update(_ changes: Studio.LoopsUpdateInputChanges) -> (String, JSONValue) {
            (Studio.Method.loops_update, json(Studio.LoopsUpdateInput(id: id, changes: changes)))
        }
        switch action {
        case .done: return act(.done)
        case .gotIt: return act(.got_it)
        case .drop: return act(.drop)
        case .keep: return act(.keep)
        case .nudge: return nil
        case .choose(let option): return act(.choose, option: option)
        case .handOff(let owner): return act(.hand_off, owner: owner)
        case .snooze(let snooze):
            if let preset = snooze.preset { return act(.snooze, snooze: preset) }
            guard let date = snooze.date() else { return nil }
            return update(.init(trigger: .init(type: .time, at: date.milliseconds), status: .snoozed))
        case .takeBack: return update(.init(owner: "patrick", status: .surfaced))
        case .undo: return update(.init(status: .surfaced))
        }
    }

    private static func json<T: Encodable>(_ value: T) -> JSONValue {
        (try? JSONDecoder().decode(JSONValue.self, from: JSONEncoder().encode(value))) ?? .null
    }
}

/// `loops.get`: the loop and its history, of which a card needs the option chosen.
struct LoopDetail: Sendable {
    var loop: LoopItem
    /// The option a closed decision took.
    var chosen: String?
    /// When it was handed off last.
    var handedOffAt: Date?

    init(_ output: Studio.LoopsGetOutput) throws {
        guard let loop = output.loop else { throw BBError(status: 404, message: "Todo not found") }
        self.loop = LoopItem(loop)
        let history = output.history ?? []
        chosen = history.last { $0.type == "closed" }.flatMap { event in
            event.data.flatMap { try? JSONDecoder().decode(JSONValue.self, from: Data($0.utf8)) }?["option"]?.stringValue
        }
        handedOffAt = history.last { $0.type == "handed_off" }?.at.map(Date.init(milliseconds:))
    }
}

struct LoopMorning: Decodable, Sendable {
    var date: String
    var items: [LoopItem]
    var more: Int

    private enum CodingKeys: String, CodingKey { case date, items, more }

    init(from decoder: Decoder) throws {
        let c = try decoder.container(keyedBy: CodingKeys.self)
        date = try c.decodeIfPresent(String.self, forKey: .date) ?? ""
        items = (try c.decodeIfPresent([Studio.LoopsGetOutputLoop].self, forKey: .items) ?? []).map(LoopItem.init)
        more = Int(try c.decodeIfPresent(Double.self, forKey: .more) ?? 0)
    }
}

extension BBClient {
    func loops(area: String? = nil, owner: String? = nil) async throws -> LoopGroups {
        try await rpc("studio", Studio.Method.loops_list, LoopRequests.list(area: area, owner: owner))
    }

    func loop(_ id: String) async throws -> LoopDetail {
        let output: Studio.LoopsGetOutput = try await rpc("studio", Studio.Method.loops_get, LoopRequests.get(id))
        return try LoopDetail(output)
    }

    /// Runs a card or row action; nil for one that only drafts (Nudge).
    @discardableResult
    func loopAction(_ id: String, _ action: LoopAction) async throws -> LoopItem? {
        guard let request = LoopRequests.request(id, action) else { return nil }
        let output: Studio.LoopsActOutput = try await rpc("studio", request.method, request.body)
        return LoopItem(Self.loop(output))
    }

    func addLoop(_ text: String) async throws {
        let _: Studio.LoopsAddOutput = try await rpc("studio", Studio.Method.loops_add, LoopRequests.add(text))
    }

    func changeLoopTrigger(_ id: String, _ trigger: LoopItem.Trigger, push: Bool) async throws -> LoopItem {
        let output: Studio.LoopsActOutput = try await rpc("studio", Studio.Method.loops_update, LoopRequests.trigger(id, trigger, push: push))
        return LoopItem(Self.loop(output))
    }

    func surfaceLoopNow(_ id: String) async throws -> LoopItem {
        let output: Studio.LoopsActOutput = try await rpc("studio", Studio.Method.loops_update, LoopRequests.surfaceNow(id))
        return LoopItem(Self.loop(output))
    }

    /// Tells Studio "arrived at <name>" or "left <name>"; never where.
    func loopPlace(_ name: String, arrive: Bool) async throws {
        let _: Studio.LoopsPlaceOutput = try await rpc("studio", Studio.Method.loops_place, LoopRequests.place(name, arrive: arrive))
    }

    /// Replaces Studio's list of this phone's place names.
    func setLoopPlaces(_ names: [String]) async throws {
        let _: Studio.LoopsPlacesOutput = try await rpc("studio", Studio.Method.loops_setPlaces, LoopRequests.setPlaces(names))
    }

    func loopMorning() async throws -> LoopMorning {
        try await rpc("studio", Studio.Method.loops_morning, .object([:]))
    }

    /// Studio's Attention Router setting (`loopsEnabled`, off by default).
    func loopsEnabled() async throws -> Bool {
        if case .bool(let on)? = try await studioSettingValues()["loopsEnabled"] { return on }
        return false
    }

    /// `loops.act` and `loops.update` answer with the loop; read it as `loops.get`'s.
    private static func loop(_ output: Studio.LoopsActOutput) -> Studio.LoopsGetOutputLoop {
        let data = (try? JSONEncoder().encode(output)) ?? Data()
        return (try? JSONDecoder().decode(Studio.LoopsGetOutputLoop.self, from: data)) ?? .init()
    }
}
