import Foundation

/// Studio's item chat: threads about a Studio item. The agent's first message
/// carries a pill for the item, which the plugin turns into a pointer to it
/// and the tools that read it. Pages go through Pages, so they stay in the page's chats.
extension BBClient {
    /// A started item chat, and whether it had to use the standard settings.
    public struct StudioChatStart: Sendable, Equatable {
        public var threadId: String
        /// The project's defaults couldn't be read, so the chat uses the standard settings.
        public var usedStandardSettings: Bool
    }

    /// Starts a thread about the item with the project's default agent. When the
    /// defaults can't be read, it starts with the standard settings and says so.
    public func startStudioChat(pluginId: String, itemId: String, projectId: String, text: String) async throws -> StudioChatStart {
        struct Result: Decodable { var threadId: String }
        var standard = false
        let choice: ExecutionChoice
        do {
            choice = try await projectDefaults(projectId) ?? ExecutionChoice()
        } catch where !Self.isCancellation(error) {
            choice = ExecutionChoice()
            standard = true
        }
        let request = Self.studioExecutionRequest(projectId: projectId, text: text, mentions: [], choice: choice)
        let input: JSONValue = ["item": ["pluginId": .string(pluginId), "id": .string(itemId)], "request": request]
        let result: Result = try await rpc("studio", Studio.Method.chat_start, input)
        return StudioChatStart(threadId: result.threadId, usedStandardSettings: standard)
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
