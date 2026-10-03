import Foundation

// Pending server stages 4–6: method shapes mirror src/ui/office/model.ts.
// These calls intentionally stay visible as dynamic dispatch in the native
// inventory until the office contract lands. Replace with Studio.Method then.
extension BBClient {
    private func pendingOfficeRPC<T: Decodable>(_ method: String, _ input: JSONValue) async throws -> T {
        try await rpc("studio", method, input)
    }
    public func officeHome(_ spaceId: String) async throws -> OfficeHome {
        try await pendingOfficeRPC("home", ["spaceId": .string(spaceId)])
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
    public func officeBotDesk(_ botId: String) async throws -> OfficeBotDesk {
        try await pendingOfficeRPC("bot_desk", ["botId": .string(botId)])
    }
}
