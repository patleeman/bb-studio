import Foundation

// MARK: Studio spaces

/// An area of work: its threads and its Studio items. Items follow their
/// project; a Space holds whole projects and threads added one by one. Each
/// thread is in exactly one Space, Personal (the default) when no other has it.
public struct StudioSpace: Codable, Identifiable, Hashable, Sendable {
    public var id: String
    /// The default Space, Personal: it holds every thread no other Space does.
    public var isDefault: Bool
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
        case id, isDefault, name, color, icon, description, defaultProjectId, projectIds, threadIds
    }

    public init(from decoder: Decoder) throws {
        let c = try decoder.container(keyedBy: CodingKeys.self)
        id = try c.decode(String.self, forKey: .id)
        isDefault = (try? c.decode(Bool.self, forKey: .isDefault)) ?? false
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

/// A Space's optional lead thread and its heartbeat.
public struct SpaceLead: Hashable, Sendable {
    public var threadId: String?
    /// The heartbeat's cadence (`hourly`, `every15minutes`…), nil when it's off.
    public var heartbeat: String?
    public var time: String?
    public var cron: String?

    public init(threadId: String?, heartbeat: String? = nil, time: String? = nil, cron: String? = nil) {
        self.threadId = threadId
        self.heartbeat = heartbeat
        self.time = time
        self.cron = cron
    }

    init(_ output: Studio.SpaceLeadOutput) {
        let run = output.run
        let cadence: String? = switch run?.cadence {
        case .hourly: "hourly"
        case .daily: "daily"
        case .weekdays: "weekdays"
        case .every5minutes: "every5minutes"
        case .every15minutes: "every15minutes"
        case .every30minutes: "every30minutes"
        case .every2hours: "every2hours"
        case .every6hours: "every6hours"
        case .weekly: "weekly"
        case .custom: "custom"
        case .unknown(let value): value
        case nil: nil
        }
        self.init(threadId: output.leadThreadId, heartbeat: run?.enabled == true ? cadence : nil, time: run?.time, cron: run?.cron)
    }

    /// The heartbeat choices, in Studio's order, with their labels.
    public static let cadences: [(id: String, label: String)] = [
        ("every5minutes", "Every 5 minutes"), ("every15minutes", "Every 15 minutes"), ("every30minutes", "Every 30 minutes"),
        ("hourly", "Hourly"), ("every2hours", "Every 2 hours"), ("every6hours", "Every 6 hours"),
        ("daily", "Daily"), ("weekdays", "Weekdays"), ("weekly", "Weekly"), ("custom", "Custom"),
    ]

    /// "every 15 min", "daily" and the like, as the web sidebar's Lead label says it.
    public static func cadenceLabel(_ cadence: String) -> String {
        switch cadence {
        case "every5minutes": "every 5 min"
        case "every15minutes": "every 15 min"
        case "every30minutes": "every 30 min"
        case "every2hours": "every 2 h"
        case "every6hours": "every 6 h"
        default: cadences.first { $0.id == cadence }?.label.lowercased() ?? cadence
        }
    }
}

/// A thread's latest line, for its second row in By space: its last prose, or what failed or blocks it.
public struct ThreadLine: Codable, Hashable, Sendable {
    public enum Kind: String, Codable, Sendable { case progress, failure, blocked }
    public var text: String
    public var kind: Kind
    public var at: Double?

    public init(text: String, kind: Kind, at: Double?) {
        self.text = text
        self.kind = kind
        self.at = at
    }
}

/// A Studio item open in a Space, like a tab: pinned first, then as opened.
public struct SpaceOpenItem: Codable, Hashable, Identifiable, Sendable {
    public var pluginId: String
    public var itemId: String
    public var title: String
    public var icon: String?
    public var kindLabel: String
    public var href: String
    public var pinned: Bool
    public var updatedAt: Double?
    public var id: String { "\(pluginId):\(itemId)" }

    public var emoji: String? { icon.flatMap { $0.isEmpty ? nil : $0 } }
}

extension StudioSpace {
    /// The mark the web sidebar shows: the emoji, else nil for a dot in its colour.
    public var label: String { emoji.map { "\($0) \(name)" } ?? name }
}

/// Which Space each thread shows under, as the web sidebar's By space decides.
public struct SpaceAssignment: Sendable {
    public var spaces: [StudioSpace]
    /// From Studio's `space_of_threads`.
    public var spaceOf: [String: String]

    public init(spaces: [StudioSpace], spaceOf: [String: String]) {
        self.spaces = spaces
        self.spaceOf = spaceOf
    }

    /// Studio's flagged default, else the first.
    public var defaultSpaceId: String? { (spaces.first { $0.isDefault } ?? spaces.first)?.id }

    /// A child stays with its root's Space, so a thread tree is never split. A
    /// thread Studio hasn't listed yet, like a new one, follows its project's
    /// Space; anything else is in the default Space.
    public func spaceId(of thread: ThreadEntry, among threads: [String: ThreadEntry]) -> String? {
        let known = Set(spaces.map(\.id))
        func listed(_ id: String) -> String? { spaceOf[id].flatMap { known.contains($0) ? $0 : nil } }
        var root = thread
        var seen: Set<String> = [thread.id]
        while let parentId = root.parentThreadId, let parent = threads[parentId], !seen.contains(parent.id) {
            seen.insert(parent.id)
            root = parent
        }
        let viaProject = spaces.first { $0.projectIds.contains(root.projectId) }?.id
        return listed(root.id) ?? listed(thread.id) ?? viaProject ?? defaultSpaceId
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

    /// Moves threads into a Space; a thread is in one Space, so it leaves any other.
    public func moveThreads(_ threadIds: [String], toSpace id: String) async throws {
        try await spaceMembers(id, add: threadIds.map { (pluginId: StudioSpace.threadRef, id: $0) })
    }

    /// The one Space each thread is in.
    public func spaceOfThreads() async throws -> [String: String] {
        struct Result: Decodable { var threads: [String: String] }
        let result: Result = try await rpc("studio", Studio.Method.space_of_threads, .object([:]))
        return result.threads
    }

    public func spaceLead(_ spaceId: String) async throws -> SpaceLead {
        let output: Studio.SpaceLeadOutput = try await rpc("studio", Studio.Method.space_lead, ["spaceId": .string(spaceId)])
        return SpaceLead(output)
    }

    /// Makes a thread the Space's lead, adding it to the Space; nil clears the lead and its heartbeat.
    @discardableResult
    public func setSpaceLead(_ spaceId: String, threadId: String?) async throws -> SpaceLead {
        let output: Studio.SpaceLeadOutput = try await rpc(
            "studio", Studio.Method.space_set_lead, ["spaceId": .string(spaceId), "threadId": threadId.map(JSONValue.string) ?? .null])
        return SpaceLead(output)
    }

    /// Turns the lead's heartbeat on or off; on needs a lead.
    @discardableResult
    public func setSpaceHeartbeat(_ spaceId: String, enabled: Bool, cadence: String, time: String?, cron: String?) async throws -> SpaceLead {
        let output: Studio.SpaceLeadOutput = try await rpc("studio", Studio.Method.space_set_run, .object(omittingNil: [
            "spaceId": .string(spaceId), "enabled": .bool(enabled), "cadence": .string(cadence),
            "time": time.map(JSONValue.string), "cron": cron.map(JSONValue.string),
        ]))
        return SpaceLead(output)
    }

    /// Moves Studio items into a Space: those not in it yet go to its catch-all project.
    /// Throws with the first failure's reason when nothing moved.
    public func moveItems(_ items: [(pluginId: String, id: String)], toSpace id: String) async throws {
        struct Failure: Decodable { var title: String; var error: String }
        struct Result: Decodable { var moved: Int; var failed: [Failure] }
        let result: Result = try await rpc("studio", Studio.Method.moveToSpace, [
            "id": .string(id), "items": .array(items.map { ["pluginId": .string($0.pluginId), "id": .string($0.id)] }),
        ])
        if let failure = result.failed.first { throw BBError(status: 0, message: "\(failure.title): \(failure.error)") }
    }

    /// Each thread's latest line; Studio answers at most 60 at a time.
    public func threadLines(_ threadIds: [String]) async throws -> [String: ThreadLine] {
        guard !threadIds.isEmpty else { return [:] }
        let output: Studio.ThreadLinesOutput = try await rpc(
            "studio", Studio.Method.thread_lines, ["threadIds": .array(threadIds.prefix(60).map(JSONValue.string))])
        return (output.lines ?? [:]).compactMapValues { line in
            guard let text = line.text?.trimmingCharacters(in: .whitespacesAndNewlines), !text.isEmpty else { return nil }
            let kind: ThreadLine.Kind = switch line.kind {
            case .failure: .failure
            case .blocked: .blocked
            default: .progress
            }
            return ThreadLine(text: text, kind: kind, at: line.at)
        }
    }

    /// Each Space's open Studio items.
    public func spaceOpenItems() async throws -> [String: [SpaceOpenItem]] {
        let output: Studio.SpaceTreeOutput = try await rpc("studio", Studio.Method.spaceTree, .object([:]))
        var result: [String: [SpaceOpenItem]] = [:]
        for space in output.spaces ?? [] {
            guard let id = space.id else { continue }
            result[id] = (space.open ?? []).compactMap { item in
                guard let pluginId = item.pluginId, let itemId = item.id, let href = item.href else { return nil }
                return SpaceOpenItem(
                    pluginId: pluginId, itemId: itemId, title: item.title ?? "Untitled", icon: item.icon,
                    kindLabel: item.kindLabel ?? "", href: href, pinned: item.pinned ?? false, updatedAt: item.updatedAt)
            }
        }
        return result
    }

    /// Closes an item's tab in its Space without touching the item.
    public func closeStudioTab(pluginId: String, id: String) async throws {
        let _: JSONValue = try await rpc(
            "studio", Studio.Method.closeTabs, ["items": .array([["pluginId": .string(pluginId), "id": .string(id)]])])
    }

    /// Makes an item in the Space's catch-all project; answers its BB web path.
    public func createInSpace(_ spaceId: String, pluginId: String, kind: String) async throws -> String {
        struct Result: Decodable { var href: String }
        let result: Result = try await rpc(
            "studio", Studio.Method.createInSpace, ["id": .string(spaceId), "pluginId": .string(pluginId), "kind": .string(kind)])
        return result.href
    }
}
