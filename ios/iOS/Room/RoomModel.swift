import Foundation
import Observation
import SwiftUI

enum RoomPlace: String, CaseIterable, Identifiable, Hashable {
    case tasks, conversations, memory, library, schedules, archive, theme

    static let menu: [RoomPlace] = [.tasks, .conversations, .memory, .library, .schedules]

    var id: String { rawValue }

    var title: String {
        switch self {
        case .tasks: "Tasks"
        case .conversations: "Conversations"
        case .memory: "Memory"
        case .library: "Library"
        case .schedules: "Schedules"
        case .archive: "Archive"
        case .theme: "Theme"
        }
    }
}

enum RoomMode: Equatable {
    case rest, talk, menu
    case record(locked: Bool)

    var recording: Bool {
        if case .record = self { return true }
        return false
    }
}

enum RoomEvent: Equatable {
    case tapInput, openChat, chevron, tapOutside
    case menuButton, closeMenu
    case open(RoomPlace), closePlace
}

@MainActor @Observable
final class RoomModel {
    private(set) var mode: RoomMode = .rest
    var place: RoomPlace?
    private(set) var focusRequests = 0
    private(set) var closesToRest = false

    var standing: Bool { mode == .talk }
    var showsDay: Bool { mode == .rest || mode.recording }
    var showsMenu: Bool { mode == .menu }

    enum Effect: Equatable { case none, focus, dismissKeyboard }

    @discardableResult
    func handle(_ event: RoomEvent) -> Effect {
        var (next, effect) = Self.transition(mode, event)
        if case .open(let place) = event, next == .menu {
            self.place = place
            closesToRest = false
        }
        if event == .closePlace {
            place = nil
            if closesToRest { next = .rest }
            closesToRest = false
        }
        if next != .menu { place = nil }
        if next == .talk, mode != .talk { RoomPerf.standUp() }
        mode = next
        if effect == .focus { focusRequests += 1 }
        return effect
    }

    func focusInput() {
        focusRequests += 1
    }

    func sync(talk: HoldToTalk.State) {
        mode = Self.mode(mode, talk: talk)
    }

    nonisolated static func mode(_ mode: RoomMode, talk: HoldToTalk.State) -> RoomMode {
        switch talk {
        case .recording, .cancelling: return mode == .talk ? .talk : .record(locked: false)
        case .handsFree: return mode == .talk ? .talk : .record(locked: true)
        case .idle, .sending, .dictating: return mode.recording ? .rest : mode
        }
    }

    nonisolated static func hint(_ talk: HoldToTalk.State) -> String? {
        switch talk {
        case .recording: "Release to send · slide left to cancel"
        case .cancelling: "Release to cancel"
        case .handsFree: "Tap the mic to send"
        case .sending: "Sending…"
        case .idle, .dictating: nil
        }
    }

    func show(_ mode: RoomMode, place: RoomPlace? = nil) {
        self.mode = mode
        self.place = mode == .menu ? place : nil
        closesToRest = false
    }

    func showPlace(_ place: RoomPlace) {
        mode = .menu
        self.place = place
        closesToRest = true
    }

    nonisolated static func transition(_ mode: RoomMode, _ event: RoomEvent) -> (RoomMode, Effect) {
        switch (mode, event) {
        case (.rest, .tapInput): return (.talk, .focus)
        case (.rest, .openChat): return (.talk, .none)
        case (.talk, .tapInput): return (.talk, .focus)
        case (.talk, .chevron), (.talk, .tapOutside): return (.rest, .dismissKeyboard)
        case (.rest, .menuButton): return (.menu, .none)
        case (.menu, .closeMenu), (.menu, .menuButton): return (.rest, .none)
        case (.menu, .open): return (.menu, .none)
        case (.menu, .closePlace): return (.menu, .none)
        default: return (mode, .none)
        }
    }
}

enum RoomTheme {
    static let fallback = "aurora-fjord"

    static func resolve(botThemeId: String?, phoneThemeId: String?, catalog: LookCatalog) -> LookTheme {
        for id in [botThemeId, phoneThemeId].compactMap({ $0 }) {
            let canonical = LookTheme.canonical(id)
            if let theme = catalog.themes.first(where: { $0.id == canonical }), theme.kind == .scene { return theme }
        }
        return catalog.themes.first { $0.id == fallback } ?? catalog.theme(fallback)
    }
}

enum RoomText {
    static func clean(_ items: [TimelineItem]) -> [TimelineItem] {
        items.compactMap { item in
            guard case .message(var row) = item, row.kind == "conversation", !row.isPassReply, let text = row.text, text.contains("["),
                  text.components(separatedBy: "\n").contains(where: isStatusToken) else { return item }
            let kept = text.components(separatedBy: "\n").filter { !isStatusToken($0) }
            let joined = kept.joined(separator: "\n").trimmingCharacters(in: .whitespacesAndNewlines)
            guard !joined.isEmpty || row.hasAttachments else { return nil }
            row.text = joined
            return .message(row)
        }
    }

    static func rows(_ rows: [ThreadTranscriptRow]) -> [ThreadTranscriptRow] {
        rows.compactMap { row in
            guard case .item(.message(let message), let state) = row else { return row }
            if let event = BotChatEntry.childEvent(message) { return .bot(.child(event, id: message.id), .init()) }
            if state.relayed != nil { return row }
            return BotChatEntry.shows(message) ? row : nil
        }
    }

    static func isStatusToken(_ line: String) -> Bool {
        line.range(of: #"^[\s`*_~]*\[(pass|fail|failed|done|ok|skip|skipped|noop)\][\s`*_~]*$"#, options: [.regularExpression, .caseInsensitive]) != nil
    }

    static func plain(_ text: String) -> String {
        let kept = text.components(separatedBy: "\n").compactMap { raw -> String? in
            var line = raw.trimmingCharacters(in: .whitespaces)
            if line.isEmpty || line.hasPrefix("::") || line.hasPrefix("```") || isStatusToken(line) { return nil }
            while line.hasPrefix("#") { line.removeFirst() }
            if line.hasPrefix("- ") || line.hasPrefix("* ") { line.removeFirst(2) }
            line = line.replacingOccurrences(of: "**", with: "").replacingOccurrences(of: "__", with: "").replacingOccurrences(of: "`", with: "")
            return line.trimmingCharacters(in: .whitespaces)
        }
        return kept.filter { !$0.isEmpty }.joined(separator: " ")
    }
}

enum RoomHeader {
    static func subline(main: Bool, title: String, rows: [TimelineRow], now: Date = Date(), calendar: Calendar = .current) -> String {
        guard main else { return role(title) }
        let date = now.formatted(.dateTime.weekday(.abbreviated).month(.abbreviated).day())
        guard let note = goodToKnow(rows: rows, now: now, calendar: calendar), let weather = weather(note) else { return date }
        return date + " · " + weather
    }

    static func role(_ title: String) -> String {
        let words = title.lowercased().split { !$0.isLetter }
        if words.contains("lead") { return "Project lead" }
        if words.contains("worker") { return "Worker" }
        return "Conversation"
    }

    static let weatherWords = ["sunny", "sun", "cloudy", "clouds", "overcast", "rain", "rainy", "showers", "snow", "snowy", "fog", "foggy", "windy",
                               "clear", "storm", "storms", "thunderstorms", "drizzle", "sleet", "hail", "humid", "high", "low", "°"]

    static func weather(_ note: String) -> String? {
        let lower = note.lowercased()
        let words = Set(lower.split { !$0.isLetter && $0 != "°" }.map(String.init))
        guard lower.contains("°") || !words.isDisjoint(with: weatherWords) else { return nil }
        let clause = note.split(whereSeparator: { ",.;".contains($0) }).first.map(String.init)?.trimmingCharacters(in: .whitespaces) ?? note
        guard !clause.isEmpty else { return nil }
        return clause.count > 42 ? String(clause.prefix(41)).trimmingCharacters(in: .whitespaces) + "…" : clause
    }

    static func goodToKnow(rows: [TimelineRow], now: Date, calendar: Calendar) -> String? {
        for row in rows.reversed() where row.kind == "conversation" && row.role == "assistant" {
            guard let text = row.text, LoopDirective.isMorning(LoopDirective.all(in: text)) else { continue }
            guard let at = row.createdAt, calendar.isDate(Date(timeIntervalSince1970: at / 1000), inSameDayAs: now) else { return nil }
            let parsed = MorningCard.parse(text)
            let section = parsed.sections.first { $0.title.lowercased().hasPrefix("good to know") }
            for line in section?.lines ?? [] {
                if case .text(let note) = line {
                    let plain = RoomText.plain(note)
                    if !plain.isEmpty { return plain }
                }
            }
            return nil
        }
        return nil
    }
}

struct RoomNow: Equatable {
    var text: String
    var since: Date?
    var last: String?
    var active: Bool

    static func agentTasks(_ tasks: [TaskItem]) -> [TaskItem] {
        tasks.filter { !$0.isMine && !$0.isClosed && !$0.isRecurring && $0.automation?.role != "finding" }
            .sorted { ($0.state == .inProgress ? 0 : 1, $1.updatedAt) < ($1.state == .inProgress ? 0 : 1, $0.updatedAt) }
    }

    static func yours(_ tasks: [TaskItem]) -> [TaskItem] {
        tasks.filter { $0.isMine && !$0.isClosed }.sorted { ($0.needsYou ? 0 : 1, $0.createdAt) < ($1.needsYou ? 0 : 1, $1.createdAt) }
    }

    static func make(threadId: String, main: Bool, running: Bool, tasks: [TaskItem], todos: [Todos.Item], rows: [TimelineRow],
                     workers: [BotWorker], latest: String?) -> RoomNow {
        let own = tasks.filter { task in
            guard !task.isMine, task.automation == nil else { return false }
            if let owner = task.ownerThreadId { return owner == threadId }
            return main
        }
        let last = lastFinished(tasks: tasks, workers: workers, latest: latest)
        if running {
            let doing = todos.first { $0.status == "in_progress" }?.text
                ?? own.first { $0.state == .inProgress }.map { $0.line ?? $0.title }
                ?? rows.last { $0.isWorkRow && ["inProgress", "running", "pending"].contains($0.status ?? "") }.flatMap(\.nowTitle)
                ?? "Writing a reply"
            let turn = rows.last { $0.role == "user" }.flatMap { $0.createdAt ?? $0.startedAt }
            return RoomNow(text: sentence(doing), since: turn.map { Date(timeIntervalSince1970: $0 / 1000) }, last: last, active: true)
        }
        if let task = own.first(where: { $0.state == .inProgress }) {
            return RoomNow(text: sentence(task.line ?? task.title), since: task.updatedAt, last: last, active: true)
        }
        let busy = workers.filter { $0.status == .running }
        if !busy.isEmpty {
            let text = busy.count == 1 ? "Waiting on " + (busy[0].title.isEmpty ? "a worker" : busy[0].title) : "Waiting on \(number(busy.count)) workers"
            return RoomNow(text: text, since: busy.map(\.updated).min(), last: last, active: true)
        }
        return RoomNow(text: "Idle", since: nil, last: last, active: false)
    }

    static func lastFinished(tasks: [TaskItem], workers: [BotWorker], latest: String?) -> String? {
        if let done = tasks.filter({ !$0.isMine && $0.state == .done }).max(by: { ($0.closedAt ?? $0.updatedAt) < ($1.closedAt ?? $1.updatedAt) }) {
            return sentence(done.line ?? done.title)
        }
        if let worker = workers.filter({ $0.status == .done }).max(by: { $0.updatedAt < $1.updatedAt }), !worker.title.isEmpty {
            return "finished " + worker.title
        }
        guard let latest else { return nil }
        let plain = RoomText.plain(latest)
        return plain.isEmpty ? nil : plain
    }

    static func sentence(_ text: String) -> String {
        let plain = RoomText.plain(text)
        let line = plain.isEmpty ? text : plain
        return line.count > 90 ? String(line.prefix(89)).trimmingCharacters(in: .whitespaces) + "…" : line
    }

    static func number(_ n: Int) -> String {
        let words = ["no", "one", "two", "three", "four", "five", "six", "seven", "eight", "nine", "ten"]
        return n < words.count ? words[n] : "\(n)"
    }

    static func elapsed(_ since: Date, now: Date = Date()) -> String {
        let minutes = max(0, Int(now.timeIntervalSince(since) / 60))
        if minutes < 1 { return "just now" }
        if minutes < 60 { return "\(minutes) min" }
        let hours = minutes / 60
        if hours < 24 { return minutes % 60 == 0 || hours >= 6 ? "\(hours) h" : "\(hours) h \(minutes % 60) min" }
        return "\(hours / 24) d"
    }

    func small(now: Date = Date()) -> String? {
        let parts = [since.map { Self.elapsed($0, now: now) }, last.map { "last: " + Self.lowered($0) }].compactMap { $0 }
        return parts.isEmpty ? nil : parts.joined(separator: " · ")
    }

    static func lowered(_ text: String) -> String {
        guard let first = text.first, first.isUppercase else { return text }
        let second = text.dropFirst().first
        guard second.map({ $0.isLowercase || $0 == " " }) ?? true else { return text }
        if text.hasPrefix("I ") { return text }
        return first.lowercased() + text.dropFirst()
    }
}

extension TimelineRow {
    var isWorkRow: Bool { kind == "work" }

    var nowTitle: String? {
        let raw = title ?? command ?? toolName
        guard let raw, !raw.isEmpty else { return nil }
        return raw
    }
}

enum RoomLight: Int, CaseIterable, Equatable {
    case natural, dusk, night, dawn, morning

    var name: String {
        switch self {
        case .natural: "day"
        case .dusk: "dusk"
        case .night: "night"
        case .dawn: "dawn"
        case .morning: "morning"
        }
    }

    static func hash(_ id: String) -> UInt64 {
        var value: UInt64 = 0xcbf29ce484222325
        for byte in id.utf8 {
            value ^= UInt64(byte)
            value = value &* 0x100000001b3
        }
        return value
    }

    static func natural(for id: String) -> RoomLight {
        let rest = allCases.filter { $0 != .natural }
        return rest[Int(hash(id) % UInt64(rest.count))]
    }

    static func lights(order: [String], main: String) -> [String: RoomLight] {
        var out: [String: RoomLight] = [:]
        var previous: RoomLight?
        for id in order {
            var light = id == main ? .natural : natural(for: id)
            if light == previous, id != main {
                let rest = allCases.filter { $0 != .natural }
                let at = rest.firstIndex(of: light) ?? 0
                light = rest[(at + 1) % rest.count]
            }
            out[id] = light
            previous = light
        }
        return out
    }
}

struct RoomChat {
    var focusRequests: Int
    var away: Bool
    var layDown: () -> Void
}

private struct RoomChatKey: EnvironmentKey {
    static let defaultValue: RoomChat? = nil
}

extension EnvironmentValues {
    var roomChat: RoomChat? {
        get { self[RoomChatKey.self] }
        set { self[RoomChatKey.self] = newValue }
    }
}

enum RoomPager {
    static let swipe: CGFloat = 60

    static func order(main: String, conversations: [BotConversation]) -> [String] {
        var seen: Set<String> = [main]
        let others = conversations.filter { !$0.isMain && $0.forkedFrom == nil }.sorted { $0.updatedAt > $1.updatedAt }
        return [main] + others.compactMap { seen.insert($0.threadId).inserted ? $0.threadId : nil }
    }

    static func step(_ order: [String], from current: String, by step: Int) -> String? {
        guard let at = order.firstIndex(of: current), order.indices.contains(at + step) else { return nil }
        return order[at + step]
    }

    enum Axis: Equatable { case vertical, horizontal }

    static func axis(_ translation: CGSize) -> Axis? {
        guard max(abs(translation.width), abs(translation.height)) > 10 else { return nil }
        return abs(translation.width) > abs(translation.height) * 1.2 ? .horizontal : .vertical
    }

    static func page(after translation: CGSize, predicted: CGSize) -> Int {
        let distance = abs(predicted.width) > abs(translation.width) ? predicted.width : translation.width
        guard abs(distance) > swipe else { return 0 }
        return distance < 0 ? 1 : -1
    }
}

@MainActor
final class RoomSessions: ObservableObject {
    @Published private(set) var shown: String
    private var sessions: [String: RoomSession] = [:]

    init(main: String) { shown = main }

    var current: RoomSession { session(for: shown) }

    func session(for threadId: String) -> RoomSession {
        if let session = sessions[threadId] { return session }
        let session = RoomSession(threadId: threadId)
        sessions[threadId] = session
        return session
    }

    func show(_ threadId: String) {
        guard threadId != shown else { return }
        let leaving = current
        leaving.talk.end()
        leaving.stop()
        shown = threadId
    }
}
