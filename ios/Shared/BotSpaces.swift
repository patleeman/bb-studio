import Foundation

public enum BotPresenceState: String, Codable, Hashable, Sendable {
    case idle, thinking, working, needs
}

public struct BotSpace: Codable, Hashable, Sendable, Identifiable {
    public struct Presence: Codable, Hashable, Sendable {
        public var form: String
        public var customColor: String?
        public var motion: Double
    }

    public struct Activity: Codable, Hashable, Sendable {
        public var turn: Bool
        public var workers: Int
    }

    public var id: String
    public var name: String
    public var avatar: String
    public var shape: String?
    public var color: String?
    public var primary: Bool
    public var mainThreadId: String?
    public var needsYou: Bool
    public var appearance: Studio.BotSpacesOutputBotsItemAppearance?
    public var presence: Presence?
    public var activity: Activity

    init?(_ wire: Studio.BotSpacesOutputBotsItem) {
        guard let id = wire.id, !id.isEmpty else { return nil }
        self.id = id
        name = wire.name ?? BotInfo.defaultName
        avatar = wire.avatar ?? ""
        shape = wire.shape
        color = wire.color
        primary = wire.primary ?? false
        mainThreadId = wire.mainThreadId
        needsYou = wire.needsYou ?? false
        appearance = wire.appearance
        presence = wire.presence.flatMap { presence in
            presence.form.map { form in
                var hex: String?
                if case .object(let color)? = presence.color, case .string("custom")? = color["source"],
                    case .string(let value)? = color["hex"]
                {
                    hex = value
                }
                return Presence(form: form, customColor: hex, motion: presence.motion ?? 1)
            }
        }
        activity = Activity(turn: wire.activity?.turn ?? false, workers: max(0, wire.activity?.workers ?? 0))
    }

    public func presenceState(live view: BotThreadsView? = nil) -> BotPresenceState {
        var needs = needsYou
        var turn = activity.turn
        var workers = activity.workers
        if let view, view.botId == id {
            needs = needsYou || view.conversations.contains { $0.needsYou != nil } || view.workers.contains { $0.status == .needsYou }
            turn = view.conversations.contains(where: \.running)
            workers = view.workers.filter { $0.status == .running }.count
        }
        if needs { return .needs }
        if workers > 0 { return .working }
        if turn { return .thinking }
        return .idle
    }
}

public struct BotSpaces: Codable, Hashable, Sendable {
    public var bots: [BotSpace]
    public var currentBotId: String?

    init(_ wire: Studio.BotSpacesOutput) {
        bots = (wire.bots ?? []).compactMap(BotSpace.init)
        currentBotId = wire.currentBotId
    }

    public var current: BotSpace? {
        bots.first { $0.id == currentBotId } ?? bots.first(where: \.primary) ?? bots.first
    }

    public var anyNeedsYou: Bool { bots.contains(where: \.needsYou) }
}

public struct BotConversation: Codable, Hashable, Sendable, Identifiable {
    public struct Parent: Codable, Hashable, Sendable {
        public var threadId: String
        public var messageId: String?
        public var turnId: String?
        public var title: String
    }

    public struct NeedsYou: Codable, Hashable, Sendable {
        public var reason: String
        public var at: Double
    }

    public var id: String { threadId }
    public var threadId: String
    public var title: String
    public var isMain: Bool
    public var forkedFrom: Parent?
    public var projectId: String?
    public var updatedAt: Double
    public var latest: String?
    public var running: Bool
    public var needsYou: NeedsYou?
    public var mirrored: Bool

    init?(_ wire: Studio.BotThreadsViewOutputConversationsItem) {
        guard let threadId = wire.threadId, !threadId.isEmpty else { return nil }
        self.threadId = threadId
        title = wire.title ?? ""
        isMain = wire.isMain ?? false
        forkedFrom = wire.forkedFrom.flatMap { parent in
            parent.threadId.map {
                Parent(threadId: $0, messageId: parent.messageId, turnId: parent.turnId, title: parent.title ?? "")
            }
        }
        projectId = wire.projectId
        updatedAt = wire.updatedAt ?? 0
        latest = wire.latest
        running = wire.running ?? false
        needsYou = wire.needsYou.map { NeedsYou(reason: $0.reason ?? "", at: $0.at ?? 0) }
        mirrored = wire.mirrored ?? false
    }

    public var updated: Date { Date(timeIntervalSince1970: updatedAt / 1000) }
}

public struct BotWorker: Codable, Hashable, Sendable, Identifiable {
    public enum Status: Codable, Hashable, Sendable {
        case running, needsYou, failed, done
        case other(String)

        init(rawValue: String) {
            switch rawValue {
            case "running": self = .running
            case "needs-you": self = .needsYou
            case "failed": self = .failed
            case "done": self = .done
            default: self = .other(rawValue)
            }
        }

        init(_ wire: Studio.BotThreadsViewOutputWorkersItemStatus?) {
            switch wire {
            case .running: self = .running
            case .needs_you: self = .needsYou
            case .failed: self = .failed
            case .done, nil: self = .done
            case .unknown(let value): self = .other(value)
            }
        }

        public var rawValue: String {
            switch self {
            case .running: "running"
            case .needsYou: "needs-you"
            case .failed: "failed"
            case .done: "done"
            case .other(let value): value
            }
        }

        public init(from decoder: Decoder) throws {
            self.init(rawValue: try decoder.singleValueContainer().decode(String.self))
        }

        public func encode(to encoder: Encoder) throws {
            var container = encoder.singleValueContainer()
            try container.encode(rawValue)
        }
    }

    public var id: String { threadId }
    public var threadId: String
    public var title: String
    public var status: Status
    public var ownerConversationId: String?
    public var ownerTitle: String?
    public var projectId: String?
    public var updatedAt: Double
    public var tag: String?
    public var branch: String?
    public var mirrored: Bool
    public var sameTitle: Int

    init?(_ wire: Studio.BotThreadsViewOutputWorkersItem) {
        guard let threadId = wire.threadId, !threadId.isEmpty else { return nil }
        self.threadId = threadId
        title = wire.title ?? ""
        status = Status(wire.status)
        ownerConversationId = wire.ownerConversationId
        ownerTitle = wire.ownerTitle
        projectId = wire.projectId
        updatedAt = wire.updatedAt ?? 0
        tag = wire.tag
        branch = wire.branch
        mirrored = wire.mirrored ?? false
        sameTitle = max(1, wire.sameTitle ?? 1)
    }

    public var updated: Date { Date(timeIntervalSince1970: updatedAt / 1000) }
}

public struct BotThreadsView: Codable, Hashable, Sendable {
    public var botId: String?
    public var conversations: [BotConversation]
    public var workers: [BotWorker]
    public var hiddenWorkers: Int
    public var hiddenToday: Int
    public var olderConversations: Int

    init(_ wire: Studio.BotThreadsViewOutput) {
        botId = wire.botId
        conversations = (wire.conversations ?? []).compactMap(BotConversation.init)
        workers = (wire.workers ?? []).compactMap(BotWorker.init)
        hiddenWorkers = Int(wire.hiddenWorkers ?? 0)
        hiddenToday = Int(wire.hiddenToday ?? 0)
        olderConversations = Int(wire.olderConversations ?? 0)
    }

    public var main: BotConversation? { conversations.first(where: \.isMain) }

    public var topLevel: [BotConversation] {
        let listed = Set(conversations.map(\.threadId))
        return conversations.filter { conversation in
            guard let parent = conversation.forkedFrom?.threadId else { return true }
            return !listed.contains(parent) || parent == conversation.threadId
        }
    }

    public func threads(of conversationId: String) -> [BotConversation] {
        conversations.filter { $0.forkedFrom?.threadId == conversationId && $0.threadId != conversationId }
    }

    public func workers(of conversationId: String) -> [BotWorker] {
        workers.filter { $0.ownerConversationId == conversationId }
    }
}

public enum BotSpacesSupport: String, Codable, Sendable {
    case unknown, available, unavailable

    static func key(_ serverURL: URL) -> String { ServerScope.key("botSpacesSupport", serverURL: serverURL) }

    public static func stored(serverURL: URL = ServerScope.selectedURL) -> BotSpacesSupport {
        AppGroup.defaults.string(forKey: key(serverURL)).flatMap(BotSpacesSupport.init(rawValue:)) ?? .unknown
    }

    static func errorKey(_ serverURL: URL) -> String { ServerScope.key("botSpacesErrorAnswer", serverURL: serverURL) }

    public static func answeredWithError(serverURL: URL) -> Bool {
        AppGroup.defaults.bool(forKey: errorKey(serverURL))
    }

    static func rememberErrorAnswer(_ value: Bool, serverURL: URL) {
        if value {
            AppGroup.defaults.set(true, forKey: errorKey(serverURL))
        } else {
            AppGroup.defaults.removeObject(forKey: errorKey(serverURL))
        }
    }

    static func store(_ value: BotSpacesSupport, serverURL: URL) {
        if value == .unknown {
            AppGroup.defaults.removeObject(forKey: key(serverURL))
        } else {
            AppGroup.defaults.set(value.rawValue, forKey: key(serverURL))
        }
    }
}

public enum BotSpacesCache {
    static let spacesKey = "bot-spaces"
    static func viewKey(_ botId: String) -> String { "bot-threads-view-\(botId)" }

    public static func loadSpaces(serverURL: URL) -> BotSpaces? {
        DiskCache.load(BotSpaces.self, key: spacesKey, serverURL: serverURL)
    }

    public static func saveSpaces(_ spaces: BotSpaces, serverURL: URL) {
        DiskCache.save(spaces, as: spacesKey, serverURL: serverURL)
    }

    public static func loadView(_ botId: String, serverURL: URL) -> BotThreadsView? {
        DiskCache.load(BotThreadsView.self, key: viewKey(botId), serverURL: serverURL)
    }

    public static func saveView(_ view: BotThreadsView, botId: String, serverURL: URL) {
        DiskCache.save(view, as: viewKey(botId), serverURL: serverURL)
    }

    public static func clear(botIds: [String], serverURL: URL) {
        DiskCache.remove(spacesKey, serverURL: serverURL)
        for botId in botIds { DiskCache.remove(viewKey(botId), serverURL: serverURL) }
    }
}

extension BBClient {
    public func botSpaces() async throws -> BotSpaces {
        let output: Studio.BotSpacesOutput = try await rpc("studio", Studio.Method.bot_spaces, .object([:]))
        return BotSpaces(output)
    }

    public func botThreadsView(botId: String?) async throws -> BotThreadsView {
        let output: Studio.BotThreadsViewOutput = try await rpc("studio", Studio.Method.bot_threads_view, Self.scoped(botId))
        return BotThreadsView(output)
    }
}

extension Studio.BotThreadsChangedEvent {
    init?(signal event: RealtimeEvent) {
        guard case .pluginSignal("studio", Studio.Channel.bot_threads_changed, let payload) = event,
            let data = try? JSONEncoder().encode(payload),
            let decoded = try? JSONDecoder().decode(Self.self, from: data),
            let botId = decoded.botId, !botId.isEmpty
        else { return nil }
        self = decoded
    }
}

extension BotSpace {
    /// Main's thread: from the Bot's threads view when it's this Bot's, else the Bot's own record.
    public func mainThreadId(in view: BotThreadsView?) -> String? {
        if let view, view.botId == nil || view.botId == id, let main = view.main { return main.threadId }
        return mainThreadId
    }
}
