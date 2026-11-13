import SwiftUI

@MainActor
final class RoomSession: ObservableObject {
    let threadId: String
    let model: ThreadModel
    let talk: HoldToTalk

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
    @StateObject private var session: RoomSession
    @State private var room = RoomModel()
    @State private var morning: LoopMorning?
    @State private var theming = false
    @State private var chatMounted = false
    @Environment(\.look) private var look
    @Environment(\.accessibilityReduceMotion) private var systemReduceMotion
    @Environment(\.scenePhase) private var phase

    init(store: BotSpacesStore, shell: BotShellModel, bot: BotSpace, mainThreadId: String) {
        self.store = store
        self.shell = shell
        self.bot = bot
        self.mainThreadId = mainThreadId
        _session = StateObject(wrappedValue: RoomSession(threadId: mainThreadId))
    }

    private var view: BotThreadsView? { store.view(for: bot.id) }
    private var reduceMotion: Bool { systemReduceMotion || RoomQA.reduceMotion }
    private var todayCount: Int? { morning.map { $0.items.count + $0.more } }

    var body: some View {
        GeometryReader { proxy in
            NavigationStack(path: $shell.detailPath) {
                stage(proxy)
                    .toolbar(room.standing ? .visible : .hidden, for: .navigationBar)
                    .toolbar {
                        if room.standing {
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
                               closeToRoom: { room.show(.rest) })
                    .presentationDetents([.height(max(320, proxy.size.height + proxy.safeAreaInsets.bottom - RoomPlaceSheet.sliver))])
                    .presentationCornerRadius(14)
                    .presentationDragIndicator(.visible)
                    .presentationBackground(look.canvas)
            }
            .sheet(isPresented: $theming) {
                NavigationStack { LookSettingsView() }
                    .presentationDragIndicator(.visible)
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
        .onChange(of: room.standing) { _, standing in mountChat(standing) }
        .task { applyQAMode() }
        .task { await session.start(app) }
        .onDisappear { session.stop() }
        .modifier(TalkLifecycle(talk: session.talk))
    }

    private func stage(_ proxy: GeometryProxy) -> some View {
        ZStack {
            if chatMounted { chat.transition(.opacity) }
        }
        .frame(maxWidth: .infinity, maxHeight: .infinity)
        .background {
            ZStack {
                SceneBackdrop(theme: look.theme, botId: bot.id, view: view)
                Rectangle().fill(.black.opacity(room.standing ? 0.5 : room.showsMenu ? 0.35 : 0))
                    .ignoresSafeArea()
                    .animation(.easeInOut(duration: 0.35), value: room.mode)
            }
            .allowsHitTesting(false)
        }
        .overlay { restLayers(proxy) }
    }

    private func restLayers(_ proxy: GeometryProxy) -> some View {
        ZStack(alignment: .bottom) {
            if !chatMounted || !room.standing {
                floor(min(430, proxy.size.height * 0.5))
            }
            if room.showsDay {
                RoomDayView(bot: bot, view: view, model: session.model, morning: morning, openMenu: openMenu,
                            openTodos: { room.showPlace(.todos) }, done: done)
                    .transition(reduceMotion ? .opacity : .opacity.combined(with: .offset(y: -40)).combined(with: .scale(scale: 0.97, anchor: .top)))
            }
            if room.showsMenu {
                RoomMenu(bot: bot, store: store, view: view, todayCount: todayCount, close: closeMenu,
                         openPlace: { room.handle(.open($0)) }, openWorker: { openItem(.worker($0)) },
                         theme: { theming = true }, settings: { app.tab = .settings },
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
        ThreadView(threadId: mainThreadId, session: session)
            .environment(\.botConversation, context(mainThreadId, kind: .conversation))
            .environment(\.roomChat, RoomChat(focusRequests: room.focusRequests, layDown: layDown))
    }

    private func mountChat(_ standing: Bool) {
        guard standing else {
            withAnimation(.easeOut(duration: reduceMotion ? 0.2 : 0.14)) { chatMounted = false }
            return
        }
        Task {
            try? await Task.sleep(for: .milliseconds(reduceMotion ? 100 : 320))
            guard room.standing else { return }
            withAnimation(.easeIn(duration: 0.2)) { chatMounted = true }
        }
    }

    private func floor(_ height: CGFloat) -> some View {
        RoomFloorView(model: session.model, look: look)
            .padding(.horizontal, 18)
            .frame(maxWidth: 640)
            .frame(height: height, alignment: .bottom)
            .rotation3DEffect(.degrees(room.standing && !reduceMotion ? 0 : 62), axis: (x: 1, y: 0, z: 0), anchor: .bottom, perspective: 0.55)
            .mask {
                LinearGradient(stops: [.init(color: .black, location: 0), .init(color: .black, location: room.standing ? 0.85 : 0.3),
                                       .init(color: .clear, location: room.standing ? 1 : 0.92)], startPoint: .bottom, endPoint: .top)
            }
            .opacity(chatMounted || room.showsMenu ? 0 : 0.92)
            .animation(floorAnimation, value: room.mode)
            .animation(.easeInOut(duration: 0.25), value: chatMounted)
            .padding(.bottom, 8)
            .contentShape(.rect)
            .onTapGesture { if room.mode == .rest { room.handle(.tapFloor) } }
            .allowsHitTesting(room.mode == .rest)
            .accessibilityElement(children: .ignore)
            .accessibilityLabel("Main conversation, last messages")
            .accessibilityHint("Opens the conversation")
            .accessibilityAddTraits(.isButton)
            .accessibilityIdentifier("RoomFloor")
            .accessibilityHidden(room.standing || room.showsMenu)
    }

    private var floorAnimation: Animation {
        if reduceMotion { return .easeInOut(duration: 0.2) }
        return room.standing ? .spring(response: 0.6, dampingFraction: 0.9) : .spring(response: 0.6, dampingFraction: 0.9).delay(0.1)
    }

    private var dock: some View {
        VStack(spacing: 10) {
            if room.mode.recording {
                RoomHint(talk: session.talk).transition(.opacity)
            }
            HStack(spacing: 10) {
                if room.mode.recording {
                    RoomWave(talk: session.talk)
                } else {
                    Button { stand() } label: {
                        Text("Message \(bot.name)")
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
                    .accessibilityLabel("Message \(bot.name)")
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

struct RoomFloorView: View {
    @ObservedObject var model: ThreadModel
    let look: Look

    var body: some View {
        VStack(spacing: 12) {
            ForEach(RoomFloor.lines(model.rows)) { line in
                Text(line.text)
                    .font(.body)
                    .lineLimit(2)
                    .foregroundStyle(.white)
                    .padding(.horizontal, line.who == .me ? 13 : 0)
                    .padding(.vertical, line.who == .me ? 9 : 0)
                    .background {
                        if line.who == .me { UnevenRoundedRectangle(cornerRadii: .init(topLeading: 18, bottomLeading: 18, bottomTrailing: 4, topTrailing: 18)).fill(look.accent.opacity(0.55)) }
                    }
                    .frame(maxWidth: 520, alignment: line.who == .me ? .trailing : .leading)
                    .frame(maxWidth: .infinity, alignment: line.who == .me ? .trailing : .leading)
                    .padding(line.who == .me ? .leading : .trailing, 40)
                    .lookHalo(look)
            }
        }
        .frame(maxHeight: .infinity, alignment: .bottom)
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
    var openMenu: () -> Void
    var openTodos: () -> Void
    var done: (String) -> Void
    @Environment(\.look) private var look

    private var day: RoomDay.Line {
        RoomDay.line(rows: model.rows, todayCount: morning.map { $0.items.count + $0.more }, status: BotShell.status(bot, view: view))
    }

    static func fit(height: CGFloat) -> (cards: Int, presence: CGFloat) {
        switch height {
        case 680...: (5, 150)
        case 600..<680: (3, 130)
        default: (2, 100)
        }
    }

    var body: some View {
        GeometryReader { proxy in
            content(Self.fit(height: proxy.size.height))
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
                Button(action: openMenu) {
                    Image(systemName: "line.3.horizontal").font(.body.weight(.semibold)).frame(width: 44, height: 44)
                }
                .buttonStyle(.plain)
                .lookGlass(look, \.hud, in: .circle, interactive: true)
                .accessibilityLabel("Everything else")
                .accessibilityIdentifier("roomMenuButton")
            }
            PresenceView(bot: bot, state: bot.presenceState(live: view),
                         workers: view?.workers.filter { $0.status == .running }.count ?? bot.activity.workers, size: fit.presence)
                .frame(maxWidth: .infinity)
                .frame(height: fit.presence + 18)
                .accessibilityElement()
                .accessibilityLabel("\(bot.name), \(BotShell.status(bot, view: view))")
            (Text(day.lead + (day.rest == nil ? "" : " ")) + Text(day.rest ?? "").foregroundStyle(.white.opacity(0.62)).fontWeight(.medium))
                .font(.title2.weight(.semibold))
                .foregroundStyle(.white)
                .lineLimit(3)
                .fixedSize(horizontal: false, vertical: true)
                .frame(maxWidth: 360, alignment: .leading)
                .lookHalo(look)
                .accessibilityIdentifier("roomDayLine")
            VStack(spacing: 8) {
                ForEach((morning?.items ?? []).prefix(fit.cards)) { item in
                    RoomCard(item: item, open: openTodos, done: { done(item.id) })
                }
            }
            .padding(.top, 18)
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
                Circle().strokeBorder(.white.opacity(0.45), lineWidth: 1.5)
                    .overlay { if closing { Image(systemName: "checkmark").font(.caption.weight(.bold)) } }
                    .frame(width: 22, height: 22)
                    .frame(width: 44, height: 52)
                    .contentShape(.rect)
            }
            .buttonStyle(.plain)
            .accessibilityLabel("Done: \(item.title)")
            Button(action: open) {
                Text(item.title).font(.body).foregroundStyle(.white).lineLimit(2)
                    .frame(maxWidth: .infinity, minHeight: 52, alignment: .leading)
                    .padding(.trailing, 14)
                    .contentShape(.rect)
            }
            .buttonStyle(.plain)
            .accessibilityIdentifier("roomCard-\(item.id)")
        }
        .padding(.leading, 4)
        .background(look.canvas.opacity(0.86), in: .rect(cornerRadius: 8))
        .overlay(RoundedRectangle(cornerRadius: 8).strokeBorder(.white.opacity(0.07)))
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
