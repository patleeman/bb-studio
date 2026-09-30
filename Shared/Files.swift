import Foundation

/// A file or directory in a thread's workspace.
public struct WorkspacePath: Decodable, Hashable, Sendable, Identifiable {
    public var kind: String
    public var path: String
    public var name: String
    public var id: String { path }
    public var isDirectory: Bool { kind == "directory" }

    public var parent: String {
        guard let slash = path.lastIndex(of: "/") else { return "" }
        return String(path[..<slash])
    }
}

/// The workspace's branch and uncommitted changes.
public struct WorkspaceStatus: Sendable {
    public struct Change: Decodable, Hashable, Sendable, Identifiable {
        public var path: String
        /// Git's letter: `M`, `A`, `D`, `R`, `?`…
        public var status: String
        public var insertions: Int?
        public var deletions: Int?
        public var id: String { path }
    }

    public var branch: String?
    public var changes: [Change]
}

public struct WorkspaceFile: Decodable, Sendable {
    public var content: String
    /// `utf8` or `base64`.
    public var contentEncoding: String
    public var mimeType: String?
    public var sizeBytes: Int?

    public var data: Data? {
        contentEncoding == "base64" ? Data(base64Encoded: content) : Data(content.utf8)
    }

    public var text: String? { contentEncoding == "utf8" ? content : nil }
}

extension BBClient {
    /// Nil when the workspace isn't a git checkout or can't be reached.
    public func workspaceStatus(_ environmentId: String) async throws -> WorkspaceStatus? {
        struct Response: Decodable {
            struct Workspace: Decodable {
                struct Tree: Decodable { var files: [WorkspaceStatus.Change] }
                struct Checkout: Decodable { var branchName: String?; var headSha: String? }
                var workingTree: Tree?
                var checkout: Checkout?
            }
            var outcome: String
            var workspace: Workspace?
        }
        let response: Response = try await get("/api/v1/environments/\(environmentId)/status")
        guard response.outcome == "available", let workspace = response.workspace else { return nil }
        let branch = workspace.checkout?.branchName ?? workspace.checkout?.headSha.map { String($0.prefix(7)) }
        return WorkspaceStatus(branch: branch, changes: workspace.workingTree?.files ?? [])
    }

    /// Every path in the workspace, as far as the server will list.
    public func workspacePaths(_ environmentId: String) async throws -> (paths: [WorkspacePath], truncated: Bool) {
        struct Response: Decodable { var paths: [WorkspacePath]; var truncated: Bool? }
        let response: Response = try await get(
            "/api/v1/environments/\(environmentId)/paths?limit=20000&includeFiles=true&includeDirectories=true")
        return (response.paths, response.truncated ?? false)
    }

    /// The file as it is on disk now.
    public func workspaceFile(_ environmentId: String, path: String) async throws -> WorkspaceFile {
        var components = URLComponents()
        components.queryItems = [
            URLQueryItem(name: "target", value: "uncommitted"), URLQueryItem(name: "side", value: "new"),
            URLQueryItem(name: "path", value: path),
        ]
        return try await get("/api/v1/environments/\(environmentId)/diff/file?\(components.percentEncodedQuery ?? "")")
    }

    /// Uncommitted changes as one unified diff per file, keyed by path.
    public func uncommittedDiffs(_ environmentId: String) async throws -> [String: String] {
        struct Response: Decodable {
            struct Diff: Decodable { var diff: String }
            var outcome: String
            var diff: Diff?
        }
        let response: Response = try await get("/api/v1/environments/\(environmentId)/diff?target=uncommitted")
        return Self.splitDiff(response.diff?.diff ?? "")
    }

    static func splitDiff(_ diff: String) -> [String: String] {
        var files: [String: String] = [:]
        var path: String?
        var lines: [Substring] = []
        func flush() {
            if let path { files[path] = lines.joined(separator: "\n") }
            lines = []
        }
        for line in diff.split(separator: "\n", omittingEmptySubsequences: false) {
            if line.hasPrefix("diff --git ") {
                flush()
                // `diff --git a/x b/x`: take the b side.
                path = line.range(of: " b/", options: .backwards).map { String(line[$0.upperBound...]) }
                continue
            }
            if line.hasPrefix("index ") || line.hasPrefix("new file mode") || line.hasPrefix("deleted file mode") { continue }
            lines.append(line)
        }
        flush()
        return files
    }
}
