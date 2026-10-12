import Foundation

/// One line of the Bot's chat: a day, a message, a quiet run of work, or a
/// thread the Bot started.
enum BotChatEntry: Identifiable, Equatable {
    /// The first item on a new day.
    case day(Date, id: String)
    /// `first` and `last` place the message in its run from the same sender:
    /// the Bot's avatar sits by the first, and corners tighten between them.
    case message(TimelineRow, first: Bool, last: Bool)
    /// Tool calls and reasoning, folded into one "Working…" row.
    case work([TimelineRow])
    /// A thread the Bot started in the work above.
    case child(threadId: String, after: String)

    var id: String {
        switch self {
        case .day(_, let id): "day:\(id)"
        case .message(let row, _, _): row.id
        case .work(let rows): "work:\(rows.first?.id ?? "")"
        case .child(let id, let after): "child:\(id):\(after)"
        }
    }

    /// Lays out the timeline as the Bot's chat. Work between two of the Bot's
    /// messages doesn't start a new run, so the avatar shows once per reply.
    static func build(_ rows: [TimelineRow], botThreadId: String? = nil, calendar: Calendar = .current) -> [BotChatEntry] {
        let items = TimelineItem.group(rows)
        var entries: [BotChatEntry] = []
        var lastDay: Date?
        var lastSender: Bool?
        var seenChildren = Set<String>()
        // Index of the last message entry, to mark it as the end of a run.
        var openMessage: Int?

        func closeRun() {
            if let index = openMessage, case .message(let row, let first, _) = entries[index] {
                entries[index] = .message(row, first: first, last: true)
            }
            openMessage = nil
        }

        for item in items {
            if let date = item.rows.lazy.compactMap({ Self.date($0.createdAt ?? $0.startedAt) }).first {
                let day = calendar.startOfDay(for: date)
                if lastDay != day {
                    closeRun()
                    lastSender = nil
                    entries.append(.day(date, id: item.id))
                    lastDay = day
                }
            }
            switch item {
            case .message(let row):
                let first = lastSender != row.isUser
                if first { closeRun() } else if let index = openMessage, case .message(let previous, let wasFirst, _) = entries[index] {
                    entries[index] = .message(previous, first: wasFirst, last: false)
                }
                entries.append(.message(row, first: first, last: true))
                openMessage = entries.count - 1
                lastSender = row.isUser
            case .activity(let rows):
                // The user's run ends at the Bot's work; the Bot's carries on.
                if lastSender == true { closeRun(); lastSender = nil }
                entries.append(.work(rows))
                for id in childThreadIds(in: rows, excluding: botThreadId) where seenChildren.insert(id).inserted {
                    entries.append(.child(threadId: id, after: item.id))
                }
            }
        }
        closeRun()
        return entries
    }

    /// Threads started in these steps: tool calls about threads whose output names a new one.
    static func childThreadIds(in rows: [TimelineRow], excluding own: String?) -> [String] {
        var ids: [String] = []
        for row in rows where row.kind == "work" {
            let name = (row.toolName ?? row.title ?? "").lowercased()
            guard name.contains("thread"), ["start", "create", "spawn", "new", "fork", "delegate"].contains(where: name.contains) else { continue }
            let text = [row.output, row.detail].compactMap { $0 }.joined(separator: "\n")
            for match in text.matches(of: /thr_[a-z0-9]{6,32}/) {
                let id = String(match.output)
                if id != own, !ids.contains(id) { ids.append(id) }
            }
        }
        return ids
    }

    /// BB times are milliseconds; older rows used seconds.
    static func date(_ value: Double?) -> Date? {
        guard let value, value > 0 else { return nil }
        return Date(timeIntervalSince1970: value > 1e11 ? value / 1000 : value)
    }

    /// "Today", "Yesterday", the weekday this week, else the date.
    static func dayLabel(_ date: Date, now: Date = .now, calendar: Calendar = .current) -> String {
        if calendar.isDateInToday(date) { return "Today" }
        if calendar.isDateInYesterday(date) { return "Yesterday" }
        if let days = calendar.dateComponents([.day], from: calendar.startOfDay(for: date), to: calendar.startOfDay(for: now)).day, days < 7 {
            return date.formatted(.dateTime.weekday(.wide))
        }
        let sameYear = calendar.component(.year, from: date) == calendar.component(.year, from: now)
        return sameYear ? date.formatted(.dateTime.weekday(.abbreviated).month(.abbreviated).day())
            : date.formatted(date: .abbreviated, time: .omitted)
    }
}

/// The Bot's Activity, as sections: only the ones with something in them.
struct BotActivitySection: Identifiable, Equatable {
    enum Kind: String { case needsYou, waiting, running, scheduled, recent }
    enum Row: Equatable, Identifiable {
        case thread(BotActivity.Thread)
        case scheduled(BotActivity.Scheduled)
        var id: String {
            switch self {
            case .thread(let thread): thread.id
            case .scheduled(let item): "scheduled:\(item.id)"
            }
        }
    }

    let kind: Kind
    let rows: [Row]
    var id: String { kind.rawValue }

    var title: String {
        switch kind {
        case .needsYou: "Needs you"
        case .waiting: "Waiting"
        case .running: "Running"
        case .scheduled: "Scheduled"
        case .recent: "Recent"
        }
    }

    static func sections(_ activity: BotActivity?) -> [BotActivitySection] {
        guard let activity else { return [] }
        let all: [BotActivitySection] = [
            .init(kind: .needsYou, rows: activity.needsYou.map(Row.thread)),
            .init(kind: .waiting, rows: (activity.waiting ?? []).map(Row.thread)),
            .init(kind: .running, rows: activity.inProgress.map(Row.thread)),
            .init(kind: .scheduled, rows: activity.scheduled.filter(\.enabled).map(Row.scheduled)),
            .init(kind: .recent, rows: activity.completed.map(Row.thread)),
        ]
        return all.filter { !$0.rows.isEmpty }
    }
}

/// The Bot's status line under its name.
enum BotStatus {
    static func line(state: BotInfo.State?, running: Bool, thinking: String?, needsYou: Int, lead: ThreadLead?) -> String {
        switch state {
        case .paused: return "Paused"
        case .stopped: return "Stopped"
        default: break
        }
        if needsYou > 0 { return needsYou == 1 ? "Needs you" : "\(needsYou) things need you" }
        if running {
            if let thought = thinking?.split(whereSeparator: \.isNewline).last.map(String.init)?
                .replacingOccurrences(of: "**", with: "").trimmingCharacters(in: .whitespaces), !thought.isEmpty, thought.count <= 48 {
                return thought
            }
            return "Thinking…"
        }
        return checkIns(lead) ?? "Here when you need me"
    }

    /// "Checks in weekdays 8:00", nil when check-ins are off.
    static func checkIns(_ lead: ThreadLead?) -> String? {
        guard let cadence = lead?.heartbeat else { return nil }
        let time = lead?.time.flatMap(clock)
        switch cadence {
        case "daily": return "Checks in daily" + (time.map { " \($0)" } ?? "")
        case "weekdays": return "Checks in weekdays" + (time.map { " \($0)" } ?? "")
        case "weekly": return "Checks in weekly" + (time.map { " \($0)" } ?? "")
        case "custom": return "Checks in on a schedule"
        default:
            let label = ThreadLead.cadences.first { $0.id == cadence }?.label.lowercased() ?? cadence
            return "Checks in \(label)"
        }
    }

    /// "08:00" as "8:00".
    static func clock(_ text: String) -> String? {
        let parts = text.split(separator: ":")
        guard parts.count == 2, let hour = Int(parts[0]), let minute = Int(parts[1]) else { return nil }
        return String(format: "%d:%02d", hour, minute)
    }
}
