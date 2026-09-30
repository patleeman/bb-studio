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

    /// Where the workspace lives on the host, to turn absolute paths into relative ones.
    public func environmentRoot(_ environmentId: String) async throws -> String? {
        struct Response: Decodable { var path: String? }
        let response: Response = try await get("/api/v1/environments/\(environmentId)")
        return response.path
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

/// Paths agents mention in messages: `docs/plan.md`, `Sources/App.swift:42`,
/// `[the plan](docs/plan.md)`. Line suffixes are dropped, since the viewer shows
/// the whole file.
public enum FilePathLink {
    static let extensions: Set<String> = [
        "md", "markdown", "mdx", "txt", "swift", "ts", "tsx", "js", "jsx", "mjs", "cjs", "json", "jsonc", "yml",
        "yaml", "toml", "py", "rb", "go", "rs", "java", "kt", "c", "h", "cc", "cpp", "m", "mm", "html", "css",
        "scss", "sh", "zsh", "sql", "xml", "plist", "proto", "graphql", "vue", "svelte", "astro", "ini", "csv",
        "lock", "gradle", "pdf", "png", "jpg", "jpeg", "gif", "svg", "webp",
    ]

    /// The path in inline code, or nil when it doesn't look like a file.
    public static func path(inCode code: String) -> String? {
        guard code.count >= 3, code.count <= 400, !code.contains(where: \.isWhitespace), !code.contains("://"),
            !code.hasPrefix("~"), !code.hasPrefix("@"), !code.hasSuffix("/")
        else { return nil }
        let path = stripLine(code)
        guard path.wholeMatch(of: /(\.{1,2}\/)?\/?[\w@.+\-\[\]]+(\/[\w@.+\-\[\]()]+)*/) != nil else { return nil }
        let name = path.split(separator: "/").last.map(String.init) ?? path
        guard let dot = name.lastIndex(of: "."), dot != name.startIndex else {
            return nil
        }
        let ext = name[name.index(after: dot)...].lowercased()
        return extensions.contains(ext) ? path : nil
    }

    /// `file.swift:12`, `file.swift:12:4` and `file.swift#L12-L20` → `file.swift`.
    public static func stripLine(_ path: String) -> String {
        path.replacing(/(:\d+(-\d+)?(:\d+)?|#L\d+(-L?\d+)?)$/, with: "")
    }

    /// `bbstudio://file?path=…`, which the thread view opens in the file viewer.
    public static func url(_ path: String) -> URL? {
        var components = URLComponents()
        components.scheme = AppLink.scheme
        components.host = "file"
        components.queryItems = [URLQueryItem(name: "path", value: path)]
        return components.url
    }

    public static func path(from url: URL) -> String? {
        guard AppLink.handles(url), url.host() == "file" else { return nil }
        return URLComponents(url: url, resolvingAgainstBaseURL: false)?.queryItems?.first { $0.name == "path" }?.value
    }
}
