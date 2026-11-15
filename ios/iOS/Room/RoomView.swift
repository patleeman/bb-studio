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
    @EnvironmentObject private var app: AppModel
    @ObservedObject var store: BotSpacesStore
    @ObservedObject var shell: BotShellModel
    let bot: BotSpace
    let mainThreadId: String
    let pages: DuoPages?
    @StateObject private var pager: RoomSessions
    @State private var room = RoomModel()
    @State private var dragAxis: RoomPager.Axis?
    @State private var dragOnPresence = false
    @State private var pageOffset: CGFloat = 0
    @State private var slide: Edge = .trailing
    @State private var nudge: CGFloat = 0
    @State private var toast: String?
    @State private var morning: LoopMorning?
    @State private var tasks = TasksModel.shared
    @State private var sceneSize: CGSize = .zero
    @State private var presenceSize: CGFloat = 0
    @State private var presenceFrame: CGRect = .zero
    @State private var switching = false
    @State private var settingsOpen = false
    @Environment(\.look) private var look
    @Environment(\.accessibilityReduceMotion) private var systemReduceMotion
    @Environment(\.scenePhase) private var phase
    @Environment(\.duoLayout) private var layout
    @Environment(\.displayScale) private var displayScale
    @Environment(\.colorScheme) private var scheme

    init(store: BotSpacesStore, shell: BotShellModel, bot: BotSpace, mainThreadId: String, pages: DuoPages? = nil) {
        self.store = store
        self.shell = shell
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
    private var shownRecord: BotConversation? { view?.conversations.first { $0.threadId == pager.shown } }
    private var light: RoomLight { RoomLight.lights(order: order, main: mainThreadId)[pager.shown] ?? .natural }

    private var view: BotThreadsView? { store.view(for: bot.id) }
    private var reduceMotion: Bool { systemReduceMotion || RoomQA.reduceMotion }
    private var todayCount: Int? {
        if tasks.supported == false { return morning.map { $0.items.count + $0.more } }
        return tasks.list.map { _ in tasks.today.count }
    }

    private var flight: [TaskItem] { tasks.flights[pager.shown]?.tasks ?? [] }

    private var yours: [TaskItem]? {
        if tasks.supported == false {
            guard isMain else { return [] }
            return morning.map { $0.items.map(TaskItem.init(loop:)) }
        }
        let own = RoomNow.yours(flight)
        if isMain {
            guard tasks.list != nil else { return nil }
            let cards = tasks.roomCards().filter { $0.isMine && !$0.isClosed }
            return cards + own.filter { task in !cards.contains { $0.id == task.id } }
        }
        if tasks.flights[pager.shown] == nil && tasks.flightErrors[pager.shown] == nil { return nil }
        return own
    }

    private var onIt: [RoomOnIt] {
        RoomOnIt.rows(threadId: pager.shown, tasks: flight, workers: view?.workers(of: pager.shown) ?? [])
    }

    private var title: String {
        guard let conversation = shownConversation else { return bot.name }
        return conversation.title.isEmpty ? "Untitled" : conversation.title
    }

    var body: some View {
        GeometryReader { proxy in
            if let pages {
                duo(proxy, pages)
            } else {
                folded(proxy)
            }
        }
        .background {
            RoomTalkWatcher(talk: session.talk) { state in
                withAnimation(reduceMotion ? .easeInOut(duration: 0.2) : .snappy) { room.sync(talk: state) }
            } failed: { app.flash($0) }
        }
        .onChange(of: pages) { _, _ in
            UIApplication.shared.sendAction(#selector(UIResponder.resignFirstResponder), to: nil, from: nil, for: nil)
            if pages != nil, room.standing { room.show(.rest) }
            if pages != nil, app.tab == .settings {
                app.tab = .bot
                settingsOpen = true
            } else if pages == nil, settingsOpen {
                settingsOpen = false
                app.tab = .settings
            }
        }
        .onChange(of: shell.roomOpen, initial: true) { _, page in
            guard let page else { return }
            shell.roomOpen = nil
            open(page)
        }
        .task(id: phase) {
            guard phase == .active else { return }
            while !Task.isCancelled {
                await loadMorning()
                try? await Task.sleep(for: .seconds(60))
            }
        }
        .task(id: "\(pager.shown)|\(phase == .active)|\(tasks.supported != false)") {
            guard phase == .active, tasks.supported != false else { return }
            while !Task.isCancelled {
                await tasks.loadFlight(pager.shown)
                try? await Task.sleep(for: .seconds(20))
            }
        }
        .onChange(of: room.mode) { _, mode in
            if mode == .rest { Task { await loadMorning() } }
        }
        .task(id: view?.workers.map(\.id).joined(separator: ",")) {
            TasksModel.shared.botThreadId = mainThreadId
            if LoopsModel.shared.botName != bot.name { LoopsModel.shared.botName = bot.name }
            var leads = (view?.workers ?? []).filter { $0.status == .running }.map { (id: $0.threadId, title: $0.title) }
            #if DEBUG
            if LoopsDemo.mode != nil { leads.insert((LoopsDemo.leadId, "Larkspur lead"), at: 0) }
            #endif
            if leads.map({ $0.id + "\u{1F}" + $0.title }) != LoopsModel.shared.leads.map({ $0.id + "\u{1F}" + $0.title }) { LoopsModel.shared.leads = leads }
        }
        .onChange(of: bot.appearance?.themeId) { _, saved in
            if let saved, shell.themeOverride[bot.id] == saved { shell.themeOverride[bot.id] = nil }
        }
        .task { applyQAMode() }
        .task(id: pager.shown) { await session.start(app) }
        .onDisappear { pager.current.stop() }
        .overlay(alignment: .top) {
            if let toast {
                Text(toast).font(.headline).foregroundStyle(.white)
                    .padding(.horizontal, 16).padding(.vertical, 8)
                    .background(.black.opacity(0.45), in: .capsule)
                    .padding(.top, 60)
                    .transition(.opacity)
                    .accessibilityIdentifier("roomBotToast")
            }
        }
        .task {
            guard let name = shell.botToast, name == bot.name else { return }
            shell.botToast = nil
            withAnimation(.easeInOut(duration: 0.2)) { toast = name }
            try? await Task.sleep(for: .milliseconds(1400))
            withAnimation(.easeInOut(duration: 0.3)) { toast = nil }
        }
        .task(id: "\(bot.id)|\(Int(sceneSize.width))x\(Int(sceneSize.height))|\(Int(presenceSize))") {
            try? await Task.sleep(for: .seconds(1.2))
            for step in [1, -1] {
                guard !Task.isCancelled else { return }
                if let id = BotShell.step(store.spaces, from: bot.id, by: step) { await warm(id) }
            }
        }
        .modifier(TalkLifecycle(talk: session.talk))
    }

    private func folded(_ proxy: GeometryProxy) -> some View {
        NavigationStack(path: $shell.detailPath) {
            ZStack {
                if !room.standing {
                    rest(proxy)
                        .transition(.opacity)
                        .zIndex(1)
                }
                chat(standing: room.standing)
                    .offset(y: room.standing ? 0 : proxy.size.height + proxy.safeAreaInsets.bottom + 40)
                    .animation(reduceMotion ? nil : room.standing ? .smooth(duration: 0.36) : .smooth(duration: 0.28), value: room.standing)
                    .opacity(room.standing ? 1 : 0)
                    .allowsHitTesting(room.standing)
                    .accessibilityHidden(!room.standing)
                    .zIndex(room.standing ? 1 : 0)
            }
            .animation(reduceMotion ? .easeInOut(duration: 0.2) : room.standing ? .smooth(duration: 0.34) : .smooth(duration: 0.26), value: room.standing)
            .frame(maxWidth: .infinity, maxHeight: .infinity)
            .background { backdrop }
            .toolbar(room.standing && !columnHeader ? .automatic : .hidden, for: .navigationBar)
            .toolbar {
                if room.standing && !columnHeader {
                    ToolbarItem(placement: .topBarLeading) {
                        Button { layDown() } label: { Image(systemName: "chevron.down") }
                            .accessibilityLabel("Back to the room")
                            .accessibilityIdentifier("roomLayDown")
                    }
                }
            }
            .navigationDestination(for: Route.self) { route in destination(route) }
        }
        .sheet(item: placeBinding) { place in
            RoomPlaceSheet(place: place, bot: bot, store: store, mainThreadId: mainThreadId, todayCount: todayCount,
                           open: openItem, startedConversation: { id in openItem(.conversation(id)) },
                           closeToRoom: { room.show(.rest) }, theme: look.theme.id, chooseTheme: chooseTheme)
                .presentationDetents([.height(max(320, proxy.size.height + proxy.safeAreaInsets.bottom - RoomPlaceSheet.sliver))])
                .presentationCornerRadius(14)
                .presentationDragIndicator(.visible)
                .presentationBackground(look.canvas)
        }
    }

    private func duo(_ proxy: GeometryProxy, _ pages: DuoPages) -> some View {
        ZStack {
            RoomCanvas(pages: pages, layout: layout) {
                ZStack(alignment: .bottom) {
                    stage(proxy, menuButton: false)
                    if room.showsMenu { menu(closeInColumn: true) }
                }
                .padding(.trailing, pages == .stacked ? max(0, FoldedChrome.column - proxy.safeAreaInsets.trailing) : 0)
                .padding(.top, proxy.safeAreaInsets.top)
                .padding(.bottom, 8)
                .ignoresSafeArea(.container, edges: [.top, .bottom])
                .environment(\.colorScheme, .dark)
            } second: {
                NavigationStack(path: $shell.detailPath) {
                    chat(standing: true)
                        .containerBackground(.clear, for: .navigation)
                        .navigationDestination(for: Route.self) { route in destination(route) }
                }
                .accessibilityElement(children: .contain)
                .accessibilityIdentifier("roomConversation")
            }
            .background {
                ZStack {
                    backdrop
                    duoScrim(pages)
                }
            }
            .opacity(spreadOpen ? 0 : 1)
            .allowsHitTesting(!spreadOpen)
            .accessibilityHidden(spreadOpen)
            if !spreadOpen {
                FoldedColumn {
                    RoomColumnMenuButton(open: room.showsMenu, reduceMotion: reduceMotion) {
                        if room.showsMenu { closeMenu() } else { openMenu() }
                    }
                }
            }
            if spreadOpen {
                Group {
                    if settingsOpen {
                        RoomSpread(content: .settings, pages: pages, layout: layout, bot: bot, store: store, mainThreadId: mainThreadId,
                                   open: openItem, close: closeSpread, chooseTheme: chooseTheme)
                    } else if let place = room.place {
                        RoomSpread(content: .place(place), pages: pages, layout: layout, bot: bot, store: store, mainThreadId: mainThreadId,
                                   open: openItem, close: closeSpread, chooseTheme: chooseTheme)
                            .id(place)
                    }
                }
                .background { backdrop.blur(radius: 6) }
                .transition(.opacity)
            }
        }
        .animation(.easeInOut(duration: 0.25), value: spreadOpen)
    }

    private var spreadOpen: Bool { pages != nil && (room.place != nil || settingsOpen) }

    private func duoScrim(_ pages: DuoPages) -> some View {
        LinearGradient(stops: [.init(color: .clear, location: 0), .init(color: .clear, location: 0.36),
                               .init(color: .black.opacity(0.5), location: 0.5), .init(color: .black.opacity(0.58), location: 1)],
                       startPoint: pages == .stacked ? .top : .leading, endPoint: pages == .stacked ? .bottom : .trailing)
            .ignoresSafeArea()
            .allowsHitTesting(false)
            .accessibilityHidden(true)
    }

    private var backdrop: some View {
        ZStack {
            SceneBackdrop(theme: look.theme, botId: bot.id, view: view)
                .onGeometryChange(for: CGSize.self) { $0.size } action: { sceneSize = SceneBackdrop.stillSize($0) }
            RoomLightLayer(light: light, seed: pager.shown)
                .id(pager.shown)
                .transition(.opacity)
            #if DEBUG
            Color.clear.frame(width: 1, height: 1).accessibilityElement().accessibilityIdentifier("roomScene").accessibilityValue(look.theme.id)
            Color.clear.frame(width: 1, height: 1).accessibilityElement().accessibilityIdentifier("roomLight").accessibilityValue(light.name)
            #endif
            RoomShade(standing: room.standing && pages == nil)
                .animation(.easeInOut(duration: 0.35), value: room.mode)
        }
        .animation(reduceMotion ? .easeInOut(duration: 0.2) : .easeInOut(duration: 0.5), value: pager.shown)
        .allowsHitTesting(false)
    }

    private func rest(_ proxy: GeometryProxy) -> some View {
        ZStack(alignment: .bottom) {
            stage(proxy, menuButton: !columnHeader)
            if room.showsMenu { menu(closeInColumn: columnHeader) }
            if (room.showsDay || room.showsMenu) && columnHeader {
                FoldedColumn {
                    RoomColumnMenuButton(open: room.showsMenu, reduceMotion: reduceMotion) {
                        if room.showsMenu { closeMenu() } else { openMenu() }
                    }
                }
                .transition(.opacity)
            }
        }
        .animation(reduceMotion ? .easeInOut(duration: 0.2) : .spring(response: 0.5, dampingFraction: 0.9), value: room.mode)
        .safeAreaInset(edge: .bottom, spacing: 0) {
            ZStack {
                if room.showsMenu {
                    Color.clear.frame(height: 70)
                } else {
                    dock.transition(.opacity)
                }
            }
            .animation(.easeInOut(duration: 0.2), value: room.mode)
        }
        .ignoresSafeArea(.keyboard)
        .padding(.top, proxy.safeAreaInsets.top)
        .ignoresSafeArea(.container, edges: .top)
        .environment(\.colorScheme, .dark)
    }

    private func menu(closeInColumn: Bool) -> some View {
        RoomMenu(bot: bot, store: store, view: view, todayCount: todayCount, closeInColumn: closeInColumn, close: closeMenu,
                 openPlace: { room.handle(.open($0)) }, openWorker: { openItem(.worker($0)) },
                 theme: { room.handle(.open(.theme)) }, settings: openSettings,
                 switchBot: { shell.show($0, store: store, compact: false) })
            .transition(reduceMotion ? .opacity : .opacity.combined(with: .scale(scale: 0.97)))
    }

    private func stage(_ proxy: GeometryProxy, menuButton: Bool) -> some View {
        ZStack {
            Color.clear
                .contentShape(.rect)
                .accessibilityElement(children: .ignore)
                .accessibilityLabel(title)
                .accessibilityHint(pages == nil ? "Opens the conversation" : "Moves to the conversation's reply box")
                .accessibilityAddTraits(.isButton)
                .accessibilityAction { openChat() }
                .accessibilityValue(order.count > 1 ? "Conversation \((order.firstIndex(of: pager.shown) ?? 0) + 1) of \(order.count)" : "")
                .modifier(RoomPaging(pages: order.count, page: page))
                .accessibilityIdentifier("RoomStage")
            ZStack {
                RoomPresenceHost(model: session.model, bot: bot, view: view, title: title, main: isMain, record: shownRecord,
                                 flight: flight, onIt: onIt, yours: yours, names: tasks.names, menuButton: menuButton, shown: room.showsDay,
                                 bottomClear: pages != nil && order.count > 1 ? 24 : 0, nudge: nudge,
                                 canSwitch: (store.spaces?.bots.count ?? 1) > 1, openMenu: openMenu, openChat: openChat,
                                 openTask: openTask, openThread: { openItem(.worker($0)) }, openTasks: { room.showPlace(.tasks) },
                                 act: act, switchBot: switchBot, reportPresence: { presenceSize = $0 },
                                 reportPresenceFrame: { presenceFrame = $0 })
                    .id(pager.shown)
                    .transition(reduceMotion ? .opacity : .asymmetric(insertion: .opacity.combined(with: .move(edge: slide)),
                                                                     removal: .opacity.combined(with: .move(edge: slide == .trailing ? .leading : .trailing))))
            }
            .offset(x: pageOffset)
            .opacity(room.showsDay ? 1 : 0)
            .animation(reduceMotion ? .easeInOut(duration: 0.2) : room.showsDay ? .easeOut(duration: 0.28) : .easeOut(duration: 0.14), value: room.showsDay)
            .allowsHitTesting(room.showsDay)
            .accessibilityHidden(!room.showsDay)
            if pages != nil && order.count > 1 && room.showsDay {
                pageDots.frame(maxHeight: .infinity, alignment: .bottom).padding(.bottom, 8)
            }
        }
        .highPriorityGesture(stageDrag)
    }

    private var stageDrag: some Gesture {
        DragGesture(minimumDistance: 10, coordinateSpace: .global)
            .onChanged { value in
                guard room.mode == .rest else { return }
                if dragAxis == nil {
                    dragAxis = RoomPager.axis(value.translation)
                    dragOnPresence = presenceFrame.insetBy(dx: -10, dy: -10).contains(value.startLocation)
                }
                guard dragAxis == .horizontal, !dragOnPresence, !reduceMotion else { return }
                let edge = RoomPager.step(order, from: pager.shown, by: value.translation.width < 0 ? 1 : -1) == nil
                pageOffset = value.translation.width * (edge ? 0.2 : 0.5)
            }
            .onEnded { value in
                defer {
                    dragAxis = nil
                    dragOnPresence = false
                }
                guard room.mode == .rest else { return }
                switch dragAxis {
                case .horizontal:
                    if dragOnPresence {
                        withAnimation(.spring(response: 0.3, dampingFraction: 0.8)) { pageOffset = 0 }
                        guard abs(value.translation.width) > 50 else { return }
                        switchBot(value.translation.width < 0 ? 1 : -1)
                    } else {
                        page(RoomPager.page(after: value.translation, predicted: value.predictedEndTranslation))
                    }
                case .vertical:
                    let rise = min(value.translation.height, value.predictedEndTranslation.height)
                    if rise < -RoomPager.swipe { openChat() }
                case nil:
                    break
                }
            }
    }

    private func chat(standing: Bool) -> some View {
        ZStack {
            ThreadView(threadId: pager.shown, session: session)
                .id(pager.shown)
                .transition(reduceMotion ? .opacity : .push(from: slide))
        }
        .environment(\.botConversation, context(pager.shown, kind: .conversation))
        .environment(\.roomChat, RoomChat(focusRequests: room.focusRequests, away: !standing, layDown: layDown))
        .environment(\.openTaskThread, { openItem(.conversation($0)) })
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

    private func warm(_ botId: String) async {
        guard let next = store.spaces?.bots.first(where: { $0.id == botId }), sceneSize.width > 1, presenceSize > 0 else { return }
        let looks = LookStore.shared
        let theme = RoomTheme.resolve(botThemeId: shell.themeOverride[next.id] ?? next.appearance?.themeId, phoneThemeId: looks.themeId, catalog: looks.catalog)
        let look = LookRoot.look(theme, store: looks, scheme: scheme)
        _ = await SceneStills.shared.still(theme: theme, mode: look.mode, size: sceneSize, scale: min(2, displayScale))
        let live = store.view(for: next.id)
        var spec = PresenceSpec(bot: next, state: next.presenceState(live: live),
                                workers: live?.workers.filter { $0.status == .running }.count ?? next.activity.workers,
                                look: look, size: presenceSize, scale: displayScale, custom: PresenceCatalog.shared.entry(next.presence?.form))
        spec.room = PresenceSpec.roomHeadroom
        _ = await PresenceStills.shared.still(spec)
    }

    private func switchBot(_ step: Int) {
        guard !switching else { return }
        guard let next = BotShell.step(store.spaces, from: bot.id, by: step) else {
            guard !reduceMotion else { return }
            withAnimation(.spring(response: 0.18, dampingFraction: 0.5)) { nudge = CGFloat(-step) * 22 }
            Task {
                try? await Task.sleep(for: .milliseconds(180))
                withAnimation(.spring(response: 0.35, dampingFraction: 0.6)) { nudge = 0 }
            }
            return
        }
        switching = true
        Task {
            await RoomWarmth.wait(upTo: .milliseconds(700)) { await warm(next) }
            switching = false
            shell.botToast = store.spaces?.bots.first { $0.id == next }?.name
            withAnimation(.easeInOut(duration: reduceMotion ? 0.25 : 0.4)) { shell.show(next, store: store, compact: false) }
        }
    }

    private var pageDots: some View {
        HStack(spacing: 6) {
            ForEach(order, id: \.self) { id in
                Capsule().fill(.white.opacity(id == pager.shown ? 0.85 : 0.3))
                    .frame(width: id == pager.shown ? 16 : RoomDock.dots, height: RoomDock.dots)
            }
        }
        .animation(.snappy, value: pager.shown)
        .accessibilityElement(children: .ignore)
        .accessibilityLabel("Conversation \((order.firstIndex(of: pager.shown) ?? 0) + 1) of \(order.count)")
        .accessibilityIdentifier("roomPageDots")
    }

    private var dock: some View {
        VStack(spacing: RoomDock.spacing) {
            if room.mode.recording {
                RoomHint(talk: session.talk).transition(.opacity)
            } else if order.count > 1 {
                pageDots
            }
            HStack(spacing: 0) {
                if room.mode.recording {
                    RoomWave(talk: session.talk)
                } else {
                    Button { stand() } label: {
                        Text(isMain ? "Talk to \(bot.name)" : "Message \(title)")
                            .id(pager.shown)
                            .transition(.asymmetric(insertion: .opacity.animation(.easeOut(duration: 0.15).delay(0.1)),
                                                    removal: .opacity.animation(.easeIn(duration: 0.1))))
                            .font(.body)
                            .foregroundStyle(.white.opacity(0.5))
                            .lineLimit(1)
                            .frame(maxWidth: .infinity, minHeight: RoomDock.field, alignment: .leading)
                            .padding(.leading, 20)
                            .contentShape(.rect)
                    }
                    .buttonStyle(.plain)
                    .accessibilityLabel(isMain ? "Talk to \(bot.name)" : "Message \(title)")
                    .accessibilityIdentifier("roomInput")
                }
                RoomMic(talk: session.talk, tint: look.roomTint)
                    .padding(.trailing, 2)
            }
            .frame(height: RoomDock.field)
            .background(.black.opacity(0.4), in: .capsule)
            .overlay(Capsule().strokeBorder(.white.opacity(0.08)))
        }
        .padding(.horizontal, 18)
        .padding(.top, RoomDock.top)
        .padding(.bottom, RoomDock.bottom)
        .animation(.snappy, value: room.mode)
    }

    private var placeBinding: Binding<RoomPlace?> {
        Binding(get: { pages == nil ? room.place : nil }, set: { value in if value == nil, pages == nil { room.handle(.closePlace) } })
    }

    private func openSettings() {
        guard pages != nil else {
            app.tab = .settings
            return
        }
        settingsOpen = true
        room.show(.rest)
    }

    private func closeSpread() {
        settingsOpen = false
        room.show(.rest)
    }

    private func stand() {
        guard room.mode == .rest else { return }
        room.handle(.tapInput)
    }

    private func openChat() {
        guard room.mode == .rest else { return }
        room.handle(pages == nil ? .openChat : .tapInput)
    }

    private func layDown() {
        guard room.standing else { return }
        UIApplication.shared.sendAction(#selector(UIResponder.resignFirstResponder), to: nil, from: nil, for: nil)
        room.handle(.chevron)
    }

    private func openMenu() {
        withAnimation(reduceMotion ? .easeInOut(duration: 0.2) : .smooth(duration: 0.4)) { _ = room.handle(.menuButton) }
    }

    private func closeMenu() {
        withAnimation(reduceMotion ? .easeInOut(duration: 0.2) : .smooth(duration: 0.4)) { _ = room.handle(.closeMenu) }
    }

    private func open(_ page: BotPage) {
        let place: RoomPlace = switch page {
        case .memory: .memory
        case .library: .library
        case .todos: .tasks
        case .automations: .schedules
        case .archive: .archive
        }
        settingsOpen = false
        room.showPlace(place)
    }

    private func openItem(_ item: BotShellItem) {
        switch item {
        case .conversation(let id) where id == mainThreadId:
            shell.detailPath = []
            settingsOpen = false
            room.show(.rest)
            if pager.shown != mainThreadId { page(-(order.firstIndex(of: pager.shown) ?? 0)) }
            room.handle(.tapInput)
        case .conversation(let id), .worker(let id):
            settingsOpen = false
            room.show(.rest)
            shell.detailPath = [.thread(id: id)]
        case .page(let page):
            open(page)
        }
    }

    private func chooseTheme(_ themeId: String) {
        Self.chooseTheme(themeId, bot: bot, shell: shell, store: store, app: app)
    }

    static func chooseTheme(_ themeId: String, bot: BotSpace, shell: BotShellModel, store: BotSpacesStore, app: AppModel) {
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

    private func openTask(_ id: String) {
        app.sheet = .task(id: id)
    }

    private func act(_ task: TaskItem, _ action: TaskAction) {
        Task {
            do {
                if tasks.supported == false {
                    let loop: LoopAction? = switch action {
                    case .done: .done
                    case .gotIt: .gotIt
                    case .drop: .drop
                    case .choose(let option): .choose(option)
                    case .snooze(let snooze): .snooze(snooze)
                    case .handOff(let to): .handOff(owner: to)
                    case .takeBack: .takeBack
                    default: nil
                    }
                    if let loop { try await LoopsModel.shared.perform(task.id, loop) }
                } else if let note = try await tasks.perform(task.id, action) {
                    app.flash(note)
                }
            } catch {
                app.flash("Couldn't update the task: \(BBClient.describe(error))")
            }
            await loadMorning()
        }
    }

    private func loadMorning() async {
        await tasks.refresh()
        guard tasks.supported == false else { return }
        await LoopsModel.shared.checkEnabled()
        guard LoopsModel.shared.enabled == true, let next = try? await app.client.loopMorning() else { return }
        morning = next
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
                         push: { [shell] route in shell.detailPath.append(route) },
                         openConversation: { id in openItem(.conversation(id)) },
                         showList: { [shell] in
                             shell.detailPath = []
                             layDown()
                         },
                         refresh: { [store] in Task { await store.refresh() } })
    }

    private func applyQAMode() {
        if let id = RoomQA.value("-qaTaskFocus") { tasks.focus = id }
        if let id = RoomQA.value("-qaPushTask") {
            Task {
                try? await Task.sleep(for: .seconds(1.5))
                if let route = NotificationActions.taskRoute(["loopId": id, "conversationId": RoomQA.value("-qaPushConversation") ?? "", "threadId": mainThreadId]) {
                    app.openTask(route.id, conversation: route.conversation)
                }
            }
        }
        if let id = RoomQA.value("-qaTaskSheet") {
            Task {
                try? await Task.sleep(for: .seconds(1.5))
                app.sheet = .task(id: id)
            }
        }
        if let id = RoomQA.value("-qaRoomConversation"), order.contains(id) {
            slide = .trailing
            pager.show(id)
        }
        guard let mode = RoomQA.mode else { return }
        switch mode {
        case "talk": room.handle(.tapInput)
        case "read": room.handle(.openChat)
        case "record", "recordLocked":
            #if DEBUG
            session.talk.qaPretend(mode == "record" ? .recording : .handsFree)
            #endif
        case "menu": room.show(.menu)
        case "settings": settingsOpen = true
        default:
            if let place = RoomPlace(rawValue: mode) { room.show(.menu, place: place) }
        }
    }
}

struct RoomPresenceHost: View {
    @ObservedObject var model: ThreadModel
    let bot: BotSpace
    let view: BotThreadsView?
    let title: String
    let main: Bool
    let record: BotConversation?
    let flight: [TaskItem]
    let onIt: [RoomOnIt]
    let yours: [TaskItem]?
    let names: TaskNames
    var menuButton: Bool
    var shown: Bool
    var bottomClear: CGFloat
    var nudge: CGFloat
    var canSwitch: Bool
    var openMenu: () -> Void
    var openChat: () -> Void
    var openTask: (String) -> Void
    var openThread: (String) -> Void
    var openTasks: () -> Void
    var act: (TaskItem, TaskAction) -> Void
    var switchBot: (Int) -> Void
    var reportPresence: (CGFloat) -> Void
    var reportPresenceFrame: (CGRect) -> Void

    var body: some View {
        let now = RoomNow.make(threadId: model.threadId, main: main, running: model.thread?.isRunning ?? record?.running ?? false, tasks: flight,
                               todos: model.shelf.todos, rows: model.rows, workers: view?.workers(of: model.threadId) ?? [], latest: record?.latest)
        RoomPresenceScreen(bot: bot, view: view, title: title, subline: RoomHeader.subline(main: main, title: title, rows: model.rows),
                           now: now, onIt: onIt, yours: yours, names: names, menuButton: menuButton, shown: shown, bottomClear: bottomClear,
                           nudge: nudge, canSwitch: canSwitch, openMenu: openMenu, openChat: openChat, openTask: openTask,
                           openThread: openThread, openTasks: openTasks, act: act, switchBot: switchBot,
                           reportPresence: reportPresence, reportPresenceFrame: reportPresenceFrame)
    }
}

struct RoomTalkWatcher: View {
    @ObservedObject var talk: HoldToTalk
    var changed: (HoldToTalk.State) -> Void
    var failed: (String) -> Void

    var body: some View {
        Color.clear
            .onChange(of: talk.state, initial: true) { _, state in changed(state) }
            .onChange(of: talk.error) { _, error in if let error { failed(error) } }
            .accessibilityHidden(true)
    }
}

struct RoomHint: View {
    @ObservedObject var talk: HoldToTalk

    var body: some View {
        if let hint = RoomModel.hint(talk.state) {
            Text(hint).font(.footnote).foregroundStyle(.white.opacity(0.7))
                .accessibilityIdentifier("roomHint")
        }
    }
}

enum RoomDock {
    static let spacing: CGFloat = 12
    static let field: CGFloat = 48
    static let top: CGFloat = 10
    static let bottom: CGFloat = 8
    static let dots: CGFloat = 6

    static func height(dots shown: Bool) -> CGFloat { top + field + bottom + (shown ? dots + spacing : 0) }
}

extension View {
    func roomPresenceSlot(_ size: CGFloat) -> some View {
        frame(maxWidth: .infinity).frame(height: size * PresenceSpec.roomHeadroom)
    }
}

struct RoomWave: View {
    @ObservedObject var talk: HoldToTalk

    var body: some View {
        HStack(spacing: 10) {
            LevelBars(tint: Color(red: 1, green: 0.54, blue: 0.54)) { [weak talk] in talk?.state == .sending ? 0 : talk?.level ?? 0 }
            Spacer(minLength: 8)
            HStack(spacing: 4) {
                Text("Listening ·")
                if let startedAt = talk.startedAt { Text(startedAt, style: .timer).monospacedDigit() }
            }
            .font(.subheadline)
            .foregroundStyle(.white.opacity(0.7))
        }
        .padding(.leading, 20)
        .padding(.trailing, 8)
        .frame(maxWidth: .infinity, minHeight: RoomDock.field)
        .accessibilityElement(children: .combine)
        .accessibilityLabel("Listening")
        .accessibilityIdentifier("roomWave")
    }
}

struct RoomMic: View {
    @ObservedObject var talk: HoldToTalk
    var tint: Color = .white
    @GestureState private var holding = false
    @State private var heldUntil: Date?

    var body: some View {
        Image(systemName: talk.isActive ? "mic.fill" : "mic")
            .font(.title3.weight(.medium))
            .foregroundStyle(talk.isActive ? Color.white : tint)
            .frame(width: 44, height: 44)
            .background(talk.isActive ? (talk.state == .cancelling ? Color.gray : Color(red: 1, green: 0.35, blue: 0.35)) : .clear, in: .circle)
            .scaleEffect(talk.isActive ? 1.12 : 1)
            .animation(.snappy(duration: 0.2), value: talk.state)
            .contentShape(.circle)
            .onTapGesture {
                if let heldUntil, Date.now.timeIntervalSince(heldUntil) < 0.5 { return }
                switch talk.state {
                case .idle: talk.press(handsFree: true)
                case .handsFree: talk.release()
                default: break
                }
            }
            .simultaneousGesture(hold)
            .onChange(of: holding) { _, holding in
                if !holding { heldUntil = .now; talk.holdLost() }
            }
            .accessibilityAddTraits(.isButton)
            .accessibilityIdentifier("roomMic")
            .accessibilityLabel(talk.state == .handsFree ? "Send recording" : "Record")
            .accessibilityHint("Tap to record, then tap again to send. Or hold to talk and let go to send; slide left to cancel.")
    }

    private var hold: some Gesture {
        LongPressGesture(minimumDuration: 0.25)
            .sequenced(before: DragGesture(minimumDistance: 0))
            .updating($holding) { value, holding, _ in
                if case .second(true, _) = value { holding = true }
            }
            .onChanged { value in
                guard case .second(true, let drag) = value else { return }
                if talk.state == .idle { talk.press() }
                if let drag { talk.drag(drag.translation) }
            }
            .onEnded { _ in
                if talk.state == .recording || talk.state == .cancelling { talk.release() }
            }
    }
}

@MainActor
final class RoomWarmth {
    private var continuation: CheckedContinuation<Void, Never>?

    static func wait(upTo limit: Duration, _ work: @escaping @MainActor () async -> Void) async {
        let warmth = RoomWarmth()
        await withCheckedContinuation { continuation in
            warmth.continuation = continuation
            Task { @MainActor in
                await work()
                warmth.finish()
            }
            Task { @MainActor in
                try? await Task.sleep(for: limit)
                warmth.finish()
            }
        }
    }

    private func finish() {
        continuation?.resume()
        continuation = nil
    }
}

struct RoomPaging: ViewModifier {
    let pages: Int
    let page: (Int) -> Void

    func body(content: Content) -> some View {
        if pages > 1 {
            content.accessibilityAdjustableAction { direction in page(direction == .increment ? 1 : -1) }
        } else {
            content
        }
    }
}
