import Foundation

// MARK: Plannotator

/// A plan waiting for review in Plannotator. The review itself happens in
/// Plannotator's own web UI, which BB relays through the plugin's HTTP route.
public struct PlanReview: Decodable, Hashable, Identifiable, Sendable {
    public var id: String { sessionId }
    public var sessionId: String
    public var threadId: String
    public var title: String?
}

extension BBClient {
    public func activePlanReview(_ threadId: String) async throws -> PlanReview? {
        try await rpcIfPresent("plannotator", "getActiveReview", ["threadId": .string(threadId)])
    }

    public func cancelPlanReview(_ review: PlanReview) async throws {
        let _: JSONValue? = try await rpcIfPresent(
            "plannotator", "cancelReview", ["threadId": .string(review.threadId), "sessionId": .string(review.sessionId)])
    }

    public func planReviewURL(_ review: PlanReview) -> URL {
        var components = URLComponents(
            url: baseURL.appending(path: "api/v1/plugins/plannotator/http/review"), resolvingAgainstBaseURL: false)!
        components.queryItems = [URLQueryItem(name: "sessionId", value: review.sessionId), URLQueryItem(name: "path", value: "/")]
        return components.url!
    }
}

// MARK: Drafts

extension BBClient {
    /// Queues the message on the thread without sending it.
    public func saveDraft(_ threadId: String, text: String, mentions: [Mention] = []) async throws {
        var body: [String: JSONValue] = [
            "input": .array([["type": "text", "text": .string(text), "mentions": .array(Mention.ranges(in: text, mentions))]]),
            "mode": "queue-if-active",
            "pluginSubmission": ["pluginId": "drafts", "data": ["kind": "draft"]],
        ]
        PermissionMode.apply(threadId, to: &body, serverURL: baseURL)
        let _: JSONValue = try await post("/api/v1/threads/\(threadId)/send", .object(body))
        PermissionMode.sent(threadId, body, serverURL: baseURL)
    }
}

// MARK: Custom instructions

extension BBClient {
    private struct SettingsView: Decodable { var values: [String: JSONValue] }

    /// Extra instructions BB adds to every agent's system prompt.
    public func customInstructions() async throws -> String {
        let view: SettingsView = try await get("/api/v1/plugins/custom-instructions/settings")
        if case .string(let text)? = view.values["instructions"] { return text }
        return ""
    }

    public func setCustomInstructions(_ text: String) async throws {
        let _: SettingsView = try await put(
            "/api/v1/plugins/custom-instructions/settings", ["values": ["instructions": .string(text)]])
    }
}
