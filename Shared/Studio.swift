import Foundation

// MARK: BB Studio

/// One thing a Studio add-on made: a page, a Talk recording or dictation, a
/// drawing, an artifact. Comes from the Studio plugin's `overview` when it's running, or
/// straight from the add-ons when it isn't.
public struct StudioItem: Codable, Identifiable, Hashable, Sendable {
    public struct Fact: Codable, Hashable, Sendable {
        public var id: String
        public var value: String

        /// A bare count reads as a word count only with its unit.
        public var display: String {
            switch id {
            case "words":
                guard let count = Int(value.replacingOccurrences(of: ",", with: "")) else { return value }
                return count == 1 ? "1 word" : "\(value) words"
            case "versions":
                return value == "1" ? "1 version" : "\(value) versions"
            case "type" where value.contains("/"):
                // Artifacts label images with their icon name.
                return (value.split(separator: "/").last.map(String.init) ?? value).capitalized
            default:
                return value
            }
        }
    }

    public struct Badge: Codable, Hashable, Sendable {
        public var label: String
        /// neutral, live, progress, warning, danger or success.
        public var tone: String
    }

    public var pluginId: String
    public var itemId: String
    /// page, recording, dictation, drawing, or another add-on's kind.
    public var kind: String
    public var title: String
    /// An emoji the user picked.
    public var icon: String?
    public var projectId: String?
    public var parentId: String?
    public var createdAt: Double
    public var updatedAt: Double
    public var preview: String?
    public var facts: [Fact]
    public var badge: Badge?
    /// Server path of a picture of it: a drawing's SVG, an image artifact.
    public var thumbnailUrl: String?
    /// App path that opens it in BB web.
    public var href: String?
    public var archived: Bool

    public var id: String { "\(pluginId):\(itemId)" }

    public var displayTitle: String {
        let title = title.trimmingCharacters(in: .whitespacesAndNewlines)
        return title.isEmpty ? "Untitled" : title
    }

    public var emoji: String? { icon.flatMap { $0.isEmpty ? nil : $0 } }

    enum CodingKeys: String, CodingKey {
        case pluginId, itemId = "id", kind, title, icon, projectId, parentId, createdAt, updatedAt
        case preview, facts, badge, thumbnailUrl, href, archived
    }

    public init(from decoder: Decoder) throws {
        let c = try decoder.container(keyedBy: CodingKeys.self)
        pluginId = try c.decode(String.self, forKey: .pluginId)
        itemId = try c.decode(String.self, forKey: .itemId)
        kind = try c.decode(String.self, forKey: .kind)
        title = (try? c.decode(String.self, forKey: .title)) ?? ""
        icon = try? c.decode(String.self, forKey: .icon)
        projectId = try? c.decode(String.self, forKey: .projectId)
        parentId = try? c.decode(String.self, forKey: .parentId)
        createdAt = (try? c.decode(Double.self, forKey: .createdAt)) ?? 0
        updatedAt = (try? c.decode(Double.self, forKey: .updatedAt)) ?? createdAt
        preview = try? c.decode(String.self, forKey: .preview)
        facts = (try? c.decode([Fact].self, forKey: .facts)) ?? []
        badge = try? c.decode(Badge.self, forKey: .badge)
        thumbnailUrl = try? c.decode(String.self, forKey: .thumbnailUrl)
        href = try? c.decode(String.self, forKey: .href)
        archived = (try? c.decode(Bool.self, forKey: .archived)) ?? false
    }

    public init(
        pluginId: String, itemId: String, kind: String, title: String, icon: String? = nil, projectId: String? = nil,
        parentId: String? = nil, createdAt: Double, updatedAt: Double, preview: String? = nil, facts: [Fact] = [],
        badge: Badge? = nil, href: String? = nil
    ) {
        self.pluginId = pluginId
        self.itemId = itemId
        self.kind = kind
        self.title = title
        self.icon = icon
        self.projectId = projectId
        self.parentId = parentId
        self.createdAt = createdAt
        self.updatedAt = updatedAt
        self.preview = preview
        self.facts = facts
        self.badge = badge
        self.href = href
        archived = false
    }
}

extension StudioItem {
    init(page: PageMeta) {
        self.init(
            pluginId: "pages", itemId: page.id, kind: "page", title: page.title ?? "", icon: page.emoji,
            projectId: page.projectId, parentId: page.parentId, createdAt: page.createdAt ?? 0,
            updatedAt: page.updatedAt ?? page.createdAt ?? 0, href: "/plugins/pages/pages/\(page.id)")
    }

    init(recording: Recording) {
        var facts = [Fact(id: "length", value: Self.clock(recording.durationMs))]
        if let words = recording.wordCount { facts.append(Fact(id: "words", value: words.formatted())) }
        let badge: Badge? =
            switch recording.status {
            case "recording": Badge(label: "Recording", tone: "live")
            case "finishing", "transcribing": Badge(label: "Transcribing", tone: "progress")
            default: recording.failedCount > 0 ? Badge(label: "\(recording.failedCount) failed", tone: "danger") : nil
            }
        self.init(
            pluginId: "talk", itemId: recording.id, kind: recording.kind, title: recording.title,
            projectId: recording.projectId, createdAt: recording.createdAt,
            updatedAt: recording.updatedAt ?? recording.createdAt,
            preview: recording.preview.isEmpty ? nil : recording.preview, facts: facts, badge: badge,
            href: "/plugins/talk/recordings/\(recording.id)")
    }

    init(drawing: DrawingSummary) {
        self.init(
            pluginId: "excalidraw", itemId: drawing.id, kind: "drawing", title: drawing.name,
            createdAt: drawing.createdAt, updatedAt: drawing.updatedAt,
            facts: drawing.elementCount.map { [Fact(id: "elements", value: $0 == 1 ? "1 shape" : "\($0) shapes")] } ?? [],
            href: "/plugins/excalidraw/drawings/\(drawing.id)")
        if drawing.elementCount ?? 0 > 0 {
            thumbnailUrl = "/api/v1/plugins/excalidraw/http/thumbnail?drawing=\(drawing.id)&v=\(Int(drawing.updatedAt))"
        }
    }

    /// `65_000` → `1:05`.
    static func clock(_ ms: Double) -> String {
        let total = max(0, Int(ms / 1000))
        let (h, m, s) = (total / 3600, total / 60 % 60, total % 60)
        return h > 0 ? String(format: "%d:%02d:%02d", h, m, s) : String(format: "%d:%02d", m, s)
    }
}

/// What an add-on says about one kind of item: its bulk actions and whether it archives.
public struct StudioKindInfo: Codable, Hashable, Sendable {
    public struct Action: Codable, Hashable, Sendable {
        public var id: String
        /// May hold `{count}`.
        public var label: String
        /// "copy" puts the returned text on the clipboard; "toast" shows the message.
        public var result: String
    }

    public var pluginId: String
    public var id: String
    public var label: String
    public var plural: String
    public var actions: [Action]
    public var canArchive: Bool
    public var blurb: String
}

/// The last Studio list, for opening instantly and offline.
public struct StudioSnapshot: Codable, Sendable {
    public static let cacheKey = "studio-items"
    public var items: [StudioItem]
    public var kinds: [StudioKindInfo]?
}

extension BBClient {
    /// Every add-on's items and kinds, from the Studio plugin.
    public func studioOverview() async throws -> (items: [StudioItem], kinds: [StudioKindInfo]) {
        struct Kind: Decodable {
            var id: String
            var label: String
            var plural: String
            var actions: [StudioKindInfo.Action]?
            var canArchive: Bool?
            var blurb: String?
        }
        struct Provider: Decodable {
            var pluginId: String
            var kinds: [Kind]
        }
        struct Overview: Decodable {
            var items: [StudioItem]
            var providers: [Provider]?
        }
        let overview: Overview = try await rpc("studio", "overview")
        let kinds = (overview.providers ?? []).flatMap { provider in
            provider.kinds.map {
                StudioKindInfo(
                    pluginId: provider.pluginId, id: $0.id, label: $0.label, plural: $0.plural,
                    actions: $0.actions ?? [], canArchive: $0.canArchive ?? false, blurb: $0.blurb ?? "")
            }
        }
        return (overview.items, kinds)
    }

    /// Ids the add-on couldn't change, with why.
    public struct StudioResults: Decodable, Sendable {
        public struct Failure: Decodable, Sendable {
            public var id: String
            public var error: String
        }
        public var done: [String]
        public var failed: [Failure]
    }

    public func studioArchive(pluginId: String, ids: [String], archived: Bool) async throws -> StudioResults {
        try await rpc(
            "studio", "archive",
            ["pluginId": .string(pluginId), "ids": .array(ids.map { .string($0) }), "archived": .bool(archived)])
    }

    /// Moves items to a project, or out of every project with nil.
    public func studioMove(pluginId: String, ids: [String], projectId: String?) async throws -> StudioResults {
        try await rpc(
            "studio", "move",
            ["pluginId": .string(pluginId), "ids": .array(ids.map { .string($0) }),
             "projectId": projectId.map { .string($0) } ?? .null])
    }

    /// Runs a kind's action. `text` is what a copy action copies; `message` what a toast says.
    public func studioAction(pluginId: String, action: String, ids: [String]) async throws -> (message: String?, text: String?) {
        struct Result: Decodable {
            var message: String?
            var text: String?
        }
        let result: Result = try await rpc(
            "studio", "action",
            ["pluginId": .string(pluginId), "action": .string(action), "ids": .array(ids.map { .string($0) })])
        return (result.message, result.text)
    }

    /// `<plugin>:<id>` keys of items whose content matches.
    public func studioSearch(_ query: String) async throws -> Set<String> {
        struct Result: Decodable { var keys: [String] }
        let result: Result = try await rpc("studio", "search", ["query": .string(String(query.prefix(200)))])
        return Set(result.keys)
    }

    public func studioRemove(pluginId: String, ids: [String]) async throws {
        let _: JSONValue = try await rpc(
            "studio", "remove", ["pluginId": .string(pluginId), "ids": .array(ids.map { .string($0) })])
    }

    public func deleteRecording(_ id: String) async throws {
        let _: JSONValue = try await rpc("talk", "recording_delete", ["id": .string(id)])
    }

    public func deletePage(_ id: String) async throws {
        let _: JSONValue = try await rpc("pages", "remove", ["id": .string(id)])
    }

    /// A new global page with this Markdown as its body.
    public func createPage(title: String, markdown: String) async throws -> PageMeta {
        struct Envelope: Decodable { var page: PageMeta }
        let envelope: Envelope = try await rpc(
            "pages", "create",
            ["projectId": .null, "parentId": .null, "title": .string(String(title.prefix(200))),
             "markdown": .string(String(markdown.prefix(200_000)))])
        return envelope.page
    }
}
