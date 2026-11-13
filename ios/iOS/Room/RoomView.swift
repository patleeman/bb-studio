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

    static var mode: String? {
        #if DEBUG
        let arguments = ProcessInfo.processInfo.arguments
        guard let at = arguments.firstIndex(of: "-qaRoomMode"), arguments.indices.contains(at + 1) else { return nil }
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
    @State private var dragLast: CGFloat = 0
    @State private var floorTop: CGFloat = 0
    @Environment(\.look) private var look
    @Environment(\.accessibilityReduceMotion) private var systemReduceMotion
    @Environment(\.scenePhase) private var phase

    init(store: BotSpacesStore, shell: BotShellModel, bot: BotSpace, mainThreadId: String) {
        self.store = store
        self.shell = shell
        self.bot = bot
        self.mainThreadId = mainThreadId
        _pager = StateObject(wrappedValue: RoomSessions(main: mainThreadId))
    }

    private var session: RoomSession { pager.current }
    private var order: [String] { RoomPager.order(main: mainThreadId, conversations: view?.conversations ?? []) }
    private var shownConversation: BotConversation? {
        pager.shown == mainThreadId ? nil : view?.conversations.first { $0.threadId == pager.shown }
    }

    private var view: BotThreadsView? { store.view(for: bot.id) }
    private var reduceMotion: Bool { systemReduceMotion || RoomQA.reduceMotion }
    private var todayCount: Int? { morning.map { $0.items.count + $0.more } }

    var body: some View {
        GeometryReader { proxy in
            NavigationStack(path: $shell.detailPath) {
                stage(proxy)
                    .toolbar(room.standing && !FoldedChrome.columnHeader ? .automatic : .hidden, for: .navigationBar)
                    .toolbar {
                        if room.standing && !FoldedChrome.columnHeader {
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
        .onChange(of: shell.roomOpen, initial: true) { _, page in
            guard let page else { return }
            shell.roomOpen = nil
            open(page)
        }
        .task(id: phase) {
            guard phase == .active else { return }
            await loadMorning()
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
                    .padding(.top, 8)
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
        .modifier(TalkLifecycle(talk: session.talk))
    }

    static let tilt: Double = 31
    static let perspective: CGFloat = 0.45

    private func stage(_ proxy: GeometryProxy) -> some View {
        chat
            .rotation3DEffect(.degrees(room.standing ? 0 : Self.tilt), axis: (x: 1, y: 0, z: 0), anchor: .bottom, perspective: Self.perspective)
            .mask {
                GeometryReader { box in
                    let top = room.standing ? 0 : max(0, floorTop - box.frame(in: .global).minY)
                    VStack(spacing: 0) {
                        Color.clear.frame(height: top)
                        LinearGradient(colors: [.clear, .black], startPoint: .top, endPoint: .bottom).frame(height: room.standing ? 0 : 90)
                        Color.black
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
            .accessibilityAdjustableAction { direction in page(direction == .increment ? 1 : -1) }
            .accessibilityIdentifier("RoomFloor")
    }

    private func restLayers(_ proxy: GeometryProxy) -> some View {
        ZStack(alignment: .bottom) {
            if room.mode == .rest {
                floorGestures
            }
            if room.showsDay {
                RoomDayView(bot: bot, view: view, model: session.model, morning: shownConversation == nil ? morning : nil,
                            conversation: shownConversation, openMenu: openMenu,
                            openTodos: { room.showPlace(.todos) }, done: done, reportBottom: { floorTop = $0 },
                            switchBot: switchBot, nudge: nudge, canSwitch: (store.spaces?.bots.count ?? 1) > 1)
                    .transition(reduceMotion ? .opacity : .opacity.combined(with: .offset(y: -40)).combined(with: .scale(scale: 0.97, anchor: .top)))
            }
            if room.showsDay && FoldedChrome.columnHeader {
                FoldedColumn {
                    Button(action: openMenu) { Label("Everything else", systemImage: "line.3.horizontal") }
                        .accessibilityIdentifier("roomMenuButton")
                }
                .transition(.opacity)
            }
            if room.showsMenu {
                RoomMenu(bot: bot, store: store, view: view, todayCount: todayCount, close: closeMenu,
                         openPlace: { room.handle(.open($0)) }, openWorker: { openItem(.worker($0)) },
                         theme: { room.handle(.open(.theme)) }, settings: { app.tab = .settings },
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
                }
            }
            .animation(.easeInOut(duration: 0.2), value: room.mode)
        }
        .ignoresSafeArea(.keyboard)
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

    private func switchBot(_ step: Int) {
        guard let next = BotShell.step(store.spaces, from: bot.id, by: step) else {
            guard !reduceMotion else { return }
            withAnimation(.spring(response: 0.18, dampingFraction: 0.5)) { nudge = CGFloat(-step) * 22 }
            Task {
                try? await Task.sleep(for: .milliseconds(180))
                withAnimation(.spring(response: 0.35, dampingFraction: 0.6)) { nudge = 0 }
            }
            return
        }
        shell.botToast = store.spaces?.bots.first { $0.id == next }?.name
        withAnimation(.easeInOut(duration: reduceMotion ? 0.25 : 0.4)) { shell.show(next, store: store, compact: false) }
    }

    private var pageDots: some View {
        HStack(spacing: 6) {
            ForEach(order, id: \.self) { id in
                Capsule().fill(.white.opacity(id == pager.shown ? 0.9 : 0.35))
                    .frame(width: id == pager.shown ? 14 : 6, height: 6)
            }
        }
        .animation(.snappy, value: pager.shown)
        .accessibilityHidden(true)
        .accessibilityIdentifier("roomPageDots")
    }

    private var dock: some View {
        VStack(spacing: 10) {
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
                        Text(shownConversation.map { "Message · " + ($0.title.isEmpty ? "Untitled" : $0.title) } ?? "Message \(bot.name)")
                            .font(.body)
                            .foregroundStyle(.white.opacity(0.55))
                            .lineLimit(1)
                            .frame(maxWidth: .infinity, minHeight: 52, alignment: .leading)
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
        .padding(.top, 10)
        .padding(.bottom, 8)
        .animation(.snappy, value: room.mode)
    }

    private var placeBinding: Binding<RoomPlace?> {
        Binding(get: { room.place }, set: { value in if value == nil { room.handle(.closePlace) } })
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
        case .todos: .todos
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

    private func done(_ id: String) {
        Task {
            _ = try? await LoopsModel.shared.perform(id, .done)
            await loadMorning()
        }
    }

    private func loadMorning() async {
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
    let morning: LoopMorning?
    var conversation: BotConversation? = nil
    var openMenu: () -> Void
    var openTodos: () -> Void
    var done: (String) -> Void
    var reportBottom: (CGFloat) -> Void = { _ in }
    var switchBot: (Int) -> Void = { _ in }
    var nudge: CGFloat = 0
    var canSwitch = false
    @Environment(\.look) private var look

    private var day: RoomDay.Line {
        if let conversation {
            return RoomDay.Line(lead: (conversation.title.isEmpty ? "Untitled" : conversation.title) + ".",
                                rest: conversation.latest.map(RoomFloor.plain).flatMap { $0.isEmpty ? nil : $0 })
        }
        return RoomDay.line(rows: model.rows, todayCount: morning.map { $0.items.count + $0.more }, status: BotShell.status(bot, view: view))
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
        GeometryReader { proxy in
            content(Self.fit(proxy.size))
        }
    }

    private func content(_ fit: (cards: Int, presence: CGFloat)) -> some View {
        let day = day
        return VStack(alignment: .leading, spacing: 0) {
            HStack {
                Text(Date.now, format: .dateTime.weekday(.wide).month(.wide).day())
                    .font(.subheadline.weight(.medium))
                    .foregroundStyle(.white.opacity(0.72))
                    .lookHalo(look)
                Spacer()
                if !FoldedChrome.columnHeader {
                    Button(action: openMenu) {
                        Image(systemName: "line.3.horizontal").font(.body.weight(.semibold)).frame(width: 44, height: 44)
                    }
                    .buttonStyle(.plain)
                    .lookGlass(look, \.hud, in: .circle, interactive: true)
                    .accessibilityLabel("Everything else")
                    .accessibilityIdentifier("roomMenuButton")
                }
            }
            .frame(minHeight: 44)
            PresenceView(bot: bot, state: bot.presenceState(live: view),
                         workers: view?.workers.filter { $0.status == .running }.count ?? bot.activity.workers, size: fit.presence,
                         room: PresenceSpec.roomHeadroom)
                .offset(x: nudge)
                .frame(maxWidth: .infinity)
                .frame(height: fit.presence * PresenceSpec.roomHeadroom)
                .contentShape(.rect)
                .gesture(DragGesture(minimumDistance: 20).onEnded { value in
                    guard abs(value.translation.width) > 50, abs(value.translation.width) > abs(value.translation.height) * 1.5 else { return }
                    switchBot(value.translation.width < 0 ? 1 : -1)
                })
                .accessibilityElement()
                .accessibilityLabel("\(bot.name), \(BotShell.status(bot, view: view))")
                .accessibilityHint(canSwitch ? "Swipe up or down to switch Bots" : "")
                .accessibilityAdjustableAction { direction in switchBot(direction == .increment ? 1 : -1) }
            (Text(day.lead + (day.rest == nil ? "" : " ")) + Text(day.rest ?? "").foregroundStyle(.white.opacity(0.62)).fontWeight(.medium))
                .font(.title2.weight(.semibold))
                .foregroundStyle(.white)
                .lineLimit(3)
                .fixedSize(horizontal: false, vertical: true)
                .frame(maxWidth: 360, alignment: .leading)
                .lookHalo(look)
                .accessibilityIdentifier("roomDayLine")
            VStack(spacing: 6) {
                ForEach((morning?.items ?? []).prefix(fit.cards)) { item in
                    RoomCard(item: item, open: openTodos, done: { done(item.id) })
                }
            }
            .padding(.top, 18)
            .onGeometryChange(for: CGFloat.self) { $0.frame(in: .global).maxY } action: { reportBottom($0) }
            Spacer(minLength: 0)
        }
        .padding(.horizontal, 22)
        .padding(.top, 8)
        .frame(maxWidth: 640)
        .frame(maxWidth: .infinity, maxHeight: .infinity, alignment: .top)
    }
}

struct RoomCard: View {
    let item: LoopItem
    var open: () -> Void
    var done: () -> Void
    @State private var closing = false
    @Environment(\.look) private var look

    var body: some View {
        HStack(spacing: 0) {
            Button {
                closing = true
                done()
            } label: {
                Circle().strokeBorder(.white.opacity(0.5), lineWidth: 1.2)
                    .overlay { if closing { Image(systemName: "checkmark").font(.caption2.weight(.bold)) } }
                    .frame(width: 17, height: 17)
                    .frame(width: 40, height: 44)
                    .contentShape(.rect)
            }
            .buttonStyle(.plain)
            .accessibilityLabel("Done: \(item.title)")
            Button(action: open) {
                Text(item.title).font(.subheadline).foregroundStyle(.white.opacity(0.92)).lineLimit(2)
                    .padding(.vertical, 8)
                    .frame(maxWidth: .infinity, minHeight: 44, alignment: .leading)
                    .padding(.trailing, 12)
                    .contentShape(.rect)
                    .lookHalo(look)
            }
            .buttonStyle(.plain)
            .accessibilityIdentifier("roomCard-\(item.id)")
        }
        .padding(.leading, 2)
        .background(look.canvas.opacity(0.28), in: .rect(cornerRadius: 10))
        .overlay(RoundedRectangle(cornerRadius: 10).strokeBorder(.white.opacity(0.14), lineWidth: 0.5))
        .opacity(closing ? 0.5 : 1)
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
            .frame(width: 52, height: 52)
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
