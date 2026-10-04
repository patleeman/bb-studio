import Foundation

// MARK: Studio spaces

/// A place the user gathers Studio items, threads, channels and projects in.
/// It opens as its own page in Pages, whose widgets show what it holds.
public struct StudioSpace: Codable, Identifiable, Hashable, Sendable {
    public var id: String
    public var name: String
    /// `#rrggbb`.
    public var color: String
    /// An emoji the user picked.
    public var icon: String?
    public var description: String
    /// Where the space's new items and threads go; nil for global.
    public var defaultProjectId: String?
    /// BB projects whose items and threads all belong to the space.
    public var projectIds: [String]
    public var threadIds: [String]
    /// Items added one by one, as `<plugin>:<id>`.
    public var itemKeys: [String]
    /// The space's page, or nil before it has one.
    public var pageId: String?

    public var emoji: String? { icon.flatMap { $0.isEmpty ? nil : $0 } }

    enum CodingKeys: String, CodingKey {
        case id, name, color, icon, description, defaultProjectId, projectIds, threadIds, itemKeys, pageId
    }

    public init(from decoder: Decoder) throws {
        let c = try decoder.container(keyedBy: CodingKeys.self)
        id = try c.decode(String.self, forKey: .id)
        name = (try? c.decode(String.self, forKey: .name)) ?? ""
        color = (try? c.decode(String.self, forKey: .color)) ?? "#64748b"
        icon = try? c.decode(String.self, forKey: .icon)
        description = (try? c.decode(String.self, forKey: .description)) ?? ""
        defaultProjectId = try? c.decode(String.self, forKey: .defaultProjectId)
        projectIds = (try? c.decode([String].self, forKey: .projectIds)) ?? []
        threadIds = (try? c.decode([String].self, forKey: .threadIds)) ?? []
        itemKeys = (try? c.decode([String].self, forKey: .itemKeys)) ?? []
        pageId = try? c.decode(String.self, forKey: .pageId)
    }

    /// What Studio calls a whole project or a thread when adding one to a space.
    public static let projectRef = "bb-project"
    public static let threadRef = "bb-thread"
}

/// The spaces a thread is in; `inherited` ones hold it through one of their projects.
public struct ThreadSpaces: Decodable, Sendable {
    public var spaces: [StudioSpace]
    public var inherited: [String]
}

/// One widget on a space's page: `<space id>/<section>`.
public struct SpaceWidgetTarget: Hashable, Sendable {
    public enum Section: String, Sendable, CaseIterable {
        case actions, recent, threads, channels, projects

        public var label: String {
            switch self {
            case .actions: "Create"
            case .recent: "Recent"
            case .threads: "Threads"
            case .channels: "Channels and messages"
            case .projects: "Projects"
            }
        }
    }

    public var spaceId: String
    public var section: Section

    /// Pages' parse: an unknown or missing section shows the recent items.
    public init?(_ target: String) {
        let parts = target.split(separator: "/", maxSplits: 1, omittingEmptySubsequences: false).map(String.init)
        guard let id = parts.first, !id.isEmpty else { return nil }
        spaceId = id
        section = parts.count > 1 ? Section(rawValue: parts[1]) ?? .recent : .recent
    }
}

extension BBClient {
    public func studioSpaces() async throws -> [StudioSpace] {
        struct Result: Decodable { var spaces: [StudioSpace] }
        let result: Result = try await rpc("studio", Studio.Method.spaces)
        return result.spaces
    }

    public func createSpace(name: String, icon: String?, description: String, defaultProjectId: String?) async throws -> StudioSpace {
        struct Result: Decodable { var space: StudioSpace }
        let result: Result = try await rpc("studio", Studio.Method.createSpace, .object(omittingNil: [
            "name": .string(String(name.prefix(40))), "icon": icon.map(JSONValue.string),
            "description": .string(String(description.prefix(500))), "defaultProjectId": defaultProjectId.map(JSONValue.string),
        ]))
        return result.space
    }

    /// A nil icon or default project clears it.
    public func updateSpace(_ id: String, name: String, icon: String?, description: String, defaultProjectId: String?) async throws -> StudioSpace {
        struct Result: Decodable { var space: StudioSpace }
        let result: Result = try await rpc("studio", Studio.Method.updateSpace, [
            "id": .string(id), "name": .string(String(name.prefix(40))), "icon": icon.map(JSONValue.string) ?? .null,
            "description": .string(String(description.prefix(500))), "defaultProjectId": defaultProjectId.map(JSONValue.string) ?? .null,
        ])
        return result.space
    }

    public func deleteSpace(_ id: String) async throws {
        let _: JSONValue = try await rpc("studio", Studio.Method.deleteSpace, ["id": .string(id)])
    }

    /// Adds and removes items, `bb-project:<id>` projects and `bb-thread:<id>` threads.
    @discardableResult
    public func spaceMembers(
        _ id: String, add: [(pluginId: String, id: String)] = [], remove: [(pluginId: String, id: String)] = []
    ) async throws -> StudioSpace {
        struct Result: Decodable { var space: StudioSpace }
        func refs(_ list: [(pluginId: String, id: String)]) -> JSONValue {
            .array(list.map { ["pluginId": .string($0.pluginId), "id": .string($0.id)] })
        }
        let result: Result = try await rpc("studio", Studio.Method.spaceMembers, ["id": .string(id), "add": refs(add), "remove": refs(remove)])
        return result.space
    }

    public func spacesForThread(_ threadId: String) async throws -> ThreadSpaces {
        try await rpc("studio", Studio.Method.spacesForThread, ["threadId": .string(threadId)])
    }

    /// The path of the space's page, made from the space template if it has none; nil without Pages.
    public func spacePage(_ id: String) async throws -> String? {
        let result: Studio.SpacePageOutput = try await rpc("studio", Studio.Method.spacePage, ["id": .string(id)])
        return result.href
    }

    public func spaceWidget(_ id: String) async throws -> Studio.SpaceWidgetOutput {
        try await rpc("studio", Studio.Method.spaceWidget, ["id": .string(id)])
    }

    /// An item made in the space's default project and added to the space; its path.
    public func createInSpace(_ id: String, pluginId: String, kind: String) async throws -> String {
        let result: Studio.CreateInSpaceOutput = try await rpc("studio", Studio.Method.createInSpace, [
            "id": .string(id), "pluginId": .string(pluginId), "kind": .string(kind),
        ])
        guard let href = result.href else { throw BBError(status: 0, message: "Studio didn't say where the new item is.") }
        return href
    }

    /// Open threads, channels and direct messages to pick from.
    public func recentSpaceThreads() async throws -> [Studio.RecentThreadsOutputThreadsItem] {
        let result: Studio.RecentThreadsOutput = try await rpc("studio", Studio.Method.recentThreads)
        return result.threads ?? []
    }
}
