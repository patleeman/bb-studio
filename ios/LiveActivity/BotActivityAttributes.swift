import ActivityKit
import Foundation

/// A Bot's Live Activity: one per Bot, only while a turn the user started from
/// the phone runs or asks something of them. The app starts, updates and ends
/// it; Studio may update and end it by push through the Mobile relay
/// (`docs/live-activity-server.md`, which documents this JSON shape).
struct BotActivityAttributes: ActivityAttributes {
    var botId: String
    var botName: String
    /// `ServerScope.namespace` of the BB server, so taps and buttons act on the right one.
    /// Empty (an activity Studio started without knowing it) means the selected server.
    var server: String

    func belongs(to namespace: String) -> Bool { server.isEmpty || server == namespace }

    struct ContentState: Codable, Hashable {
        /// `idle`, `thinking`, `working` or `needs` (`BotPresenceState`).
        var state: String
        /// Running workers. The app sends 0: the activity is about the turn.
        var workers: Int
        /// The conversation the line comes from, and its title ("Main").
        var conversationId: String?
        var conversationTitle: String?
        /// A line of text under the title. The app leaves it out (status only);
        /// never a `[PASS]` (`SilentOutput`).
        var line: String?
        /// Why the Bot needs you, shown in amber; nil when nothing does.
        var needsYou: String?
        /// The first worker approval waiting, answered from the expanded island.
        var approval: Approval?
        /// Unix seconds.
        var updatedAt: Double

        var presence: BotPresenceState { BotPresenceState(rawValue: state) ?? .idle }
    }

    struct Approval: Codable, Hashable {
        var workerThreadId: String
        var interactionId: String
        var summary: String
        var canApprove: Bool = true
        var canDeny: Bool = true
    }
}

extension BotActivityAttributes.ContentState {
    /// A turn the user started from the phone, in one of this Bot's conversations.
    struct PhoneTurn: Equatable {
        var threadId: String
        var sent: Date
        var conversation: BotConversation?
        var running: Bool
        var needsYou: Bool

        /// Still worth showing: it runs, asks something of the user, or was
        /// sent too recently for BB to say it runs (and wasn't seen running yet).
        func live(ran: Bool, now: Date) -> Bool {
            running || needsYou || (!ran && now.timeIntervalSince(sent) < PhoneTurns.grace)
        }
    }

    /// The phone turns (`PhoneTurns`: thread id → when it was sent) that are
    /// this Bot's conversations.
    static func phoneTurns(bot: BotSpace, view: BotThreadsView?, turns: [String: Date]) -> [PhoneTurn] {
        let view = view?.botId == nil || view?.botId == bot.id ? view : nil
        return turns.compactMap { threadId, sent in
            let conversation = view?.conversations.first { $0.threadId == threadId }
            if let conversation {
                return PhoneTurn(threadId: threadId, sent: sent, conversation: conversation,
                                 running: conversation.running, needsYou: conversation.needsYou != nil)
            }
            // Without the Bot's threads, only Main is known, by the Bot's own turn flag.
            guard view == nil, threadId == bot.mainThreadId else { return nil }
            return PhoneTurn(threadId: threadId, sent: sent, conversation: nil, running: bot.activity.turn, needsYou: false)
        }
    }

    /// What the activity shows for a Bot now, or nil when it should end. It
    /// follows only a turn the user started from the phone (`turns`), while it
    /// runs or asks something of the user; workers alone never show it. `ran`
    /// holds the phone turns already seen running, so a quick reply ends it
    /// without waiting out the grace. The line stays empty (the view shows the
    /// state), so an old reply or a `[PASS]` never shows. `view` is the Bot's
    /// threads, when loaded.
    static func make(bot: BotSpace, view: BotThreadsView?, turns: [String: Date], ran: Set<String> = [],
                     approval: BotActivityAttributes.Approval? = nil, now: Date = .now) -> Self? {
        let live = phoneTurns(bot: bot, view: view, turns: turns).filter { $0.live(ran: ran.contains($0.threadId), now: now) }
        guard let turn = live.max(by: { ($0.needsYou ? 1 : 0, $0.sent) < ($1.needsYou ? 1 : 0, $1.sent) }) else { return nil }
        let conversation = turn.conversation
        let needs = turn.needsYou
            ? conversation?.needsYou?.reason.nonEmpty ?? approval.map { "Approve: \($0.summary)" } ?? "Needs you"
            : nil
        return Self(state: (turn.needsYou ? BotPresenceState.needs : .thinking).rawValue, workers: 0,
                    conversationId: turn.threadId,
                    conversationTitle: conversation.map { $0.isMain ? "Main" : ($0.title.nonEmpty ?? "Conversation") } ?? "Main",
                    line: nil, needsYou: needs.map { String($0.prefix(120)) }, approval: turn.needsYou ? approval : nil,
                    updatedAt: now.timeIntervalSince1970)
    }

    /// The conversation whose latest line the widgets show change with: one
    /// that needs you, else one that's running, else Main, else the newest.
    static func conversation(_ view: BotThreadsView) -> BotConversation? {
        view.conversations.filter { $0.needsYou != nil }.max { $0.updatedAt < $1.updatedAt }
            ?? view.conversations.filter(\.running).max { $0.updatedAt < $1.updatedAt }
            ?? view.main
            ?? view.conversations.max { $0.updatedAt < $1.updatedAt }
    }

    /// Whether two states differ in anything the activity shows.
    func differs(from other: Self) -> Bool {
        var a = self, b = other
        a.updatedAt = 0
        b.updatedAt = 0
        return a != b
    }

    static func plain(_ text: String) -> String {
        text.replacingOccurrences(of: #"\[([^\]]+)\]\([^)]+\)"#, with: "$1", options: .regularExpression)
            .replacingOccurrences(of: #"[*_`#>]+"#, with: "", options: .regularExpression)
            .replacingOccurrences(of: #"\s+"#, with: " ", options: .regularExpression)
            .trimmingCharacters(in: .whitespacesAndNewlines)
    }
}

private extension String {
    var nonEmpty: String? {
        let trimmed = trimmingCharacters(in: .whitespacesAndNewlines)
        return trimmed.isEmpty ? nil : trimmed
    }
}

/// The Bot's links, scoped to its server: the activity opens the conversation.
enum BotActivityLinks {
    static func open(_ attributes: BotActivityAttributes, _ state: BotActivityAttributes.ContentState) -> URL {
        var path = "bbstudio://bot/\(attributes.botId)"
        if let id = state.conversationId { path = "bbstudio://conversation/\(id)" }
        var parts = URLComponents(string: path)!
        if !attributes.server.isEmpty { parts.queryItems = [URLQueryItem(name: "server", value: attributes.server)] }
        return parts.url!
    }
}
