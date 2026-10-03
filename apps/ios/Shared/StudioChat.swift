import Foundation

/// Studio Chat: threads about a Studio item. The agent's first message
/// carries a pill for the item, which the plugin turns into a pointer to it
/// and the tools that read it. Pages go through Pages, so they stay in the page's chats.
extension BBClient {
    /// Starts a thread about the item with the project's default agent.
    public func startStudioChat(pluginId: String, itemId: String, projectId: String, text: String) async throws -> String {
        struct Result: Decodable { var threadId: String }
        let choice = ((try? await projectDefaults(projectId)) ?? nil) ?? ExecutionChoice()
        let permission = choice.permissionMode.flatMap { PermissionMode.all.contains($0) ? $0 : nil } ?? "auto"
        let request: JSONValue = [
            "projectId": .string(projectId),
            "providerId": .string(choice.providerId ?? "claude-code"),
            "model": .string(choice.model ?? ""),
            "reasoningLevel": .string(choice.reasoningLevel ?? "medium"),
            "permissionMode": .string(permission),
            "executionInputSources": [:],
            "environment": ["type": "project-default"],
            "input": [["type": "text", "text": .string(text), "mentions": []]],
        ]
        let result: Result = try await rpc("studio", Studio.Method.chat_start, [
            "item": ["pluginId": .string(pluginId), "id": .string(itemId)],
            "request": request,
        ])
        return result.threadId
    }

    /// The item's current home thread, if one is still linked.
    public func lastStudioChat(pluginId: String, itemId: String) async throws -> String? {
        let result: Studio.ChatHomeOutput = try await rpc("studio", Studio.Method.chat_home, ["pluginId": .string(pluginId), "id": .string(itemId)])
        return result.thread?.threadId
    }
}
