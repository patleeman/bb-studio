import SwiftUI

struct RootView: View {
    @EnvironmentObject private var model: AppModel
    @State private var office = OfficeContext(client: AppModel.shared.client)

    /// Whatever opens joins Today; something new from another Space opens
    /// there, and the app follows it (Space routing).
    private func noteOpened(_ route: Route) async {
        guard let landed = await office.tabs?.noteOpened(route, client: model.client) else { return }
        await office.select(landed)
    }

    var body: some View {
        TabView(selection: $model.tab) {
            OfficeInboxTab()
                .tabItem { Label("Inbox", systemImage: "tray") }
                .badge(office.inboxBadge)
                .tag(Tab.inbox)

            TabsTab()
                .tabItem { Label("Tabs", systemImage: "square.on.square") }
                .tag(Tab.tabs)

            NavigationStack { SettingsView() }
                .tabItem { Label("Settings", systemImage: "gear") }
                .tag(Tab.settings)
        }
        .tabViewStyle(.sidebarAdaptable)
        .alert("Notification unavailable", isPresented: Binding(
            get: { model.notificationError != nil },
            set: { if !$0 { model.notificationError = nil } }
        )) {
            Button("OK", role: .cancel) { model.notificationError = nil }
        } message: {
            Text(model.notificationError ?? "")
        }
        .environment(office)
        .task(id: model.serverURL) {
            if office.spaces.currentSpaceId == nil || office.home == nil { office = OfficeContext(client: model.client) }
            office.observe(model.realtime)
            await office.load()
        }
        .onDisappear { office.stopObserving() }
        // Whatever you open, in either stack, joins Today (docs/office-tabs.md).
        .onChange(of: model.path.last) { _, route in
            if let route { Task { await noteOpened(route) } }
        }
        .onChange(of: model.inboxPath.last) { _, route in
            if let route { Task { await noteOpened(route) } }
        }
        .sheet(
            isPresented: Binding(get: { model.newThreadDraft != nil }, set: { if !$0 { model.newThreadDraft = nil } })
        ) {
            NewThreadView(text: model.newThreadDraft ?? "")
        }
        .sheet(item: $model.sheet) { sheet in
            switch sheet {
            case .capture:
                CaptureSheet()
            case .dictation(let threadId, let autoStart):
                DictationView(threadId: threadId, autoStart: autoStart)
            case .recording:
                DictationView(threadId: nil, autoStart: true, kind: "recording")
            case .voiceChat(let threadId):
                VoiceChatView(threadId: threadId)
            case .write:
                QuickWriteView()
            case .newTasks:
                QuickTaskView()
            }
        }
    }
}

/// The screen for a route, in whichever tab pushed it.
struct RouteDestination: View {
    let route: Route

    var body: some View {
        switch route {
        case .thread(let id): ThreadView(threadId: id).id(id)
        case .savedView(let id): SavedViewScreen(id: id)
        case .pages: PagesView()
        case .page(let id): PageView(pageId: id).id(id)
        case .automations: AutomationsView()
        case .automation(let automation): AutomationView(automation: automation).id(automation.id)
        case .usage: UsageView()
        case .archived: ArchivedView()
        case .drawings: DrawingsView()
        case .drawing(let id): DrawingView(id: id)
        case .recording(let id): RecordingDetailView(id: id)
        case .artifact(let id): ArtifactView(id: id)
        case .tasks: TasksView()
        case .task(let id): TaskView(id: id).id(id)
        case .table(let id): StudioTableView(id: id).id(id)
        case .terminals(let scope, let title): TerminalsView(scope: scope, title: title)
        case .bot(let id): BotView(id: id)
        case .space(let id): SpaceRouteView(id: id).id(id)
        case .feed: FeedView()
        case .feedPost(let id): FeedPostView(id: id).id(id)
        case .studioCollection: StudioView()
        case .botDesk(let id): BotDeskView(botId: id).id(id)
        case .officeHome: OfficeHomeScreen()
        case .officeTeam: OfficeTeamScreen()
        }
    }
}
