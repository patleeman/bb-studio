import Foundation

/// A mention typed into a message: the text holds `token`, and the send carries
/// `resource` for every place the token appears, as BB web's prompt box does.
public struct Mention: Codable, Hashable, Sendable {
    public var token: String
    public var resource: JSONValue

    public init(token: String, resource: JSONValue) {
        self.token = token
        self.resource = resource
    }

    public static func thread(_ id: String, projectId: String?, label: String) -> Mention {
        var resource: [String: JSONValue] = ["kind": "thread", "threadId": .string(id), "label": .string(label)]
        if let projectId { resource["projectId"] = .string(projectId) }
        return Mention(token: "@thread:\(id)", resource: .object(resource))
    }

    public static func plugin(_ pluginId: String, _ item: MentionResults.Item) -> Mention {
        Mention(
            token: "@\(item.title)",
            resource: [
                "kind": "plugin", "pluginId": .string(pluginId), "itemId": .string(item.itemId),
                "label": .string(item.title), "icon": .from(item.icon),
            ])
    }

    /// `{start, end, resource}` ranges in UTF-16 units, which is how JavaScript counts.
    static func ranges(in text: String, _ mentions: [Mention]) -> [JSONValue] {
        var result: [JSONValue] = []
        for mention in Set(mentions) {
            var search = text.startIndex..<text.endIndex
            while let range = text.range(of: mention.token, range: search) {
                let start = text.utf16.distance(from: text.utf16.startIndex, to: range.lowerBound)
                result.append([
                    "start": .from(start), "end": .from(start + mention.token.utf16.count), "resource": mention.resource,
                ])
                search = range.upperBound..<text.endIndex
            }
        }
        return result
    }
}

/// `GET /api/v1/plugins/mentions/search`: bots and other plugin items.
public struct MentionResults: Decodable, Sendable {
    public struct Group: Decodable, Sendable {
        public var pluginId: String
        public var providerId: String
        public var label: String
        public var items: [Item]
    }

    public struct Item: Decodable, Hashable, Sendable {
        public var itemId: String
        public var title: String
        public var subtitle: String?
        public var icon: String?
    }

    public var groups: [Group]
}

/// A thread's model and reasoning. `GET /threads/:id/default-execution-options`.
public struct ThreadExecution: Decodable, Hashable, Sendable {
    public var model: String?
    public var reasoningLevel: String?
    public var permissionMode: String?
}

extension BBClient {
    public func mentionSearch(_ query: String, projectId: String?, threadId: String?) async throws -> MentionResults {
        var components = URLComponents()
        components.queryItems = [URLQueryItem(name: "q", value: query), URLQueryItem(name: "trigger", value: "@")]
        if let projectId { components.queryItems?.append(URLQueryItem(name: "projectId", value: projectId)) }
        if let threadId { components.queryItems?.append(URLQueryItem(name: "threadId", value: threadId)) }
        return try await get("/api/v1/plugins/mentions/search?\(components.percentEncodedQuery ?? "")")
    }

    public func execution(_ threadId: String) async throws -> ThreadExecution? {
        try await get("/api/v1/threads/\(threadId)/default-execution-options")
    }

    /// Takes effect from the next turn. BB refuses models from another provider.
    public func setExecution(_ threadId: String, model: String, reasoningLevel: String?) async throws {
        let _: JSONValue = try await patch(
            "/api/v1/threads/\(threadId)", ["model": .string(model), "reasoningLevel": .from(reasoningLevel)])
    }
}
