import Foundation

/// Loops' types, which old `::loop{id}` cards and the loop pushes' lock-screen
/// buttons still use: a task's priority and trigger (`LoopItem`), snoozes,
/// actions and options. Personal to-dos are gone from the phone.
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
