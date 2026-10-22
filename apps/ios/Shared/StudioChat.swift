import Foundation

/// Studio's item chat: threads about a Studio item. The agent's first message
/// carries a pill for the item, which the plugin turns into a pointer to it
/// and the tools that read it. Pages go through Pages, so they stay in the page's chats.
extension BBClient {
    /// Starts a thread about the item with the project's default agent.
    public func startStudioChat(pluginId: String, itemId: String, projectId: String, text: String) async throws -> String {
        struct Result: Decodable { var threadId: String }
        let choice = try await projectDefaults(projectId) ?? ExecutionChoice()
        let request = Self.studioExecutionRequest(projectId: projectId, text: text, mentions: [], choice: choice)
        let input: JSONValue = ["item": ["pluginId": .string(pluginId), "id": .string(itemId)], "request": request]
        let result: Result = try await rpc("studio", Studio.Method.chat_start, input)
        return result.threadId
    }

    /// The execution options shared by item chats and page work.
    static func studioExecutionRequest(projectId: String, text: String, mentions: [Mention], choice: ExecutionChoice) -> JSONValue {
        let permission = choice.permissionMode.flatMap { PermissionMode.all.contains($0) ? $0 : nil } ?? "auto"
        return [
            "projectId": .string(projectId),
            "providerId": .string(choice.providerId ?? "claude-code"),
            "model": .string(choice.model ?? ""),
            "reasoningLevel": .string(choice.reasoningLevel ?? "medium"),
            "permissionMode": .string(permission),
            "executionInputSources": [:],
            "environment": ["type": "project-default"],
            "input": [["type": "text", "text": .string(text), "mentions": .array(Mention.ranges(in: text, mentions))]],
        ]
    }

    /// The item's current home thread, if one is still linked.
    public func lastStudioChat(pluginId: String, itemId: String) async throws -> String? {
        let input: JSONValue = ["pluginId": .string(pluginId), "id": .string(itemId)]
        let result: Studio.ChatHomeOutput = try await rpc("studio", Studio.Method.chat_home, input)
        return result.thread?.threadId
    }
}
