import Foundation

// MARK: Studio Feed

/// A post an agent made to the feed by ending a reply with `::post{…}`.
public struct FeedPost: Decodable, Identifiable, Hashable, Sendable {
    public var id: String
    public var title: String
    /// Markdown.
    public var body: String
    /// The body as plain text, cut short.
    public var preview: String
    /// Sites the body links to.
    public var domains: [String]
    public var topic: String?
    /// Posts with the same story are follow-ups to one another.
    public var story: String?
    /// How many posts its story has; 1 for a post on its own.
    public var storyPosts: Int
    /// normal or urgent.
    public var priority: String
    public var author: String
    public var botId: String?
    public var threadId: String?
    public var projectId: String?
    public var channelId: String?
    public var channelName: String?
    public var createdAt: Double
    public var updatedAt: Double
    public var editedBy: String?
    public var resolvedAt: Double?

    public var isUrgent: Bool { priority == "urgent" }
    public var isResolved: Bool { resolvedAt != nil }

    /// "Scout in #ops", or just who posted it.
    public var from: String { channelName.map { "\(author) in #\($0)" } ?? author }

    public var created: Date { Date(timeIntervalSince1970: createdAt / 1000) }

    /// App path that opens it in BB web, and that notifications carry.
    public var href: String { "/plugins/feed/feed/\(id)" }

    /// What a new thread about it starts with, as BB web's Discuss does.
    public var discussPrompt: String {
        "Let's discuss this feed post: \"\(title)\" (\(from)). Read it first with feed_read id \(id).\n\n"
    }
}

public struct FeedPage: Decodable, Sendable {
    public var posts: [FeedPost]
    public var nextCursor: String?
    /// When you last read the feed; posts after it are new.
    public var lastSeenAt: Double
}

extension BBClient {
    /// Newest first, each story once by its newest post.
    public func feed(cursor: String? = nil, topic: String? = nil, query: String? = nil, limit: Int = 40) async throws -> FeedPage {
        var input: [String: JSONValue] = ["limit": .number(Double(limit))]
        if let cursor { input["cursor"] = .string(cursor) }
        if let topic { input["topic"] = .string(topic) }
        if let query, !query.isEmpty { input["query"] = .string(String(query.prefix(200))) }
        return try await rpc("feed", "list", .object(input))
    }

    public func feedPost(_ id: String) async throws -> FeedPost? {
        struct Result: Decodable { var post: FeedPost? }
        let result: Result = try await rpc("feed", "post", ["postId": .string(id)])
        return result.post
    }

    /// A story's posts, oldest first.
    public func feedStory(_ story: String) async throws -> [FeedPost] {
        struct Result: Decodable { var posts: [FeedPost] }
        let result: Result = try await rpc("feed", "story", ["story": .string(story)])
        return result.posts
    }

    /// The post a reply's `::post` line made.
    public func feedPost(directive source: String) async throws -> FeedPost? {
        struct Result: Decodable { var post: FeedPost? }
        let result: Result = try await rpc("feed", "forDirective", ["source": .string(String(source.prefix(4000)))])
        return result.post
    }

    /// Topics in use, most posts first.
    public func feedTopics() async throws -> [String] {
        struct Topic: Decodable { var topic: String }
        struct Result: Decodable { var topics: [Topic] }
        let result: Result = try await rpc("feed", "topics", .object([:]))
        return result.topics.map(\.topic)
    }

    @discardableResult
    public func resolveFeedPost(_ id: String, resolved: Bool) async throws -> FeedPost? {
        struct Result: Decodable { var post: FeedPost? }
        let result: Result = try await rpc("feed", "edit", ["postId": .string(id), "resolved": .bool(resolved)])
        return result.post
    }

    public func removeFeedPost(_ id: String) async throws {
        let _: JSONValue = try await rpc("feed", "remove", ["postId": .string(id)])
    }

    /// Everything up to now is read.
    public func markFeedSeen() async throws {
        let _: JSONValue = try await rpc("feed", "seen", .object([:]))
    }

    /// Stories with a post since you last read the feed.
    public func feedUnread() async throws -> Int {
        struct Result: Decodable { var count: Int }
        let result: Result = try await rpc("feed", "unread", .object([:]))
        return result.count
    }
}
