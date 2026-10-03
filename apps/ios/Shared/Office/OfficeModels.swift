import Foundation

/// Project-owned Spaces from the office RPCs, distinct from legacy tag Spaces.
public struct OfficeSpace: Codable, Identifiable, Hashable, Sendable {
    public var id: String
    public var name: String
    public var icon: String?
    public var description: String
    public var isDefault: Bool
    public var defaultProjectId: String?
    public var projectIds: [String]
    public var createdAt: Double
    public var updatedAt: Double
}

public enum OfficeTrust: String, Codable, Sendable { case ask, act }

public struct OfficeSpaceSettings: Codable, Hashable, Sendable {
    public struct Model: Codable, Hashable, Sendable {
        public var providerId: String
        public var model: String
    }
    public var enabledItemKinds: [String]?
    public var defaultTrust: OfficeTrust
    public var defaultBotModel: Model?
}

public struct OfficeItem: Codable, Identifiable, Hashable, Sendable {
    /// Composite identity prevents collisions between providers in a mixed list.
    public var id: String { "\(pluginId):\(itemId)" }
    public var itemId: String
    public var pluginId: String
    public var kind: String
    public var title: String
    public var href: String
    public var projectId: String?
    public var authorBotId: String?
    public var updatedAt: Double
    public var icon: String?
    enum CodingKeys: String, CodingKey {
        case itemId = "id", pluginId, kind, title, href, projectId, authorBotId, updatedAt, icon
    }
}

public struct OfficeThread: Codable, Identifiable, Hashable, Sendable {
    public var id: String
    public var title: String
    public var state: String
    public var updatedAt: Double
    public var authorBotId: String?
}

public struct OfficeFolder: Codable, Identifiable, Hashable, Sendable {
    public var id: String
    public var spaceId: String
    public var name: String
    public var path: String?
    public var archived: Bool
    public var isDefault: Bool
    /// Only space_tree includes children; folder_create returns metadata alone.
    public var threads: [OfficeThread]?
    public var items: [OfficeItem]?
    public var hasRepo: Bool?
    public var branch: String?
}

public struct OfficeSpaceTree: Codable, Sendable {
    public var space: OfficeSpace
    public var folders: [OfficeFolder]
    public var favorites: [String]?
}

// Stage 4–6 types currently mirror src/ui/office/model.ts. Reconcile with
// src/office/contract.ts when those server contracts land.
public enum OfficeBotState: String, Codable, Sendable { case idle, working, needsYou = "needs_you" }

public struct OfficeTeamBot: Codable, Identifiable, Hashable, Sendable {
    public var id: String
    public var name: String
    public var avatar: String?
    public var role: String?
    public var state: OfficeBotState
    public var activeTaskCount: Int
    public var model: String?
    public var trust: OfficeTrust?
    public var spaceId: String?
}

public struct OfficeConversation: Codable, Identifiable, Hashable, Sendable {
    public var id: String
    public var title: String
    public var memberBotIds: [String]
    public var isDirect: Bool
    public var needsYou: Bool
    public var unread: Bool
    public var href: String
}

public struct OfficeInboxAction: Codable, Identifiable, Hashable, Sendable {
    public var id: String
    public var label: String
    public var primary: Bool?
}

public struct OfficeInboxEvent: Codable, Identifiable, Hashable, Sendable {
    public enum Kind: String, Codable, Sendable { case request, report, comment }
    public struct Item: Codable, Hashable, Sendable {
        public var ref: String
        public var title: String
        public var href: String
    }
    public var id: String { key }
    public var key: String
    public var spaceId: String
    public var type: Kind
    public var source: String
    public var botId: String?
    public var threadId: String?
    public var item: Item?
    public var title: String
    public var body: String
    public var actions: [OfficeInboxAction]?
    public var answerable: Bool?
    public var urgent: Bool?
    public var href: String?
    public var createdAt: Double
    public var readAt: Double?
    public var doneAt: Double?
    /// Local state only. Never serialize pending actions to the server.
    public var isPending = false
    enum CodingKeys: String, CodingKey {
        case key, spaceId, type, source, botId, threadId, item, title, body, actions, answerable, urgent, href, createdAt, readAt, doneAt
    }
}

public struct OfficeInboxCounts: Codable, Hashable, Sendable {
    public struct Count: Codable, Hashable, Sendable {
        public var requests: Int
        public var unreadReports: Int
    }
    public var bySpace: [String: Count]
    public func count(spaceId: String = "all") -> Count {
        if spaceId != "all" { return bySpace[spaceId] ?? Count(requests: 0, unreadReports: 0) }
        return bySpace.values.reduce(Count(requests: 0, unreadReports: 0)) {
            Count(requests: $0.requests + $1.requests, unreadReports: $0.unreadReports + $1.unreadReports)
        }
    }
}

public struct OfficeWorkingTask: Codable, Identifiable, Hashable, Sendable {
    public enum Status: String, Codable, Sendable { case working, waiting, review, done }
    public var id: String
    public var botId: String?
    public var title: String
    public var status: Status
    public var note: String?
    public var recurring: String?
    public var href: String
    public var updatedAt: Double
}

public struct OfficeHome: Codable, Sendable {
    public var needsYou: [OfficeInboxEvent]
    public var working: [OfficeWorkingTask]
    public var reports: [OfficeInboxEvent]
    public var recent: [OfficeItem]
}

public struct OfficeBotDesk: Codable, Sendable {
    public struct Memory: Codable, Sendable {
        public var mission: String
        public var memory: String
    }
    public var bot: OfficeTeamBot
    public var tasks: [OfficeWorkingTask]
    public var directConversationId: String?
    public var directThreadId: String?
    public var profileHref: String
    public var memory: Memory?
}
