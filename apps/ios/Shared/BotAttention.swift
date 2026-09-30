import Foundation

// MARK: Bot Teams attention and approvals

/// A channel message a bot flagged for the owner: a decision, a blocker, or an update.
public struct AttentionItem: Decodable, Identifiable, Hashable, Sendable {
    public var id: String
    public var roomId: String
    /// `decision`, `blocker` or `update`.
    public var reason: String
    /// `open`, `snoozed` or `acknowledged`.
    public var status: String
    public var snoozedUntil: Double?
    public var createdAt: Double
    public var channelName: String
    public var message: RoomMessage
    public var pendingReply: PendingReply?

    public struct PendingReply: Decodable, Hashable, Sendable {
        public var id: String
        public var text: String
        public var error: String?
    }
}

public struct AttentionPage: Decodable, Sendable {
    public var items: [AttentionItem]
    public var openCount: Int
    public var nextOffset: Int?
}


extension BBClient {
    public func attention(status: String = "open", offset: Int = 0) async throws -> AttentionPage {
        try await rpc("bot-teams", "attentionList", ["status": .string(status), "limit": 30, "offset": .from(offset)])
    }

    /// `acknowledge`, `snooze` (with minutes) or `reopen`.
    @discardableResult
    public func updateAttention(_ id: String, _ action: String, minutes: Int? = nil) async throws -> AttentionItem {
        var input: [String: JSONValue] = ["id": .string(id), "action": .string(action)]
        if let minutes { input["minutes"] = .from(minutes) }
        return try await rpc("bot-teams", "attentionUpdate", .object(input))
    }
}
