import SwiftUI

/// What `ShellRoot` shows before or after Studio's Bots load.
enum ShellBotState: Equatable {
    case loading
    case failed(String)
    case empty
    case ready(BotSpace)

    static func resolve(spaces: BotSpaces?, bot: BotSpace?, error: String?) -> ShellBotState {
        if let bot { return .ready(bot) }
        if spaces != nil { return .empty }
        if let error, !error.isEmpty { return .failed(error) }
        return .loading
    }
}

/// The app once Studio's Bots answer (round 7). Home is the root and every
/// other screen is pushed on its stack, laid out by the posture: one column
/// on the iPhone and the folded or vertical Duo; panes side by side on the
/// open Duo, by width and text size (`ShellPanes`), with the controls in the rail.
struct ShellRoot: View {
    @ObservedObject var store: BotSpacesStore
    @ObservedObject private var router = Router.shared
    @ObservedObject private var looks = LookStore.shared
    @EnvironmentObject private var app: AppModel
    @State private var geometry = ShellGeometry()
    @Environment(\.dynamicTypeSize) private var typeSize

    /// The device's posture as laid out at this width and text size: book
    /// and flat are one column where two panes can't both be readable.
    private var posture: ShellPosture { geometry.posture.laidOut(width: geometry.paneWidth, body: ShellPanes.body(typeSize)) }
    private var bot: BotSpace? { BotShell.shownBot(store.spaces, chosen: router.shownBotId) }

    var body: some View {
        Group {
            switch ShellBotState.resolve(spaces: store.spaces, bot: bot, error: store.error) {
            case .ready(let bot):
                if posture.splitsWorkbench {
                    ShellPages(bot: bot, store: store, width: geometry.paneWidth)
                } else {
                    ShellColumn(bot: bot, store: store)
                }
            case .empty:
                EmptyBotsColumn(store: store, error: nil)
            case .failed(let message):
                EmptyBotsColumn(store: store, error: message)
            case .loading:
                ContentUnavailableView {
                    Label("Loading Home", systemImage: "sparkles")
                } description: {
                    Text("Connecting to BB Studio.")
                }
                .accessibilityIdentifier("shellLoading")
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
        .onChange(of: posture) { _, _ in router.homePane.layoutChanged() }
        .onChange(of: router.conversation) { _, id in
            if let id, let bot { ShellMemory.remember(id, botId: bot.id) }
        }
    }

    private func theme(_ bot: BotSpace) -> LookTheme {
        BotTheme.resolve(botThemeId: router.themeOverride[bot.id] ?? bot.appearance?.themeId, phoneThemeId: looks.themeId,
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
        if ProcessInfo.processInfo.arguments.contains("-qaForgetConversation") { return main }
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

    /// `-qaConversation <id>`: the UI tests open on a conversation, pushed over Home.
    static var qaConversation: String? {
        let arguments = ProcessInfo.processInfo.arguments
        guard let at = arguments.firstIndex(of: "-qaConversation"), arguments.indices.contains(at + 1) else { return nil }
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

/// Home when the server has Studio installed with 0 Bots (or a load error):
/// still mounts the normal NavigationStack so every deep link pushes cleanly.
private struct EmptyBotsColumn: View {
    @ObservedObject var store: BotSpacesStore
    let error: String?
    @ObservedObject private var router = Router.shared
    @Environment(\.shellPosture) private var posture

    var body: some View {
        NavigationStack(path: $router.path) {
            emptyHome
                .shellSurface()
                .navigationDestination(for: Route.self) { ShellNoBotDestination(route: $0).shellSurface() }
        }
    }

    @ViewBuilder private var emptyHome: some View {
        let content = ContentUnavailableView {
            Label(error == nil ? "No Bot yet" : "Couldn't load Bots",
                  systemImage: error == nil ? "sparkles" : "exclamationmark.triangle")
        } description: {
            Text(error ?? "Create a Bot in BB Studio on your computer to start Home here. Studio items, Automations, and Settings still open below.")
        } actions: {
            if error != nil {
                Button("Try Again") { store.retryNow() }
                    .buttonStyle(.borderedProminent)
                    .accessibilityIdentifier("homeBotsRetry")
            } else {
                Button("Refresh") { Task { await store.refresh() } }
                    .buttonStyle(.borderedProminent)
                    .accessibilityIdentifier("homeNoBotsRefresh")
                Button("Studio") { router.open(.studio(kind: nil, nil)) }
                    .accessibilityIdentifier("homeNoBotsStudio")
            }
            Button("Settings") { router.open(.settings) }
                .accessibilityIdentifier("homeNoBotsSettings")
        }
        .accessibilityElement(children: .contain)
        .accessibilityIdentifier(error == nil ? "homeNoBots" : "homeBotsError")

        if posture.usesRail {
            VStack(spacing: 0) {
                ShellTitleLine(title: "Home", posture: posture)
                content
            }
            .toolbar(.hidden, for: .navigationBar)
        } else {
            content
                .navigationTitle("Home")
                .navigationBarTitleDisplayMode(.inline)
        }
    }
}

/// Pushed destinations when the server has 0 Bots (no bot-scoped places).
private struct ShellNoBotDestination: View {
    let route: Route

    var body: some View {
        switch route {
        case .conversation(let id), .thread(let id):
            ConversationScreen(threadId: id, pane: false)
        case .studio:
            StudioView().modifier(PushedChrome(title: route.shellTitle))
        case .settings:
            SettingsView().modifier(PushedChrome(title: route.shellTitle))
        default:
            RouteDestination(route: route).modifier(PushedChrome(title: route.shellTitle))
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
            BotThemePicker(bot: bot, current: router.themeOverride[bot.id] ?? bot.appearance?.themeId ?? "") { themeId in
                BotTheme.choose(themeId, bot: bot, router: router, store: store, app: app)
            }
        case .studio: StudioView()
        case .settings: SettingsView()
        case .memorySkill(let botId, let name): MemorySkillRoute(botId: botId, name: name)
        case .memoryNewSkill(let botId): NewSkillScreen(store: MemoryStore.shared(botId: botId, client: app.client))
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

// MARK: Side by side

/// The open Duo (book or flat): the conversation, the Workbench beside it
/// when it has a tab the phone can show (or what a pushed screen puts in
/// its place), and Home beside them when it fits, each as wide as
/// `ShellPanes` decides. Home that doesn't fit comes over the conversation
/// from the rail. The rail is at the right edge.
private struct ShellPages: View {
    let bot: BotSpace
    @ObservedObject var store: BotSpacesStore
    @ObservedObject private var router = Router.shared
    @State private var workbench = WorkbenchStore.shared
    @EnvironmentObject private var app: AppModel
    @Environment(\.dynamicTypeSize) private var typeSize
    /// What's pushed over the conversation offers: in the rail.
    @State private var paneActions: [ScreenAction] = []
    /// And what it puts in the side pane in the Workbench's place.
    @State private var paneCompanion: ScreenCompanion?
    /// The room left of the rail (`ShellGeometry.paneWidth`): the one the posture was laid out for.
    let width: CGFloat
    @Environment(\.shellPosture) private var posture

    private var conversation: String {
        router.conversation ?? BotShell.mainThreadId(bot, view: store.view(for: bot.id)) ?? ""
    }
    private var pushed: Bool { !panePath.wrappedValue.isEmpty }
    private var companion: ScreenCompanion? { pushed ? paneCompanion : nil }
    private var bodySize: CGFloat { ShellPanes.body(typeSize) }

    private var panes: ShellPanes {
        ShellPanes.make(width: width, body: bodySize, side: companion != nil || workbench.selected(conversation) != nil,
                        home: !router.homePane.hidden)
    }

    var body: some View {
        let panes = panes
        let overlaid = !panes.homeFits && router.homePane.overlaid
        HStack(spacing: 0) {
            if panes.home > 0 {
                homeColumn.frame(width: panes.home)
            }
            conversationColumn
                .frame(width: panes.conversation)
                .environment(\.shellPaneAtRail, panes.side == 0)
                // Under Home, out of VoiceOver's reach where SwiftUI's hiding reaches its UIKit host.
                .accessibilityHidden(overlaid)
                .overlay(alignment: .leading) { if panes.home > 0 { Divider() } }
                .overlay(alignment: .leading) { if panes.home == 0, !overlaid { HomeEdge(fits: panes.homeFits) } }
            if panes.side > 0 {
                ShellSidePane(threadId: conversation, companion: companion)
                    .frame(width: panes.side)
                    .overlay(alignment: .leading) { Divider() }
            }
        }
        .frame(maxWidth: .infinity, alignment: .leading)
        .overlay(alignment: .leading) {
            if overlaid {
                HomeOverlay(width: ShellPanes.overlayWidth(width: width, body: bodySize)) { homeColumn }
                    .transition(.move(edge: .leading).combined(with: .opacity))
            }
        }
        .modifier(ShellPagesRail(threadId: conversation, bot: bot, store: store, homeFits: panes.homeFits,
                                 homeShown: router.homePane.shown(fits: panes.homeFits),
                                 pushed: pushed, pushedActions: pushed ? paneActions : [], companion: companion != nil))
        .animation(.snappy(duration: 0.25), value: panes)
        .animation(.snappy(duration: 0.25), value: overlaid)
        // The side pane follows the Workbench's tabs, shown or not.
        .task(id: conversation) {
            workbench.attach(app.realtime)
            await workbench.load(conversation)
        }
    }

    private var homeColumn: some View {
        VStack(spacing: 0) {
            ShellTitleLine(title: "Home", posture: posture)
            HomeView(bot: bot, store: store, column: true)
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

/// Home over the conversation, from its leading edge, where it doesn't fit
/// beside it; a tap beside it, a pick in it, the rail's Home or VoiceOver's
/// escape closes it.
private struct HomeOverlay<Home: View>: View {
    let width: CGFloat
    @ViewBuilder var home: Home
    @ObservedObject private var router = Router.shared
    @Environment(\.look) private var look

    var body: some View {
        HStack(spacing: 0) {
            home
                .frame(width: width)
                .background(look.canvas)
                .overlay(alignment: .trailing) { Divider() }
                .shadow(color: .black.opacity(0.3), radius: 12)
                .accessibilityAction(.escape) { router.homePane.toggle(fits: false) }
            Color.black.opacity(0.25)
                .contentShape(.rect)
                .onTapGesture { router.homePane.toggle(fits: false) }
                .accessibilityHidden(true)
        }
    }
}

/// A swipe in from the conversation's left edge shows Home (or brings it over).
private struct HomeEdge: View {
    let fits: Bool
    @ObservedObject private var router = Router.shared

    var body: some View {
        Color.clear
            .frame(width: 20)
            .frame(maxHeight: .infinity)
            .padding(.vertical, 60)
            .contentShape(.rect)
            .gesture(DragGesture(minimumDistance: 12).onEnded { drag in
                if drag.translation.width > 60, abs(drag.translation.height) < drag.translation.width {
                    withAnimation(.snappy) { router.homePane.toggle(fits: fits) }
                }
            })
            .accessibilityHidden(true)
    }
}

/// The side pane: the conversation's Workbench under its title line (the
/// tab, which opens the tab menu), or what a pushed screen puts there.
private struct ShellSidePane: View {
    let threadId: String
    let companion: ScreenCompanion?
    @ObservedObject private var router = Router.shared
    @State private var workbench = WorkbenchStore.shared
    @State private var addingTab = false
    @EnvironmentObject private var app: AppModel
    @Environment(\.shellPosture) private var posture
    @ObservedObject private var session: ConversationSession
    @ObservedObject private var model: ThreadModel

    init(threadId: String, companion: ScreenCompanion?) {
        self.threadId = threadId
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
                    ShellTitleLine(title: workbench.selected(threadId)?.title ?? "Workbench", posture: posture) {
                        WorkbenchTabMenuItems(threadId: threadId) { addingTab = true }
                    }
                    WorkbenchView(threadId: threadId, webURL: model.thread.map { app.client.webURL(forThread: $0) },
                                  openThread: { router.push(.thread(id: $0)) },
                                  actionsChanged: { if session.tabActions != $0 { session.tabActions = $0 } })
                }
            }
        }
        .sheet(isPresented: $addingTab) { WorkbenchNewTab(threadId: threadId) }
        .accessibilityElement(children: .contain)
        .accessibilityIdentifier("workbenchPage")
    }
}

/// The open Duo's rail: Tabs, Home, New and More for the conversation; Back
/// and a pushed screen's actions first while one shows over it.
private struct ShellPagesRail: ViewModifier {
    let threadId: String
    let bot: BotSpace
    @ObservedObject var store: BotSpacesStore
    let homeFits: Bool
    let homeShown: Bool
    var pushed = false
    var pushedActions: [ScreenAction] = []
    /// The pushed screen has the side pane: the rail keeps Home alone after its own.
    var companion = false
    @ObservedObject private var router = Router.shared
    @State private var workbench = WorkbenchStore.shared
    @State private var addingTab = false
    @Environment(\.shellPosture) private var posture
    /// Observed, as on `ConversationScreen`: the tab actions in More follow it.
    @ObservedObject private var session: ConversationSession

    init(threadId: String, bot: BotSpace, store: BotSpacesStore, homeFits: Bool, homeShown: Bool, pushed: Bool,
         pushedActions: [ScreenAction], companion: Bool) {
        self.threadId = threadId
        self.bot = bot
        self.store = store
        self.homeFits = homeFits
        self.homeShown = homeShown
        self.pushed = pushed
        self.pushedActions = pushedActions
        self.companion = companion
        session = ConversationSessions.shared.session(threadId)
    }

    func body(content: Content) -> some View {
        content
            .rail(slots, actions: RailActions(tap: tap, tabs: AnyView(tabMenu), more: AnyView(moreMenu)))
            .sheet(isPresented: $addingTab) { WorkbenchNewTab(threadId: threadId) }
    }

    private var tabMenu: some View {
        WorkbenchTabMenuItems(threadId: threadId) { addingTab = true }
    }

    private var slots: [RailSlot] {
        let own = RailLayout.slots(posture, screen: .conversation(workbench: true), tabs: workbench.count(threadId), homeShown: homeShown)
        guard pushed else { return own }
        return RailLayout.panePushed(pushedActions, companion: companion, homeShown: homeShown, own: own)
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
        case .home: withAnimation(.snappy) { router.homePane.toggle(fits: homeFits) }
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
