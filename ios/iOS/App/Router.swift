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

/// All of the app's navigation in one place (round 7): Home is the root and
/// everything else is pushed on its one stack (`path`). Beside two Duo
/// pages the conversation is a column of its own: `conversation` is the
/// one it shows, and `path` past it is what's pushed over it.
@MainActor
final class Router: ObservableObject {
    static let shared = Router()

    /// Home's stack: a conversation, Memory, Library, a page…
    @Published var path: [Route] = []
    /// The conversation on screen (or last on screen): the conversation
    /// column beside two pages, and where Home's "You're here" points.
    @Published private(set) var conversation: String?
    @Published var sheet: Sheet?
    /// Set by `bbstudio://reply/<id>`; that thread focuses its composer.
    @Published var replyThreadId: String?
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
    /// Bumped to put the keyboard in Home's search (the Duo rail's Search).
    @Published private(set) var searchRequests = 0

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

    /// Onto the stack showing, so Back returns where you were.
    func push(_ route: Route) {
        path.append(route)
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
            if Self.isConversation(id, store: store) { openConversation(id) } else { path = [.thread(id: id)] }
        case .worker(let id):
            path = [.thread(id: id)]
        case .place(let page, let botId):
            if let botId, store.spaces?.bots.contains(where: { $0.id == botId }) == true { show(botId, store: store) }
            path = [.place(page)]
        case .route(let route):
            path.append(route)
        case .list:
            path = []
        case .compose(let text):
            path = []
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
            path = [.studio] + (route.map { [$0] } ?? [])
        case .settings:
            path = [.settings]
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
        path = [.conversation(id: threadId)]
        homePane.pickedConversation()
    }

    /// Memory, Library, a worker…: from Home's rows and the Bot's pages.
    func open(item: BotShellItem) {
        switch item {
        case .conversation(let id): openConversation(id)
        case .worker(let id): path = [.thread(id: id)]
        case .page(let page): path = [.place(page)]
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
    }

    func focusInput() {
        focusRequests += 1
    }

    func focusSearch() {
        path = []
        searchRequests += 1
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
        path = []
        landed = false
        homePane = ShellHomePane()
    }
}

