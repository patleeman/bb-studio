import Foundation

// MARK: Studio spaces

/// A place the user gathers threads and projects in; items follow their project.
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

    public var emoji: String? { icon.flatMap { $0.isEmpty ? nil : $0 } }

    enum CodingKeys: String, CodingKey {
        case id, name, color, icon, description, defaultProjectId, projectIds, threadIds
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
}
