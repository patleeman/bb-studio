import SwiftUI

/// The app once Studio's Bots answer (round 7). Home is the root and every
/// other screen is pushed on its stack, laid out by the posture:
/// one column on the iPhone and the folded or vertical Duo; two pages on
/// the open Duo (book: conversation | Workbench; flat: Home | conversation |
/// Workbench), with the controls in the rail.
struct ShellRoot: View {
    @ObservedObject var store: BotSpacesStore
    @ObservedObject private var router = Router.shared
    @ObservedObject private var looks = LookStore.shared
    @EnvironmentObject private var app: AppModel
    @State private var geometry = ShellGeometry()

    private var posture: ShellPosture { geometry.posture }
    private var bot: BotSpace? { BotShell.shownBot(store.spaces, chosen: router.shownBotId) }

    var body: some View {
        Group {
            if let bot {
                if posture.splitsWorkbench {
                    ShellPages(bot: bot, store: store, window: geometry.window)
                } else {
                    ShellColumn(bot: bot, store: store)
                }
            } else {
                ProgressView()
            }
        }
        .environment(\.shellPosture, posture)
        .environment(\.shellReservedColumn, geometry.trailingInset)
        .environment(\.shellInnerScreen, geometry.innerScreen || posture.innerScreen)
        .background { ShellBackground() }
        // The vertical Duo is a big iPhone: type a step up (9f: 18 pt body), never down.
        .dynamicTypeSize(posture.largeType ? .xLarge ... .accessibility5 : .xSmall ... .accessibility5)
        .lookRoot(bot: bot, theme: bot.map(theme))
        .background(ShellGeometryReader { geometry = $0 }.accessibilityHidden(true))
        .sheet(isPresented: Binding(get: { router.compose != nil }, set: { if !$0 { router.compose = nil } })) {
            NewThreadView(text: router.compose ?? "", botId: bot?.id) { id, botId in started(id, botId: botId) }
        }
        .task(id: store.spaces) { await LookExport.run(store: store, client: app.client) }
        .onAppear { land() }
        .onChange(of: store.spaces) { _, _ in land() }
        .onChange(of: store.views) { _, _ in land() }
        .onChange(of: router.pending, initial: true) { _, _ in router.consume(store) }
        .onChange(of: posture) { old, new in router.homePane.postureChanged(from: old, to: new) }
        .onChange(of: router.conversation) { _, id in
            if let id, let bot { ShellMemory.remember(id, botId: bot.id) }
        }
    }

    private func theme(_ bot: BotSpace) -> LookTheme {
        RoomTheme.resolve(botThemeId: router.themeOverride[bot.id] ?? bot.appearance?.themeId, phoneThemeId: looks.themeId,
                          catalog: looks.catalog)
    }

    /// Home first; the conversation column (two pages) on the last one shown.
    private func land() {
        router.land(store) { bot, main in ShellMemory.opening(main: main, botId: bot.id, store: store) }
        #if DEBUG
        if !ShellMemory.qaOpened, let id = ShellMemory.qaConversation, router.path.isEmpty, store.spaces != nil {
            ShellMemory.qaOpened = true
            router.openConversation(id)
        }
        #endif
        router.consume(store)
    }

    /// New conversation: with this Bot it opens here; with another, that Bot's Home opens on it.
    private func started(_ id: String, botId: String?) {
        Task {
            if let botId, botId != bot?.id { store.watch(botId, fetch: false) }
            await store.refresh()
            if let botId, botId != bot?.id { router.show(botId, store: store) }
            router.openConversation(id)
            router.focusInput()
        }
    }
}

/// Which conversation the open Duo's column shows first: the last one opened
/// while it is still listed, else the Bot's Main.
@MainActor
enum ShellMemory {
    private static let key = "shellLastConversation"

    static func opening(main: String, botId: String, store: BotSpacesStore) -> String {
        #if DEBUG
        if ProcessInfo.processInfo.arguments.contains("-qaRoomForget") { return main }
        #endif
        guard let last = AppGroup.defaults.string(forKey: key + "." + botId),
              store.view(for: botId)?.conversations.contains(where: { $0.threadId == last }) == true else { return main }
        return last
    }

    static func remember(_ threadId: String, botId: String) {
        AppGroup.defaults.set(threadId, forKey: key + "." + botId)
    }

    #if DEBUG
    /// Once a launch: Home stays Home after the test goes back to it.
    static var qaOpened = false

    /// `-qaRoomConversation <id>`: the UI tests open on a conversation, pushed over Home.
    static var qaConversation: String? {
        let arguments = ProcessInfo.processInfo.arguments
        guard let at = arguments.firstIndex(of: "-qaRoomConversation"), arguments.indices.contains(at + 1) else { return nil }
        return arguments[at + 1]
    }
    #endif
}

// MARK: One column

/// The iPhone, and the folded or vertical Duo: Home with everything pushed over it.
private struct ShellColumn: View {
    let bot: BotSpace
    @ObservedObject var store: BotSpacesStore
    @ObservedObject private var router = Router.shared

    var body: some View {
        NavigationStack(path: $router.path) {
            HomeScreen(bot: bot, store: store)
                .shellSurface()
                .navigationDestination(for: Route.self) { ShellDestination(route: $0, bot: bot, store: store).shellSurface() }
        }
    }
}

/// Home at the root of a stack: the iPhone's bar (Search, New), or the
/// Duo's title line and rail (New, Search).
private struct HomeScreen: View {
    let bot: BotSpace
    @ObservedObject var store: BotSpacesStore
    @ObservedObject private var router = Router.shared
    @Environment(\.shellPosture) private var posture

    var body: some View {
        if posture.usesRail {
            VStack(spacing: 0) {
                ShellTitleLine(title: "Home", posture: posture)
                HomeView(bot: bot, store: store)
            }
            .toolbar(.hidden, for: .navigationBar)
            .rail(RailLayout.slots(posture, screen: .home, tabs: 0, homeShown: true),
                  actions: RailActions(tap: tap), large: posture.largeType)
        } else {
            HomeView(bot: bot, store: store)
                .navigationTitle("Home")
                .navigationBarTitleDisplayMode(.inline)
                .toolbar {
                    ToolbarItemGroup(placement: .topBarTrailing) {
                        Button { router.focusSearch() } label: { Image(systemName: RailSlot.search.symbol) }
                            .accessibilityLabel("Search")
                            .accessibilityIdentifier("homeSearchButton")
                        Button { router.compose = "" } label: { Image(systemName: RailSlot.new.symbol) }
                            .accessibilityLabel("New conversation")
                            .accessibilityIdentifier("homeNew")
                    }
                }
        }
    }

    private func tap(_ slot: RailSlot) {
        switch slot {
        case .new: router.compose = ""
        case .search: router.focusSearch()
        default: break
        }
    }
}

/// A screen pushed over Home, by its route.
struct ShellDestination: View {
    let route: Route
    let bot: BotSpace
    @ObservedObject var store: BotSpacesStore
    var pane = false
    @ObservedObject private var router = Router.shared
    @Environment(\.shellPosture) private var posture
    @EnvironmentObject private var app: AppModel

    var body: some View {
        switch route {
        case .conversation(let id):
            ConversationScreen(threadId: id, pane: pane)
                .environment(\.botConversation, ShellContext.make(id, kind: .conversation, bot: bot, store: store))
        case .thread(let id):
            ConversationScreen(threadId: id, pane: pane)
                .environment(\.botConversation, ShellContext.make(id, kind: ShellContext.kind(id, bot: bot, store: store),
                                                                 bot: bot, store: store))
        default:
            other.modifier(PushedChrome(title: route.shellTitle, pane: pane))
        }
    }

    @ViewBuilder private var other: some View {
        switch route {
        case .place(let page): ShellPlace(page: page, bot: bot, store: store)
        case .theme:
            RoomThemePicker(bot: bot, current: router.themeOverride[bot.id] ?? bot.appearance?.themeId ?? "") { themeId in
                RoomTheme.choose(themeId, bot: bot, router: router, store: store, app: app)
            }
        case .studio: StudioView()
        case .settings: SettingsView()
        default:
            RouteDestination(route: route)
                .environment(\.botConversation, ShellContext.make(BotShell.mainThreadId(bot, view: store.view(for: bot.id)) ?? "",
                                                                 kind: .conversation, bot: bot, store: store))
        }
    }
}

/// One of the Bot's places, pushed: Memory, Library, Schedules, Archive.
struct ShellPlace: View {
    let page: BotPage
    let bot: BotSpace
    @ObservedObject var store: BotSpacesStore
    @ObservedObject private var router = Router.shared

    var body: some View {
        switch page {
        case .memory: MemoryPageView(botId: bot.id, open: router.open(item:))
        case .library: LibraryPageView(botId: bot.id)
        case .automations: BotAutomationsSheet(botId: bot.id, botName: bot.name, embedded: true, allAutomations: true).id(bot.id)
        case .archive: ArchivePageView(botId: bot.id, open: router.open(item:), refresh: { Task { await store.refresh() } })
        }
    }
}

/// What a thread's screen knows of the Bot it belongs to.
@MainActor
enum ShellContext {
    /// A worker, a reply thread opened from a message, or else a conversation.
    static func kind(_ threadId: String, bot: BotSpace, store: BotSpacesStore) -> BotConversationContext.Kind {
        if store.view(for: bot.id)?.workers.contains(where: { $0.threadId == threadId }) == true { return .worker }
        return Router.shared.replyThreads.contains(threadId) ? .reply : .conversation
    }

    static func make(_ threadId: String, kind: BotConversationContext.Kind, bot: BotSpace, store: BotSpacesStore) -> BotConversationContext {
        let router = Router.shared
        return BotShell.context(threadId: threadId, kind: kind, bot: bot, view: store.view(for: bot.id),
                                push: { router.push($0) },
                                openConversation: { router.openConversation($0) },
                                showList: { router.path = [] },
                                refresh: { Task { await store.refresh() } })
    }
}

// MARK: Two pages

/// The open Duo: the left page is the conversation (or Home in book, when
/// asked for), with Home beside it when flat; the right page is the
/// conversation's Workbench with the rail at its edge.
private struct ShellPages: View {
    let bot: BotSpace
    @ObservedObject var store: BotSpacesStore
    let window: CGSize
    @ObservedObject private var router = Router.shared
    @EnvironmentObject private var app: AppModel
    @Environment(\.shellPosture) private var posture
    /// What's pushed over the left page's conversation offers: in the right page's rail.
    @State private var paneActions: [ScreenAction] = []
    /// And what it puts on the right page in the Workbench's place.
    @State private var paneCompanion: ScreenCompanion?

    static let hinge: CGFloat = 32

    private var conversation: String {
        router.conversation ?? BotShell.mainThreadId(bot, view: store.view(for: bot.id)) ?? ""
    }
    private var homeShown: Bool { router.homePane.shown(posture) }

    var body: some View {
        GeometryReader { proxy in
            let page = max(0, window.width / 2 - Self.hinge / 2 - proxy.safeAreaInsets.leading)
            HStack(spacing: 0) {
                left(width: page)
                    .frame(width: page)
                Color.clear.frame(width: Self.hinge).accessibilityHidden(true)
                let pushed = !panePath.wrappedValue.isEmpty
                ShellWorkbenchPage(threadId: conversation, bot: bot, store: store, homeShown: homeShown,
                                   pushed: pushed, pushedActions: pushed ? paneActions : [],
                                   companion: pushed ? paneCompanion : nil)
                    .frame(maxWidth: .infinity)
            }
        }
        .animation(.snappy(duration: 0.25), value: homeShown)
        .onAppear { hold(heldConversation, releasing: nil) }
        .onChange(of: heldConversation) { old, new in hold(new, releasing: old) }
        .onDisappear { hold(nil, releasing: heldConversation) }
    }

    /// Book with Home over the conversation: its Workbench still shows on the
    /// right page, so the thread stays attached and its Workbench marked shown.
    private var heldConversation: String? {
        posture == .book && homeShown && !conversation.isEmpty ? conversation : nil
    }

    private func hold(_ id: String?, releasing old: String?) {
        if let id, id != old {
            ConversationSessions.shared.session(id).hold(app)
            WorkbenchShown.shared.show(id)
        }
        if let old, old != id {
            ConversationSessions.shared.session(old).stop()
            WorkbenchShown.shared.hide(old)
        }
    }

    @ViewBuilder private func left(width: CGFloat) -> some View {
        if posture == .flat {
            HStack(spacing: 0) {
                if homeShown {
                    homeColumn.frame(width: min(206, (width * 0.38).rounded()))
                    Divider()
                }
                conversationColumn
            }
        } else if homeShown {
            // Home takes the page; the conversation's thread stays held (`holdsConversation`).
            homeColumn
        } else {
            conversationColumn
                .overlay(alignment: .leading) { HomeEdge() }
        }
    }

    private var homeColumn: some View {
        VStack(spacing: 0) {
            ShellTitleLine(title: "Home", posture: posture)
            HomeView(bot: bot, store: store, column: posture == .flat)
        }
        // As the conversation's column: SwiftUI hands it the window's trailing inset, a screen away.
        .ignoresSafeArea(.container, edges: .trailing)
        .accessibilityElement(children: .contain)
        .accessibilityIdentifier("homeColumn")
    }

    private var conversationColumn: some View {
        NavigationStack(path: panePath) {
            ShellDestination(route: .conversation(id: conversation), bot: bot, store: store, pane: true)
                .id(conversation)
                .shellSurface()
                .navigationDestination(for: Route.self) { ShellDestination(route: $0, bot: bot, store: store, pane: true).shellSurface() }
        }
        .onPreferenceChange(ScreenActionsKey.self) { value in
            MainActor.assumeIsolated { if paneActions != value { paneActions = value } }
        }
        .onPreferenceChange(ScreenCompanionKey.self) { value in
            MainActor.assumeIsolated { if paneCompanion != value { paneCompanion = value } }
        }
        .accessibilityElement(children: .contain)
        .accessibilityIdentifier("conversationColumn")
    }

    /// What's pushed over the column's conversation: the stack past it.
    private var panePath: Binding<[Route]> {
        Binding(get: {
            if case .conversation? = router.path.first { return Array(router.path.dropFirst()) }
            return router.path
        }, set: { next in
            if case .conversation? = router.path.first { router.path = [router.path[0]] + next } else { router.path = next }
        })
    }
}

/// Book: a swipe in from the left edge brings Home onto the left page.
private struct HomeEdge: View {
    @ObservedObject private var router = Router.shared
    @Environment(\.shellPosture) private var posture

    var body: some View {
        Color.clear
            .frame(width: 20)
            .frame(maxHeight: .infinity)
            .padding(.vertical, 60)
            .contentShape(.rect)
            .gesture(DragGesture(minimumDistance: 12).onEnded { drag in
                if drag.translation.width > 60, abs(drag.translation.height) < drag.translation.width { router.homePane.toggle(posture) }
            })
            .accessibilityHidden(true)
    }
}

/// The open Duo's right page: the conversation's Workbench under its title
/// line (the tab, which opens the tab menu), the rail at its edge.
private struct ShellWorkbenchPage: View {
    let threadId: String
    let bot: BotSpace
    @ObservedObject var store: BotSpacesStore
    let homeShown: Bool
    /// Something is pushed over the left page's conversation: Back lowest, and its actions in More.
    var pushed = false
    var pushedActions: [ScreenAction] = []
    var companion: ScreenCompanion?
    @ObservedObject private var router = Router.shared
    @State private var workbench = WorkbenchStore.shared
    @State private var addingTab = false
    @Environment(\.shellPosture) private var posture
    @EnvironmentObject private var app: AppModel
    /// Observed, as on `ConversationScreen`: the tab actions in More and the
    /// thread's web link follow them.
    @ObservedObject private var session: ConversationSession
    @ObservedObject private var model: ThreadModel

    init(threadId: String, bot: BotSpace, store: BotSpacesStore, homeShown: Bool, pushed: Bool = false,
         pushedActions: [ScreenAction] = [], companion: ScreenCompanion? = nil) {
        self.threadId = threadId
        self.bot = bot
        self.store = store
        self.homeShown = homeShown
        self.pushed = pushed
        self.pushedActions = pushedActions
        self.companion = companion
        let session = ConversationSessions.shared.session(threadId)
        self.session = session
        model = session.model
    }

    var body: some View {
        Group {
            if let companion {
                companion.view.id(companion.id)
            } else {
                VStack(spacing: 0) {
                    ShellTitleLine(title: workbench.selected(threadId)?.title ?? "Workbench", posture: posture) { tabMenu }
                    WorkbenchView(threadId: threadId, webURL: model.thread.map { app.client.webURL(forThread: $0) },
                                  openThread: { router.push(.thread(id: $0)) },
                                  actionsChanged: { if session.tabActions != $0 { session.tabActions = $0 } })
                }
            }
        }
        .rail(slots, actions: RailActions(tap: tap, tabs: AnyView(tabMenu), more: AnyView(moreMenu)))
        .sheet(isPresented: $addingTab) { WorkbenchNewTab(threadId: threadId) }
        .accessibilityElement(children: .contain)
        .accessibilityIdentifier("workbenchPage")
    }

    private var tabMenu: some View {
        WorkbenchTabMenuItems(threadId: threadId) { addingTab = true }
    }

    /// Something pushed over the conversation: Back lowest and its actions,
    /// then (unless its companion has the page) the Workbench's own buttons.
    private var slots: [RailSlot] {
        let own = RailLayout.slots(posture, screen: .conversation(workbench: true), tabs: workbench.count(threadId), homeShown: homeShown)
        guard pushed else { return own }
        return RailLayout.panePushed(pushedActions, companion: companion != nil, homeShown: homeShown, own: own)
    }

    /// The pushed screen's overflow while one shows over the conversation; else the conversation's menu.
    @ViewBuilder private var moreMenu: some View {
        if pushed, pushedActions.count > 2 {
            ScreenActionItems(actions: RailLayout.overflow(pushedActions))
        } else {
            ConversationMenuItems(session: session, conversation: ShellContext.make(threadId, kind: .conversation, bot: bot, store: store),
                                  tabActions: session.tabActions)
        }
    }

    private func tap(_ slot: RailSlot) {
        switch slot {
        case .back: if !router.path.isEmpty { router.path.removeLast() }
        case .home: withAnimation(.snappy) { router.homePane.toggle(posture) }
        case .new: router.compose = ""
        default: break
        }
    }
}

extension View {
    /// A screen on a shell stack: see-through, so the theme's backdrop behind the shell shows.
    func shellSurface() -> some View {
        containerBackground(.clear, for: .navigation)
    }
}

/// Behind the whole shell, once: the Bot's theme as the desktop shows it.
/// A scene theme's still (Tonight's Sky, Aurora Fjord…) under a veil of its
/// own canvas, darker toward the bottom where text and the composer sit, so
/// text keeps the theme's contrast; a classic theme's canvas. A still, not
/// the live scene: nothing on the phone animates all the time.
struct ShellBackground: View {
    @Environment(\.look) private var look
    @ObservedObject private var store = BotSpacesStore.shared
    @ObservedObject private var router = Router.shared

    var body: some View {
        if look.showsScene {
            let bot = BotShell.shownBot(store.spaces, chosen: router.shownBotId)
            ZStack {
                SceneBackdrop(theme: look.theme, botId: bot?.id, view: bot.flatMap { store.view(for: $0.id) }, stillOnly: true, paused: true, motion: false)
                LinearGradient(stops: [.init(color: look.canvas.opacity(Self.veilTop), location: 0),
                                       .init(color: look.canvas.opacity(Self.veilMid), location: 0.4),
                                       .init(color: look.canvas.opacity(Self.veilBottom), location: 1)],
                               startPoint: .top, endPoint: .bottom)
            }
            .ignoresSafeArea()
            .allowsHitTesting(false)
            .accessibilityHidden(true)
            #if DEBUG
            // A point, not the screen: a full-screen element can hide every control from XCUITest's hit test.
            .overlay(alignment: .topLeading) {
                Color.clear.frame(width: 1, height: 1).accessibilityElement().accessibilityIdentifier("shellScene").accessibilityValue(look.theme.id)
            }
            #endif
        } else {
            look.canvas.ignoresSafeArea()
        }
    }

    /// The veil's strength: the scene reads at the top, text sits on more canvas below.
    static let veilTop = 0.35
    static let veilMid = 0.55
    static let veilBottom = 0.75
}
