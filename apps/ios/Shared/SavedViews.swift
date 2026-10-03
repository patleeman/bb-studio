import Foundation

extension SavedViewMember { var json: JSONValue { ["kind": .string(kind), "id": .string(id)] } }

extension BBClient {
    public func savedView(_ id: String, before: SavedViewEntry? = nil) async throws -> SavedViewPage {
        var input: [String: JSONValue] = ["id": .string(id), "limit": .from(60)]
        if let before { input["before"] = .number(before.createdAt); input["beforeId"] = .string(before.id) }
        return try await rpc("studio", "teams_view", .object(input))
    }

    public func createSavedView(name: String, members: [SavedViewMember], requestId: String = UUID().uuidString.lowercased()) async throws -> SavedThreadView {
        try await rpc("studio", "teams_viewCreate", ["name": .string(String(name.prefix(80))), "members": .array(members.map(\.json)), "requestId": .string(requestId)])
    }

    public func updateSavedView(_ view: SavedThreadView, name: String? = nil, members: [SavedViewMember]? = nil, archived: Bool? = nil) async throws -> SavedThreadView {
        try await rpc("studio", "teams_viewUpdate", ["id": .string(view.id), "name": .string(name ?? view.name), "members": .array((members ?? view.members).map(\.json)), "archived": .bool(archived ?? view.archived), "expectedUpdatedAt": .number(view.updatedAt)])
    }

    public func deleteSavedView(_ id: String) async throws {
        let _: JSONValue = try await rpc("studio", "teams_viewDelete", ["id": .string(id)])
    }

    public func sendToView(_ id: String, text: String, targets: [SavedViewMember], replyThreadId: String?, fresh: Bool, mode: String, requestId: String) async throws -> SavedViewSend {
        try await rpc("studio", "teams_viewSend", ["id": .string(id), "text": .string(text), "targets": .array(targets.map(\.json)), "replyThreadId": replyThreadId.map(JSONValue.string) ?? .null, "fresh": .bool(fresh), "mode": .string(mode), "requestId": .string(requestId)])
    }
}
