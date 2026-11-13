import ActivityKit
import Foundation

/// A Bot's Live Activity: one per Bot while a turn or any worker runs, or while
/// something needs you. The app starts and updates it while open; Studio
/// starts, updates and ends it by push through the Mobile relay otherwise
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
        /// Running workers.
        var workers: Int
        /// The conversation the line comes from, and its title ("Main").
        var conversationId: String?
        var conversationTitle: String?
        /// That conversation's latest line, plain text.
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
    /// What the activity shows for a Bot now, or nil when it's idle and the
    /// activity should end. `view` is the Bot's threads, when loaded.
    static func make(bot: BotSpace, view: BotThreadsView?, approval: BotActivityAttributes.Approval? = nil,
                     now: Date = .now) -> Self? {
        let view = view?.botId == nil || view?.botId == bot.id ? view : nil
        let presence = bot.presenceState(live: view.map { var copy = $0; copy.botId = bot.id; return copy })
        guard presence != .idle else { return nil }
        let workers = view.map { $0.workers.filter { $0.status == .running }.count } ?? bot.activity.workers
        let conversation = view.flatMap(Self.conversation)
        let needingWorker = view?.workers.first { $0.status == .needsYou }
        var needs: String?
        if presence == .needs {
            needs = conversation?.needsYou?.reason.nonEmpty
                ?? approval.map { "Approve: \($0.summary)" }
                ?? needingWorker.map { "\($0.title.nonEmpty ?? "A worker") is waiting on you" }
                ?? "Needs you"
        }
        return Self(state: presence.rawValue, workers: workers,
                    conversationId: conversation?.threadId ?? bot.mainThreadId,
                    conversationTitle: conversation.map { $0.isMain ? "Main" : ($0.title.nonEmpty ?? "Conversation") } ?? "Main",
                    line: conversation?.latest.map(Self.plain).flatMap(\.nonEmpty).map { String($0.prefix(160)) },
                    needsYou: needs.map { String($0.prefix(120)) }, approval: approval,
                    updatedAt: now.timeIntervalSince1970)
    }

    /// The conversation the activity speaks for: one that needs you, else one
    /// that's running, else Main, else the newest.
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
