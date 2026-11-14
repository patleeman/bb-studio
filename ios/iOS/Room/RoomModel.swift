import Foundation
import Observation
import SwiftUI

enum RoomPlace: String, CaseIterable, Identifiable, Hashable {
    case todos, conversations, memory, library, schedules, archive, theme

    static let menu: [RoomPlace] = [.todos, .conversations, .memory, .library, .schedules]

    var id: String { rawValue }

    var title: String {
        switch self {
        case .todos: "Todos"
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
    case tapInput, tapFloor, chevron, tapOutside
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
        mode = next
        if effect == .focus { focusRequests += 1 }
        return effect
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
        case (.rest, .tapFloor): return (.talk, .none)
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

enum RoomFloor {
    static func clean(_ items: [TimelineItem]) -> [TimelineItem] {
        items.compactMap { item in
            guard case .message(var row) = item, row.kind == "conversation", let text = row.text, text.contains("["),
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
            guard case .item(.message(let message), _) = row else { return row }
            if let event = BotChatEntry.childEvent(message) { return .bot(.child(event, id: message.id), .init()) }
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

enum RoomDay {
    struct Line: Equatable {
        var lead: String
        var rest: String?
    }

    static func line(rows: [TimelineRow], todayCount: Int?, status: String, now: Date = Date(), calendar: Calendar = .current) -> Line {
        let lead = countLine(todayCount)
        if let note = goodToKnow(rows: rows, now: now, calendar: calendar) { return Line(lead: lead, rest: note) }
        return Line(lead: lead, rest: status)
    }

    static func countLine(_ count: Int?) -> String {
        switch count {
        case nil: return "Here's your day."
        case 0: return "Nothing on today's list."
        case 1: return "One thing today."
        case let n?:
            let words = ["", "One", "Two", "Three", "Four", "Five", "Six", "Seven", "Eight", "Nine", "Ten"]
            return (n < words.count ? words[n] : "\(n)") + " things today."
        }
    }

    static func goodToKnow(rows: [TimelineRow], now: Date, calendar: Calendar) -> String? {
        for row in rows.reversed() where row.kind == "conversation" && row.role == "assistant" {
            guard let text = row.text, LoopDirective.isMorning(LoopDirective.all(in: text)) else { continue }
            guard let at = row.createdAt, calendar.isDate(Date(timeIntervalSince1970: at / 1000), inSameDayAs: now) else { return nil }
            let parsed = MorningCard.parse(text)
            let section = parsed.sections.first { $0.title.lowercased().hasPrefix("good to know") }
            for line in section?.lines ?? [] {
                if case .text(let note) = line {
                    let plain = RoomFloor.plain(note)
                    if !plain.isEmpty { return plain }
                }
            }
            return nil
        }
        return nil
    }
}

struct RoomChat {
    var focusRequests: Int
    var lying: Bool
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
