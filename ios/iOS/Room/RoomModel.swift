import Foundation
import Observation
import SwiftUI

enum RoomPlace: String, CaseIterable, Identifiable, Hashable {
    case strands, conversations, memory, library, schedules, archive, theme

    /// The places at the foot of the conversation list (the conversation is home).
    static let homeList: [RoomPlace] = [.strands, .memory, .library, .schedules, .theme]

    var id: String { rawValue }

    var symbol: String {
        switch self {
        case .strands: "list.bullet.rectangle"
        case .conversations: "bubble.left.and.bubble.right"
        case .memory: "brain"
        case .library: "books.vertical"
        case .schedules: "clock"
        case .archive: "archivebox"
        case .theme: "paintpalette"
        }
    }

    var title: String {
        switch self {
        case .strands: "Strands"
        case .conversations: "Conversations"
        case .memory: "Memory"
        case .library: "Library"
        case .schedules: "Schedules"
        case .archive: "Archive"
        case .theme: "Theme"
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
            if let event = BotChatRows.childEvent(message) { return .child(event, id: message.id) }
            if state.relayed != nil { return row }
            return BotChatRows.shows(message) ? row : nil
        }
    }

    private static let statusTokens: Set<String> = ["pass", "fail", "failed", "done", "ok", "skip", "skipped", "noop"]

    static func isStatusToken(_ line: String) -> Bool {
        guard !line.isEmpty else { return false }
        let scalars = line.unicodeScalars
        var start = scalars.startIndex
        var end = scalars.endIndex
        func isTrim(_ s: Unicode.Scalar) -> Bool {
            s.properties.isWhitespace || s == "`" || s == "*" || s == "_" || s == "~"
        }
        while start < end, isTrim(scalars[start]) { scalars.formIndex(after: &start) }
        while end > start {
            let prev = scalars.index(before: end)
            guard isTrim(scalars[prev]) else { break }
            end = prev
        }
        guard start < end, scalars[start] == "[" else { return false }
        let last = scalars.index(before: end)
        guard last > start, scalars[last] == "]" else { return false }
        let inner = scalars[scalars.index(after: start)..<last]
        guard inner.count <= 8 else { return false }
        return statusTokens.contains(Substring(inner).lowercased())
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
    /// The conversation is home: the header opens the conversation list instead of going back to the room.
    var showList: (() -> Void)? = nil
    /// Swiping sideways on the messages pages between the Bot's conversations.
    var page: ((CGFloat, CGFloat?) -> Void)? = nil
    /// Where this conversation is among them, for the dots under its name.
    var pages: RoomChatPages? = nil
    /// The unfolded Duo's left screen shows its strands: no box above the composer.
    var strandsBeside = false
    /// The unfolded Duo: the title shows the Workspace on the right screen instead of a sheet.
    var showWorkspace: (() -> Void)? = nil
}

struct RoomChatPages: Equatable {
    var index: Int
    var count: Int
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
    static let maxCached = 6
    @Published private(set) var shown: String
    private var sessions: [String: RoomSession] = [:]
    private var recentOrder: [String] = []

    init(main: String) {
        shown = main
        recentOrder = [main]
    }

    var current: RoomSession { session(for: shown) }

    func session(for threadId: String) -> RoomSession {
        touch(threadId)
        if let session = sessions[threadId] { return session }
        let session = RoomSession(threadId: threadId)
        sessions[threadId] = session
        evictIfNeeded()
        return session
    }

    func show(_ threadId: String) {
        guard threadId != shown else { return }
        let leaving = current
        leaving.talk.end()
        leaving.stop()
        shown = threadId
        touch(threadId)
        evictIfNeeded()
    }

    private func touch(_ threadId: String) {
        if let idx = recentOrder.firstIndex(of: threadId) { recentOrder.remove(at: idx) }
        recentOrder.append(threadId)
    }

    private func evictIfNeeded() {
        while sessions.count > Self.maxCached {
            guard let victim = recentOrder.first(where: { $0 != shown && sessions[$0] != nil }) else { break }
            sessions.removeValue(forKey: victim)?.stop()
            if let idx = recentOrder.firstIndex(of: victim) { recentOrder.remove(at: idx) }
        }
    }
}
