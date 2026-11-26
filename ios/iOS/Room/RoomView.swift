import SwiftUI

@MainActor
final class RoomSession: ObservableObject {
    let threadId: String
    let model: ThreadModel
    let talk: HoldToTalk
    weak var transcript: TranscriptHandle?

    init(threadId: String) {
        self.threadId = threadId
        model = ThreadModel(threadId: threadId)
        talk = HoldToTalk(threadId: threadId)
    }

    private var attached = false

    func start(_ app: AppModel) async {
        if !attached {
            attached = true
            model.attach(app)
        }
        talk.send = { [model, app] text in
            Task { if await !model.send(text) { app.flash("It didn't send. Try again from the conversation.") } }
        }
        await model.load()
    }

    func stop() {
        guard attached else { return }
        attached = false
        model.detach()
    }
}

enum RoomQA {
    static var reduceMotion: Bool {
        #if DEBUG
        ProcessInfo.processInfo.arguments.contains("-qaReduceMotion")
        #else
        false
        #endif
    }

    /// `-qaRoomMode settings|<place>`: opens Settings or a place over the conversation.
    static var mode: String? { value("-qaRoomMode") }

    static func value(_ flag: String) -> String? {
        #if DEBUG
        let arguments = ProcessInfo.processInfo.arguments
        guard let at = arguments.firstIndex(of: flag), arguments.indices.contains(at + 1) else { return nil }
        return arguments[at + 1]
        #else
        nil
        #endif
    }
}

struct RoomView: View {
    @ObservedObject private var router = Router.shared
    @EnvironmentObject private var app: AppModel
    @ObservedObject var store: BotSpacesStore
    let bot: BotSpace
    let mainThreadId: String
    let pages: DuoPages?
    @StateObject private var pager: RoomSessions
    @State private var pageOffset: CGFloat = 0
    @State private var slide: Edge = .trailing
    @State private var toast: String?
    /// New conversation over the room: the unfolded Duo's context pane, and New thread from anywhere else (Siri, ⌘N, a link).
    @State private var startingConversation = false
    @State private var composeText = ""
    @State private var settingsOpen = false
    /// The unfolded Duo (round 5): Home on the left and the live conversation
    /// on the right, or the conversation on the left and its Workspace on the right.
    @State private var duoHome = true
    /// A worker opened live on the right screen, in place of the Workspace.
    @State private var duoWorker: String?
    /// Asked to show a conversation (a link, a pick, a Bot switch that opens
    /// one): the room's opening (Main, or the last one) doesn't replace it.
    @State private var focused = false
    @Environment(\.look) private var look
    @Environment(\.accessibilityReduceMotion) private var systemReduceMotion
    @Environment(\.scenePhase) private var phase
    @Environment(\.duoLayout) private var layout

    init(store: BotSpacesStore, bot: BotSpace, mainThreadId: String, pages: DuoPages? = nil) {
        self.store = store
        self.bot = bot
        self.mainThreadId = mainThreadId
        self.pages = pages
        _pager = StateObject(wrappedValue: RoomSessions(main: mainThreadId))
    }

    private var session: RoomSession { pager.current }
    private var columnHeader: Bool { FoldedChrome.columnHeader }
    private var order: [String] { RoomPager.order(main: mainThreadId, conversations: view?.conversations ?? []) }
    private var isMain: Bool { pager.shown == mainThreadId }
    private var shownConversation: BotConversation? {
        isMain ? nil : view?.conversations.first { $0.threadId == pager.shown }
    }
    private var light: RoomLight { RoomLight.lights(order: order, main: mainThreadId)[pager.shown] ?? .natural }

    private var view: BotThreadsView? { store.view(for: bot.id) }
    private var reduceMotion: Bool { systemReduceMotion || RoomQA.reduceMotion }
    var body: some View {
        lifecycle(polling(routing(canvas)))
            .modifier(TalkLifecycle(talk: session.talk))
            .sheet(isPresented: $startingConversation) {
                NewThreadView(text: composeText, botId: bot.id) { id, botId in
                    Task {
                        if let botId, botId != bot.id { store.watch(botId, fetch: false) }
                        await store.refresh()
                        guard let botId else { return openItem(.worker(id)) }
                        if botId == bot.id { openItem(.conversation(id)) } else { switchTo(botId, opening: id) }
                    }
                }
            }
    }

    private var canvas: some View {
        GeometryReader { proxy in
            if let pages {
                duo(proxy, pages)
            } else {
                folded(proxy)
            }
        }
    }

    private func routing<Content: View>(_ content: Content) -> some View {
        content
            .onChange(of: pages) { _, _ in pagesChanged() }
            .onChange(of: router.request, initial: true) { _, request in take(request) }
            .onChange(of: router.detailPath) { _, path in detailPathChanged(path) }
            .onChange(of: order) { old, new in orderChanged(old, new) }
    }

    private func polling<Content: View>(_ content: Content) -> some View {
        content
            .onChange(of: bot.appearance?.themeId) { _, saved in themeSaved(saved) }
    }

    private func lifecycle<Content: View>(_ content: Content) -> some View {
        content
            .task { applyQAMode() }
            .task(id: pager.shown) {
                RoomHome.remember(pager.shown, botId: bot.id)
                await session.start(app)
            }
            .onDisappear { pager.current.stop() }
            .overlay(alignment: .top) { toastView }
            .task { await showToast() }
    }

    @ViewBuilder private var toastView: some View {
        if let toast {
            Text(toast).font(.headline).foregroundStyle(.white)
                .padding(.horizontal, 16).padding(.vertical, 8)
                .background(.black.opacity(0.45), in: .capsule)
                .padding(.top, 60)
                .transition(.opacity)
                .accessibilityIdentifier("roomBotToast")
        }
    }

    private func pagesChanged() {
        UIApplication.shared.sendAction(#selector(UIResponder.resignFirstResponder), to: nil, from: nil, for: nil)
        if pages != nil, router.tab == .settings {
            router.tab = .bot
            settingsOpen = true
        } else if pages == nil, settingsOpen {
            settingsOpen = false
            router.tab = .settings
        }
    }

    /// What the router asks of the room: a place, a conversation, the list or New conversation.
    private func take(_ request: RoomRequest?) {
        guard let request else { return }
        router.request = nil
        switch request {
        case .place(let page): open(page)
        case .focus(let id): focus(on: id)
        case .list: showList()
        case .compose(let text):
            composeText = text
            startingConversation = true
        }
    }

    private func detailPathChanged(_ path: [Route]) {
        guard !path.isEmpty else { return }
        settingsOpen = false
        if router.place != nil { router.closePlace() }
    }

    private func orderChanged(_ old: [String], _ new: [String]) {
        guard !new.contains(pager.shown) else { return }
        let before: [String] = old.firstIndex(of: pager.shown).map { Array(old[..<$0].reversed()) } ?? []
        let next = before.first { new.contains($0) } ?? mainThreadId
        slide = .leading
        withAnimation(reduceMotion ? .easeInOut(duration: 0.2) : .spring(response: 0.45, dampingFraction: 0.9)) {
            pageOffset = 0
            pager.show(next)
        }
    }

    private func themeSaved(_ saved: String?) {
        if let saved, router.themeOverride[bot.id] == saved { router.themeOverride[bot.id] = nil }
    }

    private func showToast() async {
        guard let name = router.botToast, name == bot.name else { return }
        router.botToast = nil
        withAnimation(.easeInOut(duration: 0.2)) { toast = name }
        try? await Task.sleep(for: .milliseconds(1400))
        withAnimation(.easeInOut(duration: 0.3)) { toast = nil }
    }

    private func folded(_ proxy: GeometryProxy) -> some View {
        NavigationStack(path: $router.detailPath) {
            chat()
                .frame(maxWidth: .infinity, maxHeight: .infinity)
                .background { backdrop(proxy) }
                .toolbar(columnHeader ? .hidden : .automatic, for: .navigationBar)
                .toolbar {
                    if !columnHeader {
                        ToolbarItem(placement: .topBarLeading) {
                            RoomHomeButton(bot: bot, view: view, needsYou: BotShell.needsYou(bot, view: view), action: showList)
                        }
                    }
                }
                .navigationDestination(for: Route.self) { route in destination(route) }
        }
        // The leading edge is back to Home (round 5): a swipe in from it goes
        // home; a sideways swipe anywhere else pages conversations, which
        // already ignores drags that start at the edge. Clear of the composer.
        .overlay(alignment: .leading) {
            if router.detailPath.isEmpty {
                Color.clear
                    .frame(width: 22)
                    .padding(.top, 100)
                    .padding(.bottom, 150)
                    .contentShape(.rect)
                    .gesture(DragGesture(minimumDistance: 12).onEnded { drag in
                        if drag.translation.width > 60, abs(drag.translation.height) < drag.translation.width { showList() }
                    })
                    .accessibilityHidden(true)
            }
        }
        .sheet(item: placeBinding) { place in
            RoomPlaceSheet(place: place, bot: bot, store: store, mainThreadId: mainThreadId,
                           open: openItem, startedConversation: { id in openItem(.conversation(id)) },
                           closeToRoom: { router.closePlace() }, theme: look.theme.id, chooseTheme: chooseTheme,
                           shown: pager.shown, settings: {
                               router.closePlace()
                               openSettings()
                           }, switchBot: { botId, conversation in switchTo(botId, opening: conversation) })
                .presentationDetents([.height(max(320, proxy.size.height + proxy.safeAreaInsets.bottom - RoomPlaceSheet.sliver))])
                .presentationCornerRadius(14)
                .presentationDragIndicator(.visible)
                .presentationBackground(look.canvas)
        }
    }

    private func duo(_ proxy: GeometryProxy, _ pages: DuoPages) -> some View {
        ZStack {
            RoomCanvas(pages: pages, layout: layout) {
                if duoHome || pages != .sideBySide {
                    contextPane(proxy)
                } else {
                    leftChat
                }
            } second: {
                if duoHome || pages != .sideBySide {
                    rightChat(proxy, pages)
                } else {
                    rightWorkspace(proxy)
                }
            }
            .background {
                ZStack {
                    backdrop(proxy)
                    duoScrim(pages)
                }
            }
            .opacity(spreadOpen ? 0 : 1)
            .allowsHitTesting(!spreadOpen)
            .accessibilityHidden(spreadOpen)
            if spreadOpen {
                Group {
                    if settingsOpen {
                        RoomSpread(content: .settings, pages: pages, layout: layout, bot: bot, store: store, mainThreadId: mainThreadId,
                                   open: openItem, close: closeSpread, chooseTheme: chooseTheme)
                    } else if let place = router.place {
                        RoomSpread(content: .place(place), pages: pages, layout: layout, bot: bot, store: store, mainThreadId: mainThreadId,
                                   open: openItem, close: closeSpread, chooseTheme: chooseTheme)
                            .id(place)
                    }
                }
                .background { backdrop(proxy).blur(radius: 6) }
                .transition(.opacity)
            }
        }
        .animation(.easeInOut(duration: 0.25), value: spreadOpen)
    }

    /// Home: the Bot's list, strands, workers and places (the unfolded Duo's left screen).
    private func contextPane(_ proxy: GeometryProxy) -> some View {
        ZStack(alignment: .bottom) {
            RoomContextPane(bot: bot, view: view, shown: pager.shown, mainThreadId: mainThreadId, order: order,
                            pick: { id in
                                router.detailPath = []
                                show(id)
                            },
                            openThread: { id in router.detailPath = [.thread(id: id)] },
                            openPlace: { router.showPlace($0) }, settings: openSettings,
                            refresh: { [store] in await store.refresh() },
                            switchBot: { switchTo($0, opening: nil) },
                            newConversation: {
                                composeText = ""
                                startingConversation = true
                            })
        }
        .padding(.top, proxy.safeAreaInsets.top)
        .padding(.bottom, 8)
        .ignoresSafeArea(.container, edges: [.top, .bottom])
        .environment(\.colorScheme, .dark)
    }

    /// The live conversation on the right screen, beside Home.
    private func rightChat(_ proxy: GeometryProxy, _ pages: DuoPages) -> some View {
        NavigationStack(path: $router.detailPath) {
            chat()
                .containerBackground(.clear, for: .navigation)
                .navigationDestination(for: Route.self) { route in destination(route) }
        }
        .environment(\.duoLayout, pages == .sideBySide && layout.twoPages ? layout : DuoLayout(size: .zero, innerScreen: layout.innerScreen))
        .environment(nil as DuoPaneState?)
        .ignoresSafeArea(.container, edges: pages == .sideBySide && layout.twoPages ? .trailing : [])
        .padding(.trailing, pages == .sideBySide ? max(0, FoldedChrome.column - proxy.safeAreaInsets.trailing) : 0)
        .accessibilityElement(children: .contain)
        .accessibilityIdentifier("roomConversation")
    }

    /// The conversation on the left screen, its Workspace on the right: a phone-style header with Home.
    private var leftChat: some View {
        NavigationStack(path: $router.detailPath) {
            chat()
                .containerBackground(.clear, for: .navigation)
                .navigationDestination(for: Route.self) { route in destination(route) }
                .toolbar {
                    ToolbarItem(placement: .topBarLeading) {
                        RoomHomeButton(bot: bot, view: view, needsYou: BotShell.needsYou(bot, view: view)) {
                            withAnimation(.snappy) {
                                duoWorker = nil
                                duoHome = true
                            }
                        }
                    }
                }
        }
        .environment(\.duoLayout, DuoLayout(size: .zero, innerScreen: layout.innerScreen))
        // A phone-style header (Home and the title), not the folded rail.
        .environment(\.duoPage, false)
        .environment(nil as DuoPaneState?)
        .accessibilityElement(children: .contain)
        .accessibilityIdentifier("roomConversation")
    }

    /// The right screen beside the conversation: its Workspace, or a worker live.
    @ViewBuilder private func rightWorkspace(_ proxy: GeometryProxy) -> some View {
        Group {
            if let worker = duoWorker {
                NavigationStack {
                    ThreadView(threadId: worker).id(worker)
                        .environment(\.botConversation, context(worker, kind: .worker))
                        .toolbar {
                            ToolbarItem(placement: .topBarLeading) {
                                Button { withAnimation(.snappy) { duoWorker = nil } } label: { Label("Workspace", systemImage: "chevron.left") }
                                    .accessibilityIdentifier("duoWorkerBack")
                            }
                        }
                }
                .environment(\.duoLayout, DuoLayout(size: .zero, innerScreen: layout.innerScreen))
            } else {
                DuoWorkspacePane(threadId: pager.shown, model: session.model, conversation: shownConversationForPane,
                                 openThread: { id in withAnimation(.snappy) { duoWorker = id } })
                    .padding(.top, proxy.safeAreaInsets.top)
            }
        }
        // Clear of the status column (84 pt from the screen's edge), whatever the safe area says.
        .padding(.trailing, FoldedChrome.column)
        .ignoresSafeArea(.container, edges: [.top, .trailing])
        .environment(\.colorScheme, .dark)
        .accessibilityElement(children: .contain)
        .accessibilityIdentifier("duoWorkspace")
    }

    private var shownConversationForPane: BotConversation? {
        view?.conversations.first { $0.threadId == pager.shown }
    }

    private var spreadOpen: Bool { pages != nil && (router.place != nil || settingsOpen) }

    private func duoScrim(_ pages: DuoPages) -> some View {
        LinearGradient(stops: [.init(color: .clear, location: 0), .init(color: .clear, location: 0.36),
                               .init(color: .black.opacity(0.5), location: 0.5), .init(color: .black.opacity(0.58), location: 1)],
                       startPoint: .leading, endPoint: .trailing)
            .ignoresSafeArea()
            .allowsHitTesting(false)
            .accessibilityHidden(true)
    }

    private func backdrop(_ proxy: GeometryProxy) -> some View {
        let spot = RoomSceneLight.spot(proxy, pages: pages, rail: columnHeader)
        let covered = pages == nil
        return ZStack {
            // Under the frost on one page too (the phone, the folded Duo), paused
            // and still: the frost's blurred still need not reach the bottom (on
            // the folded Duo it stopped halfway, black below), and this fills it.
            SceneBackdrop(theme: look.theme, botId: bot.id, view: view, light: spot, paused: covered, motion: !covered)
            RoomLightLayer(light: light, seed: pager.shown, spot: spot)
                .id(pager.shown)
                .transition(.opacity)
            RoomFrost(pages: pages, layout: layout, light: light, seed: pager.shown, spot: spot, botId: bot.id, view: view)
            #if DEBUG
            Color.clear.frame(width: 1, height: 1).accessibilityElement().accessibilityIdentifier("roomScene").accessibilityValue(look.theme.id)
            Color.clear.frame(width: 1, height: 1).accessibilityElement().accessibilityIdentifier("roomLight").accessibilityValue(light.name)
            if let spot { RoomLightMarker(spot: spot) }
            #endif
            RoomShade(standing: pages == nil)
        }
        // The whole window, the keyboard's part too: as the conversation's
        // background it was only as tall as the room above the keyboard, and
        // the frost (blurred within its own frame) stopped there.
        .ignoresSafeArea()
        .animation(reduceMotion ? .easeInOut(duration: 0.2) : .easeInOut(duration: 0.5), value: pager.shown)
        .allowsHitTesting(false)
    }

    private func chat() -> some View {
        ZStack {
            ThreadView(threadId: pager.shown, session: session)
                .id(pager.shown)
                .transition(reduceMotion ? .opacity : .push(from: slide))
        }
        .offset(x: pageOffset)
        .environment(\.botConversation, context(pager.shown, kind: .conversation))
        .environment(\.roomChat, RoomChat(focusRequests: router.focusRequests, away: false, layDown: dismissKeyboard,
                                          showList: pages == nil ? showList : nil,
                                          page: order.count > 1 ? chatPage : nil,
                                          pages: RoomChatPages(index: order.firstIndex(of: pager.shown) ?? 0, count: order.count),
                                          strandsBeside: pages != nil && duoHome,
                                          showWorkspace: pages == .sideBySide ? {
                                              withAnimation(.snappy) {
                                                  duoWorker = nil
                                                  duoHome = false
                                              }
                                          } : nil))
        // The room is dark under its frost and shade, whatever variant the
        // scene's driver chose for the hour: the conversation's chrome (its
        // bottom band, strands pill, composer, header) takes the theme's dark
        // tokens too, not a light canvas under a dark transcript.
        .environment(\.look, Look(theme: look.theme, scheme: .dark, showsScene: look.showsScene))
        .environment(\.colorScheme, .dark)
        // The navigation bar's glass buttons (voice, more) too: the bar takes
        // its scheme from the window, not from the environment above.
        .toolbarColorScheme(.dark, for: .navigationBar)
    }

    /// A sideways drag on the open conversation's messages: it follows the
    /// finger (less at the first or last), then pages, as the room does.
    private func chatPage(_ translation: CGFloat, _ predicted: CGFloat?) {
        if let predicted {
            page(RoomPager.page(after: CGSize(width: translation, height: 0), predicted: CGSize(width: predicted, height: 0)))
            return
        }
        guard !reduceMotion else { return }
        let edge = RoomPager.step(order, from: pager.shown, by: translation < 0 ? 1 : -1) == nil
        pageOffset = translation * (edge ? 0.2 : 0.5)
    }

    private func page(_ step: Int) {
        let next = step == 0 ? nil : RoomPager.step(order, from: pager.shown, by: step)
        guard let next else {
            withAnimation(.spring(response: 0.35, dampingFraction: 0.8)) { pageOffset = 0 }
            return
        }
        slide = step > 0 ? .trailing : .leading
        withAnimation(reduceMotion ? .easeInOut(duration: 0.2) : .spring(response: 0.45, dampingFraction: 0.9)) {
            pageOffset = 0
            pager.show(next)
        }
    }

    /// Another Bot from the list's header (or a conversation just started with it): its room, on that conversation or its Main.
    private func switchTo(_ botId: String, opening conversation: String?) {
        guard botId != bot.id else { return }
        if router.place != nil { router.closePlace() }
        router.botToast = store.spaces?.bots.first { $0.id == botId }?.name
        withAnimation(.easeInOut(duration: reduceMotion ? 0.25 : 0.4)) {
            router.show(botId, store: store, compact: false)
            if let conversation { router.openConversation(conversation) }
        }
    }

    private var placeBinding: Binding<RoomPlace?> {
        Binding(get: { pages == nil ? router.place : nil }, set: { value in if value == nil, pages == nil { router.closePlace() } })
    }

    private func openSettings() {
        guard pages != nil else {
            router.tab = .settings
            return
        }
        settingsOpen = true
        router.closePlace()
    }

    private func closeSpread() {
        settingsOpen = false
        router.closePlace()
    }

    /// The conversation list over the conversation.
    private func showList() {
        dismissKeyboard()
        router.showPlace(.conversations)
    }

    private func dismissKeyboard() {
        UIApplication.shared.sendAction(#selector(UIResponder.resignFirstResponder), to: nil, from: nil, for: nil)
    }

    private func open(_ page: BotPage) {
        let place: RoomPlace = switch page {
        case .memory: .memory
        case .library: .library
        case .strands: .strands
        case .automations: .schedules
        case .archive: .archive
        }
        settingsOpen = false
        router.showPlace(place)
    }

    private func openItem(_ item: BotShellItem) {
        switch item {
        case .conversation(let id) where order.contains(id):
            router.detailPath = []
            focus(on: id, keyboard: id == mainThreadId)
        case .conversation(let id), .worker(let id):
            settingsOpen = false
            router.closePlace()
            router.detailPath = [.thread(id: id)]
        case .page(let page):
            open(page)
        }
    }

    private func show(_ id: String) {
        guard pager.shown != id else { return }
        let from = order.firstIndex(of: pager.shown) ?? 0
        slide = (order.firstIndex(of: id) ?? 0) >= from ? .trailing : .leading
        withAnimation(reduceMotion ? .easeInOut(duration: 0.2) : .spring(response: 0.45, dampingFraction: 0.9)) {
            pageOffset = 0
            pager.show(id)
        }
    }

    private func focus(on id: String, keyboard: Bool = false) {
        focused = true
        settingsOpen = false
        if router.place != nil { router.closePlace() }
        guard order.contains(id) else {
            router.detailPath = [.thread(id: id)] + router.detailPath
            return
        }
        show(id)
        if keyboard, router.detailPath.isEmpty { router.focusInput() }
    }

    private func chooseTheme(_ themeId: String) {
        Self.chooseTheme(themeId, bot: bot, shell: router, store: store, app: app)
    }

    static func chooseTheme(_ themeId: String, bot: BotSpace, shell: Router, store: BotSpacesStore, app: AppModel) {
        let previous = shell.themeOverride[bot.id]
        shell.themeOverride[bot.id] = themeId
        Task {
            do {
                try await app.client.setBotTheme(botId: bot.id, themeId: themeId, keeping: bot.appearance)
                await store.refresh()
            } catch {
                shell.themeOverride[bot.id] = previous
                app.flash("The theme didn't change: " + BBClient.describe(error))
            }
        }
    }

    @ViewBuilder private func destination(_ route: Route) -> some View {
        switch route {
        case .thread(let id):
            ThreadView(threadId: id).id(id)
                .environment(\.botConversation, context(id, kind: view?.workers.contains { $0.threadId == id } == true ? .worker : .conversation))
        default:
            RouteDestination(route: route).environment(\.botConversation, context(mainThreadId, kind: .conversation))
        }
    }

    private func context(_ threadId: String, kind: BotConversationContext.Kind) -> BotConversationContext {
        BotShell.context(threadId: threadId, kind: kind, bot: bot, view: view, splitsThreads: false,
                         push: { [router] route in
                             if pages == .sideBySide, !duoHome, case .thread(let id) = route, id != pager.shown {
                                 withAnimation(.snappy) { duoWorker = id }
                             } else {
                                 router.detailPath.append(route)
                             }
                         },
                         openConversation: { id in openItem(.conversation(id)) },
                         showList: { [router] in
                             router.detailPath = []
                             showList()
                         },
                         refresh: { [store] in Task { await store.refresh() } })
    }

    private func applyQAMode() {
        if focused {
            // Already showing what it was asked for.
        } else if let id = RoomQA.value("-qaRoomConversation"), order.contains(id) {
            slide = .trailing
            pager.show(id)
        } else {
            let opening = RoomHome.opening(main: mainThreadId, order: order, botId: bot.id)
            if opening != pager.shown { pager.show(opening) }
        }
        guard let mode = RoomQA.mode else { return }
        if mode == "settings" {
            settingsOpen = true
        } else if let place = RoomPlace(rawValue: mode) {
            router.showPlace(place)
        }
    }
}
