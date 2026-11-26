import SwiftUI

struct RootView: View {
    @EnvironmentObject private var model: AppModel
    @ObservedObject private var spaces = BotSpacesStore.shared
    @State private var timedOut = false
    @State private var attempt = 0

    var body: some View {
        #if DEBUG
        let _ = RenderCount.bump("root.body")
        #endif
        let shown = StudioLaunch.shown(support: spaces.support, failed: spaces.answeredWithError, timedOut: timedOut)
        Group {
            switch shown {
            case .room:
                ShellRoot(store: spaces)
            case .loading:
                SpacesLoadingView(serverURL: spaces.serverURL)
                    .transition(.opacity)
            case .unreachable:
                NavigationStack {
                    StudioUnreachableView(unavailable: spaces.support == .unavailable, error: spaces.error,
                                          serverURL: spaces.serverURL, retry: retry)
                }
                .transition(.opacity)
            }
        }
        .modifier(RootNotice())
        // Capture, dictation, Write and the rest work while Studio loads, too.
        .modifier(RootSheets())
        .animation(.easeInOut(duration: 0.25), value: shown)
        .onChange(of: shown) { old, _ in
            if old == .loading { UIAccessibility.post(notification: .screenChanged, argument: nil) }
        }
        .task(id: attempt) {
            timedOut = false
            try? await Task.sleep(for: timeout)
            timedOut = true
        }
    }

    private func retry() {
        attempt += 1
        spaces.retryNow()
    }

    private var timeout: Duration {
        #if DEBUG
        let ms = UserDefaults.standard.integer(forKey: "qaSpacesFallback")
        if ms > 0 { return .milliseconds(ms) }
        #endif
        return StudioLaunch.timeout
    }
}

/// Studio's Bots didn't answer: it isn't installed on this server, the server
/// answered with an error, or nothing came back in time.
struct StudioUnreachableView: View {
    let unavailable: Bool
    let error: String?
    let serverURL: URL
    let retry: () -> Void

    var body: some View {
        ContentUnavailableView {
            Label(unavailable ? "Studio isn't on this server" : "Can't reach Studio", systemImage: unavailable ? "puzzlepiece.extension" : "wifi.exclamationmark")
        } description: {
            Text(unavailable
                 ? "Install BB Studio on \(serverURL.host() ?? serverURL.absoluteString), then try again."
                 : error ?? "\(serverURL.host() ?? serverURL.absoluteString) didn't answer.")
        } actions: {
            Button("Try Again", action: retry)
                .buttonStyle(.borderedProminent)
                .accessibilityIdentifier("studioRetry")
            NavigationLink("Settings") { SettingsView() }
                .accessibilityIdentifier("studioSettings")
        }
        .accessibilityElement(children: .contain)
        .accessibilityIdentifier("studioUnreachable")
    }
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
    @ObservedObject private var router = Router.shared
    @EnvironmentObject private var model: AppModel

    func body(content: Content) -> some View {
        content
        .sheet(item: $router.sheet) { sheet in
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

/// The screen for a route, in whichever tab pushed it.
struct RouteDestination: View {
    let route: Route

    // In two switches of eight, so each type-checks quickly: one of sixteen
    // was close to what Xcode 26 gives up on.
    var body: some View {
        switch route {
        case .page: threadsAndTools.studioStar(route)
        case .thread, .pages, .automations, .automation, .usage, .archived: threadsAndTools
        case .visualChats, .visualChat: visualChat
        case .terminals: studioItems
        default: studioItems.studioStar(route)
        }
    }

    @ViewBuilder private var threadsAndTools: some View {
        switch route {
        case .thread(let id): ConversationScreen(threadId: id).id(id)
        case .pages: PagesView()
        case .page(let id): PageView(pageId: id).id(id)
        case .automations: AutomationsView()
        case .automation(let automation): AutomationView(automation: automation).id(automation.id)
        case .usage: UsageView()
        case .archived: ArchivedView()
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
