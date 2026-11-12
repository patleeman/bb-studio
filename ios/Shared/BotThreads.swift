import Foundation

// The threads under a Bot, grouped as on the desktop Bots sidebar
// (packages/bb-studio/src/ui/bot/BotSidebar.tsx, workspace.ts sidebarGroups):
// Running, Runners, Recurring, Recent and Earlier conversations, a thread
// nested under the thread that started it. Pure, so it's tested. Nothing
// here needs you: the Bot handles its threads, and only the Bot itself asks
// for you (`BotActivity.attention`).

/// The Bot's handoff chain with titles (`bot_chain`). Chain threads are
/// hidden in BB, so their titles come from here.
public struct BotChainThreads: Hashable, Sendable {
    /// Oldest first; it ends at the Bot's thread.
    public var threadIds: [String]
    public var titles: [String: String]

    public init(threadIds: [String] = [], titles: [String: String] = [:]) {
        self.threadIds = threadIds
        self.titles = titles
    }

    /// Earlier conversations, newest first: the chain before `current`, the
    /// Bot's thread. Nothing while the chain doesn't end there yet.
    public func earlier(current: String?) -> [String] {
        guard let current, threadIds.last == current else { return [] }
        return Array(threadIds.dropLast().reversed())
    }

    public func title(_ id: String) -> String {
        let title = titles[id]?.trimmingCharacters(in: .whitespacesAndNewlines) ?? ""
        return title.isEmpty ? "Untitled" : title
    }
}

extension BBClient {
    /// The Bot's handoff chain and its threads' titles (`bot_chain`).
    public func botChainThreads(botId: String? = nil) async throws -> BotChainThreads {
        struct Output: Decodable {
            struct Thread: Decodable { var id: String; var title: String }
            var threadIds: [String]
            var threads: [Thread]?
        }
        let output: Output = try await rpc("studio", Studio.Method.bot_chain, Self.scoped(botId))
        var titles: [String: String] = [:]
        for thread in output.threads ?? [] { titles[thread.id] = thread.title }
        return BotChainThreads(threadIds: output.threadIds, titles: titles)
    }
}

/// The Bot's threads in the desktop sidebar's groups.
public struct BotThreadGroups: Equatable, Sendable {
    public struct Node: Equatable, Sendable {
        public var thread: BotActivity.Thread
        public var children: [Node]
    }
    /// One row of a tree, flattened for a list.
    public struct Row: Equatable, Sendable, Identifiable {
        public var thread: BotActivity.Thread
        public var depth: Int
        public var id: String { thread.id }
    }

    /// Started threads that are running, or have a running thread below them.
    public var running: [Node] = []
    /// Started threads queued to start, with none running in their tree.
    public var waiting: [Node] = []
    /// Automations that wake the Bot, other than its check-in.
    public var recurring: [BotActivity.Scheduled] = []
    /// The rest of the threads it started, newest first.
    public var recent: [Node] = []

    public var isEmpty: Bool { running.isEmpty && waiting.isEmpty && recent.isEmpty }

    /// Desktop `sidebarGroups`: Running, Waiting to start and Recent are trees, a thread under
    /// the thread that started it at any depth, placed by its root. A thread
    /// held by a question (`waitingFor`) is in progress, so it's under Running.
    public init(_ activity: BotActivity?) {
        guard let activity else { return }
        func started(_ list: [BotActivity.Thread]) -> [BotActivity.Thread] { list.filter { $0.relation == "started" } }
        let pending = activity.waiting ?? []
        let working = Set(activity.inProgress.map(\.id))
        let queued = Set(pending.map(\.id))
        var all: [String: BotActivity.Thread] = [:]
        var order: [String] = []
        for thread in started(activity.inProgress + pending + activity.completed) where all[thread.id] == nil {
            all[thread.id] = thread
            order.append(thread.id)
        }
        var children: [String: [BotActivity.Thread]] = [:]
        var roots: [BotActivity.Thread] = []
        for id in order {
            let thread = all[id]!
            if let parent = thread.parentId, parent != thread.id, all[parent] != nil {
                children[parent, default: []].append(thread)
            } else {
                roots.append(thread)
            }
        }
        // Newest first; a stable sort keeps the server's order on ties.
        func newest(_ list: [BotActivity.Thread]) -> [BotActivity.Thread] {
            list.enumerated().sorted { $0.element.updatedAt != $1.element.updatedAt ? $0.element.updatedAt > $1.element.updatedAt : $0.offset < $1.offset }.map(\.element)
        }
        func build(_ thread: BotActivity.Thread, _ seen: inout Set<String>) -> Node {
            seen.insert(thread.id)
            var kids: [Node] = []
            for kid in newest(children[thread.id] ?? []) where !seen.contains(kid.id) { kids.append(build(kid, &seen)) }
            return Node(thread: thread, children: kids)
        }
        func hasRunning(_ node: Node) -> Bool { working.contains(node.thread.id) || node.children.contains(where: hasRunning) }
        func hasQueued(_ node: Node) -> Bool { queued.contains(node.thread.id) || node.children.contains(where: hasQueued) }
        let trees = newest(roots).map { root -> Node in
            var seen = Set<String>()
            return build(root, &seen)
        }
        running = trees.filter(hasRunning)
        waiting = trees.filter { !hasRunning($0) && hasQueued($0) }
        recurring = activity.scheduled.filter { $0.kind == "automation" }
        recent = trees.filter { !hasRunning($0) && !hasQueued($0) }
    }

    /// A tree as list rows, each child after its parent, one level deeper.
    public static func rows(_ nodes: [Node], depth: Int = 0) -> [Row] {
        nodes.flatMap { [Row(thread: $0.thread, depth: depth)] + rows($0.children, depth: depth + 1) }
    }
}

/// A thread's status dot, as on desktop.
public enum BotThreadTone: String, Sendable {
    /// `held`: in progress but held by a pending question the Bot owns.
    case held, running, waiting, failed, idle

    public init(_ thread: BotActivity.Thread) {
        if thread.waitingFor != nil { self = .held }
        else if ["active", "starting", "stopping", "running"].contains(thread.status) { self = .running }
        else if thread.status == "pending" { self = .waiting }
        else if thread.status.contains("error") || thread.status.contains("fail") { self = .failed }
        else { self = .idle }
    }

    public var label: String {
        switch self {
        case .held: "Waiting"
        case .running: "Running"
        case .waiting: "Waiting to start"
        case .failed: "Failed"
        case .idle: "Done"
        }
    }
}

/// A Bot sidebar row's state, the same on desktop and iOS: what its mark
/// shows and what its right-hand text says.
public enum BotRowState: Equatable, Sendable {
    /// Working now; ticks from `since` when BB knows it.
    case running(since: Double?)
    /// Held by a pending question or approval: a still amber ring.
    case waiting
    /// Queued to start: dimmed, with a muted hairline ring.
    case queued
    /// The last run or the thread failed: a still red ring.
    case failed
    /// Done, or a runner between runs. A runner's mark is dimmed.
    case idle
    /// A paused runner or automation: dimmed, "paused".
    case paused

    public init(_ tone: BotThreadTone, since: Double? = nil) {
        switch tone {
        case .running: self = .running(since: since)
        case .held: self = .waiting
        case .waiting: self = .queued
        case .failed: self = .failed
        case .idle: self = .idle
        }
    }
}

/// Times in Bot sidebar rows.
public enum BotRowTime {
    /// Since a run started: "0:42", "12:05", "1:02:10".
    public static func elapsed(since: Double, now: Date = Date()) -> String {
        let seconds = max(0, Int((now.timeIntervalSince1970 * 1000 - since) / 1000))
        let (h, m, s) = (seconds / 3600, seconds / 60 % 60, seconds % 60)
        return h > 0 ? String(format: "%d:%02d:%02d", h, m, s) : String(format: "%d:%02d", m, s)
    }

    /// "Running for 12 minutes", for VoiceOver.
    public static func spokenElapsed(since: Double, now: Date = Date()) -> String {
        let seconds = max(0, now.timeIntervalSince1970 - since / 1000)
        let formatter = DateComponentsFormatter()
        formatter.unitsStyle = .full
        formatter.allowedUnits = seconds < 60 ? [.second] : seconds < 3600 ? [.minute] : [.hour, .minute]
        return "Running for \(formatter.string(from: seconds) ?? "")"
    }

    /// As the Schedule shows it: the time today ("5:15 PM"), otherwise the weekday too ("Sat 5:15 PM").
    public static func at(_ at: Double, now: Date = Date(), locale: Locale = .current, timeZone: TimeZone = .current) -> String {
        var calendar = Calendar.current
        calendar.timeZone = timeZone
        let date = Date(timeIntervalSince1970: at / 1000)
        var style = calendar.isDate(date, inSameDayAs: now)
            ? Date.FormatStyle.dateTime.hour().minute() : Date.FormatStyle.dateTime.weekday(.abbreviated).hour().minute()
        style.locale = locale
        style.timeZone = timeZone
        return date.formatted(style)
    }
}

/// Desktop's short age: "now", "5m", "3h", "2d", "4w".
public enum BotAge {
    public static func label(_ at: Double, now: Date = Date()) -> String {
        let minutes = Int(((now.timeIntervalSince1970 * 1000 - at) / 60_000).rounded())
        if minutes < 1 { return "now" }
        if minutes < 60 { return "\(minutes)m" }
        if minutes < 60 * 24 { return "\(Int((Double(minutes) / 60).rounded()))h" }
        if minutes < 60 * 24 * 7 { return "\(Int((Double(minutes) / 1440).rounded()))d" }
        return "\(Int((Double(minutes) / 10080).rounded()))w"
    }
}

extension BotRunner {
    /// Its schedule in plain English, as on desktop: "Weekdays 9:00 AM",
    /// "Every 2 h", or a custom cron through `CronText`.
    public var plainSchedule: String {
        guard let cadence = schedule?.cadence else { return "Manual" }
        let short = ["every5minutes": "Every 5 min", "every15minutes": "Every 15 min", "every30minutes": "Every 30 min",
                     "hourly": "Hourly", "every2hours": "Every 2 h", "every6hours": "Every 6 h"]
        let daily = ["daily": "Daily", "weekdays": "Weekdays", "weekly": "Mondays"]
        if cadence == "custom" { return schedule?.cron.map { CronText.describe($0) } ?? "Custom" }
        if let days = daily[cadence] {
            let time = schedule?.time.flatMap(CronText.minute).map(CronText.at12) ?? "9:00 AM"
            return "\(days) \(time)"
        }
        return short[cadence] ?? cadence
    }

    /// Mid-run, as desktop counts it: running and not paused.
    public var isRunning: Bool { running == true && state == "active" }

    /// How its last run went, as desktop's `runnerLastRun`: "failed", "reported"
    /// (it told you), "quiet" (nothing to report), or nil before its first run.
    public var lastOutcome: String? {
        let failed = lastRunStatus.map { $0.range(of: "fail|error", options: [.regularExpression, .caseInsensitive]) != nil } ?? false
        guard let lastRunAt else { return failed ? "failed" : nil }
        if failed { return "failed" }
        // A previous report does not describe a later silent run.
        let reported = (lastReportAt ?? 0) >= lastRunAt && (lastLevel == "tell" || lastLevel == "urgent")
        return reported ? "reported" : "quiet"
    }

    /// Its row's state: running, then paused, a failed last run, or between runs.
    /// An urgent report is just "reported"; the Bot passes it on.
    public var rowState: BotRowState {
        if isRunning { return .running(since: runningSince) }
        if paused { return .paused }
        return lastOutcome == "failed" ? .failed : .idle
    }

    /// The row's right-hand text when it isn't running: "paused", or
    /// "next 5:15 PM" with the last outcome after it, "next 5:15 PM · quiet".
    /// `compact`, for a tight row where the name comes first: just the time,
    /// "5:15 PM", keeping only a failed outcome.
    public func rowStatus(compact: Bool = false, now: Date = Date(), locale: Locale = .current, timeZone: TimeZone = .current) -> (next: String?, outcome: String?) {
        if paused { return ("paused", nil) }
        let time = nextRunAt.map { BotRowTime.at($0, now: now, locale: locale, timeZone: timeZone) }
        guard compact else { return (time.map { "next \($0)" }, lastOutcome) }
        return (time, lastOutcome == "failed" ? "failed" : nil)
    }

    /// "Next run 5:15 PM, last run quiet", for VoiceOver.
    public func spokenStatus(now: Date = Date()) -> String {
        if isRunning { return runningSince.map { BotRowTime.spokenElapsed(since: $0, now: now) } ?? "Running" }
        if paused { return "Paused" }
        return [nextRunAt.map { "Next run \(BotRowTime.at($0, now: now))" }, lastOutcome.map { "last run \($0)" }]
            .compactMap { $0 }.joined(separator: ", ")
    }

    /// "Next run Tue 5:05 PM"; nil when paused or unknown.
    public func nextRunLabel(locale: Locale = .current, timeZone: TimeZone = .current) -> String? {
        guard !paused, let nextRunAt else { return nil }
        return "Next run \(BotRunner.when(nextRunAt, locale: locale, timeZone: timeZone))"
    }

    /// Schedule, then next run or Paused: "Daily 7:05 AM · Next run Tue 7:05 AM".
    public func subtitle(locale: Locale = .current, timeZone: TimeZone = .current) -> String {
        if paused { return "Paused · \(plainSchedule)" }
        return [plainSchedule, nextRunLabel(locale: locale, timeZone: timeZone)].compactMap { $0 }.joined(separator: " · ")
    }

    /// A weekday and time: "Tue 5:05 PM".
    public static func when(_ at: Double, locale: Locale = .current, timeZone: TimeZone = .current) -> String {
        var style = Date.FormatStyle.dateTime.weekday(.abbreviated).hour().minute()
        style.locale = locale
        style.timeZone = timeZone
        return Date(timeIntervalSince1970: at / 1000).formatted(style)
    }
}

/// A five-field cron in plain English, ported from desktop `describeCron`
/// (packages/bb-studio/src/schedule.ts) so both read the same: "Daily 7:05 AM
/// and 5:05 PM", "Every 2 hours", "4× daily: 7 AM, 12, 5, 10 PM", "Weekdays
/// 9:00 AM", "Mondays 8:30 AM", "Every 15 minutes". The timezone shows only
/// when it isn't the local one. Anything else is "Custom: <cron>".
public enum CronText {
    private static let dayWords = ["sun": 0, "mon": 1, "tue": 2, "wed": 3, "thu": 4, "fri": 5, "sat": 6]
    private static let pluralDays = ["Sundays", "Mondays", "Tuesdays", "Wednesdays", "Thursdays", "Fridays", "Saturdays"]
    private static let dayNames = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"]

    public static func describe(_ expr: String, timezone: String? = nil, localZone: String = TimeZone.current.identifier) -> String {
        let cron = expr.split(whereSeparator: \.isWhitespace).joined(separator: " ")
        let custom = "Custom: \(cron)"
        let fields = cron.split(separator: " ").map(String.init)
        guard fields.count == 5 else { return custom }
        let (minField, hourField, dom, month, dowField) = (fields[0], fields[1], fields[2], fields[3], fields[4])
        guard dom == "*", month == "*" else { return custom }
        guard let minutes = values(minField, 0, 59), let hours = values(hourField, 0, 23),
              let days = values(dowField, 0, 7, names: dayWords) else { return custom }
        let dayText = cronDays(days)
        let dayWord = ["Daily", "Weekdays", "Weekends"].contains(dayText) ? dayText.lowercased() : dayText
        let onDays = dayText == "Daily" ? "" : " on \(dayWord)"
        let zone = zoneNote(timezone, localZone: localZone)
        let allHours = hours.count == 24
        let hourStep = step(hourField)
        let minuteStep = step(minField)
        var text: String?
        if minutes.count == 60 && allHours {
            text = "Every minute\(onDays)"
        } else if let minuteStep, allHours {
            text = "Every \(minuteStep) minutes\(onDays)"
        } else if let minuteStep, hours.count > 1, zip(hours, hours.dropFirst()).allSatisfy({ $1 == $0 + 1 }) {
            let from = at12(hours[0] * 60).replacingOccurrences(of: ":00", with: "")
            let to = at12(((hours[hours.count - 1] + 1) % 24) * 60).replacingOccurrences(of: ":00", with: "")
            text = "Every \(minuteStep) minutes, \(from)–\(to)\(onDays)"
        } else if minutes.count == 1 {
            let minute = minutes[0]
            let past = minute != 0 ? " at :\(String(format: "%02d", minute))" : ""
            if allHours {
                text = "Hourly\(past)\(onDays)"
            } else if let hourStep {
                text = "Every \(hourStep) hours\(past)\(onDays)"
            } else {
                text = times(hours.map { $0 * 60 + minute }, dayText: dayText, dayWord: dayWord)
            }
        } else if hours.count == 1, minutes.count <= 4 {
            let list = minutes.map { hours[0] * 60 + $0 }
            text = list.count == 2 ? times(list, dayText: dayText, dayWord: dayWord) : "\(list.count)× \(dayWord): \(shortTimes(list))"
        }
        return text.map { $0 + zone } ?? custom
    }

    private static func times(_ list: [Int], dayText: String, dayWord: String) -> String {
        switch list.count {
        case 1: "\(dayText) \(at12(list[0]))"
        case 2: "\(dayText) \(at12(list[0])) and \(at12(list[1]))"
        default: "\(list.count)× \(dayWord): \(shortTimes(list))"
        }
    }

    /// "08:00" as a minute of the day.
    static func minute(_ time: String) -> Int? {
        let parts = time.split(separator: ":")
        guard parts.count == 2, let h = Int(parts[0]), let m = Int(parts[1]), (0..<24).contains(h), (0..<60).contains(m) else { return nil }
        return h * 60 + m
    }

    private static func clock12(_ minute: Int) -> (time: String, half: String) {
        let h = minute / 60, m = minute % 60
        return ("\(h % 12 == 0 ? 12 : h % 12):\(String(format: "%02d", m))", h < 12 ? "AM" : "PM")
    }

    /// A minute of the day on a 12-hour clock: "7:05 AM".
    static func at12(_ minute: Int) -> String {
        let clock = clock12(minute)
        return "\(clock.time) \(clock.half)"
    }

    /// "7, 12, 5, 10 PM": whole hours lose ":00", and AM/PM follows the last time of each run.
    private static func shortTimes(_ minutes: [Int]) -> String {
        minutes.enumerated().map { i, minute in
            let clock = clock12(minute)
            let text = minute % 60 != 0 ? clock.time : String(clock.time.dropLast(3))
            let next = i + 1 < minutes.count ? minutes[i + 1] : nil
            return next == nil || clock12(next!).half != clock.half ? "\(text) \(clock.half)" : text
        }.joined(separator: ", ")
    }

    private static func cronDays(_ days: [Int]) -> String {
        let set = Array(Set(days.map { $0 % 7 })).sorted()
        if set.count == 7 { return "Daily" }
        if set.count == 1 { return pluralDays[set[0]] }
        if set == [1, 2, 3, 4, 5] { return "Weekdays" }
        if set == [0, 6] { return "Weekends" }
        return set.map { dayNames[$0] }.joined(separator: ", ")
    }

    private static func zoneNote(_ timezone: String?, localZone: String) -> String {
        guard let timezone, !timezone.isEmpty, timezone != localZone else { return "" }
        let city = timezone.split(separator: "/").last.map(String.init) ?? timezone
        return " (\(city.replacingOccurrences(of: "_", with: " ")) time)"
    }

    /// "*/n" as n.
    private static func step(_ field: String) -> Int? {
        guard field.hasPrefix("*/") else { return nil }
        let digits = field.dropFirst(2)
        guard !digits.isEmpty, digits.allSatisfy(\.isASCIIDigit) else { return nil }
        return Int(digits)
    }

    /// A cron field's values in [min, max] (*, n, a-b, lists, /steps, day names), or nil.
    private static func values(_ field: String, _ min: Int, _ max: Int, names: [String: Int]? = nil) -> [Int]? {
        func value(_ text: Substring) -> Int? {
            if let named = names?[text.lowercased()] { return named }
            guard !text.isEmpty, text.allSatisfy(\.isASCIIDigit) else { return nil }
            return Int(text)
        }
        var out = Set<Int>()
        for part in field.split(separator: ",", omittingEmptySubsequences: false) {
            var base = part
            var stepBy = 1
            var stepped = false
            if let slash = part.firstIndex(of: "/") {
                let digits = part[part.index(after: slash)...]
                guard !digits.isEmpty, digits.allSatisfy(\.isASCIIDigit), let n = Int(digits) else { return nil }
                stepBy = n
                stepped = true
                base = part[..<slash]
            }
            let from: Int, to: Int
            if base == "*" {
                (from, to) = (min, max)
            } else {
                let ends = base.split(separator: "-", omittingEmptySubsequences: false)
                guard ends.count <= 2, let a = value(ends[0]) else { return nil }
                if ends.count == 2 {
                    guard let b = value(ends[1]) else { return nil }
                    (from, to) = (a, b)
                } else {
                    (from, to) = (a, stepped ? max : a)
                }
            }
            guard stepBy >= 1, from >= min, to <= max, from <= to else { return nil }
            for v in stride(from: from, through: to, by: stepBy) { out.insert(v) }
        }
        return out.sorted()
    }
}

private extension Character {
    var isASCIIDigit: Bool { ("0"..."9").contains(self) }
}
