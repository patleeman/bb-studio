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

/// A saved version of a page.
public struct PageSnapshot: Decodable, Identifiable, Hashable, Sendable {
    public var id: String
    public var label: String
    public var actor: String
    public var createdAt: Double
}

/// A "Work with this page" thread.
public struct PageChat: Decodable, Hashable, Sendable {
    public var threadId: String
    public var createdAt: Double
}

/// A comment thread on a page, anchored to text in one block.
public struct PageCommentThread: Decodable, Identifiable, Hashable, Sendable {
    public struct Comment: Decodable, Identifiable, Hashable, Sendable {
        public var id: String
        /// `user` for you, `bot:<id>` or `agent:<thread id>` otherwise.
        public var author: String
        public var authorName: String
        public var text: String
        public var createdAt: Double
    }

    public var id: String
    public var resolved: Bool
    public var blockId: String?
    /// The commented text.
    public var quote: String
    public var comments: [Comment]
    public var updatedAt: Double
}

/// A block with text that a new comment can be anchored to.
public struct PageTextBlock: Decodable, Identifiable, Hashable, Sendable {
    public var id: String
    public var text: String
}

/// The last page tree, for opening instantly and offline.
public struct PagesSnapshot: Codable, Sendable {
    public static let cacheKey = "pages-tree"
    public var pages: [PageMeta]
    public var projectNames: [String: String]
}

// MARK: Pages

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

    /// Starts an agent thread about the page, or hands it to a bot the message @mentions.
    public func workWithPage(_ id: String, projectId: String, text: String, mentions: [Mention] = [], choice: ExecutionChoice)
        async throws -> (threadId: String, botName: String?)
    {
        struct Result: Decodable {
            var threadId: String
            var botName: String?
        }
        let request: JSONValue = [
            "projectId": .string(projectId),
            "providerId": .string(choice.providerId ?? "claude-code"),
            "model": .string(choice.model ?? ""),
            "reasoningLevel": .string(choice.reasoningLevel ?? "medium"),
            "permissionMode": .string(choice.permissionMode ?? "auto"),
            "executionInputSources": [:],
            "environment": ["type": "project-default"],
            "input": [["type": "text", "text": .string(text), "mentions": .array(Mention.ranges(in: text, mentions))]],
        ]
        let result: Result = try await rpc("pages", "work", ["id": .string(id), "request": request])
        return (result.threadId, result.botName)
    }

    public func pageChats(_ id: String) async throws -> [PageChat] {
        struct Result: Decodable { var chats: [PageChat] }
        let result: Result = try await rpc("pages", "chats", ["pageId": .string(id)])
        return result.chats
    }

    /// The page a thread was started from with "Work with this page".
    public func chatPage(_ threadId: String) async throws -> PageMeta? {
        struct Result: Decodable { var page: PageMeta? }
        let result: Result = try await rpc("pages", "chatPage", ["threadId": .string(threadId)])
        return result.page
    }

    public func updatePage(_ id: String, title: String? = nil, icon: String? = nil, archived: Bool? = nil) async throws {
        var input: [String: JSONValue] = ["id": .string(id)]
        if let title { input["title"] = .string(String(title.prefix(200))) }
        if let icon { input["icon"] = .string(String(icon.prefix(16))) }
        if let archived { input["archived"] = .bool(archived) }
        let _: JSONValue = try await rpc("pages", "update", .object(input))
    }

    public func pageSnapshots(_ id: String) async throws -> [PageSnapshot] {
        struct Result: Decodable { var snapshots: [PageSnapshot] }
        let result: Result = try await rpc("pages", "snapshots", ["id": .string(id)])
        return result.snapshots
    }

    public func snapshotPage(_ id: String, label: String?) async throws {
        var input: [String: JSONValue] = ["id": .string(id)]
        if let label = label?.trimmingCharacters(in: .whitespacesAndNewlines), !label.isEmpty {
            input["label"] = .string(String(label.prefix(120)))
        }
        let _: JSONValue = try await rpc("pages", "snapshot", .object(input))
    }

    public func restorePage(snapshotId: String) async throws {
        let _: JSONValue = try await rpc("pages", "restore", ["snapshotId": .string(snapshotId)])
    }

    /// Every comment thread, resolved ones included.
    public func pageComments(_ id: String) async throws -> [PageCommentThread] {
        struct Result: Decodable { var threads: [PageCommentThread] }
        let result: Result = try await rpc("pages", "comments", ["id": .string(id), "includeResolved": .bool(true)])
        return result.threads
    }

    public func pageCommentBlocks(_ id: String) async throws -> [PageTextBlock] {
        struct Result: Decodable { var blocks: [PageTextBlock] }
        let result: Result = try await rpc("pages", "commentBlocks", ["id": .string(id)])
        return result.blocks
    }

    /// Starts a thread as you. An @bot in the text reaches that bot, as in the editor.
    public func commentOnPage(_ id: String, block: String, text: String) async throws {
        let _: JSONValue = try await rpc(
            "pages", "commentCreate", ["id": .string(id), "block": .string(block), "text": .string(String(text.prefix(8000)))])
    }

    public func replyToPageComment(_ id: String, thread: String, text: String) async throws {
        let _: JSONValue = try await rpc(
            "pages", "commentReply", ["id": .string(id), "thread": .string(thread), "text": .string(String(text.prefix(8000)))])
    }

    public func resolvePageComment(_ id: String, thread: String, resolved: Bool) async throws {
        let _: JSONValue = try await rpc(
            "pages", "commentResolve", ["id": .string(id), "thread": .string(thread), "resolved": .bool(resolved)])
    }

    /// The ids of plugins installed and running on the server.
    public func runningPlugins() async throws -> Set<String> {
        struct List: Decodable {
            struct Plugin: Decodable {
                var id: String
                var status: String?
            }
            var plugins: [Plugin]
        }
        let list: List = try await get("/api/v1/plugins")
        return Set(list.plugins.filter { $0.status == "running" }.map(\.id))
    }

    public func webURL(forPage id: String) -> URL {
        URL(string: "/plugins/pages/pages/\(id)", relativeTo: baseURL)!
    }
}
