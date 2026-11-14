import SwiftUI

struct RootView: View {
    @EnvironmentObject private var model: AppModel

    @State private var windowSize = CGSize.zero
    @State private var windowLeadingInset: CGFloat = 0
    @State private var windowTrailingInset: CGFloat = 0
    @State private var innerScreen = false
    @State private var pane = DuoPaneState.shared
    @ObservedObject private var spaces = BotSpacesStore.shared
    @State private var launch = SpacesLaunch(timedOut: BotSpacesStore.shared.skipsLoading)
    @State private var classic = ClassicBotActivity.shared
    @State private var tick = 0

    var body: some View {
        #if DEBUG
        let _ = RenderCount.bump("root.body")
        #endif
        let layout = DuoLayout(size: windowSize, leadingInset: windowLeadingInset, trailingInset: windowTrailingInset,
                               pane: pane.pane, dragWidth: pane.dragWidth, innerScreen: innerScreen)
        let _ = tick
        let idle = model.tab == .bot && model.path.isEmpty && model.botDraft == nil
        let quiet = model.sheet == nil && !classic.busy && !(launch.shown == .classic && ClassicBotActivity.held())
        let shown = launch.next(support: spaces.support, idle: idle, quiet: quiet, linked: model.botShowsLoops)
        Group {
            switch shown {
            case .room:
                spacesRoot(layout)
            case .loading:
                SpacesLoadingView(serverURL: spaces.serverURL)
                    .transition(.opacity)
                    .modifier(RootNotice())
            case .classic:
                HStack(spacing: 0) {
                    DuoTabRail(selection: $model.tab)
                        .frame(width: layout.railWidth)
                        .clipped()
                        .background {
                            if layout.twoPages {
                                RegularSurfaceBackground(name: "rail", style: AnyShapeStyle(.bar))
                            }
                        }
                        .accessibilityHidden(!layout.twoPages)
                    tabs
                }
            }
        }
        .animation(.easeInOut(duration: 0.25), value: shown)
        .onChange(of: shown, initial: true) { old, value in
            launch.shown = value
            if old == .loading, value != .loading { UIAccessibility.post(notification: .screenChanged, argument: nil) }
            if value == .room, model.botShowsLoops {
                model.botShowsLoops = false
                model.shellLink = .page(.todos, botId: nil)
            }
        }
        .task(id: spaces.support == .available && launch.shown == .classic && model.tab == .bot) {
            guard spaces.support == .available, launch.shown == .classic, model.tab == .bot else { return }
            while !Task.isCancelled {
                TouchClock.watch()
                try? await Task.sleep(for: .seconds(1))
                tick += 1
            }
        }
        .onAppear { TouchClock.watch() }
        .task {
            try? await Task.sleep(for: fallback)
            launch.timedOut = true
        }
        .background {
            if layout.twoPages {
                RegularSurfaceBackground(name: "root", style: AnyShapeStyle(Color(uiColor: .systemGroupedBackground)), fullWidth: true)
            }
        }
        .overlay(alignment: .top) {
            // The status-bar tap strip runs the header button under it.
            if layout.twoPages {
                StatusBarStripView()
                    .frame(height: StatusBarStrip.depth)
                    .ignoresSafeArea()
                    .allowsHitTesting(false)
            }
        }
        .environment(\.duoLayout, layout)
        .environment(pane)
        .lookRoot(bot: spaces.spaces?.current)
        .background(WindowGeometry { size, leading, trailing, inner in
            windowSize = size
            windowLeadingInset = leading
            windowTrailingInset = trailing
            innerScreen = inner
        })
    }

    private var fallback: Duration {
        #if DEBUG
        let ms = UserDefaults.standard.integer(forKey: "qaSpacesFallback")
        if ms > 0 { return .milliseconds(ms) }
        #endif
        return SpacesLaunch.fallback
    }

    private var tabVisibility: Visibility { DuoLayout(size: windowSize).twoPages ? .hidden : .automatic }

    private var tabs: some View {
        TabView(selection: $model.tab) {
            BotsTab()
                .toolbar(tabVisibility, for: .tabBar)
                .tabItem { Label("Bot", systemImage: "face.smiling") }
                .tag(Tab.bot)

            InboxTab()
                .toolbar(tabVisibility, for: .tabBar)
                .tabItem { Label("Threads", systemImage: "bubble.left.and.bubble.right") }
            .tag(Tab.inbox)

            StudioTab()
            // A Visual Chat board fills the screen down to its chat line.
            .toolbar(model.studioPath.last.map(\.isVisualChatBoard) == true ? .hidden : tabVisibility, for: .tabBar)
            .tabItem { Label("Studio", systemImage: "square.stack") }
            .tag(Tab.studio)

            SettingsTab()
                .toolbar(tabVisibility, for: .tabBar)
                .tabItem { Label("Settings", systemImage: "gear") }
                .tag(Tab.settings)
        }
        .tabViewStyle(.tabBarOnly)
        // Use our rail on a two-page window. Portrait keeps the phone tabs.
        .environment(\.horizontalSizeClass, DuoLayout(size: windowSize).twoPages ? .regular : .compact)
        .toolbar(DuoLayout(size: windowSize).twoPages ? .hidden : .automatic, for: .tabBar)
        .modifier(RootNotice())
        .modifier(RootSheets(active: true))
    }

    private var secondary: Binding<Tab?> {
        Binding(get: { model.tab == .bot ? nil : model.tab }, set: { if $0 == nil { model.tab = .bot } })
    }

    @ViewBuilder
    private func spacesRoot(_ layout: DuoLayout) -> some View {
        BotSpacesRoot(store: spaces)
            .transformEnvironment(\.horizontalSizeClass) { if layout.twoPages { $0 = .regular } }
            .modifier(RootNotice())
            .modifier(RootSheets(active: model.tab == .bot))
            .sheet(item: secondary) { tab in
                Group {
                    switch tab {
                    case .inbox: InboxTab()
                    case .studio: StudioTab()
                    case .settings: SettingsTab()
                    case .bot: EmptyView()
                    }
                }
                .environment(\.duoLayout, DuoLayout(size: .zero))
                .environment(\.horizontalSizeClass, .compact)
                .presentationDragIndicator(.visible)
                .presentationSizing(.page)
                .modifier(RootSheets(active: true))
            }
    }
}

extension Tab: Identifiable {
    var id: Self { self }
}

private struct RootNotice: ViewModifier {
    @EnvironmentObject private var model: AppModel

    func body(content: Content) -> some View {
        content
        .overlay(alignment: .bottom) {
            if let notice = model.notice {
                Text(notice)
                    .font(.subheadline.weight(.medium))
                    .multilineTextAlignment(.center)
                    .padding(.horizontal, 14)
                    .padding(.vertical, 8)
                    .background(.regularMaterial, in: .capsule)
                    .padding(.horizontal)
                    .padding(.bottom, 64)
                    .transition(.move(edge: .bottom).combined(with: .opacity))
                    .allowsHitTesting(false)
            }
        }
        .animation(.snappy, value: model.notice)
        .alert("Notification unavailable", isPresented: Binding(
            get: { model.notificationError != nil },
            set: { if !$0 { model.notificationError = nil } }
        )) {
            Button("OK", role: .cancel) { model.notificationError = nil }
        } message: {
            Text(model.notificationError ?? "")
        }
    }
}

private struct RootSheets: ViewModifier {
    @EnvironmentObject private var model: AppModel
    let active: Bool

    func body(content: Content) -> some View {
        content
        .sheet(item: active ? $model.sheet : .constant(nil)) { sheet in
            switch sheet {
            case .capture:
                CaptureSheet()
            case .dictation(let threadId, let autoStart):
                DictationView(threadId: threadId, autoStart: autoStart)
            case .recording:
                DictationView(threadId: nil, autoStart: true, kind: "recording")
            case .write:
                QuickWriteView()
            case .handsFree(let autoStart, let threadId):
                VoiceLiveView(controller: VoiceLiveController.make(client: model.client, threadId: threadId), autoStart: autoStart)
                    .presentationDragIndicator(.hidden)
            }
        }
    }
}

/// The destination stack never moves to a different structural branch on resize.
/// ThreadView owns its live model, draft and ScrollPosition throughout the change.
struct InboxTab: View {
    @EnvironmentObject private var model: AppModel
    @Environment(\.duoLayout) private var layout
    @StateObject private var inbox = InboxModel()

    var body: some View {
        RegularPages {
            ZStack {
                if layout.twoPages {
                    NavigationStack { InboxView(selectsDetail: true, model: inbox) }
                }
            }
        } detail: {
            NavigationStack(path: $model.path) {
                InboxView(model: inbox)
                .opacity(layout.twoPages ? 0 : 1)
                .accessibilityHidden(layout.twoPages)
                .overlay {
                    if layout.twoPages {
                        DuoEmptyDetail(title: "No thread selected", systemImage: Symbols.thread)
                    }
                }
                .navigationDestination(for: Route.self) { RouteDestination(route: $0) }
            }
        }
        // One live store and load task for both presentations. On the phone,
        // an inactive navigation root must not own the sidebar's data load.
        .task(id: model.serverURL) {
            inbox.restore()
            inbox.attach(model)
            await inbox.load(model.client)
        }
    }
}

/// The screen for a route, in whichever tab pushed it.
struct RouteDestination: View {
    let route: Route

    // In two switches of eight, so each type-checks quickly: one of sixteen
    // was close to what Xcode 26 gives up on.
    var body: some View {
        switch route {
        case .page: threadsAndTools.studioStar(route)
        case .thread, .pages, .automations, .automation, .usage, .archived, .memoryRecord: threadsAndTools
        case .visualChats, .visualChat: visualChat
        case .terminals: studioItems
        default: studioItems.studioStar(route)
        }
    }

    @ViewBuilder private var threadsAndTools: some View {
        switch route {
        case .thread(let id): ThreadView(threadId: id).id(id)
        case .pages: PagesView()
        case .page(let id): PageView(pageId: id).id(id)
        case .automations: AutomationsView()
        case .automation(let automation): AutomationView(automation: automation).id(automation.id)
        case .usage: UsageView()
        case .archived: ArchivedView()
        case .memoryRecord(let id): MemoryRecordLoader(id: id)
        default: EmptyView()
        }
    }

    @ViewBuilder private var studioItems: some View {
        switch route {
        case .drawing(let id): DrawingView(id: id)
        case .recording(let id): RecordingDetailView(id: id)
        case .artifact(let id): ArtifactView(id: id)
        case .design(let id): DesignView(id: id).id(id)
        case .mini(let id): MiniAppView(id: id).id(id)
        case .terminals(let scope, let title): TerminalsView(scope: scope, title: title)
        default: EmptyView()
        }
    }

    @ViewBuilder private var visualChat: some View {
        switch route {
        case .visualChats: VisualChatListView()
        case .visualChat(let threadId): VisualChatScreen(threadId: threadId).id(threadId ?? "new")
        default: EmptyView()
        }
    }
}

/// What the Bot tab shows for the selected server.
enum BotLead: Equatable {
    case loading
    case bot(BotInfo)
    case none
    case unavailable(String)

    init(_ bot: BotInfo?) { self = bot.map(BotLead.bot) ?? .none }
}
