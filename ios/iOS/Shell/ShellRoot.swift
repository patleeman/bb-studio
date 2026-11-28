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

/// The app once Studio's Bots answer (round 8, native as Kensico): the
/// system's tab bar (Home, Library, Memory, Search), one stack per tab with
/// native bars. Home's tab is laid out by the posture: one column on the
/// iPhone and the folded or vertical Duo; panes side by side on the open
/// Duo, by width and text size (`ShellPanes`).
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
                ShellTabs(bot: bot, store: store, width: geometry.paneWidth)
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
        .environment(\.shellInnerScreen, geometry.innerScreen || posture.innerScreen)
        .background { ShellBackground() }
        // The vertical Duo is a big iPhone: type a step up (9f: 18 pt body), never down.
        .dynamicTypeSize(posture.largeType ? .xLarge ... .accessibility5 : .xSmall ... .accessibility5)
        .lookRoot(bot: bot, theme: bot.map(theme))
        .background(ShellGeometryReader { geometry = $0 }.accessibilityHidden(true))
        .task(id: store.spaces) { await LookExport.run(store: store, client: app.client) }
        .onAppear { land() }
        .onChange(of: store.spaces) { _, _ in land() }
        .onChange(of: store.views) { _, _ in land() }
        .onChange(of: router.pending, initial: true) { _, _ in router.consume(store) }
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

// MARK: Tabs

/// The tabs, as Kensico's: SwiftUI's TabView with the tab bar only. The
/// system draws it (on the folded Duo, as the capsule in the reserved right
/// column). Home holds the conversations; Library and Memory are the Bot's
/// places; Search finds across them. As UIKit's tab bar controller, a
/// visited tab stays mounted while another shows (its stack, a conversation
/// still listening), so going back is instant and nothing is missed; the
/// cost is memory for what's pushed in tabs out of sight.
private struct ShellTabs: View {
    let bot: BotSpace
    @ObservedObject var store: BotSpacesStore
    let width: CGFloat
    @ObservedObject private var router = Router.shared

    var body: some View {
        TabView(selection: $router.tab) {
            Tab("Home", systemImage: "house", value: ShellTab.home) {
                HomeTab(bot: bot, store: store, width: width)
            }
            Tab("Library", systemImage: BotPage.library.symbol, value: ShellTab.library) {
                ShellStack(path: $router.libraryPath, bot: bot, store: store) { LibraryPageView(botId: bot.id) }
            }
            Tab("Memory", systemImage: BotPage.memory.symbol, value: ShellTab.memory) {
                MemoryTab(bot: bot, store: store, width: width)
            }
            Tab(value: ShellTab.search, role: .search) {
                ShellStack(path: $router.searchPath, bot: bot, store: store) { HomeSearchView(bot: bot, store: store) }
            }
        }
        .tabViewStyle(.tabBarOnly)
        .sensoryFeedback(.selection, trigger: router.tab)
    }
}

/// One tab's stack: its root, and every route pushed over it.
private struct ShellStack<Root: View>: View {
    @Binding var path: [Route]
    let bot: BotSpace
    @ObservedObject var store: BotSpacesStore
    @ViewBuilder var root: Root

    var body: some View {
        NavigationStack(path: $path) {
            root
                .shellSurface()
                .navigationDestination(for: Route.self) { ShellDestination(route: $0, bot: bot, store: store).shellSurface() }
        }
    }
}

/// Home's tab: Home with everything pushed over it, or beside two pages, the panes.
private struct HomeTab: View {
    let bot: BotSpace
    @ObservedObject var store: BotSpacesStore
    let width: CGFloat
    @ObservedObject private var router = Router.shared
    @Environment(\.shellPosture) private var posture

    var body: some View {
        if posture.splitsWorkbench {
            ShellPages(bot: bot, store: store, width: width)
        } else {
            ShellStack(path: $router.path, bot: bot, store: store) { HomeScreen(bot: bot, store: store) }
        }
    }
}

/// Memory's tab: one stack. Beside two pages, Core is page one, with a
/// title of its own, and Skills | History page two, the tab's stack: its bar
/// (the layer switch, Search, + New skill) and what they open. The one
/// `memoryPath` either way, so folding or unfolding keeps what's pushed.
private struct MemoryTab: View {
    let bot: BotSpace
    @ObservedObject var store: BotSpacesStore
    /// The room between the safe areas; page one takes half.
    let width: CGFloat
    @ObservedObject private var router = Router.shared
    @EnvironmentObject private var app: AppModel
    @Environment(\.shellPosture) private var posture

    var body: some View {
        if posture.splitsWorkbench {
            let memory = MemoryStore.shared(botId: bot.id, client: app.client)
            HStack(spacing: 0) {
                CoreLayerView(store: memory)
                    .paneBar { Text("Memory").font(.headline).accessibilityAddTraits(.isHeader) }
                    .frame(width: (width / 2).rounded())
                    // A page left of another: SwiftUI hands it the window's trailing inset, a page away.
                    .ignoresSafeArea(.container, edges: .trailing)
                    .accessibilityElement(children: .contain)
                    .accessibilityIdentifier("memory-page")
                ShellStack(path: $router.memoryPath, bot: bot, store: store) {
                    MemoryBrowsePane(store: memory, open: router.open(item:))
                }
                .overlay(alignment: .leading) { Divider() }
            }
        } else {
            ShellStack(path: $router.memoryPath, bot: bot, store: store) {
                MemoryPageView(botId: bot.id, open: router.open(item:))
            }
        }
    }
}

/// Home when the server has Studio installed with 0 Bots (or a load error):
/// still mounts the normal NavigationStack so every deep link pushes cleanly.
private struct EmptyBotsColumn: View {
    @ObservedObject var store: BotSpacesStore
    let error: String?
    @ObservedObject private var router = Router.shared

    var body: some View {
        NavigationStack(path: $router.path) {
            emptyHome
                .navigationTitle("Home")
                .navigationBarTitleDisplayMode(.large)
                .shellSurface()
                .navigationDestination(for: Route.self) {
                    ShellNoBotDestination(route: $0).navigationBarTitleDisplayMode(.inline).shellSurface()
                }
        }
    }

    private var emptyHome: some View {
        ContentUnavailableView {
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
    }
}

/// Pushed destinations when the server has 0 Bots (no bot-scoped places).
private struct ShellNoBotDestination: View {
    let route: Route

    var body: some View {
        switch route {
        case .conversation(let id), .thread(let id): ConversationScreen(threadId: id)
        case .studio: StudioView()
        case .settings: SettingsView()
        case .newConversation(let text): NewThreadView(text: text, keepsDraft: true)
        default: RouteDestination(route: route)
        }
    }
}

/// Home at the root of its tab: a large title, and New conversation in the bar.
private struct HomeScreen: View {
    let bot: BotSpace
    @ObservedObject var store: BotSpacesStore

    var body: some View {
        HomeView(bot: bot, store: store)
            .navigationTitle("Home")
            .navigationBarTitleDisplayMode(.large)
            .toolbar { ToolbarItem(placement: .primaryAction) { NewConversationButton() } }
    }
}

/// New conversation, in Home's bar and the open Duo's conversation column.
private struct NewConversationButton: View {
    var body: some View {
        Button { Router.shared.newConversation() } label: { Label("New conversation", systemImage: "square.and.pencil") }
            .accessibilityIdentifier("homeNew")
    }
}

/// A screen pushed on a tab's stack, by its route. Inline titles: a screen
/// that wants a large one says so itself.
struct ShellDestination: View {
    let route: Route
    let bot: BotSpace
    @ObservedObject var store: BotSpacesStore
    var pane = false
    @ObservedObject private var router = Router.shared
    @EnvironmentObject private var app: AppModel

    var body: some View {
        Group {
            switch route {
            case .conversation(let id):
                ConversationScreen(threadId: id, pane: pane)
                    .environment(\.botConversation, ShellContext.make(id, kind: .conversation, bot: bot, store: store))
            case .thread(let id):
                ConversationScreen(threadId: id, pane: pane)
                    .environment(\.botConversation, ShellContext.make(id, kind: ShellContext.kind(id, bot: bot, store: store),
                                                                     bot: bot, store: store))
            default:
                other
            }
        }
        .navigationBarTitleDisplayMode(.inline)
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
        case .newConversation(let text):
            NewThreadView(text: text, botId: bot.id, keepsDraft: true) { id, botId in started(id, botId: botId) }
        default:
            RouteDestination(route: route)
                .environment(\.botConversation, ShellContext.make(BotShell.mainThreadId(bot, view: store.view(for: bot.id)) ?? "",
                                                                 kind: .conversation, bot: bot, store: store))
        }
    }
}

extension ShellDestination {
    /// New conversation started: with this Bot it opens here; with another, that Bot's Home opens on it.
    private func started(_ id: String, botId: String?) {
        Task {
            if let botId, botId != bot.id { store.watch(botId, fetch: false) }
            await store.refresh()
            if let botId, botId != bot.id { router.show(botId, store: store) }
            router.openConversation(id)
            router.focusInput()
        }
    }
}

/// One of the Bot's places, pushed: Schedules, Archive (Memory and Library are tabs).
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
                                showList: { router.home([]) },
                                refresh: { Task { await store.refresh() } })
    }
}

// MARK: Side by side

/// Home's tab on the open Duo (book or flat), as Kensico's two pages: Home's
/// column, then the conversation's stack to the window's trailing edge. The
/// conversation is the stack's root (no Back to an empty page); what it opens
/// pushes over it. Each screen on the stack lays out as a page and, for a
/// conversation or a worker with a tab the phone can show, that thread's
/// Workbench beside it (`PaneSplit`), as wide as `ShellPanes` decides.
///
/// One stack, at the trailing edge in every state: the system puts that
/// stack's bar buttons (Home, the Workbench, New, ⋯) in the Duo's control
/// strip, and any other stack's inline in its bar, so a stack short of the
/// edge left them floating mid-screen and Home's button at its top-left.
/// Home has a bar-height title of its own (`PaneBar`). Home that doesn't fit
/// comes over the conversation from Home's button or the edge swipe.
private struct ShellPages: View {
    let bot: BotSpace
    @ObservedObject var store: BotSpacesStore
    @ObservedObject private var router = Router.shared
    @State private var workbench = WorkbenchStore.shared
    @State private var choice = WorkbenchPaneChoice.shared
    @EnvironmentObject private var app: AppModel
    @Environment(\.dynamicTypeSize) private var typeSize
    /// The room between the safe areas (`ShellGeometry.paneWidth`): the one the posture was laid out for.
    let width: CGFloat

    private var conversation: String {
        router.conversation ?? BotShell.mainThreadId(bot, view: store.view(for: bot.id)) ?? ""
    }
    private var pushed: Bool { !panePath.wrappedValue.isEmpty }
    private var bodySize: CGFloat { ShellPanes.body(typeSize) }

    /// The screen on top of the stack: Home's width follows its side pane.
    private var top: Route { panePath.wrappedValue.last ?? .conversation(id: conversation) }

    private var panes: ShellPanes {
        ShellPanes.make(width: width, body: bodySize, side: PaneSplit.showsSide(top, workbench: workbench, choice: choice),
                        home: !router.homePane.hidden)
    }

    var body: some View {
        let panes = panes
        let overlaid = !panes.homeFits && router.homePane.overlaid
        // Not over a pushed screen: the edge is its Back swipe there.
        let edgeSwipe = panes.home == 0 && !overlaid && !pushed
        HStack(spacing: 0) {
            if panes.home > 0 {
                homeColumn.frame(width: panes.home)
            }
            stack(panes)
                .frame(width: panes.stack)
                .overlay(alignment: .leading) { if panes.home > 0 { Divider() } }
                .gesture(HomeEdgePan(enabled: edgeSwipe, fits: panes.homeFits))
        }
        .frame(maxWidth: .infinity, alignment: .leading)
        // Under Home (both panes): out of VoiceOver's reach, the transcript's UIKit views too.
        .environment(\.shellCovered, overlaid)
        .environment(\.transcriptCovered, overlaid)
        #if DEBUG
        .overlay(alignment: .topLeading) { HomeEdgeMarker(enabled: edgeSwipe) }
        .background(ShellPagesReport(panes: panes))
        #endif
        .overlay(alignment: .leading) {
            if overlaid {
                HomeOverlay(width: ShellPanes.overlayWidth(width: width, body: bodySize)) { homeColumn }
                    .transition(.move(edge: .leading).combined(with: .opacity))
            }
        }
        .animation(.snappy(duration: 0.25), value: panes)
        .animation(.snappy(duration: 0.25), value: overlaid)
        .onChange(of: overlaid) { _, over in HomeOverlayFocus.changed(over: over) }
        // Side by side again, or Home now fits beside the others (the last
        // tab the phone shows closed, the text got smaller), or no longer does.
        .onChange(of: panes.homeFits, initial: true) { _, _ in
            if router.homePane.overlaid { router.homePane.layoutChanged() }
        }
        // The side pane follows the Workbench's tabs, shown or not.
        .task(id: conversation) {
            workbench.attach(app.realtime)
            await workbench.load(conversation)
        }
    }

    private var homeColumn: some View {
        HomeView(bot: bot, store: store, column: true)
            .paneBar { Text("Home").font(.headline).accessibilityAddTraits(.isHeader) }
            // As the conversation's column: SwiftUI hands it the window's trailing inset, a screen away.
            .ignoresSafeArea(.container, edges: .trailing)
            .accessibilityElement(children: .contain)
            .accessibilityIdentifier("homeColumn")
    }

    private func stack(_ panes: ShellPanes) -> some View {
        NavigationStack(path: panePath) {
            page(.conversation(id: conversation), panes: panes)
                .id(conversation)
                .navigationDestination(for: Route.self) { page($0, panes: panes) }
        }
        .accessibilityElement(children: .contain)
        .accessibilityIdentifier("conversationColumn")
        .modifier(ShellCovered())
    }

    /// A screen on the stack: its page, its Workbench, and the shell's buttons,
    /// the same on every screen so the control strip never changes under the thumb.
    private func page(_ route: Route, panes: ShellPanes) -> some View {
        PaneSplit(route: route, bot: bot, store: store, stack: panes.stack, bodySize: bodySize)
            .toolbar {
                ToolbarItem(placement: .topBarTrailing) {
                    HomePaneButton(fits: panes.homeFits, shown: panes.home > 0 || router.homePane.overlaid)
                }
                ToolbarItem(placement: .topBarTrailing) { NewConversationButton() }
            }
            .shellSurface()
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

/// A screen on the open Duo's stack, as wide as the stack: a conversation or
/// a worker with its Workbench beside it (when it has a tab the phone can
/// show and isn't hidden by hand), anything else alone. The stack's bar
/// spans both: the conversation's title is two, its own over its page and
/// the Workbench's tab menu over the pane (`shellSideWidth`).
private struct PaneSplit: View {
    let route: Route
    let bot: BotSpace
    @ObservedObject var store: BotSpacesStore
    /// The stack's width.
    let stack: CGFloat
    let bodySize: CGFloat
    @State private var workbench = WorkbenchStore.shared
    @State private var choice = WorkbenchPaneChoice.shared

    /// The thread a screen shows: its Workbench is the side pane's.
    static func thread(_ route: Route) -> String? {
        switch route {
        case .conversation(let id), .thread(let id): id
        default: nil
        }
    }

    @MainActor static func showsSide(_ route: Route, workbench: WorkbenchStore, choice: WorkbenchPaneChoice) -> Bool {
        guard let id = thread(route) else { return false }
        return workbench.selected(id) != nil && choice.shown(id)
    }

    var body: some View {
        let side = Self.showsSide(route, workbench: workbench, choice: choice) ? Self.thread(route) : nil
        let split = ShellPanes.split(stack: stack, body: bodySize, side: side != nil)
        HStack(spacing: 0) {
            ShellDestination(route: route, bot: bot, store: store, pane: true)
                .frame(width: split.conversation)
                .environment(\.shellPaneAtEdge, split.side == 0)
                .environment(\.shellSideWidth, split.side)
            if let side, split.side > 0 {
                ShellSidePane(threadId: side)
                    .id(side)
                    .frame(width: split.side)
                    .overlay(alignment: .leading) { Divider().ignoresSafeArea() }
                    .transition(.move(edge: .trailing).combined(with: .opacity))
            }
        }
        .animation(.snappy(duration: 0.25), value: split.side)
    }
}

/// Home's column shown or hidden beside the conversation, or brought over it where it doesn't fit.
private struct HomePaneButton: View {
    let fits: Bool
    let shown: Bool

    var body: some View {
        Button { Router.shared.homePane.toggle(fits: fits) } label: {
            Label(shown ? "Hide Home" : "Home", systemImage: "sidebar.leading")
        }
        .accessibilityIdentifier("homePane")
    }
}

/// Home over the conversation, from its leading edge, where it doesn't fit
/// beside it; a tap beside it, a pick in it, the bar's Home or VoiceOver's
/// escape closes it. Modal to VoiceOver: the dimmed panes are out of reach,
/// and the dimming is its close button.
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
            Color(white: 0, opacity: 0.25)
                .contentShape(.rect)
                .onTapGesture { close() }
                .accessibilityElement()
                .accessibilityLabel("Close Home")
                .accessibilityAddTraits(.isButton)
                .accessibilityAction { close() }
                .accessibilityIdentifier("homeOverlayScrim")
        }
        .accessibilityElement(children: .contain)
        .accessibilityAddTraits(.isModal)
        .accessibilityAction(.escape) { close() }
    }

    private func close() { router.homePane.toggle(fits: false) }
}

/// What opening or closing Home over the conversation does beyond showing it.
@MainActor
enum HomeOverlayFocus {
    static func changed(over: Bool) {
        // The composer's keyboard (and a hardware keyboard's typing) stays with the conversation under Home.
        if over { UIApplication.shared.sendAction(#selector(UIResponder.resignFirstResponder), to: nil, from: nil, for: nil) }
        // VoiceOver moves into Home, or back to the conversation.
        UIAccessibility.post(notification: .screenChanged, argument: nil)
    }
}

/// A swipe in from the screen's left edge, over the conversation, shows
/// Home (or brings it over). A screen-edge pan: it starts only on a
/// sideways drag from the edge, so taps there (the composer's +) go through.
private struct HomeEdgePan: UIGestureRecognizerRepresentable {
    let enabled: Bool
    let fits: Bool

    func makeUIGestureRecognizer(context: Context) -> UIScreenEdgePanGestureRecognizer {
        let pan = UIScreenEdgePanGestureRecognizer()
        pan.edges = .left
        return pan
    }

    func updateUIGestureRecognizer(_ recognizer: UIScreenEdgePanGestureRecognizer, context: Context) {
        recognizer.isEnabled = enabled
    }

    func handleUIGestureRecognizerAction(_ recognizer: UIScreenEdgePanGestureRecognizer, context: Context) {
        guard recognizer.state == .ended else { return }
        let drag = recognizer.translation(in: recognizer.view)
        if drag.x > 60, abs(drag.y) < drag.x { Router.shared.homePane.toggle(fits: fits) }
    }
}

#if DEBUG
/// For the UI tests (`qa-duo/counts`): the panes as laid out, and where the
/// shell starts in the window. The simulator stands in for the inner screen
/// with a window stretched past its outer screen, where the system's tab
/// view places its content 44 points left and a stack's bar runs into its
/// inset; the tests measure the pages from these instead.
private struct ShellPagesReport: View {
    let panes: ShellPanes

    var body: some View {
        GeometryReader { proxy in
            let minX = proxy.frame(in: .global).minX
            Color.clear.onChange(of: [minX, panes.home, panes.conversation, panes.side, CGFloat(Router.shared.path.count)], initial: true) { _, _ in
                RenderCount.set("pages.minX", Int(minX.rounded()))
                RenderCount.set("pages.home", Int(panes.home))
                RenderCount.set("pages.conversation", Int(panes.conversation))
                RenderCount.set("pages.side", Int(panes.side))
                RenderCount.set("pages.pushed", Router.shared.path.count)
            }
        }
    }
}

/// A point for the UI tests: whether the edge swipe would open Home.
private struct HomeEdgeMarker: View {
    let enabled: Bool

    var body: some View {
        Color.clear.frame(width: 1, height: 1)
            .accessibilityElement()
            .accessibilityIdentifier("homeEdge")
            .accessibilityValue(enabled ? "on" : "off")
    }
}
#endif

/// The side pane: a thread's Workbench, beside it on the open Duo's stack,
/// under the stack's bar, whose title over it is the shown tab
/// (`ConversationScreen`). Its tab's actions are in that thread's ⋯.
private struct ShellSidePane: View {
    let threadId: String
    @ObservedObject private var router = Router.shared
    @EnvironmentObject private var app: AppModel
    @ObservedObject private var session: ConversationSession
    @ObservedObject private var model: ThreadModel

    init(threadId: String) {
        self.threadId = threadId
        let session = ConversationSessions.shared.session(threadId)
        self.session = session
        model = session.model
    }

    var body: some View {
        // On the stack, as in the chat's place on the iPhone: a link in a tab
        // (a page's related item) pushes over the conversation. No stack of
        // its own: a nested stack's hidden bar hides the stack's, buttons and all.
        WorkbenchView(threadId: threadId, webURL: model.thread.map { app.client.webURL(forThread: $0) },
                      openThread: { router.push(.thread(id: $0)) },
                      actionsChanged: { if session.tabActions != $0 { session.tabActions = $0 } })
            .accessibilityElement(children: .contain)
            .accessibilityIdentifier("workbenchPage")
            .modifier(ShellCovered())
    }
}

/// The top of a page beside the stack on the open Duo (Home, Memory's Core):
/// its title at a bar's height. Such a page has no stack of its own: the
/// control strip takes one stack's bar buttons, the one at the trailing edge.
private struct PaneBar<Title: View>: ViewModifier {
    @ViewBuilder var title: Title

    func body(content: Content) -> some View {
        content.safeAreaInset(edge: .top, spacing: 0) {
            title
                .frame(maxWidth: .infinity, minHeight: 44)
                .background(.bar)
                .overlay(alignment: .bottom) { Divider() }
        }
    }
}

extension View {
    func paneBar(@ViewBuilder _ title: () -> some View) -> some View {
        modifier(PaneBar(title: title))
    }
}

/// A pane under Home over the conversation: hidden from VoiceOver, besides
/// being outside Home's modal (the pane's own hiding: a container's doesn't reach it).
private struct ShellCovered: ViewModifier {
    @Environment(\.shellCovered) private var covered

    func body(content: Content) -> some View {
        content.accessibilityHidden(covered)
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
