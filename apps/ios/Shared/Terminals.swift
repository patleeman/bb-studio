import Foundation

// MARK: Terminals

/// A persistent PTY on a machine, scoped to a thread, an environment, or a machine path.
public struct TerminalSession: Decodable, Identifiable, Hashable, Sendable {
    public var id: String
    public var threadId: String?
    public var environmentId: String?
    public var hostId: String
    public var title: String
    public var initialCwd: String
    public var cols: Int
    public var rows: Int
    /// starting, running, disconnected or exited.
    public var status: String
    public var exitCode: Int?
    public var closeReason: String?
    public var createdAt: Double
    public var updatedAt: Double
    public var lastUserInputAt: Double?

    public var isActive: Bool { status == "starting" || status == "running" }

    public var statusLabel: String {
        switch status {
        case "exited": exitCode.map { "Exited (\($0))" } ?? "Exited"
        case "disconnected": "Disconnected"
        case "starting": "Starting"
        default: "Running"
        }
    }

    /// The last path component of where it started, `~` for the home folder.
    public var shortCwd: String {
        let parts = initialCwd.split(separator: "/")
        if parts.count == 2, parts[0] == "Users" { return "~" }
        return parts.last.map(String.init) ?? initialCwd
    }
}

/// Where a terminal runs.
public enum TerminalScope: Hashable, Sendable {
    case thread(String)
    case environment(String)

    var query: String {
        switch self {
        case .thread(let id): "threadId=\(id)"
        case .environment(let id): "environmentId=\(id)"
        }
    }

    var target: JSONValue {
        switch self {
        case .thread(let id): ["kind": "thread", "threadId": .string(id)]
        case .environment(let id): ["kind": "environment", "environmentId": .string(id)]
        }
    }
}

extension BBClient {
    public func terminals(_ scope: TerminalScope) async throws -> [TerminalSession] {
        struct Result: Decodable { var sessions: [TerminalSession] }
        let result: Result = try await get("/api/v1/terminals?\(scope.query)")
        return result.sessions
    }

    public func terminal(_ id: String) async throws -> TerminalSession {
        try await get("/api/v1/terminals/\(id)")
    }

    /// Opens a shell, or runs `command` when given.
    public func createTerminal(
        _ scope: TerminalScope, cols: Int, rows: Int, command: String? = nil, title: String? = nil
    ) async throws -> TerminalSession {
        var body: [String: JSONValue] = [
            "target": scope.target,
            "cols": .number(Double(min(max(cols, 1), 500))),
            "rows": .number(Double(min(max(rows, 1), 200))),
        ]
        if let command = command?.trimmingCharacters(in: .whitespacesAndNewlines), !command.isEmpty {
            body["start"] = ["mode": "command", "command": .string(command)]
        }
        if let title = title?.trimmingCharacters(in: .whitespacesAndNewlines), !title.isEmpty {
            body["title"] = .string(String(title.prefix(200)))
        }
        return try await post("/api/v1/terminals", .object(body))
    }

    public func renameTerminal(_ id: String, title: String) async throws {
        let _: TerminalSession = try await patch("/api/v1/terminals/\(id)", ["title": .string(String(title.prefix(200)))])
    }

    /// Replaces it with a fresh shell; the new session has a new id.
    public func restartTerminal(_ id: String) async throws -> TerminalSession {
        try await post("/api/v1/terminals/\(id)/restart", .object([:]))
    }

    public func closeTerminal(_ id: String) async throws {
        let _: TerminalSession = try await post("/api/v1/terminals/\(id)/close", ["mode": "force", "reason": "user"])
    }

    /// The socket that streams a terminal's output from `sinceSeq` and takes its input.
    public func terminalSocketURL(_ id: String, sinceSeq: Int) -> URL {
        var components = URLComponents(url: webSocketURL, resolvingAgainstBaseURL: false)!
        components.path = "/ws/terminals/\(id)"
        components.queryItems = [URLQueryItem(name: "sinceSeq", value: String(sinceSeq))]
        return components.url!
    }
}
