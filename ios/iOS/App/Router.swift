import SwiftUI

/// Everywhere the app can be sent. Pushes, Spotlight, links, widgets, Siri,
/// quick actions, the Watch and the app's own buttons all go through
/// `Router.open`, so the same thing opens the same way from anywhere.
enum Destination: Hashable {
    /// A Bot's conversation, or any BB thread: shown in the room (a thread
    /// that isn't one of the Bot's conversations is pushed over it).
    case conversation(String)
    /// A worker's thread, pushed over its conversation.
    case worker(String)
    /// One of the Bot's places (Strands, Memory, Library, Schedules, Archive).
    case place(BotPage, botId: String?)
    /// A screen pushed in the room: a page, an automation, a memory record…
    case route(Route)
    /// The one conversation list, over the conversation.
    case list
    /// New conversation, its message prefilled.
    case compose(String)
    /// A Bot's room, on its Main (nil: the current Bot).
    case bot(String?)
    /// Studio over the room: its list (with a kind filter), or one item.
    case studio(kind: String?, Route?)
    /// Settings over the room.
    case settings
    /// A sheet over everything (capture, dictation, hands-free voice…).
    case sheet(Sheet)
}

/// What the room should do next, set by `Router.follow` and taken by the room.
enum RoomRequest: Equatable {
    /// A Bot's place, as a sheet on the phone or a spread on the unfolded Duo.
    case place(BotPage)
    /// Show this conversation (and focus its composer when it's Main).
    case focus(String)
    /// The one conversation list.
    case list
    /// New conversation with this message.
    case compose(String)
}

enum Tab: Hashable {
    case studio, bot, settings
}

/// All of the app's navigation state in one place: what shows over the room
/// (Studio, Settings, a sheet), what waits for Studio's Bots to load, the
/// shown Bot and conversation, what's pushed over it, and the room's open
/// place. One model, so every way in lands the same way.
@MainActor
final class Router: ObservableObject {
    static let shared = Router()

    // MARK: Over the room

    /// The room (`.bot`) is home; Studio and Settings open as sheets over it.
    @Published var tab: Tab = .bot
    @Published var studioPath: [Route] = []
    /// Studio's kind filter; nil for everything.
    @Published var studioKind: String?
    @Published var sheet: Sheet?
    /// Set by `bbstudio://reply/<id>`; that thread focuses its composer.
    @Published var replyThreadId: String?
    /// A destination that came before Studio's Bots loaded: the room takes it once they have.
    @Published private(set) var pending: Destination?

    // MARK: The Bot and its conversation

    @Published var shownBotId: String? {
        didSet { BotSpacesStore.shared.shownBotId = shownBotId }
    }
    @Published var selection: BotShellItem?
    @Published var compactColumn: NavigationSplitViewColumn = .sidebar
    /// What's pushed over the conversation.
    @Published var detailPath: [Route] = []
    /// For the room to act on (a place, a conversation, the list, New conversation).
    @Published var request: RoomRequest?
    @Published var themeOverride: [String: String] = [:]
    @Published var botToast: String?

    // MARK: The room

    /// The place open over the conversation (the list is `.conversations`).
    @Published var place: RoomPlace?
    /// Bumped to put the keyboard in the conversation's composer.
    @Published private(set) var focusRequests = 0

    private(set) var landed = false
    private var landing = false
    private var pendingPush: Route?

    /// The one way in: everything that opens something calls this.
    func open(_ destination: Destination) {
        switch destination {
        case .studio(let kind, let route):
            tab = .studio
            if let kind { studioKind = StudioKind.family(kind) }
            studioPath = route.map { [$0] } ?? []
        case .settings:
            tab = .settings
        case .sheet(let next):
            sheet = next
        default:
            if tab != .bot { tab = .bot }
            if case .task? = sheet { sheet = nil }
            pending = destination
        }
    }

    /// Onto the stack showing, so Back returns where you were.
    func push(_ route: Route) {
        if tab == .studio { studioPath.append(route) } else { open(.route(route)) }
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
        switch destination {
        case .conversation(let id):
            open(item: .conversation(id))
        case .worker(let id):
            open(item: .worker(id))
        case .place(let page, let botId):
            if let botId, botId != BotShell.shownBot(store.spaces, chosen: shownBotId)?.id, store.spaces?.bots.contains(where: { $0.id == botId }) == true {
                show(botId, store: store, compact: true)
            }
            open(item: .page(page))
        case .route(let route):
            landed = true
            compactColumn = .detail
            if selection == nil, let bot = BotShell.shownBot(store.spaces, chosen: shownBotId),
               let main = BotShell.mainThreadId(bot, view: store.view(for: bot.id)) {
                pendingPush = route
                selection = .conversation(main)
            } else {
                detailPath.append(route)
            }
        case .list:
            landed = true
            showList()
            request = .list
        case .compose(let text):
            landed = true
            request = .compose(text)
        case .bot(let id):
            let botId = id ?? store.spaces?.bots.first(where: \.primary)?.id ?? store.spaces?.current?.id
            guard let botId, let bot = store.spaces?.bots.first(where: { $0.id == botId }) else { return }
            if bot.id != BotShell.shownBot(store.spaces, chosen: shownBotId)?.id {
                show(bot.id, store: store, compact: false)
            }
            landed = true
            selection = BotShell.mainThreadId(bot, view: store.view(for: bot.id)).map(BotShellItem.conversation)
            compactColumn = .detail
            if case .conversation(let id)? = selection { request = .focus(id) }
        case .studio, .settings, .sheet:
            open(destination)
        }
    }

    // MARK: The shell

    func openConversation(_ threadId: String) {
        open(item: .conversation(threadId))
    }

    func open(item: BotShellItem) {
        landed = true
        detailPath = []
        selection = item
        compactColumn = .detail
        // The room may show another conversation while this one is still the
        // selection (it opened on the last one): ask it to show this one.
        if case .conversation(let id) = item { request = .focus(id) }
    }

    func takeLanding() -> Bool {
        defer { landing = false }
        return landing
    }

    func takePendingPush() -> [Route] {
        defer { pendingPush = nil }
        return pendingPush.map { [$0] } ?? []
    }

    func showList() {
        detailPath = []
        selection = nil
        compactColumn = .sidebar
    }

    /// The first conversation once the Bots load: the shown Bot's Main.
    func land(_ store: BotSpacesStore) {
        guard !landed, let bot = BotShell.shownBot(store.spaces, chosen: shownBotId),
            let main = BotShell.mainThreadId(bot, view: store.view(for: bot.id))
        else { return }
        landed = true
        shownBotId = bot.id
        landing = true
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

    // MARK: The room

    func showPlace(_ place: RoomPlace) {
        self.place = place
    }

    func closePlace() {
        place = nil
    }

    func focusInput() {
        focusRequests += 1
    }

    /// Another server: nothing of the last one's navigation carries over.
    func reset() {
        studioKind = nil
        sheet = nil
        studioPath = []
        replyThreadId = nil
        pending = nil
        shownBotId = nil
        selection = nil
        detailPath = []
        request = nil
        place = nil
        landed = false
        pendingPush = nil
    }
}
