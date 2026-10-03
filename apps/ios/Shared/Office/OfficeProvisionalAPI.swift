import Foundation

// Pending server stages 4–6: method shapes mirror src/ui/office/model.ts.
// These calls intentionally stay visible as dynamic dispatch in the native
// inventory until the office contract lands. Replace with Studio.Method then.
extension BBClient {
    func pendingOfficeRPC<T: Decodable>(_ method: String, _ input: JSONValue) async throws -> T {
        try await rpc("studio", method, input)
    }
    public func officeTeam(_ spaceId: String) async throws -> [OfficeTeamBot] {
        struct Result: Decodable { var bots: [OfficeTeamBot] }
        let result: Result = try await pendingOfficeRPC("team_list", ["spaceId": .string(spaceId)])
        return result.bots
    }
    public func officeTalk(_ spaceId: String) async throws -> [OfficeConversation] {
        struct Result: Decodable { var conversations: [OfficeConversation] }
        let result: Result = try await pendingOfficeRPC("talk_list", ["spaceId": .string(spaceId)])
        return result.conversations
    }
    /// Creates or reuses the bot's DM. Reload its desk for navigation IDs, as
    /// the web UI does, until talk_dm's return contract is published.
    public func officeDirectMessage(botId: String) async throws {
        let _: JSONValue = try await pendingOfficeRPC("talk_dm", ["botId": .string(botId)])
    }
    public func officeStart(spaceId: String, request: String) async throws -> OfficeStartResult {
        try await pendingOfficeRPC("office_start", ["spaceId": .string(spaceId), "request": .string(request)])
    }
    public func officeDelegate(botId: String, brief: String, context: [String]? = nil,
                               folderId: String? = nil, schedule: String? = nil) async throws -> OfficeDelegationResult {
        try await pendingOfficeRPC("delegate", .object(omittingNil: [
            "botId": .string(botId), "brief": .string(brief),
            "context": context.map { .array($0.map(JSONValue.string)) },
            "folderId": folderId.map(JSONValue.string), "schedule": schedule.map(JSONValue.string),
        ]))
    }
    public func officeBotDesk(_ botId: String) async throws -> OfficeBotDesk {
        try await pendingOfficeRPC("bot_desk", ["botId": .string(botId)])
    }
}

/// Provisional office_start result from the web OfficeHome composer.
public struct OfficeStartResult: Codable, Sendable {
    public var threadId: String?
    public var taskId: String?
    public var botId: String?
}

/// Provisional delegate result from the web DelegateDialog.
public struct OfficeDelegationResult: Codable, Sendable {
    public var taskId: String
}
