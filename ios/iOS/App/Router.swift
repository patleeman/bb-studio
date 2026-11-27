import SwiftUI

/// Everywhere the app can be sent. Pushes, Spotlight, links, widgets, Siri,
/// quick actions, the Watch and the app's own buttons all go through
/// `Router.open`, so the same thing opens the same way from anywhere.
enum Destination: Hashable {
    /// A Bot's conversation, or any BB thread: pushed over Home.
    case conversation(String)
    /// A worker's thread, pushed over Home.
    case worker(String)
    /// One of the Bot's places (Memory, Library, Schedules, Archive).
    case place(BotPage, botId: String?)
    /// A screen pushed on what shows: a page, an automation, a memory record…
    case route(Route)
    /// Home.
    case list
    /// New conversation, its message prefilled.
    case compose(String)
    /// A Bot's Home, on its Main (nil: the current Bot).
    case bot(String?)
    /// Studio's list (with a kind filter), or one item over it.
    case studio(kind: String?, Route?)
    case settings
    /// A sheet over everything (capture, dictation, hands-free voice…).
    case sheet(Sheet)
}

/// The app's top-level places: the tab bar's tabs (round 8). Each has its own stack.
enum ShellTab: String, Hashable, CaseIterable {
    case home, library, memory, search
}

/// All of the app's navigation in one place (round 8, as Kensico's
/// Navigator): the tab showing, and one stack per tab. Home's stack holds
/// the conversations and everything opened from them. Beside two Duo pages
/// the conversation is a column of its own, Home's detail page:
/// `conversation` is the one it shows, and `path` past it is what's pushed over it.
@MainActor
final class Router: ObservableObject {
    static let shared = Router()

    @Published var tab: ShellTab = .home
    /// Home's stack: a conversation, a worker, a page, Settings…
    /// Anything pushed closes Home over the conversation column (it shows in that column).
    @Published var path: [Route] = [] {
        didSet { if !path.isEmpty, homePane.overlaid { homePane.pushed() } }
    }
    @Published var libraryPath: [Route] = []
    @Published var memoryPath: [Route] = []
    @Published var searchPath: [Route] = []
    /// The conversation on screen (or last on screen): the conversation
    /// column beside two pages, and where Home's "You're here" points.
    @Published private(set) var conversation: String?
    @Published var sheet: Sheet?
    /// Set by `bbstudio://reply/<id>`; that thread focuses its composer.
    @Published var replyThreadId: String?
    /// Reply threads opened from their conversation's messages: pushed, they say Reply….
    var replyThreads: Set<String> = []
    /// New conversation over Home, its message prefilled.
    @Published var compose: String?
    /// Studio's kind filter; nil for everything.
    @Published var studioKind: String?
    /// A destination that came before Studio's Bots loaded: taken once they have.
    @Published private(set) var pending: Destination?
    @Published var shownBotId: String? {
        didSet { BotSpacesStore.shared.shownBotId = shownBotId }
    }
    @Published var themeOverride: [String: String] = [:]
    /// Home's pane beside the conversation on the open Duo.
    @Published var homePane = ShellHomePane()
    /// Bumped to put the keyboard in the conversation's composer.
    @Published private(set) var focusRequests = 0

    private(set) var landed = false

    /// The one way in: everything that opens something calls this.
    func open(_ destination: Destination) {
        switch destination {
        case .sheet(let next):
            sheet = next
        default:
            pending = destination
        }
    }

    /// Onto the shown tab's stack, so Back returns where you were. A second
    /// tap on what's already on top (a quick double tap) pushes nothing.
    func push(_ route: Route) {
        switch tab {
        case .home: Self.push(route, on: &path)
        case .library: Self.push(route, on: &libraryPath)
        case .memory: Self.push(route, on: &memoryPath)
        case .search: Self.push(route, on: &searchPath)
        }
    }

    private static func push(_ route: Route, on stack: inout [Route]) {
        if stack.last != route { stack.append(route) }
    }

    /// One of the Bot's places: Memory and Library are tabs, the rest open on Home.
    func show(_ page: BotPage) {
        switch page {
        case .memory:
            tab = .memory
            memoryPath = []
        case .library:
            tab = .library
            libraryPath = []
        case .automations, .archive:
            home([.place(page)])
        }
    }

    /// Home's tab, with this stack.
    func home(_ stack: [Route]) {
        tab = .home
        path = stack
    }

    /// Takes the waiting destination once Studio's Bots are loaded. True when one was followed.
    @discardableResult
    func consume(_ store: BotSpacesStore) -> Bool {
        guard store.spaces != nil, let destination = pending else { return false }
        pending = nil
        follow(destination, store: store)
        return true
    }

    func follow(_ destination: Destination, store: BotSpacesStore) {
        landed = true
        switch destination {
        case .conversation(let id):
            if Self.isConversation(id, store: store) { openConversation(id) } else { home([.thread(id: id)]) }
        case .worker(let id):
            home([.thread(id: id)])
        case .place(let page, let botId):
            if let botId, store.spaces?.bots.contains(where: { $0.id == botId }) == true { show(botId, store: store) }
            show(page)
        case .route(let route):
            push(route)
        case .list:
            home([])
        case .compose(let text):
            home([])
            compose = text
        case .bot(let id):
            let botId = id ?? store.spaces?.bots.first(where: \.primary)?.id ?? store.spaces?.current?.id
            guard let botId, let bot = store.spaces?.bots.first(where: { $0.id == botId }) else { return }
            show(bot.id, store: store)
            if let main = BotShell.mainThreadId(bot, view: store.view(for: bot.id)) {
                openConversation(main)
                focusInput()
            }
        case .studio(let kind, let route):
            if let kind { studioKind = StudioKind.family(kind) }
            home([.studio] + (route.map { [$0] } ?? []))
        case .settings:
            home([.settings])
        case .sheet(let next):
            sheet = next
        }
    }

    /// One of the shown Bot's conversations (else any thread, pushed as one).
    static func isConversation(_ id: String, store: BotSpacesStore) -> Bool {
        store.views.values.contains { $0.conversations.contains { $0.threadId == id } }
    }

    /// A conversation over Home, which Back returns to.
    func openConversation(_ threadId: String) {
        landed = true
        conversation = threadId
        home([.conversation(id: threadId)])
    }

    /// Memory, Library, a worker…: from Home's rows and the Bot's pages.
    func open(item: BotShellItem) {
        switch item {
        case .conversation(let id): openConversation(id)
        case .worker(let id): home([.thread(id: id)])
        case .page(let page): show(page)
        }
    }

    /// The conversation a stack shows, for the column beside two pages.
    func shown(_ threadId: String) {
        if conversation != threadId { conversation = threadId }
    }

    /// Once the Bots load: Home, with the conversation the app was last on
    /// (or the Bot's Main) as the open Duo's conversation column.
    func land(_ store: BotSpacesStore, opening: (BotSpace, String) -> String) {
        guard !landed, let bot = BotShell.shownBot(store.spaces, chosen: shownBotId),
              let main = BotShell.mainThreadId(bot, view: store.view(for: bot.id))
        else { return }
        landed = true
        shownBotId = bot.id
        conversation = opening(bot, main)
    }

    /// Another Bot: its Home.
    func show(_ botId: String, store: BotSpacesStore) {
        let previous = BotShell.shownBot(store.spaces, chosen: shownBotId)?.id
        guard botId != previous, store.spaces?.bots.contains(where: { $0.id == botId }) == true else { return }
        if let previous, previous != store.spaces?.current?.id { store.unwatch(previous) }
        store.watch(botId)
        shownBotId = botId
        landed = true
        conversation = nil
        path = []
        libraryPath = []
        memoryPath = []
        searchPath = []
    }

    func focusInput() {
        focusRequests += 1
    }

    /// Another server: nothing of the last one's navigation carries over.
    func reset() {
        studioKind = nil
        sheet = nil
        compose = nil
        replyThreadId = nil
        pending = nil
        shownBotId = nil
        conversation = nil
        tab = .home
        path = []
        libraryPath = []
        memoryPath = []
        searchPath = []
        landed = false
        homePane = ShellHomePane()
    }
}

