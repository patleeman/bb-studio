import Foundation

public struct ThreadEnvironment: Decodable, Identifiable, Sendable {
    public var id: String
    public var name: String?
    public var projectId: String
    public var hostId: String
    public var path: String?
    public var branchName: String?
    public var status: String

    public var label: String { name ?? branchName ?? path ?? id }
}

public enum NewThreadWorkspace: Sendable {
    case projectDefault
    case worktree(hostId: String, baseBranch: String?)
    case reuse(String)

    var request: JSONValue {
        switch self {
        case .projectDefault:
            return ["type": "project-default"]
        case .worktree(let hostId, let branch):
            let selection: JSONValue = branch.map { ["kind": "named", "name": .string($0)] } ?? ["kind": "default"]
            return ["type": "provider", "environmentProviderId": "git-worktree",
                    "machine": ["type": "existing", "hostId": .string(hostId)],
                    "inputs": ["branch": selection]]
        case .reuse(let id):
            return ["type": "reuse", "environmentId": .string(id)]
        }
    }
}

extension BBClient {
    public func threadEnvironments(projectId: String) async throws -> [ThreadEnvironment] {
        var query = URLComponents()
        query.queryItems = [URLQueryItem(name: "projectId", value: projectId)]
        return try await get("/api/v1/environments?\(query.percentEncodedQuery ?? "")")
    }

    public func createThread(projectId: String, text: String, attachments: [JSONValue] = [],
                             options: ExecutionChoice? = nil, workspace: NewThreadWorkspace) async throws -> ThreadEntry {
        var body: [String: JSONValue] = [
            "projectId": .string(projectId), "origin": "app", "input": Self.input(text, attachments),
            "environment": workspace.request,
        ]
        if let options {
            if let providerId = options.providerId { body["providerId"] = .string(providerId) }
            if let model = options.model { body["model"] = .string(model) }
            if let reasoning = options.reasoningLevel { body["reasoningLevel"] = .string(reasoning) }
            if let permissionMode = options.permissionMode { body["permissionMode"] = .string(permissionMode) }
        }
        return try await post("/api/v1/threads", .object(body))
    }
}
