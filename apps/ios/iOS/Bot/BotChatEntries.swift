import Foundation

/// The Bot's chain as one conversation (desktop `chat-model.ts`). A thread
/// after the first starts with the handoff request the previous one wrote;
/// that's plumbing, so its first user message is left out once its start is
/// loaded, and the history reads on.
enum BotChain {
    struct Page: Equatable {
        var threadId: String
        var rows: [TimelineRow]
        /// A thread after the first whose start is loaded.
        var continuation: Bool
    }

    static func merge(_ pages: [Page]) -> [TimelineRow] {
        var out: [TimelineRow] = []
        var seen = Set<String>()
        for page in pages {
            var skippedHandoff = !page.continuation
            for row in page.rows {
                if !skippedHandoff, row.isConversation, row.isUser { skippedHandoff = true; continue }
                if seen.insert("\(page.threadId):\(row.id)").inserted { out.append(row) }
            }
        }
        return out
    }
}

/// A thread the Bot started, from BB's thread metadata (its source, parent or
/// lifecycle owner is one of the Bot's chain), with its live status.
struct BotStartedThread: Equatable, Identifiable {
    var id: String
    var title: String
    /// Milliseconds, as BB sends them.
    var createdAt: Double
    var status: BotChildStatus
}

enum BotChildStatus: String, Equatable {
    case running, waiting, finished, failed, stopped, needsYou

    var label: String {
        switch self {
        case .running: "Running"
        case .waiting: "Waiting to start"
        case .finished: "Finished"
        case .failed: "Failed"
        case .stopped: "Stopped"
        case .needsYou: "Needs you"
        }
    }

    /// From a BB system message about a child thread.
    static func of(systemMessage kind: String?) -> BotChildStatus? {
        switch kind {
        case "child-completed": .finished
        case "child-failed": .failed
        case "child-interrupted": .stopped
        case "child-needs-attention": .needsYou
        default: nil
        }
    }
}

/// A card in the chat about a thread the Bot started: when it started, or BB's word that it finished.
struct BotChildEvent: Equatable {
    enum Verb: Equatable { case started, update }
    var threadId: String?
    var title: String
    var status: BotChildStatus
    var verb: Verb
}

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
    /// A thread the Bot started, or news of one.
    case child(BotChildEvent, id: String)
    /// The "/compact" Studio's cache warmer sent, not the user.
    case autoCompacted(BotActivity.Compaction, id: String)

    var id: String {
        switch self {
        case .day(_, let id): "day:\(id)"
        case .message(let row, _, _): row.id
        case .work(let rows): "work:\(rows.first?.id ?? "")"
        case .child(_, let id): "child:\(id)"
        case .autoCompacted(_, let id): "compacted:\(id)"
        }
    }

    /// The last layout, kept: the chat redraws on every keystroke in the
    /// composer, and its rows rarely changed meanwhile.
    @MainActor static let memo = Memo()

    @MainActor final class Memo {
        private var rows: [TimelineRow] = []
        private var started: [BotStartedThread] = []
        private var compactions: [BotActivity.Compaction] = []
        private var entries: [BotChatEntry] = []

        func entries(_ rows: [TimelineRow], started: [BotStartedThread], compactions: [BotActivity.Compaction] = []) -> [BotChatEntry] {
            // Same arrays (usually the very same storage): nothing to do.
            if rows == self.rows, started == self.started, compactions == self.compactions { return entries }
            self.rows = rows
            self.started = started
            self.compactions = compactions
            entries = BotChatEntry.build(rows, started: started, compactions: compactions)
            return entries
        }
    }

    /// Lays out the timeline as the Bot's chat. Work between two of the Bot's
    /// messages doesn't start a new run, so the avatar shows once per reply.
    /// `started` threads go in where they were made; ones older than the
    /// loaded rows wait until that history loads.
    static func build(_ rows: [TimelineRow], started: [BotStartedThread] = [], compactions: [BotActivity.Compaction] = [], calendar: Calendar = .current) -> [BotChatEntry] {
        let items = TimelineItem.group(rows.filter(shows))
        var entries: [BotChatEntry] = []
        var lastDay: Date?
        var lastSender: Bool?
        // Index of the last message entry, to mark it as the end of a run.
        var openMessage: Int?
        let firstTime = items.lazy.compactMap { $0.rows.lazy.compactMap { $0.createdAt ?? $0.startedAt }.first }.first ?? 0
        var cards = started.filter { $0.createdAt >= firstTime }.sorted { $0.createdAt < $1.createdAt }[...]

        func closeRun() {
            if let index = openMessage, case .message(let row, let first, _) = entries[index] {
                entries[index] = .message(row, first: first, last: true)
            }
            openMessage = nil
        }
        func stamp(_ time: Double?, id: String) {
            guard let date = Self.date(time) else { return }
            let day = calendar.startOfDay(for: date)
            if lastDay != day {
                closeRun()
                lastSender = nil
                entries.append(.day(date, id: id))
                lastDay = day
            }
        }
        func card(_ event: BotChildEvent, id: String, at time: Double?) {
            stamp(time, id: "child:\(id)")
            closeRun()
            lastSender = nil
            // A thread that reports back again and again (a recurring runner)
            // keeps one card, its latest, until something else is said.
            if event.verb == .update, event.threadId != nil, case .child(let previous, _)? = entries.last,
               previous.verb == .update, previous.threadId == event.threadId {
                entries[entries.count - 1] = .child(event, id: id)
                return
            }
            entries.append(.child(event, id: id))
        }
        func cardsBefore(_ time: Double?) {
            while let next = cards.first, time.map({ next.createdAt <= $0 }) ?? true {
                cards.removeFirst()
                card(BotChildEvent(threadId: next.id, title: next.title, status: next.status, verb: .started), id: "started:\(next.id)", at: next.createdAt)
            }
        }

        for item in items {
            let time = item.rows.lazy.compactMap { $0.createdAt ?? $0.startedAt }.first
            if time != nil { cardsBefore(time) }
            stamp(time, id: item.id)
            switch item {
            case .message(let row):
                if let event = childEvent(row) {
                    card(event, id: row.id, at: time)
                    continue
                }
                if let compaction = autoCompaction(row, compactions) {
                    closeRun()
                    lastSender = nil
                    entries.append(.autoCompacted(compaction, id: row.id))
                    continue
                }
                let first = lastSender != row.isUser
                if first { closeRun() } else if let index = openMessage, case .message(let previous, let wasFirst, _) = entries[index] {
                    entries[index] = .message(previous, first: wasFirst, last: false)
                }
                entries.append(.message(row, first: first, last: true))
                openMessage = entries.count - 1
                lastSender = row.isUser
            case .activity(let rows):
                // The user's run ends at the Bot's work; the Bot's carries on.
                // Reasoning alone isn't work worth a line (as on the desktop).
                guard rows.contains(where: { $0.kind == "work" }) else { continue }
                if lastSender == true { closeRun(); lastSender = nil }
                entries.append(.work(rows))
            }
        }
        cardsBefore(nil)
        closeRun()
        return entries
    }

    /// Rows the chat leaves out: BB's own messages that aren't about a child
    /// thread, the Bot's bare "✓" after a quiet check-in, and its [PASS].
    static func shows(_ row: TimelineRow) -> Bool {
        guard row.isConversation else { return true }
        if row.isUser, let initiator = row.initiator, initiator != "user" { return childEvent(row) != nil }
        if !row.isUser, row.text?.trimmingCharacters(in: .whitespacesAndNewlines) == "✓", !row.hasAttachments { return false }
        if row.isPassReply { return false }
        return true
    }

    /// BB's message that a thread the Bot started finished, failed, stopped or needs you.
    static func childEvent(_ row: TimelineRow) -> BotChildEvent? {
        guard row.isUser, let initiator = row.initiator, initiator != "user", let subject = row.systemMessageSubject else { return nil }
        if subject.kind == "thread", let status = BotChildStatus.of(systemMessage: row.systemMessageKind) {
            return BotChildEvent(threadId: subject.threadId, title: subject.threadName ?? "A thread", status: status, verb: .update)
        }
        if row.systemMessageKind == "child-outcome-batch", subject.kind == "thread-batch" {
            let outcomes = subject.outcomes ?? []
            let count = subject.count ?? outcomes.count
            return BotChildEvent(threadId: nil, title: "\(count) threads", status: outcomes.contains { $0.status == "failed" } ? .failed : .finished, verb: .update)
        }
        return nil
    }

    /// The warmer's compaction behind a "/compact" user message: one Studio
    /// recorded up to two minutes before it. Without one it was the user's.
    static func autoCompaction(_ row: TimelineRow, _ compactions: [BotActivity.Compaction]) -> BotActivity.Compaction? {
        guard !compactions.isEmpty, row.isConversation, row.isUser,
              row.text?.trimmingCharacters(in: .whitespacesAndNewlines) == "/compact",
              let sent = date(row.createdAt ?? row.startedAt)?.timeIntervalSince1970 else { return nil }
        return compactions.last { compaction in
            let delay = sent - compaction.at / 1000
            return delay >= -5 && delay <= 120
        }
    }

    /// "Auto-compacted by Studio before the cache expired · ~180k tokens".
    static func autoCompactedLabel(_ compaction: BotActivity.Compaction) -> String {
        let label = "Auto-compacted by Studio before the cache expired"
        guard let tokens = compaction.tokens, tokens > 0 else { return label }
        let size = tokens >= 1000 ? "\(Int((tokens / 1000).rounded()))k" : "\(Int(tokens))"
        return "\(label) · ~\(size) tokens"
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

extension BotStartedThread {
    /// The threads the Bot started, as the chat places them: the Activity's
    /// "started" threads whose BB metadata (source, parent or lifecycle owner)
    /// is one of the Bot's chain, at their creation time, with live status.
    static func list(activity: BotActivity?, threads: [String: ThreadEntry], chain: [String]) -> [BotStartedThread] {
        guard let activity else { return [] }
        let chain = Set(chain)
        var out: [String: BotStartedThread] = [:]
        func add(_ items: [BotActivity.Thread], _ status: (BotActivity.Thread) -> BotChildStatus) {
            for item in items where item.relation == "started" && out[item.id] == nil {
                guard let thread = threads[item.id],
                      [thread.sourceThreadId, thread.parentThreadId, thread.lifecycleOwnerThreadId].contains(where: { $0.map(chain.contains) == true })
                else { continue }
                out[item.id] = BotStartedThread(id: item.id, title: item.title, createdAt: thread.createdAt, status: status(item))
            }
        }
        add(activity.waiting ?? []) { _ in .waiting }
        add(activity.inProgress) { _ in .running }
        add(activity.completed) { $0.status == "error" ? .failed : .finished }
        return out.values.sorted { $0.createdAt < $1.createdAt }
    }
}
