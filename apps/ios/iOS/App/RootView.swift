import SwiftUI

struct RootView: View {
    @EnvironmentObject private var model: AppModel

    var body: some View {
        TabView(selection: $model.tab) {
            InboxTab()
                .tabItem { Label("Home", systemImage: "house") }
            .tag(Tab.inbox)

            NavigationStack(path: $model.studioPath) {
                StudioView().navigationDestination(for: Route.self) { RouteDestination(route: $0) }
            }
            .tabItem { Label("Studio", systemImage: "square.stack") }
            .tag(Tab.studio)

            NavigationStack {
                WebTab()
                    .navigationTitle("BB Web")
                    .navigationBarTitleDisplayMode(.inline)
            }
            .tabItem { Label("Web", systemImage: "globe") }
            .tag(Tab.web)

            NavigationStack { SettingsView() }
                .tabItem { Label("Settings", systemImage: "gear") }
                .tag(Tab.settings)
        }
        .tabViewStyle(.sidebarAdaptable)
        .sheet(item: $model.sheet) { sheet in
            switch sheet {
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

/// A stack on iPhone; on iPad, the inbox beside the open thread.
struct InboxTab: View {
    @EnvironmentObject private var model: AppModel
    @Environment(\.horizontalSizeClass) private var sizeClass

    var body: some View {
        if sizeClass == .regular {
            NavigationSplitView {
                InboxView().navigationSplitViewColumnWidth(min: 320, ideal: 380, max: 480)
            } detail: {
                NavigationStack(path: $model.path) {
                    ContentUnavailableView("No thread selected", systemImage: "bubble.left.and.bubble.right")
                        .navigationDestination(for: Route.self) { RouteDestination(route: $0) }
                }
            }
        } else {
            NavigationStack(path: $model.path) {
                InboxView().navigationDestination(for: Route.self) { RouteDestination(route: $0) }
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
        case .room(let room): ChannelView(room: room)
        case .pages: PagesView()
        case .page(let id): PageView(pageId: id).id(id)
        case .automations: AutomationsView()
        case .automation(let automation): AutomationView(automation: automation).id(automation.id)
        case .usage: UsageView()
        case .queue: QueueView()
        case .archived: ArchivedView()
        case .drawings: DrawingsView()
        case .attention: AttentionView()
        case .drawing(let id): DrawingView(id: id)
        case .recording(let id): RecordingDetailView(id: id)
        case .artifact(let id): ArtifactView(id: id)
        case .tasks: TasksView()
        case .task(let id): TaskView(id: id).id(id)
        case .terminals(let scope, let title): TerminalsView(scope: scope, title: title)
        case .machines: MachinesView()
        case .bot(let id): BotView(id: id)
        }
    }
}

/// BB Web keeps its own socket and re-renders on every change, even on another
/// tab, so it unloads once it has been out of sight for a while.
private struct WebTab: View {
    @EnvironmentObject private var model: AppModel
    @State private var mounted = false

    var body: some View {
        Group {
            if mounted {
                WebView(url: model.serverURL).ignoresSafeArea(edges: .bottom)
            } else {
                Color.clear
            }
        }
        .task(id: model.tab == .web) {
            guard model.tab != .web else {
                mounted = true
                return
            }
            try? await Task.sleep(for: .seconds(120))
            if !Task.isCancelled { mounted = false }
        }
    }
}
