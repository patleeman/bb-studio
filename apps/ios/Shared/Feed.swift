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
    /// What its thread is called: "#channel", or the thread's title.
    public var threadTitle: String?
    /// Read with the rest of its story. Servers from before per-post read state leave it out.
    @ReadByDefault public var read: Bool
    public var createdAt: Double
    public var updatedAt: Double
    public var editedBy: String?
    public var resolvedAt: Double?

    public var isUrgent: Bool { priority == "urgent" }
    public var isResolved: Bool { resolvedAt != nil }

    /// "Scout in #ops", or just who posted it.
    public var from: String { channelName.map { "\(author) in #\($0)" } ?? author }

    public var created: Date { Date(timeIntervalSince1970: createdAt / 1000) }

    /// Discuss's item for the thread it came from: "Open #ops", or the thread's title.
    public var openThreadLabel: String {
        if let threadTitle, !threadTitle.isEmpty { return "Open \(threadTitle)" }
        return channelName.map { "Open #\($0)" } ?? "Open thread"
    }

    /// App path that opens it in BB web, and that notifications carry.
    public var href: String { "/plugins/feed/feed/\(id)" }

    /// What a new thread about it starts with, as BB web's Discuss does.
    public var discussPrompt: String {
        "Let's discuss this feed post: \"\(title)\" (\(from)). Read it first with feed_read id \(id).\n\n"
    }
}

/// A flag that decodes as true when it's missing.
@propertyWrapper
public struct ReadByDefault: Decodable, Hashable, Sendable {
    public var wrappedValue: Bool
    public init(wrappedValue: Bool) { self.wrappedValue = wrappedValue }
    public init(from decoder: Decoder) throws { wrappedValue = try decoder.singleValueContainer().decode(Bool.self) }
}

extension KeyedDecodingContainer {
    func decode(_ type: ReadByDefault.Type, forKey key: Key) throws -> ReadByDefault {
        try decodeIfPresent(type, forKey: key) ?? ReadByDefault(wrappedValue: true)
    }
}

public struct FeedPage: Decodable, Sendable {
    public var posts: [FeedPost]
    public var nextCursor: String?
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

    public func removeFeedPost(_ id: String) async throws {
        let _: JSONValue = try await rpc("feed", "remove", ["postId": .string(id)])
    }

    /// Marks a post read or unread, with the rest of its story.
    @discardableResult
    public func markFeedPost(_ id: String, read: Bool) async throws -> FeedPost? {
        struct Result: Decodable { var post: FeedPost? }
        let result: Result = try await rpc("feed", "read", ["postId": .string(id), "read": .bool(read)])
        return result.post
    }

    /// Marks everything up to now read, on every device.
    public func markFeedSeen() async throws {
        let _: JSONValue = try await rpc("feed", "seen", .object([:]))
    }

    /// Stories with an unread post.
    public func feedUnread() async throws -> Int {
        struct Result: Decodable { var count: Int }
        let result: Result = try await rpc("feed", "unread", .object([:]))
        return result.count
    }
}
