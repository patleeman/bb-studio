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

            BotTab()
                .tabItem { Label(model.botTitle ?? BotInfo.defaultName, systemImage: "person.crop.circle.badge.checkmark") }
                .tag(Tab.bot)

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
        case .drawings: DrawingsView()
        case .drawing(let id): DrawingView(id: id)
        case .recording(let id): RecordingDetailView(id: id)
        case .artifact(let id): ArtifactView(id: id)
        case .design(let id): DesignView(id: id).id(id)
        case .terminals(let scope, let title): TerminalsView(scope: scope, title: title)
        }
    }
}

/// Studio's Bot: its chat, with its state, Activity, check-ins and Pause / Resume / Stop.
private struct BotTab: View {
    @EnvironmentObject private var model: AppModel
    @State private var path: [Route] = []
    @State private var lead = BotLead.loading
    @State private var activity: BotActivity?
    @State private var attempt = 0
    @State private var editingHeartbeat = false
    @State private var showingActivity = false
    @State private var confirmingStop = false
    @State private var error: String?
    private struct LoadKey: Hashable { let visible: Bool; let server: URL; let attempt: Int }

    private var bot: BotInfo? { if case .bot(let bot) = lead { bot } else { nil } }

    var body: some View {
        NavigationStack(path: $path) {
            Group {
                switch lead {
                case .bot(let bot):
                    if let id = bot.lead.threadId {
                        ThreadView(threadId: id, hidesTabBar: false, answersActionButton: true).id("\(model.serverURL.absoluteString)|\(id)")
                            .safeAreaInset(edge: .top) { banner(bot) }
                    } else {
                        ContentUnavailableView("\(bot.name) has no chat", systemImage: "person.crop.circle.badge.questionmark",
                                               description: Text("Open a thread, then choose Make this my Bot from its ⋯ menu."))
                    }
                case .none:
                    ContentUnavailableView("No Bot yet",
                                           systemImage: "person.crop.circle.badge.questionmark",
                                           description: Text("Your Bot is an always-on agent that sees every project. Create it in Studio → Bot on your Mac, or open a thread and choose Make this my Bot from its ⋯ menu."))
                case .unavailable(let message):
                    ContentUnavailableView {
                        Label("Bot unavailable", systemImage: "exclamationmark.triangle")
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
            .toolbar {
                if let bot {
                    ToolbarItem(placement: .topBarLeading) { botMenu(bot) }
                    ToolbarItem(placement: .topBarLeading) {
                        Button { showingActivity = true } label: {
                            Label("Activity", systemImage: (activity?.needsYou.isEmpty ?? true) ? "list.bullet.rectangle" : "exclamationmark.bubble.fill")
                        }
                        .badge(activity?.needsYou.count ?? 0)
                        .accessibilityHint("What \(bot.name) is doing and what needs you")
                    }
                }
            }
            .sheet(isPresented: $editingHeartbeat, onDismiss: { attempt += 1 }) { BotHeartbeatSheet() }
            .sheet(isPresented: $showingActivity) {
                BotActivitySheet(name: bot?.name ?? BotInfo.defaultName, activity: activity) { id in
                    showingActivity = false
                    path.append(.thread(id: id))
                } refresh: { await loadActivity() }
            }
            .confirmationDialog("Stop \(bot?.name ?? BotInfo.defaultName)?", isPresented: $confirmingStop, titleVisibility: .visible) {
                Button("Stop", role: .destructive) { change(.stop) }
            } message: {
                Text("It pauses, its check-ins and automations turn off, and the running threads it started stop. Its chat and data are kept.")
            }
            .alert("Couldn't change the Bot", isPresented: Binding(get: { error != nil }, set: { if !$0 { error = nil } })) {
                Button("OK", role: .cancel) { error = nil }
            } message: { Text(error ?? "") }
        }
        .task(id: LoadKey(visible: model.tab == .bot, server: model.serverURL, attempt: attempt)) {
            guard model.tab == .bot else { return }
            let client = model.client
            // Another server's Bot is never shown for this one.
            if case .bot(let shown) = lead, client.cachedBotThreadId != shown.lead.threadId { lead = .loading }
            do {
                lead = BotLead(try await client.bot())
            } catch where BBClient.isCancellation(error) {
                return
            } catch {
                guard client.baseURL == model.serverURL else { return }
                // Offline or a server without Studio: keep what this server last said.
                if case .bot = lead {
                } else if let cached = client.cachedBotThreadId {
                    lead = .bot(BotInfo(name: client.cachedBotName, avatar: client.cachedBotAvatar ?? BotInfo.defaultAvatar, state: .active, lead: ThreadLead(threadId: cached)))
                } else {
                    lead = .unavailable(BBClient.describe(error, server: client.baseURL))
                }
            }
            model.botTitle = bot?.name
            // An Action button press with nothing to talk to must not start recording later.
            if bot?.lead.threadId == nil { model.botTalkPending = false }
            await loadActivity()
        }
    }

    private func loadActivity() async {
        guard bot != nil else { activity = nil; return }
        activity = try? await model.client.botActivity()
    }

    @ViewBuilder
    private func banner(_ bot: BotInfo) -> some View {
        if bot.state != .active {
            HStack(spacing: 8) {
                Image(systemName: bot.state == .paused ? "pause.circle.fill" : "stop.circle.fill").foregroundStyle(.orange)
                Text("\(bot.name) is \(bot.state.rawValue). It won't start new work.").font(.footnote)
                Spacer(minLength: 0)
                Button("Resume") { change(.resume) }.font(.footnote.weight(.semibold))
            }
            .padding(.horizontal).padding(.vertical, 8)
            .background(.bar)
        }
    }

    private func botMenu(_ bot: BotInfo) -> some View {
        Menu {
            Section("\(bot.title) · \(bot.state.rawValue.capitalized)") {
                Button { editingHeartbeat = true } label: { Label("Check-ins…", systemImage: "waveform.path.ecg") }
                    .disabled(bot.state != .active)
                if bot.state == .active {
                    Button { change(.pause) } label: { Label("Pause", systemImage: "pause.circle") }
                } else {
                    Button { change(.resume) } label: { Label("Resume", systemImage: "play.circle") }
                }
                if bot.state != .stopped {
                    Button(role: .destructive) { confirmingStop = true } label: { Label("Stop…", systemImage: "stop.circle") }
                }
            }
        } label: {
            Text(bot.avatar).font(.title3).accessibilityLabel("\(bot.name), \(bot.state.rawValue)")
        }
    }

    private func change(_ action: BotInfo.Action) {
        Task {
            do {
                if let next = try await model.client.setBotState(action) { lead = .bot(next) }
                await loadActivity()
            } catch {
                self.error = BBClient.describe(error, server: model.client.baseURL)
            }
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

/// The Bot's Needs you and Activity: In progress, Scheduled, Completed.
struct BotActivitySheet: View {
    let name: String
    let activity: BotActivity?
    var open: (String) -> Void
    var refresh: () async -> Void
    @Environment(\.dismiss) private var dismiss

    var body: some View {
        NavigationStack {
            List {
                threads("Needs you", activity?.needsYou, empty: "Nothing needs you.")
                threads("In progress", activity?.inProgress, empty: "Nothing running.")
                Section("Scheduled") {
                    if let scheduled = activity?.scheduled, !scheduled.isEmpty {
                        ForEach(scheduled) { item in
                            LabeledContent {
                                Text(!item.enabled ? "Off" : item.nextRunAt.map { Date(timeIntervalSince1970: $0 / 1000).formatted(date: .abbreviated, time: .shortened) } ?? "On")
                            } label: {
                                Label(item.name, systemImage: item.kind == "heartbeat" ? "waveform.path.ecg" : "clock")
                            }
                        }
                    } else {
                        Text("No check-ins or automations.").foregroundStyle(.secondary)
                    }
                }
                threads("Completed", activity?.completed, empty: "Threads it starts show here when they finish.")
            }
            .refreshable { await refresh() }
            .navigationTitle("\(name)'s Activity")
            .navigationBarTitleDisplayMode(.inline)
            .toolbar { ToolbarItem(placement: .confirmationAction) { Button("Done") { dismiss() } } }
        }
    }

    private func threads(_ title: String, _ rows: [BotActivity.Thread]?, empty: String) -> some View {
        Section(title) {
            if let rows, !rows.isEmpty {
                ForEach(rows) { row in
                    Button { open(row.id) } label: {
                        Label {
                            VStack(alignment: .leading, spacing: 2) {
                                Text(row.relation == "self" ? "Its chat" : row.title).lineLimit(1)
                                Text(row.needsYou ? "Waiting for you" : Date(timeIntervalSince1970: row.updatedAt / 1000).formatted(.relative(presentation: .named)))
                                    .font(.caption).foregroundStyle(.secondary)
                            }
                        } icon: {
                            Image(systemName: row.needsYou ? "exclamationmark.bubble" : row.relation == "self" ? "bubble.left" : "arrow.triangle.branch")
                                .foregroundStyle(row.needsYou ? .orange : .secondary)
                        }
                    }
                    .foregroundStyle(.primary)
                }
            } else {
                Text(empty).foregroundStyle(.secondary)
            }
        }
    }
}
