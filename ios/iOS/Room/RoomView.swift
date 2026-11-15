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
    @StateObject private var pager: RoomSessions
    @State private var room = RoomModel()
    @State private var dragAxis: RoomPager.Axis?
    @State private var pageOffset: CGFloat = 0
    @State private var slide: Edge = .trailing
    @State private var nudge: CGFloat = 0
    @State private var toast: String?
    @State private var morning: LoopMorning?
    @State private var tasks = TasksModel.shared
    @State private var dragLast: CGFloat = 0
    @State private var floorTop: CGFloat = 0
    @State private var maskOpen = false
    @State private var dockTop: CGFloat = 0
    @State private var sceneSize: CGSize = .zero
    @State private var presenceSize: CGFloat = 0
    @State private var switching = false
    @State private var inheritedTrailing: CGFloat = 0
    @Environment(\.look) private var look
    @Environment(\.accessibilityReduceMotion) private var systemReduceMotion
    @Environment(\.scenePhase) private var phase
    @Environment(\.duoPage) private var duoPage
    @Environment(\.displayScale) private var displayScale
    @Environment(\.colorScheme) private var scheme

    var workbench: Workbench?

    init(store: BotSpacesStore, shell: BotShellModel, bot: BotSpace, mainThreadId: String, workbench: Workbench? = nil) {
        self.store = store
        self.shell = shell
        self.bot = bot
        self.mainThreadId = mainThreadId
        self.workbench = workbench
        _pager = StateObject(wrappedValue: RoomSessions(main: mainThreadId))
    }

    private var session: RoomSession { pager.current }
    private var columnHeader: Bool { FoldedChrome.columnHeader || duoPage }
    private var order: [String] { RoomPager.order(main: mainThreadId, conversations: view?.conversations ?? []) }
    private var shownConversation: BotConversation? {
        pager.shown == mainThreadId ? nil : view?.conversations.first { $0.threadId == pager.shown }
    }

    private var view: BotThreadsView? { store.view(for: bot.id) }
    private var reduceMotion: Bool { systemReduceMotion || RoomQA.reduceMotion }
    private var todayCount: Int? {
        if tasks.supported == false { return morning.map { $0.items.count + $0.more } }
        return tasks.list.map { _ in tasks.today.count }
    }

    private var cards: [TaskItem]? {
        if tasks.supported == false { return morning.map { $0.items.map(TaskItem.init(loop:)) } }
        return tasks.list.map { _ in tasks.roomCards() }
    }

    var body: some View {
        GeometryReader { proxy in
            NavigationStack(path: workbench == nil ? $shell.detailPath : .constant([])) {
                stage(proxy)
                    .safeAreaPadding(.trailing, duoPage ? max(0, FoldedChrome.column - inheritedTrailing) : 0)
                    .background {
                        GeometryReader { box in
                            Color.clear.onChange(of: box.safeAreaInsets.trailing, initial: true) { _, inset in inheritedTrailing = inset }
                        }
                    }
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
        .background {
            RoomTalkWatcher(talk: session.talk) { state in
                withAnimation(reduceMotion ? .easeInOut(duration: 0.2) : .snappy) { room.sync(talk: state) }
            } failed: { app.flash($0) }
        }
        .onChange(of: shell.detailPath, initial: true) { _, _ in moveToWorkbench() }
        .onChange(of: workbench != nil) { _, _ in moveToWorkbench() }
        .onChange(of: room.place) { _, place in
            guard let workbench, let place else { return }
            workbench.open(.place(place))
            room.show(.rest)
        }
        .onChange(of: duoPage) { _, _ in
            UIApplication.shared.sendAction(#selector(UIResponder.resignFirstResponder), to: nil, from: nil, for: nil)
        }
        .onChange(of: shell.roomStandUp) { _, stand in
            guard stand else { return }
            shell.roomStandUp = false
            room.show(.rest)
            room.handle(.tapFloor)
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
        .onChange(of: room.standing, initial: true) { _, standing in
            withAnimation(reduceMotion ? .easeInOut(duration: 0.2) : standing ? .easeIn(duration: 0.22).delay(0.12) : .easeOut(duration: 0.06)) { maskOpen = standing }
        }
        .modifier(TalkLifecycle(talk: session.talk))
    }

    static let floorGap: CGFloat = 14
    static let floorFade: CGFloat = 72
    static let dockFade: CGFloat = 32

    static let tilt: Double = 31
    static let perspective: CGFloat = 0.45

    private func stage(_ proxy: GeometryProxy) -> some View {
        chat
            .rotation3DEffect(.degrees(room.standing ? 0 : Self.tilt), axis: (x: 1, y: 0, z: 0), anchor: .bottom, perspective: Self.perspective)
            .mask {
                GeometryReader { box in
                    let frame = box.frame(in: .global)
                    let top = max(0, floorTop + Self.floorGap - frame.minY)
                    let bottom = dockTop > 0 ? max(0, frame.maxY - dockTop + 4) : 0
                    ZStack(alignment: .top) {
                        VStack(spacing: 0) {
                            Color.clear.frame(height: top)
                            LinearGradient(colors: [.clear, .black], startPoint: .top, endPoint: .bottom).frame(height: Self.floorFade)
                            Color.black
                            LinearGradient(colors: [.black, .clear], startPoint: .top, endPoint: .bottom).frame(height: Self.dockFade)
                            Color.clear.frame(height: bottom)
                        }
                        Color.black.opacity(maskOpen ? 1 : 0)
                    }
                }
                .ignoresSafeArea()
            }
            .opacity(room.showsMenu ? 0 : 1)
            .animation(reduceMotion ? nil : .spring(response: 0.6, dampingFraction: 0.9), value: room.standing)
            .animation(.easeInOut(duration: 0.3), value: room.showsMenu)
            .allowsHitTesting(room.standing)
            .frame(maxWidth: .infinity, maxHeight: .infinity)
            .background {
                ZStack {
                    SceneBackdrop(theme: look.theme, botId: bot.id, view: view)
                        .onGeometryChange(for: CGSize.self) { $0.size } action: { sceneSize = SceneBackdrop.stillSize($0) }
                    #if DEBUG
                    Color.clear.frame(width: 1, height: 1).accessibilityElement().accessibilityIdentifier("roomScene").accessibilityValue(look.theme.id)
                    #endif
                    Rectangle().fill(.black.opacity(room.standing ? 0.5 : room.showsMenu ? 0.35 : 0.18))
                        .ignoresSafeArea()
                        .animation(.easeInOut(duration: 0.35), value: room.mode)
                }
                .allowsHitTesting(false)
            }
            .overlay { restLayers(proxy) }
    }

    private var floorGestures: some View {
        Color.clear
            .contentShape(.rect)
            .gesture(DragGesture(minimumDistance: 6)
                .onChanged { value in
                    if dragAxis == nil { dragAxis = RoomPager.axis(value.translation) }
                    switch dragAxis {
                    case .vertical:
                        let step = value.translation.height - dragLast
                        dragLast = value.translation.height
                        session.transcript?.scroll(by: step / cos(Self.tilt * .pi / 180))
                    case .horizontal:
                        let edge = RoomPager.step(order, from: pager.shown, by: value.translation.width < 0 ? 1 : -1) == nil
                        pageOffset = value.translation.width * (edge ? 0.25 : 0.6)
                    case nil:
                        break
                    }
                }
                .onEnded { value in
                    if dragAxis == .horizontal {
                        page(RoomPager.page(after: value.translation, predicted: value.predictedEndTranslation))
                    } else {
                        session.transcript?.endScroll()
                    }
                    dragAxis = nil
                    dragLast = 0
                })
            .onTapGesture { if room.mode == .rest { room.handle(.tapFloor) } }
            .accessibilityElement(children: .ignore)
            .accessibilityLabel("Main conversation")
            .accessibilityHint("Opens the conversation")
            .accessibilityAddTraits(.isButton)
            .accessibilityAction { room.handle(.tapFloor) }
            .accessibilityValue(order.count > 1 ? "Conversation \((order.firstIndex(of: pager.shown) ?? 0) + 1) of \(order.count)" : "")
            .modifier(RoomPaging(pages: order.count, page: page))
            .accessibilityIdentifier("RoomFloor")
    }

    private func restLayers(_ proxy: GeometryProxy) -> some View {
        ZStack(alignment: .bottom) {
            if room.mode == .rest {
                floorGestures
            }
            RoomDayView(bot: bot, view: view, model: session.model, cards: shownConversation == nil ? cards : nil,
                        todayCount: shownConversation == nil ? todayCount : nil,
                        conversation: shownConversation, openMenu: openMenu,
                        openTask: openTask, act: act, reportBottom: reportFloor,
                        reportPresence: { presenceSize = $0 },
                        switchBot: switchBot, nudge: nudge, canSwitch: (store.spaces?.bots.count ?? 1) > 1, shown: room.showsDay)
                .opacity(room.showsDay ? 1 : 0)
                .animation(reduceMotion ? .easeInOut(duration: 0.2) : room.showsDay ? .easeOut(duration: 0.28) : .easeOut(duration: 0.14), value: room.showsDay)
                .allowsHitTesting(room.showsDay)
                .accessibilityHidden(!room.showsDay)
            if room.showsDay && columnHeader {
                FoldedColumn {
                    Button(action: openMenu) { Label("Everything else", systemImage: "line.3.horizontal") }
                        .accessibilityIdentifier("roomMenuButton")
                }
                .transition(.opacity)
            }
            if room.showsMenu {
                RoomMenu(bot: bot, store: store, view: view, todayCount: todayCount, close: closeMenu,
                         openPlace: { room.handle(.open($0)) }, openWorker: { openItem(.worker($0)) },
                         theme: { room.handle(.open(.theme)) }, settings: openSettings,
                         switchBot: { shell.show($0, store: store, compact: false) })
                    .transition(reduceMotion ? .opacity : .opacity.combined(with: .scale(scale: 0.97)))
            }
        }
        .animation(reduceMotion ? .easeInOut(duration: 0.2) : .spring(response: 0.5, dampingFraction: 0.9), value: room.mode)
        .safeAreaInset(edge: .bottom, spacing: 0) {
            ZStack {
                if room.standing || room.showsMenu {
                    Color.clear.frame(height: 70)
                } else {
                    dock.transition(.opacity)
                        .onGeometryChange(for: CGFloat.self) { $0.frame(in: .global).minY } action: { dockTop = $0 }
                }
            }
            .animation(.easeInOut(duration: 0.2), value: room.mode)
        }
        .ignoresSafeArea(.keyboard)
        .padding(.top, proxy.safeAreaInsets.top)
        .ignoresSafeArea(.container, edges: .top)
        .environment(\.colorScheme, .dark)
    }

    private var chat: some View {
        ZStack {
            ThreadView(threadId: pager.shown, session: session)
                .id(pager.shown)
                .transition(reduceMotion ? .opacity : .push(from: slide))
        }
        .environment(\.botConversation, context(pager.shown, kind: .conversation))
        .environment(\.roomChat, RoomChat(focusRequests: room.focusRequests, lying: !room.standing, layDown: layDown))
        .environment(\.openTaskThread, { openItem(.conversation($0)) })
        .offset(x: pageOffset)
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

    private func reportFloor(_ bottom: CGFloat) {
        guard floorTop > 0, bottom < floorTop else {
            floorTop = bottom
            return
        }
        withAnimation(reduceMotion ? nil : .easeInOut(duration: 0.3).delay(0.18)) { floorTop = bottom }
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
                Capsule().fill(.white.opacity(id == pager.shown ? 0.9 : 0.35))
                    .frame(width: id == pager.shown ? 14 : RoomDock.dots, height: RoomDock.dots)
            }
        }
        .animation(.snappy, value: pager.shown)
        .accessibilityHidden(true)
        .background {
            #if DEBUG
            Color.clear.frame(width: 1, height: 1).accessibilityElement().accessibilityLabel("Pages").accessibilityIdentifier("roomPageDots")
            #endif
        }
    }

    private var dock: some View {
        VStack(spacing: RoomDock.spacing) {
            if room.mode.recording {
                RoomHint(talk: session.talk).transition(.opacity)
            } else if order.count > 1 {
                pageDots
            }
            HStack(spacing: 10) {
                if room.mode.recording {
                    RoomWave(talk: session.talk)
                } else {
                    Button { stand() } label: {
                        ZStack(alignment: .leading) {
                            Text(shownConversation.map { "Message · " + ($0.title.isEmpty ? "Untitled" : $0.title) } ?? "Message \(bot.name)")
                                .id(pager.shown)
                                .transition(.asymmetric(insertion: .opacity.animation(.easeOut(duration: 0.15).delay(0.1)),
                                                        removal: .opacity.animation(.easeIn(duration: 0.1))))
                        }
                            .font(.body)
                            .foregroundStyle(.white.opacity(0.55))
                            .lineLimit(1)
                            .frame(maxWidth: .infinity, minHeight: RoomDock.field, alignment: .leading)
                            .padding(.horizontal, 20)
                            .background(look.canvas.opacity(0.9), in: .capsule)
                            .overlay(Capsule().strokeBorder(.white.opacity(0.12)))
                            .contentShape(.capsule)
                    }
                    .buttonStyle(.plain)
                    .accessibilityLabel(shownConversation.map { "Message " + $0.title } ?? "Message \(bot.name)")
                    .accessibilityIdentifier("roomInput")
                }
                RoomMic(talk: session.talk)
            }
        }
        .padding(.horizontal, 16)
        .padding(.top, RoomDock.top)
        .padding(.bottom, RoomDock.bottom)
        .animation(.snappy, value: room.mode)
    }

    private var placeBinding: Binding<RoomPlace?> {
        Binding(get: { workbench == nil ? room.place : nil }, set: { value in if value == nil { room.handle(.closePlace) } })
    }

    private func moveToWorkbench() {
        guard let workbench, !shell.detailPath.isEmpty else { return }
        workbench.open(routes: shell.detailPath)
        shell.detailPath = []
    }

    private func openSettings() {
        guard let workbench else {
            app.tab = .settings
            return
        }
        workbench.open(.settings)
        closeMenu()
    }

    private func stand() {
        guard room.mode == .rest else { return }
        room.handle(.tapInput)
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
        room.showPlace(place)
    }

    private func openItem(_ item: BotShellItem) {
        switch item {
        case .conversation(let id) where id == mainThreadId:
            shell.detailPath = []
            room.show(.rest)
            room.handle(.tapInput)
        case .conversation(let id), .worker(let id):
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
        tasks.focus = id
        room.showPlace(.tasks)
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
        BotShell.context(threadId: threadId, kind: kind, bot: bot, view: view, splitsThreads: workbench != nil,
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
        guard let mode = RoomQA.mode else { return }
        switch mode {
        case "talk": room.handle(.tapInput)
        case "read": room.handle(.tapFloor)
        case "record", "recordLocked":
            #if DEBUG
            session.talk.qaPretend(mode == "record" ? .recording : .handsFree)
            #endif
        case "menu": room.show(.menu)
        default:
            if let place = RoomPlace(rawValue: mode) { room.show(.menu, place: place) }
        }
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

struct RoomDayView: View {
    let bot: BotSpace
    let view: BotThreadsView?
    @ObservedObject var model: ThreadModel
    @Environment(\.duoPage) private var duoPage
    let cards: [TaskItem]?
    var todayCount: Int? = nil
    var conversation: BotConversation? = nil
    var openMenu: () -> Void
    var openTask: (String) -> Void = { _ in }
    var act: (TaskItem, TaskAction) -> Void = { _, _ in }
    var reportBottom: (CGFloat) -> Void = { _ in }
    var reportPresence: (CGFloat) -> Void = { _ in }
    var switchBot: (Int) -> Void = { _ in }
    var nudge: CGFloat = 0
    var canSwitch = false
    var shown = true
    @Environment(\.look) private var look

    private var day: RoomDay.Line {
        if let conversation {
            return RoomDay.Line(lead: (conversation.title.isEmpty ? "Untitled" : conversation.title) + ".",
                                rest: conversation.latest.map(RoomFloor.plain).flatMap { $0.isEmpty ? nil : $0 })
        }
        return RoomDay.line(rows: model.rows, todayCount: todayCount, status: BotShell.status(bot, view: view))
    }

    static func height(_ task: TaskItem) -> CGFloat {
        let subtitle = !task.isMine || TaskRules.roomLine(task) != nil
        var height = max(44, 16 + (task.title.count > 34 ? 40 : 20) + (subtitle ? 16 : 0))
        if task.isMine && task.kind == .decide && !task.options.isEmpty { height += 38 }
        return CGFloat(height)
    }

    static func fitting(_ tasks: [TaskItem], count: Int) -> [TaskItem] {
        let budget = CGFloat(count) * 46 + CGFloat(max(0, count - 1)) * 6
        var used: CGFloat = 0
        var out: [TaskItem] = []
        for task in tasks.prefix(count) {
            let next = used + height(task) + (out.isEmpty ? 0 : 6)
            if !out.isEmpty && next > budget { break }
            used = next
            out.append(task)
        }
        return out
    }

    static func fit(_ size: CGSize) -> (cards: Int, presence: CGFloat) {
        let cards = switch size.height {
        case 680...: 5
        case 600..<680: 3
        default: 2
        }
        return (cards, (min(size.width * 0.28, size.height * 0.16)).rounded())
    }

    var body: some View {
        let day = day
        RoomColumn(reportPresence: reportPresence) {
            HStack {
                Text(Date.now, format: .dateTime.weekday(.wide).month(.wide).day())
                    .font(.subheadline.weight(.medium))
                    .foregroundStyle(.white.opacity(0.72))
                    .lookHalo(look)
                Spacer()
                if !(FoldedChrome.columnHeader || duoPage) && !shown {
                    Color.clear.frame(width: 44, height: 44)
                } else if !(FoldedChrome.columnHeader || duoPage) {
                    Button(action: openMenu) {
                        Image(systemName: "line.3.horizontal").font(.body.weight(.semibold)).frame(width: 44, height: 44)
                    }
                    .buttonStyle(.plain)
                    .lookGlass(look, \.hud, in: .circle, interactive: true)
                    .accessibilityLabel("Everything else")
                    .accessibilityIdentifier("roomMenuButton")
                }
            }
        } presence: { size in
            PresenceView(bot: bot, state: bot.presenceState(live: view),
                         workers: view?.workers.filter { $0.status == .running }.count ?? bot.activity.workers, size: size,
                         room: PresenceSpec.roomHeadroom, paused: !shown)
                .offset(x: nudge)
                .roomPresenceSlot(size)
                .contentShape(.rect)
                .gesture(DragGesture(minimumDistance: 20).onEnded { value in
                    guard abs(value.translation.width) > 50, abs(value.translation.width) > abs(value.translation.height) * 1.5 else { return }
                    switchBot(value.translation.width < 0 ? 1 : -1)
                })
                .accessibilityElement()
                .accessibilityLabel("\(bot.name), \(BotShell.status(bot, view: view))")
                .accessibilityHint(canSwitch ? "Swipe up or down to switch Bots" : "")
                .accessibilityAdjustableAction { direction in switchBot(direction == .increment ? 1 : -1) }
        } below: { cards in
            ZStack(alignment: .topLeading) {
                (Text(day.lead + (day.rest == nil ? "" : " ")) + Text(day.rest ?? "").foregroundStyle(.white.opacity(0.62)).fontWeight(.medium))
                    .font(.title2.weight(.semibold))
                    .foregroundStyle(.white)
                    .lineLimit(3)
                    .fixedSize(horizontal: false, vertical: true)
                    .frame(maxWidth: 360, alignment: .leading)
                    .lookHalo(look)
                    .accessibilityIdentifier("roomDayLine")
                    .id(conversation?.threadId ?? "main")
                    .transition(.asymmetric(insertion: .opacity.animation(.easeOut(duration: 0.2).delay(0.16)),
                                            removal: .opacity.animation(.easeIn(duration: 0.14))))
            }
            .frame(maxWidth: .infinity, alignment: .leading)
            VStack(spacing: 6) {
                ForEach(RoomDayView.fitting(self.cards ?? [], count: cards)) { item in
                    RoomCard(task: item, names: TasksModel.shared.names, open: { openTask(item.id) }, act: { act(item, $0) })
                        .transition(.opacity)
                        .accessibilityHidden(!shown)
                        .allowsHitTesting(shown)
                }
            }
            .padding(.top, 18)
            .onGeometryChange(for: CGFloat.self) { $0.frame(in: .global).maxY } action: { reportBottom($0) }
        }
    }
}

struct RoomColumn<Header: View, Presence: View, Below: View>: View {
    var reportPresence: (CGFloat) -> Void = { _ in }
    @ViewBuilder var header: () -> Header
    @ViewBuilder var presence: (CGFloat) -> Presence
    @ViewBuilder var below: (Int) -> Below

    var body: some View {
        GeometryReader { proxy in
            let fit = RoomDayView.fit(proxy.size)
            VStack(alignment: .leading, spacing: 0) {
                header().frame(minHeight: 44)
                presence(fit.presence)
                below(fit.cards)
                Spacer(minLength: 0)
            }
            .onChange(of: fit.presence, initial: true) { _, size in reportPresence(size) }
            .padding(.horizontal, 22)
            .padding(.top, 8)
            .frame(maxWidth: 640)
            .frame(maxWidth: .infinity, maxHeight: .infinity, alignment: .top)
        }
    }
}

enum RoomDock {
    static let spacing: CGFloat = 10
    static let field: CGFloat = 52
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

struct RoomCard: View {
    let task: TaskItem
    let names: TaskNames
    var open: () -> Void
    var act: (TaskAction) -> Void
    @State private var closing: TaskAction?
    @Environment(\.look) private var look

    private var deciding: Bool { task.isMine && task.kind == .decide && !task.options.isEmpty }

    var body: some View {
        VStack(alignment: .leading, spacing: 0) {
            HStack(spacing: 0) {
                leading
                Button(action: open) {
                    VStack(alignment: .leading, spacing: 2) {
                        Text(task.title).font(.subheadline).foregroundStyle(.white.opacity(0.92)).lineLimit(2)
                        if let line = subtitle {
                            Text(line).font(.caption.weight(task.needsYou ? .semibold : .regular))
                                .foregroundStyle(task.needsYou ? Color.orange : .white.opacity(0.62)).lineLimit(2)
                        }
                    }
                    .padding(.vertical, 8)
                    .frame(maxWidth: .infinity, minHeight: 44, alignment: .leading)
                    .padding(.trailing, 12)
                    .contentShape(.rect)
                    .lookHalo(look)
                }
                .buttonStyle(.plain)
                .accessibilityLabel(label)
                .accessibilityHint("Opens the task")
                .accessibilityIdentifier("roomCard-\(task.id)")
            }
            if deciding {
                options.padding(.leading, 40).padding(.trailing, 10).padding(.bottom, 10)
            }
        }
        .padding(.leading, 2)
        .background(look.canvas.opacity(0.28), in: .rect(cornerRadius: 10))
        .overlay(RoundedRectangle(cornerRadius: 10).strokeBorder(task.needsYou ? Color.orange.opacity(0.75) : .white.opacity(0.14), lineWidth: task.needsYou ? 1 : 0.5))
        .opacity(closing == nil ? 1 : 0.5)
        .contentShape(.contextMenuPreview, .rect(cornerRadius: 10))
        .contextMenu { TaskMenu(task: task, names: names, open: open, perform: run) }
        .task(id: closing) {
            guard closing != nil else { return }
            try? await Task.sleep(for: .seconds(8))
            closing = nil
        }
        .accessibilityElement(children: .contain)
        .accessibilityIdentifier("roomTask-\(task.id)")
        .accessibilityValue(TaskRules.status(task).id)
    }

    @ViewBuilder private var leading: some View {
        if deciding {
            Image(systemName: "arrow.triangle.branch").font(.caption.weight(.semibold)).foregroundStyle(.white.opacity(0.6))
                .frame(width: 40, height: 44)
                .accessibilityHidden(true)
        } else if task.isMine && !task.isClosed {
            Button {
                run(task.kind == .read ? .gotIt : .done)
            } label: {
                Circle().strokeBorder(task.needsYou ? Color.orange : .white.opacity(0.5), lineWidth: 1.2)
                    .overlay { if closing != nil { Image(systemName: "checkmark").font(.caption2.weight(.bold)) } }
                    .frame(width: 17, height: 17)
                    .frame(width: 40, height: 44)
                    .contentShape(.rect)
            }
            .buttonStyle(.plain)
            .accessibilityLabel("\(task.kind == .read ? "Got it" : "Done"): \(task.title)")
        } else {
            Circle().fill(Color.green.opacity(0.85)).frame(width: 7, height: 7)
                .frame(width: 40, height: 44)
                .accessibilityHidden(true)
        }
    }

    private var options: some View {
        FlowLayout(spacing: 6) {
            if task.options.count <= 3 {
                ForEach(task.options, id: \.self) { option in
                    Button { run(.choose(option)) } label: {
                        Text(LoopOption(option).title).font(.caption.weight(.semibold)).foregroundStyle(.white).lineLimit(1)
                            .padding(.horizontal, 12).frame(minHeight: 32)
                            .background(.white.opacity(closing == .choose(option) ? 0.32 : 0.16), in: .capsule)
                            .contentShape(.capsule)
                    }
                    .buttonStyle(.plain)
                    .disabled(closing != nil)
                    .accessibilityLabel("Choose \(option)")
                    .accessibilityIdentifier("roomOption")
                }
            } else {
                Button(action: open) {
                    Text("Choose… (\(task.options.count))").font(.caption.weight(.semibold)).foregroundStyle(.white)
                        .padding(.horizontal, 12).frame(minHeight: 32)
                        .background(.white.opacity(0.16), in: .capsule)
                }
                .buttonStyle(.plain)
                .accessibilityIdentifier("roomOption")
            }
        }
    }

    private var subtitle: String? {
        if !task.isMine { return "\(names.label(task.owner)) is on it" }
        return TaskRules.roomLine(task)
    }

    private var label: String {
        var parts = [task.title]
        if task.needsYou { parts.append("Needs you") }
        if let subtitle { parts.append(subtitle) }
        return parts.joined(separator: ", ")
    }

    private func run(_ action: TaskAction) {
        switch action {
        case .done, .gotIt, .choose, .drop: closing = action
        default: break
        }
        act(action)
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
        .padding(.horizontal, 18)
        .frame(maxWidth: .infinity, minHeight: 52)
        .background(Color(red: 0.05, green: 0.07, blue: 0.13).opacity(0.92), in: .capsule)
        .overlay(Capsule().strokeBorder(Color(red: 1, green: 0.47, blue: 0.47).opacity(0.35)))
        .accessibilityElement(children: .combine)
        .accessibilityLabel("Listening")
        .accessibilityIdentifier("roomWave")
    }
}

struct RoomMic: View {
    @ObservedObject var talk: HoldToTalk
    @GestureState private var holding = false
    @State private var heldUntil: Date?

    var body: some View {
        Image(systemName: "mic.fill")
            .font(.title3.weight(.semibold))
            .foregroundStyle(talk.isActive ? Color.white : Color(red: 0.04, green: 0.06, blue: 0.13))
            .frame(width: RoomDock.field, height: RoomDock.field)
            .background(talk.isActive ? (talk.state == .cancelling ? Color.gray : Color(red: 1, green: 0.35, blue: 0.35)) : Color(white: 0.93), in: .circle)
            .scaleEffect(talk.isActive ? 1.18 : 1)
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
