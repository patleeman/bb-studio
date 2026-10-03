import Foundation

public enum OfficeTabZone: String, Codable, Sendable { case essential, pinned, today, archived }
public enum OfficeTabKind: String, Codable, Sendable { case thread, item, bot, conversation, inbox, home, library }

public struct OfficeTab: Codable, Identifiable, Hashable, Sendable {
    public var ref: String
    public var kind: OfficeTabKind
    public var title: String? = nil
    public var icon: String? = nil
    public var href: String? = nil
    public var zone: OfficeTabZone
    public var folderId: String? = nil
    public var openedAt: Double
    public var archivedAt: Double? = nil
    public var itemKind: String? = nil
    public var providerId: String? = nil
    public var botState: OfficeBotState? = nil
    public var badge: Int? = nil
    public var needsYou: Bool? = nil
    public var unread: Bool? = nil
    public var id: String { ref }
    public var threadId: String? { targetId(prefix: "thread:") }
    public var itemRef: (pluginId: String, itemId: String)? {
        guard ref.hasPrefix("item:") else { return nil }
        let parts = ref.dropFirst(5).split(separator: ":", maxSplits: 1, omittingEmptySubsequences: false)
        guard parts.count == 2, !parts[0].isEmpty, !parts[1].isEmpty else { return nil }
        return (String(parts[0]), String(parts[1]))
    }
    func targetId(prefix: String) -> String? {
        guard ref.hasPrefix(prefix) else { return nil }
        let id = String(ref.dropFirst(prefix.count))
        return id.isEmpty || id.contains(":") ? nil : id
    }
}

public struct OfficeTabFolder: Codable, Identifiable, Hashable, Sendable {
    public var id: String
    public var name: String
    public var open: Bool
    public var position: Int
}

// Skip only future kinds; malformed known tabs still report a contract error.
private struct CompatibleTab: Decodable {
    var tab: OfficeTab?
    enum CodingKeys: String, CodingKey { case kind }
    init(from decoder: Decoder) throws {
        let raw = try decoder.container(keyedBy: CodingKeys.self).decode(String.self, forKey: .kind)
        tab = OfficeTabKind(rawValue: raw) == nil ? nil : try OfficeTab(from: decoder)
    }
}

public struct OfficeTabsResult: Decodable, Sendable {
    public var seeded: Bool
    public var essentials: [OfficeTab]
    public var pinned: [OfficeTab]
    public var folders: [OfficeTabFolder]
    public var today: [OfficeTab]
    enum CodingKeys: String, CodingKey { case seeded, essentials, pinned, folders, today }
    public init(from decoder: Decoder) throws {
        let c = try decoder.container(keyedBy: CodingKeys.self)
        seeded = try c.decode(Bool.self, forKey: .seeded)
        essentials = try c.decode([CompatibleTab].self, forKey: .essentials).compactMap(\.tab)
        pinned = try c.decode([CompatibleTab].self, forKey: .pinned).compactMap(\.tab)
        today = try c.decode([CompatibleTab].self, forKey: .today).compactMap(\.tab)
        folders = try c.decode([OfficeTabFolder].self, forKey: .folders)
    }
}

extension BBClient {
    public func officeTabs(_ spaceId: String) async throws -> OfficeTabsResult {
        try await rpc("studio", Studio.Method.tabs_get, ["spaceId": .string(spaceId)])
    }
    public func officeTabsSeed(_ spaceId: String, pinnedThreadIds: [String]) async throws {
        try await tabsAction(Studio.Method.tabs_seed, ["spaceId": .string(spaceId), "pinnedThreadIds": .array(pinnedThreadIds.map(JSONValue.string))])
    }
    public func officeTabOpen(_ spaceId: String, ref: String) async throws -> OfficeTab? {
        try await openTab(["spaceId": .string(spaceId), "ref": .string(ref)])
    }
    public func officeTabOpen(_ spaceId: String, href: String) async throws -> OfficeTab? {
        try await openTab(["spaceId": .string(spaceId), "href": .string(href)])
    }
    private func openTab(_ input: JSONValue) async throws -> OfficeTab? {
        struct Result: Decodable { var tab: CompatibleTab? }
        let result: Result = try await rpc("studio", Studio.Method.tabs_open, input)
        return result.tab?.tab
    }
    public func officeTabMove(_ spaceId: String, ref: String, zone: OfficeTabZone, folderId: String? = nil, index: Int? = nil) async throws {
        try await tabsAction(Studio.Method.tabs_move, .object(omittingNil: [
            "spaceId": .string(spaceId), "ref": .string(ref), "zone": .string(zone.rawValue),
            "folderId": folderId.map(JSONValue.string) ?? .null, "index": index.map { .number(Double($0)) },
        ]))
    }
    public func officeTabsArchived(_ spaceId: String, query: String? = nil) async throws -> [OfficeTab] {
        struct Result: Decodable { var tabs: [CompatibleTab] }
        let result: Result = try await rpc("studio", Studio.Method.tabs_archived, .object(omittingNil: ["spaceId": .string(spaceId), "query": query.map(JSONValue.string)]))
        return result.tabs.compactMap(\.tab)
    }
    public func officeTabFolderCreate(_ spaceId: String, name: String) async throws -> OfficeTabFolder {
        struct Result: Decodable { var folder: OfficeTabFolder }
        let result: Result = try await rpc("studio", Studio.Method.tab_folder_create, ["spaceId": .string(spaceId), "name": .string(name)])
        return result.folder
    }
    public func officeTabFolderUpdate(_ folderId: String, name: String? = nil, open: Bool? = nil, position: Int? = nil) async throws -> OfficeTabFolder {
        struct Result: Decodable { var folder: OfficeTabFolder }
        let result: Result = try await rpc("studio", Studio.Method.tab_folder_update, .object(omittingNil: [
            "folderId": .string(folderId), "name": name.map(JSONValue.string), "open": open.map(JSONValue.bool), "position": position.map { .number(Double($0)) },
        ]))
        return result.folder
    }
    public func officeTabFolderDelete(_ folderId: String) async throws {
        try await tabsAction(Studio.Method.tab_folder_delete, ["folderId": .string(folderId)])
    }
    public func officeSearch(_ spaceId: String, query: String) async throws -> [OfficeTab] {
        struct Result: Decodable { var results: [CompatibleTab] }
        let result: Result = try await rpc("studio", Studio.Method.office_search, ["spaceId": .string(spaceId), "query": .string(query)])
        return result.results.compactMap(\.tab)
    }
    private func tabsAction(_ method: String, _ input: JSONValue) async throws {
        struct Result: Decodable { var ok: Bool }
        let result: Result = try await rpc("studio", method, input)
        guard result.ok else { throw BBError(status: 0, message: "The tab action was not completed.") }
    }
}
