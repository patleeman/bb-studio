import Foundation

// MARK: Personal project

/// Where a new thread goes. Like the desktop composer, a thread needs no
/// project: without one it starts in BB's personal project, which runs in a
/// personal workspace on the primary machine.
public enum NewThreadProject {
    /// BB's `PERSONAL_PROJECT_ID`. `GET /api/v1/projects` leaves it out.
    public static let personalId = "proj_personal"
    /// What the desktop project picker calls the personal project.
    public static let personalLabel = "No project"

    /// The remembered choice when BB still has that project, else the personal project.
    public static func resolve(saved: String?, projects: [Project]) -> String {
        guard let saved, !saved.isEmpty else { return personalId }
        if saved == personalId || projects.contains(where: { $0.id == saved }) { return saved }
        return personalId
    }

    public static func label(_ projectId: String, projects: [Project]) -> String {
        if projectId == personalId { return personalLabel }
        return projects.first { $0.id == projectId }?.name ?? personalLabel
    }
}

// MARK: Machines

/// A machine from `GET /api/v1/hosts`.
public struct BBHost: Decodable, Identifiable, Hashable, Sendable {
    public struct Lifecycle: Decodable, Hashable, Sendable {
        public var phase: String
    }

    public var id: String
    public var name: String
    /// `connected` or `disconnected`.
    public var status: String
    public var lifecycle: Lifecycle?

    public var isConnected: Bool { status == "connected" }
    /// Removed machines can't hold a project.
    public var isUsable: Bool { !["removing", "destroyed"].contains(lifecycle?.phase ?? "active") }

    /// The machine the new-project sheet starts on, as on desktop: the first connected one.
    public static func defaultHost(_ hosts: [BBHost]) -> BBHost? {
        hosts.first { $0.isConnected && $0.isUsable } ?? hosts.first { $0.isUsable }
    }
}

/// `GET /api/v1/hosts/:id/directory`: one folder on a machine.
public struct HostDirectoryListing: Decodable, Sendable {
    public struct Entry: Decodable, Hashable, Identifiable, Sendable {
        /// `file` or `directory`.
        public var kind: String
        public var name: String
        public var path: String
        public var id: String { path }
    }

    public var directory: String
    public var parent: String?
    public var entries: [Entry]

    public var folders: [Entry] { entries.filter { $0.kind == "directory" } }
}

// MARK: Project paths

/// BB's project path rules (`@bb/domain` project-path), so the sheet can
/// say what's wrong before BB does.
public enum ProjectPath {
    public static let invalidMessage = "Project path must be an absolute path."
    public static let rootMessage = "Project path must point to a project directory, not the filesystem root."
    public static let networkMessage =
        "Windows network paths are not supported. Map the share to a drive letter and use a path like C:\\Users\\me\\repo."

    private static func isWindowsDrive(_ path: String) -> Bool {
        let chars = Array(path)
        return chars.count >= 2 && chars[0].isASCII && chars[0].isLetter && chars[1] == ":"
            && (chars.count == 2 || chars[2] == "\\" || chars[2] == "/")
    }

    private static func isUNC(_ path: String) -> Bool {
        path.hasPrefix("\\\\") || path.hasPrefix("//")
    }

    public static func normalize(_ path: String) -> String {
        let trimmed = path.trimmingCharacters(in: .whitespacesAndNewlines)
        guard !trimmed.isEmpty else { return "" }
        if isWindowsDrive(trimmed) {
            var windows = trimmed.replacingOccurrences(of: "/", with: "\\")
            while windows.count > 3, windows.hasSuffix("\\") { windows.removeLast() }
            if windows.count == 2 { windows += "\\" }
            return windows.prefix(1).uppercased() + windows.dropFirst()
        }
        if trimmed == "/" { return trimmed }
        var posix = trimmed
        while posix.count > 1, posix.hasSuffix("/") { posix.removeLast() }
        return posix
    }

    /// Nil when BB would accept the path.
    public static func validationMessage(_ path: String) -> String? {
        let normalized = normalize(path)
        if normalized.isEmpty { return invalidMessage }
        if isUNC(normalized) { return networkMessage }
        guard normalized.hasPrefix("/") || isWindowsDrive(normalized) else { return invalidMessage }
        if normalized == "/" || (isWindowsDrive(normalized) && normalized.count <= 3) { return rootMessage }
        return nil
    }

    /// The folder's name, which desktop uses as the project name.
    public static func projectName(_ path: String) -> String {
        guard validationMessage(path) == nil else { return "" }
        let normalized = normalize(path)
        return normalized.split(whereSeparator: { $0 == "/" || $0 == "\\" }).last.map(String.init) ?? ""
    }
}

// MARK: API

extension BBClient {
    public func hosts() async throws -> [BBHost] {
        try await get("/api/v1/hosts")
    }

    /// The folder at `path` on a machine, or its home folder when `path` is nil.
    public func hostDirectory(hostId: String, path: String? = nil) async throws -> HostDirectoryListing {
        var components = URLComponents()
        if let path { components.queryItems = [URLQueryItem(name: "path", value: path)] }
        let host = hostId.addingPercentEncoding(withAllowedCharacters: .urlPathAllowed) ?? hostId
        let query = components.percentEncodedQuery.map { "?\($0)" } ?? ""
        return try await get("/api/v1/hosts/\(host)/directory\(query)")
    }

    /// The body of `POST /api/v1/projects`, as desktop's New project sends it:
    /// a folder on a machine, named after the folder unless a name is given.
    public static func createProjectBody(name: String, hostId: String, path: String) -> JSONValue {
        let normalized = ProjectPath.normalize(path)
        let trimmed = name.trimmingCharacters(in: .whitespacesAndNewlines)
        return [
            "name": .string(trimmed.isEmpty ? ProjectPath.projectName(normalized) : trimmed),
            "source": ["type": "local_path", "hostId": .string(hostId), "path": .string(normalized)],
        ]
    }

    /// Adds a project for a folder on a machine. BB answers with the existing
    /// project when one already has that folder.
    public func createProject(name: String, hostId: String, path: String) async throws -> Project {
        try await post("/api/v1/projects", Self.createProjectBody(name: name, hostId: hostId, path: path))
    }
}
