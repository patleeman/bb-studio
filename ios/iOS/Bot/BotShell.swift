import SwiftUI

enum BotPage: String, CaseIterable, Hashable, Identifiable {
    case memory, library, todos, automations, archive

    var id: String { rawValue }

    var title: String {
        switch self {
        case .memory: "Memory"
        case .library: "Library"
        case .todos: "Todos"
        case .automations: "Automations"
        case .archive: "Archive"
        }
    }

    var symbol: String {
        switch self {
        case .memory: "brain.head.profile"
        case .library: "books.vertical"
        case .todos: "checklist"
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
}

struct BotSpaceDot: Equatable, Identifiable {
    var id: String
    var name: String
    var active: Bool
    var amber: Bool

    var label: String { name + (amber ? ", needs you" : "") }
}

enum BotShell {
    static func usesSpaces(support: BotSpacesSupport, showing: Bool, idle: Bool) -> Bool {
        guard support == .available else { return false }
        return showing || idle
    }

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
        func add(_ conversation: BotConversation, depth: Int) {
            guard seen.insert(conversation.threadId).inserted else { return }
            let line = secondLine(conversation)
            out.append(BotConversationLine(threadId: conversation.threadId, title: conversation.title.isEmpty ? "Untitled" : conversation.title,
                                           forkedFrom: depth > 0 ? conversation.forkedFrom?.title : nil, depth: depth,
                                           updatedAt: conversation.updatedAt, tone: line.tone, text: line.text))
            for child in view.threads(of: conversation.threadId) { add(child, depth: depth + 1) }
        }
        for conversation in view.topLevel { add(conversation, depth: 0) }
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

@MainActor
final class BotShellModel: ObservableObject {
    @Published var shownBotId: String?
    @Published var selection: BotShellItem?
    @Published var compactColumn: NavigationSplitViewColumn = .sidebar
    @Published var detailPath: [Route] = []
    private(set) var landed = false

    func openConversation(_ threadId: String) {
        landed = true
        detailPath = []
        selection = .conversation(threadId)
        compactColumn = .detail
    }

    func open(_ item: BotShellItem) {
        landed = true
        detailPath = []
        selection = item
        compactColumn = .detail
    }

    func showList() {
        detailPath = []
        selection = nil
        compactColumn = .sidebar
    }

    func land(_ store: BotSpacesStore) {
        guard !landed, let bot = BotShell.shownBot(store.spaces, chosen: shownBotId),
            let main = BotShell.mainThreadId(bot, view: store.view(for: bot.id))
        else { return }
        landed = true
        shownBotId = bot.id
        selection = .conversation(main)
        compactColumn = .detail
    }

    func show(_ botId: String, store: BotSpacesStore, compact: Bool) {
        let previous = BotShell.shownBot(store.spaces, chosen: shownBotId)?.id
        guard botId != previous, store.spaces?.bots.contains(where: { $0.id == botId }) == true else { return }
        if let previous, previous != store.spaces?.current?.id { store.unwatch(previous) }
        store.watch(botId)
        shownBotId = botId
        landed = true
        if compact {
            selection = nil
            compactColumn = .sidebar
        } else {
            let bot = BotShell.shownBot(store.spaces, chosen: botId)
            selection = BotShell.mainThreadId(bot, view: store.view(for: botId)).map(BotShellItem.conversation)
        }
    }

    func step(_ step: Int, store: BotSpacesStore, compact: Bool) {
        guard let next = BotShell.step(store.spaces, from: BotShell.shownBot(store.spaces, chosen: shownBotId)?.id, by: step) else { return }
        show(next, store: store, compact: compact)
    }

    func open(_ route: BotRoute, store: BotSpacesStore) {
        switch route {
        case .list:
            selection = nil
            compactColumn = .sidebar
        case .primary, .bot:
            var botId = store.spaces?.bots.first(where: \.primary)?.id ?? store.spaces?.current?.id
            if case .bot(let id) = route { botId = id }
            guard let botId, let bot = store.spaces?.bots.first(where: { $0.id == botId }) else { return }
            if bot.id != BotShell.shownBot(store.spaces, chosen: shownBotId)?.id {
                show(bot.id, store: store, compact: false)
            }
            landed = true
            selection = BotShell.mainThreadId(bot, view: store.view(for: bot.id)).map(BotShellItem.conversation)
            compactColumn = .detail
        }
    }
}
