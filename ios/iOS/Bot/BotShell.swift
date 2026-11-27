import SwiftUI

enum BotPage: String, CaseIterable, Hashable, Identifiable {
    case strands, memory, library, automations, archive

    var id: String { rawValue }

    var title: String {
        switch self {
        case .memory: "Memory"
        case .library: "Library"
        case .strands: "Strands"
        case .automations: "Automations"
        case .archive: "Archive"
        }
    }

    var symbol: String {
        switch self {
        case .memory: "brain.head.profile"
        case .library: "books.vertical"
        case .strands: "list.bullet.rectangle"
        case .automations: "arrow.triangle.2.circlepath"
        case .archive: "archivebox"
        }
    }
}

enum BotShellItem: Hashable {
    case conversation(String)
    case worker(String)
    case page(BotPage)

    var threadId: String? {
        switch self {
        case .conversation(let id), .worker(let id): id
        case .page: nil
        }
    }
}

struct BotConversationLine: Equatable, Identifiable {
    enum Tone: Equatable { case needsYou, running, quiet }

    var id: String { threadId }
    var threadId: String
    var title: String
    var forkedFrom: String?
    var depth: Int
    var updatedAt: Double
    var tone: Tone
    var text: String
    /// BB's provider id for its logo (`claude-code`, `codex`…), nil when unknown.
    var providerId: String? = nil
}

struct BotSpaceDot: Equatable, Identifiable {
    var id: String
    var name: String
    var active: Bool
    var amber: Bool

    var label: String { name + (amber ? ", needs you" : "") }
}

/// What the root shows: the room once Studio's Bots answer (or from what
/// they answered last time), loading until then, and Studio unreachable after
/// a real failure (not installed, or an error answer) or `timeout`.
enum StudioLaunch {
    enum Shown: Equatable { case loading, room, unreachable }

    static let timeout: Duration = .seconds(10)
    static let retries: [Duration] = [.seconds(5), .seconds(15), .seconds(60)]

    static func shown(support: BotSpacesSupport, failed: Bool, timedOut: Bool) -> Shown {
        switch support {
        case .available: .room
        case .unavailable: .unreachable
        case .unknown: failed || timedOut ? .unreachable : .loading
        }
    }

    static func retryDelay(_ attempt: Int, delays: [Duration] = retries) -> Duration {
        guard let last = delays.last else { return .seconds(60) }
        return attempt < delays.count ? delays[max(0, attempt)] : last
    }
}

enum BotShell {
    static func shownBot(_ spaces: BotSpaces?, chosen: String?) -> BotSpace? {
        guard let spaces else { return nil }
        return spaces.bots.first { $0.id == chosen } ?? spaces.current
    }

    static func mainThreadId(_ bot: BotSpace?, view: BotThreadsView?) -> String? {
        if let view, view.botId == nil || view.botId == bot?.id, let main = view.main { return main.threadId }
        return bot?.mainThreadId
    }

    static func needsYou(_ bot: BotSpace, view: BotThreadsView?) -> Bool {
        bot.presenceState(live: view) == .needs
    }

    static func secondLine(_ conversation: BotConversation) -> (tone: BotConversationLine.Tone, text: String) {
        if let needs = conversation.needsYou {
            return (.needsYou, needs.reason.isEmpty ? "Needs you" : needs.reason)
        }
        if conversation.running { return (.running, conversation.latest.flatMap { $0.isEmpty ? nil : $0 } ?? "Working…") }
        return (.quiet, conversation.latest ?? "")
    }

    static func lines(_ view: BotThreadsView?) -> [BotConversationLine] {
        guard let view else { return [] }
        var out: [BotConversationLine] = []
        var seen: Set<String> = []
        for conversation in view.conversations where seen.insert(conversation.threadId).inserted {
            let line = secondLine(conversation)
            out.append(BotConversationLine(threadId: conversation.threadId, title: conversation.title.isEmpty ? "Untitled" : conversation.title,
                                           forkedFrom: nil, depth: 0,
                                           updatedAt: conversation.updatedAt, tone: line.tone, text: line.text,
                                           providerId: conversation.providerId))
        }
        return out
    }

    static func splitWorkers(_ workers: [BotWorker]) -> (active: [BotWorker], done: [BotWorker]) {
        let needs = workers.filter { $0.status == .needsYou }
        let running = workers.filter { $0.status == .running }
        return (needs + running, workers.filter { $0.status != .needsYou && $0.status != .running })
    }

    static func dots(_ spaces: BotSpaces?, shown: String?, views: [String: BotThreadsView]) -> [BotSpaceDot] {
        guard let spaces else { return [] }
        let active = shownBot(spaces, chosen: shown)?.id
        return spaces.bots.map { bot in
            BotSpaceDot(id: bot.id, name: bot.name, active: bot.id == active, amber: needsYou(bot, view: views[bot.id]))
        }
    }

    static func step(_ spaces: BotSpaces?, from current: String?, by step: Int) -> String? {
        guard let bots = spaces?.bots, !bots.isEmpty else { return nil }
        let at = bots.firstIndex { $0.id == current } ?? 0
        let next = at + step
        guard bots.indices.contains(next), bots[next].id != current else { return nil }
        return bots[next].id
    }

    @MainActor
    static func context(threadId: String, kind: BotConversationContext.Kind, bot: BotSpace, view: BotThreadsView?, splitsThreads: Bool,
                        push: @escaping (Route) -> Void, openConversation: @escaping (String) -> Void,
                        showList: @escaping () -> Void, refresh: @escaping () -> Void) -> BotConversationContext {
        BotConversationContext(
            threadId: threadId, kind: kind, botId: bot.id, botName: bot.name,
            look: BotLook(shape: bot.shape, color: bot.color, emoji: bot.avatar),
            mainThreadId: mainThreadId(bot, view: view),
            conversation: view?.conversations.first { $0.threadId == threadId },
            workers: WorkersLine(conversationId: threadId, view: kind == .conversation ? view : nil),
            allWorkers: view?.workers ?? [],
            splitsThreads: splitsThreads, push: push, openConversation: openConversation, showList: showList, refresh: refresh,
            botPause: bot.paused ? (bot.state ?? "paused") : nil)
    }

    static func shortAge(_ at: Double, now: Date = Date()) -> String {
        WorkerInfo.age(at, now: now)
    }

    static func status(_ bot: BotSpace, view: BotThreadsView?) -> String {
        let workers = view?.workers.filter { $0.status == .running }.count ?? bot.activity.workers
        let state: String = switch bot.presenceState(live: view) {
        case .needs: "Needs you"
        case .working, .thinking: "Working"
        case .idle: "Idle"
        }
        guard workers > 0 else { return state }
        return state + " · " + (workers == 1 ? "1 worker" : "\(workers) workers")
    }
}
