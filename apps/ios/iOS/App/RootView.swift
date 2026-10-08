import SwiftUI

struct RootView: View {
    @EnvironmentObject private var model: AppModel

    var body: some View {
        TabView(selection: $model.tab) {
            InboxTab()
                .tabItem { Label("Home", systemImage: "house") }
            .tag(Tab.inbox)

            NavigationStack(path: $model.studioPath) {
                StudioHomeView().navigationDestination(for: Route.self) { RouteDestination(route: $0) }
            }
            .tabItem { Label("Studio", systemImage: "square.stack") }
            .tag(Tab.studio)

            ChiefOfStaffTab()
                .tabItem { Label("Chief of Staff", systemImage: "person.crop.circle.badge.checkmark") }
                .tag(Tab.chief)

            NavigationStack { SettingsView() }
                .tabItem { Label("Settings", systemImage: "gear") }
                .tag(Tab.settings)
        }
        .tabViewStyle(.sidebarAdaptable)
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
                    ContentUnavailableView("No thread selected", systemImage: Symbols.thread)
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
        case .pages: PagesView()
        case .page(let id): PageView(pageId: id).id(id)
        case .automations: AutomationsView()
        case .automation(let automation): AutomationView(automation: automation).id(automation.id)
        case .usage: UsageView()
        case .archived: ArchivedView()
        case .spaceArchived(let id): ArchivedView(spaceId: id).id(id)
        case .drawings: DrawingsView()
        case .drawing(let id): DrawingView(id: id)
        case .recording(let id): RecordingDetailView(id: id)
        case .artifact(let id): ArtifactView(id: id)
        case .table(let id): StudioTableView(id: id).id(id)
        case .design(let id): DesignView(id: id).id(id)
        case .terminals(let scope, let title): TerminalsView(scope: scope, title: title)
        }
    }
}

/// The Personal Space's lead thread, the agent to go to first.
private struct ChiefOfStaffTab: View {
    @EnvironmentObject private var model: AppModel
    @State private var path: [Route] = []
    @State private var lead = ChiefLead.loading
    @State private var attempt = 0
    private struct LoadKey: Hashable { let visible: Bool; let server: URL; let attempt: Int }

    var body: some View {
        NavigationStack(path: $path) {
            Group {
                switch lead {
                case .thread(let id):
                    ThreadView(threadId: id, hidesTabBar: false, answersActionButton: true).id("\(model.serverURL.absoluteString)|\(id)")
                case .none:
                    ContentUnavailableView("No chief of staff",
                                           systemImage: "person.crop.circle.badge.questionmark",
                                           description: Text("Make a thread the Personal Space's lead to see it here."))
                case .unavailable(let message):
                    ContentUnavailableView {
                        Label("Chief of Staff unavailable", systemImage: "exclamationmark.triangle")
                    } description: {
                        Text(message)
                    } actions: {
                        Button("Retry") { attempt += 1 }
                    }
                case .loading:
                    ProgressView()
                }
            }
            .navigationDestination(for: Route.self) { RouteDestination(route: $0) }
        }
        .task(id: LoadKey(visible: model.tab == .chief, server: model.serverURL, attempt: attempt)) {
            guard model.tab == .chief else { return }
            let client = model.client
            // Another server's lead is never shown for this one.
            if case .thread(let shown) = lead, client.cachedChiefOfStaffThreadId != shown { lead = .loading }
            do {
                lead = ChiefLead(try await client.chiefOfStaffThreadId())
            } catch where BBClient.isCancellation(error) {
                return
            } catch {
                guard client.baseURL == model.serverURL else { return }
                // Offline or a server without Studio: keep what this server last said.
                if case .thread = lead {
                } else if let cached = client.cachedChiefOfStaffThreadId {
                    lead = .thread(cached)
                } else {
                    lead = .unavailable(BBClient.describe(error, server: client.baseURL))
                }
            }
            // An Action button press with nothing to talk to must not start recording later.
            if case .thread = lead {} else { model.chiefTalkPending = false }
        }
    }
}

/// What the Chief of Staff tab shows for the selected server.
enum ChiefLead: Equatable {
    case loading
    case thread(String)
    case none
    case unavailable(String)

    init(_ threadId: String?) { self = threadId.map(ChiefLead.thread) ?? .none }
}
