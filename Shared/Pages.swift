import Foundation

/// A BB Page's metadata, as the pages plugin's `tree`, `get` and `search` return it.
public struct PageMeta: Codable, Identifiable, Hashable, Sendable {
    public var id: String
    /// Nil for global pages.
    public var projectId: String?
    public var parentId: String?
    public var title: String?
    /// An emoji, or empty.
    public var icon: String?
    public var position: Double?
    public var createdAt: Double?
    public var updatedAt: Double?
    public var updatedBy: String?
    public var archived: Bool?

    public var displayTitle: String {
        let title = title?.trimmingCharacters(in: .whitespacesAndNewlines) ?? ""
        return title.isEmpty ? "Untitled" : title
    }

    public var emoji: String? { icon.flatMap { $0.isEmpty ? nil : $0 } }
}

/// The last page tree, for opening instantly and offline.
public struct PagesSnapshot: Codable, Sendable {
    public static let cacheKey = "pages-tree"
    public var pages: [PageMeta]
    public var projectNames: [String: String]
}

// MARK: Pages (read-only)

extension BBClient {
    /// Every page, global and in all projects, archived ones left out.
    public func pages() async throws -> [PageMeta] {
        struct Tree: Decodable { var pages: [PageMeta] }
        let tree: Tree = try await rpc("pages", "tree", [:])
        return tree.pages.filter { $0.archived != true }
    }

    public func page(_ id: String) async throws -> PageMeta? {
        struct Envelope: Decodable { var page: PageMeta? }
        let envelope: Envelope = try await rpc("pages", "get", ["id": .string(id)])
        return envelope.page
    }

    public func pageMarkdown(_ id: String) async throws -> String {
        struct Envelope: Decodable { var markdown: String }
        let envelope: Envelope = try await rpc("pages", "markdown", ["id": .string(id)])
        return envelope.markdown
    }

    /// Title and content search.
    public func searchPages(_ query: String) async throws -> [PageMeta] {
        struct Envelope: Decodable { var pages: [PageMeta] }
        let envelope: Envelope = try await rpc("pages", "search", ["query": .string(String(query.prefix(200)))])
        return envelope.pages.filter { $0.archived != true }
    }

    /// Whether a plugin is installed and running on the server.
    public func isPluginRunning(_ id: String) async throws -> Bool {
        struct List: Decodable {
            struct Plugin: Decodable {
                var id: String
                var status: String?
            }
            var plugins: [Plugin]
        }
        let list: List = try await get("/api/v1/plugins")
        return list.plugins.contains { $0.id == id && $0.status == "running" }
    }

    public func webURL(forPage id: String) -> URL {
        URL(string: "/plugins/pages/pages/\(id)", relativeTo: baseURL)!
    }
}
