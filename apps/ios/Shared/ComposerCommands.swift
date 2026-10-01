import Foundation

public struct ComposerCommand: Decodable, Hashable, Sendable {
    public var name: String
    public var source: String
    public var origin: String
    public var description: String?
    public var argumentHint: String?

    public var mention: Mention {
        Mention(token: "/\(name)", resource: [
            "kind": "command", "trigger": "/", "name": .string(name),
            "source": .string(source), "origin": .string(origin),
            "label": .string(name), "argumentHint": .from(argumentHint),
        ])
    }
}

extension BBClient {
    public func composerCommands(projectId: String, providerId: String, environmentId: String?) async throws -> [ComposerCommand] {
        struct Response: Decodable { var commands: [ComposerCommand] }
        var parts = URLComponents()
        parts.queryItems = [URLQueryItem(name: "provider", value: providerId)]
        if let environmentId { parts.queryItems?.append(URLQueryItem(name: "environmentId", value: environmentId)) }
        let result: Response = try await get("/api/v1/projects/\(projectId)/commands?\(parts.percentEncodedQuery ?? "")")
        return result.commands
    }

    public func clearContext(_ threadId: String) async throws {
        let _: JSONValue = try await post("/api/v1/threads/\(threadId)/context/clear")
    }
}

public struct ThreadContextReport: Decodable, Sendable {
    public struct Entry: Decodable, Sendable {
        public var label: String
        public var tokens: Int
    }
    public struct Category: Decodable, Sendable {
        public var label: String
        public var kind: String
        public var tokens: Int
        public var entries: [Entry]
    }
    public struct Snapshot: Decodable, Sendable {
        public var capturedAt: String
        public var categories: [Category]
    }
    public struct Usage: Decodable, Sendable {
        public var usedTokens: Int
        public var modelContextWindow: Int
        public var estimated: Bool
        public var snapshot: Snapshot?
    }
    public var usage: Usage?
}

extension BBClient {
    public func threadContext(_ threadId: String) async throws -> ThreadContextReport {
        try await get("/api/v1/threads/\(threadId)/context")
    }
}
