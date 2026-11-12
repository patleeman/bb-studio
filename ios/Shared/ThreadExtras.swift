import Foundation

/// A prompt sent before, for sending again.
public struct PromptHistoryEntry: Decodable, Identifiable, Hashable, Sendable {
    public var id: String
    public var createdAt: Double
    public var input: [QueuedMessage.Input]

    public var text: String {
        input.compactMap { $0.type == "text" ? $0.text : nil }.joined(separator: "\n")
    }
}

extension BBClient {
    /// Newest first.
    public func promptHistory(_ threadId: String, limit: Int = 50) async throws -> [PromptHistoryEntry] {
        try await get("/api/v1/threads/\(threadId)/prompt-history?limit=\(limit)")
    }

    /// Re-submits the turn that failed and put the thread in `error`.
    public func retry(_ threadId: String) async throws {
        let _: JSONValue = try await post("/api/v1/threads/\(threadId)/retry", ["turnRequestId": .null])
    }

    /// Rewrites the newest message the user sent and runs the turn again from
    /// there. BB stops the thread first, and refuses (409) when it can't rewind.
    public func editLastMessage(_ threadId: String, text: String, mentions: [Mention] = []) async throws {
        let _: JSONValue = try await post(
            "/api/v1/threads/\(threadId)/edit-message",
            [
                "input": .array([["type": "text", "text": .string(text), "mentions": .array(Mention.ranges(in: text, mentions))]]),
                "operationId": .string(UUID().uuidString),
            ])
    }

    /// Archived threads, newest first.
    public func archivedThreads(limit: Int = 50, offset: Int = 0) async throws -> [ThreadEntry] {
        try await get("/api/v1/threads?archived=true&limit=\(limit)&offset=\(offset)")
    }

    /// Summarizes the conversation so far to free context.
    public func compact(_ threadId: String) async throws {
        let _: JSONValue = try await post("/api/v1/threads/\(threadId)/compact")
    }

    /// A new visible thread with this one's history. Returns its id.
    public func fork(_ threadId: String) async throws -> String {
        struct Response: Decodable { var id: String }
        let response: Response = try await post("/api/v1/threads/fork", ["sourceThreadId": .string(threadId)])
        return response.id
    }
}
