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
    @State private var leadId: String?
    @State private var loaded = false

    var body: some View {
        NavigationStack(path: $path) {
            Group {
                if let leadId {
                    ThreadView(threadId: leadId).id(leadId)
                } else if loaded {
                    ContentUnavailableView("No chief of staff",
                                           systemImage: "person.crop.circle.badge.questionmark",
                                           description: Text("Make a thread the Personal Space's lead to see it here."))
                } else {
                    ProgressView()
                }
            }
            .navigationDestination(for: Route.self) { RouteDestination(route: $0) }
            .safeAreaInset(edge: .bottom, spacing: 0) {
                if let leadId, path.isEmpty { PushToTalkBar(threadId: leadId) }
            }
        }
        .task(id: model.tab == .chief) {
            guard model.tab == .chief else { return }
            if let id = try? await model.client.chiefOfStaffThreadId() { leadId = id }
            loaded = true
        }
    }
}

/// Hold to talk; let go to send the transcript to the thread. Slide up before
/// letting go to keep it as a Talk recording only, a quick capture.
private struct PushToTalkBar: View {
    let threadId: String
    @EnvironmentObject private var model: AppModel
    @StateObject private var recorder = TalkRecorder(client: AppModel.shared.client)
    @State private var holding = false
    /// Started by the Action button: records until the next press or a tap.
    @State private var handsFree = false
    @State private var captureOnly = false
    /// Slid left while holding: letting go discards instead of sending.
    @State private var cancelling = false
    @State private var starting: Task<Void, Never>?
    @State private var status: String?

    var body: some View {
        VStack(spacing: 6) {
            if let status {
                Text(status).font(.footnote).foregroundStyle(.secondary).lineLimit(2)
            }
            HStack(spacing: 10) {
            HStack(spacing: 10) {
                Image(systemName: !holding ? "mic.fill" : cancelling ? "xmark" : captureOnly ? "tray.and.arrow.down.fill" : "waveform")
                    .symbolEffect(.variableColor.iterative, isActive: holding && !captureOnly && !cancelling)
                Text(label).font(.headline)
                if holding, let startedAt = recorder.startedAt {
                    Text(startedAt, style: .timer).monospacedDigit().foregroundStyle(.secondary)
                }
            }
            .frame(maxWidth: .infinity, minHeight: 52)
            .foregroundStyle(holding ? .white : .primary)
            .background(!holding ? Color(.secondarySystemFill) : cancelling ? Color.gray : captureOnly ? Color.orange : Color.red, in: .capsule)
            .scaleEffect(holding ? 1.03 : 1)
            .animation(.snappy, value: holding)
            .animation(.snappy, value: captureOnly)
            .animation(.snappy, value: cancelling)
            .contentShape(.capsule)
            .gesture(
                DragGesture(minimumDistance: 0)
                    .onChanged { drag in
                        if handsFree { return }
                        if !holding { press() }
                        let left = drag.translation.width < -80
                        let up = !left && drag.translation.height < -60
                        if up != captureOnly || left != cancelling {
                            captureOnly = up
                            cancelling = left
                            UIImpactFeedbackGenerator(style: .light).impactOccurred()
                        }
                    }
                    .onEnded { _ in
                        handsFree = false
                        if cancelling { cancel() } else { release() }
                    }
            )
            .disabled(recorder.phase == .finishing)
            .accessibilityLabel("Push to talk")
            .accessibilityHint("Hold to talk to your chief of staff. Slide up before letting go to save a capture instead, or left to cancel.")
            if handsFree {
                Button { cancel() } label: {
                    Image(systemName: "xmark").font(.headline).frame(width: 52, height: 52)
                }
                .buttonStyle(.plain)
                .background(Color(.secondarySystemFill), in: .circle)
                .accessibilityLabel("Cancel")
                .transition(.scale.combined(with: .opacity))
            }
            }
            .animation(.snappy, value: handsFree)
        }
        .padding(.horizontal)
        .padding(.bottom, 8)
        .background(.bar)
        .onAppear(perform: takeActionButton)
        .onChange(of: model.chiefTalkPending) { takeActionButton() }
    }

    private func takeActionButton() {
        guard model.chiefTalkPending else { return }
        model.chiefTalkPending = false
        if handsFree || holding {
            handsFree = false
            release()
        } else if recorder.phase != .finishing {
            press()
            handsFree = true
        }
    }

    private var label: String {
        if recorder.phase == .finishing { return "Transcribing…" }
        if handsFree { return "Listening · tap to send" }
        if !holding { return "Hold to talk" }
        if cancelling { return "Release to cancel" }
        return captureOnly ? "Release to capture" : "Release to send · ↑ capture · ← cancel"
    }

    private func press() {
        holding = true
        captureOnly = false
        status = nil
        UIImpactFeedbackGenerator(style: .medium).impactOccurred()
        starting = Task { await recorder.start(kind: "dictation", threadId: threadId) }
    }

    /// Stops without sending. The audio still reaches Talk, as when closing dictation.
    private func cancel() {
        holding = false
        handsFree = false
        captureOnly = false
        cancelling = false
        let started = starting
        Task {
            await started?.value
            _ = await recorder.cancel()
            status = "Cancelled"
        }
    }

    private func release() {
        let capture = captureOnly
        holding = false
        captureOnly = false
        let started = starting
        Task {
            await started?.value
            guard recorder.phase == .recording else {
                if case .failed(let message) = recorder.phase { status = message }
                return
            }
            let spoken = (await recorder.finish() ?? "").trimmingCharacters(in: .whitespacesAndNewlines)
            if case .failed(let message) = recorder.phase { status = message; return }
            guard !spoken.isEmpty else { return }
            if capture {
                status = "Captured to Talk: \(spoken)"
            } else {
                do {
                    _ = try await model.client.send(threadId, text: spoken)
                    status = nil
                } catch {
                    status = BBClient.describe(error, server: model.client.baseURL)
                }
            }
            UINotificationFeedbackGenerator().notificationOccurred(.success)
        }
    }
}
