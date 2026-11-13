import Foundation

/// What the Status, Bot and Work widgets show about one Bot, from
/// `bot_spaces` and `bot_threads_view` (the same data as the app's Bot list).
/// From a Studio without `bot_spaces`, `load` throws an unknown-RPC error and
/// the widgets fall back to BB's threads.
public struct BotWidgetFacts: Codable, Hashable, Sendable {
    public var spaces: BotSpaces
    public var botId: String
    public var view: BotThreadsView?

    public var bot: BotSpace? { spaces.bots.first { $0.id == botId } }

    public var presence: BotPresenceState {
        bot?.presenceState(live: view.map { var copy = $0; copy.botId = botId; return copy }) ?? .idle
    }

    public var mainThreadId: String? { view?.main?.threadId ?? bot?.mainThreadId }

    /// Conversations that need you, then workers waiting on you, newest first.
    public var needs: [ThreadEntry] {
        let conversations = (view?.conversations ?? []).filter { $0.needsYou != nil }.map { $0.widgetEntry }
        let workers = (view?.workers ?? []).filter { $0.status == .needsYou }.map { $0.widgetEntry }
        return (conversations + workers).sorted { ($0.latestAttentionAt ?? 0) > ($1.latestAttentionAt ?? 0) }
    }

    /// Workers waiting on you (an approval or an answer).
    public var waitingWorkers: [ThreadEntry] {
        (view?.workers ?? []).filter { $0.status == .needsYou }.map { $0.widgetEntry }
    }

    /// Conversations with a turn running, then running workers.
    public var running: [ThreadEntry] {
        let conversations = (view?.conversations ?? []).filter { $0.running && $0.needsYou == nil }.map { $0.widgetEntry }
        let workers = (view?.workers ?? []).filter { $0.status == .running }.map { $0.widgetEntry }
        return (conversations + workers).sorted { ($0.latestAttentionAt ?? 0) > ($1.latestAttentionAt ?? 0) }
    }

    /// Why the Bot needs you: the newest conversation's reason, else its workers.
    public var reason: String? {
        if let reason = (view?.conversations ?? []).filter({ $0.needsYou != nil }).max(by: { $0.updatedAt < $1.updatedAt })?.needsYou?.reason,
           !reason.isEmpty
        {
            return reason
        }
        let waiting = waitingWorkers.count
        if waiting > 0 { return waiting == 1 ? "A worker is waiting on you" : "\(waiting) workers are waiting on you" }
        return bot?.needsYou == true ? "Needs you" : nil
    }

    /// The other Bots that need you, for a line under this one's.
    public var othersNeedingYou: [BotSpace] { spaces.bots.filter { $0.id != botId && $0.needsYou } }

    public var look: BotLook {
        BotLook(shape: bot?.shape, color: bot?.color, emoji: bot?.avatar.isEmpty == false ? bot!.avatar : BotInfo.defaultAvatar)
    }
}

public enum BotWidgetData {
    struct NoBot: Error {}

    static func key(_ botId: String?) -> String { "widget-bot-facts-\(botId ?? "current")" }

    /// Loads the Bots and the chosen one's threads (nil: the current Bot), and
    /// keeps them for the next offline refresh and the Bot picker.
    public static func load(client: BBClient, botId: String?) async throws -> BotWidgetFacts {
        let spaces = try await client.botSpaces()
        BotSpacesCache.saveSpaces(spaces, serverURL: client.baseURL)
        guard let bot = spaces.bots.first(where: { $0.id == botId }) ?? spaces.current else { throw NoBot() }
        var view: BotThreadsView?
        do {
            view = try await client.botThreadsView(botId: bot.id)
            if let view { BotSpacesCache.saveView(view, botId: bot.id, serverURL: client.baseURL) }
        } catch {
            view = BotSpacesCache.loadView(bot.id, serverURL: client.baseURL)
        }
        let facts = BotWidgetFacts(spaces: spaces, botId: bot.id, view: view)
        DiskCache.save(facts, as: key(botId), serverURL: client.baseURL)
        return facts
    }

    /// The last facts loaded for this choice, else the app's own caches.
    public static func cached(serverURL: URL, botId: String?) -> BotWidgetFacts? {
        if let facts = DiskCache.load(BotWidgetFacts.self, key: key(botId), serverURL: serverURL) { return facts }
        guard BotSpacesSupport.stored(serverURL: serverURL) == .available,
              let spaces = BotSpacesCache.loadSpaces(serverURL: serverURL),
              let bot = spaces.bots.first(where: { $0.id == botId }) ?? spaces.current
        else { return nil }
        return BotWidgetFacts(spaces: spaces, botId: bot.id, view: BotSpacesCache.loadView(bot.id, serverURL: serverURL))
    }

    /// Whether the widgets should use Bot spaces: not when the server is known not to have them.
    public static func usesSpaces(serverURL: URL) -> Bool {
        BotSpacesSupport.stored(serverURL: serverURL) != .unavailable
    }
}

extension BotConversation {
    /// The conversation as a row in a widget's list.
    var widgetEntry: ThreadEntry {
        let at = needsYou?.at ?? updatedAt
        return ThreadEntry(id: threadId, projectId: projectId ?? "", title: isMain ? "Main" : (title.isEmpty ? "Conversation" : title),
                           status: running ? "active" : "idle", latestAttentionAt: at, createdAt: updatedAt, updatedAt: updatedAt,
                           hasPendingInteraction: needsYou != nil)
    }
}

extension BotWorker {
    /// The worker as a row in a widget's list.
    var widgetEntry: ThreadEntry {
        ThreadEntry(id: threadId, projectId: projectId ?? "", title: title.isEmpty ? "Worker" : title,
                    status: status == .running || status == .needsYou ? "active" : status == .failed ? "error" : "idle",
                    latestAttentionAt: updatedAt, createdAt: updatedAt, updatedAt: updatedAt, hasPendingInteraction: status == .needsYou)
    }
}
