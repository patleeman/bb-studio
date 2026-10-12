import SwiftUI

/// One bot's chat, with its status, Activity, voice, profile, check-ins and
/// Pause / Resume / Stop. Without a Bot, it greets you and the first message
/// makes it. Every call is scoped to `botId`; nil is the primary bot.
struct BotTab: View {
    /// The bot to show; nil for the primary.
    var botId: String? = nil
    /// Back to the Bots list.
    var back: (() -> Void)? = nil
    @EnvironmentObject private var model: AppModel
    @State private var path: [Route] = []
    @State private var lead = BotLead.loading
    @State private var activity: BotActivity?
    /// The Bot's handoff chain, oldest first (`bot_chain`).
    @State private var chain: [String] = []
    /// BB's metadata for the threads the Activity says the Bot started.
    @State private var startedThreads: [String: ThreadEntry] = [:]
    @State private var attempt = 0
    @State private var sheet: BotSheet?
    @State private var confirmingStop = false
    @State private var error: String?
    private struct LoadKey: Hashable { let visible: Bool; let server: URL; let botId: String?; let attempt: Int }

    private var bot: BotInfo? { if case .bot(let bot) = lead { bot } else { nil } }
    private var needsYou: Int { activity?.needsYou.count ?? 0 }

    var body: some View {
        NavigationStack(path: $path) {
            content
                .navigationDestination(for: Route.self) { RouteDestination(route: $0) }
                .toolbar { if let bot { toolbar(bot) } }
                .sheet(item: $sheet, onDismiss: { attempt += 1 }) { sheet in
                    switch sheet {
                    case .activity:
                        BotActivitySheet(bot: bot, botId: botId, activity: activity) { id in
                            self.sheet = nil
                            path.append(.thread(id: id))
                        } refresh: { await loadActivity() }
                    case .profile:
                        BotProfileSheet(bot: bot, botId: botId) { next in
                            if let next { lead = .bot(next) }
                        }
                    case .checkIns:
                        BotHeartbeatSheet(botId: botId)
                    case .skills:
                        BotSkillsSheet(name: bot?.name ?? BotInfo.defaultName, botId: botId)
                    }
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
        .task(id: LoadKey(visible: model.tab == .bot, server: model.serverURL, botId: botId, attempt: attempt)) {
            guard model.tab == .bot else { return }
            await load()
            // Live status for the threads it started, as the desktop polls it.
            while !Task.isCancelled {
                try? await Task.sleep(for: .seconds(20))
                if Task.isCancelled { break }
                await loadActivity()
            }
        }
    }

    @ViewBuilder
    private var content: some View {
        switch lead {
        case .bot(let bot):
            if let id = bot.lead.threadId {
                ThreadView(threadId: id, hidesTabBar: false, answersActionButton: botId == nil, botChrome: chrome(bot))
                    .id("\(model.serverURL.absoluteString)|\(id)")
                    .safeAreaInset(edge: .top, spacing: 0) { banner(bot) }
            } else {
                ContentUnavailableView {
                    Label { Text("\(bot.name) has no chat") } icon: { BotAvatar(bot.look, size: 56) }
                } description: {
                    Text("Open a thread, then choose Make this my Bot from its ⋯ menu.")
                }
            }
        case .none:
            BotOnboardingView { prompt in
                try await create(prompt: prompt)
            } customize: {
                sheet = .profile
            }
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

    private func chrome(_ bot: BotInfo) -> BotChrome {
        let chain = chain.last == bot.lead.threadId ? chain : bot.lead.threadId.map { [$0] } ?? []
        return BotChrome(bot: bot, chain: chain, started: BotStartedThread.list(activity: activity, threads: startedThreads, chain: chain),
                         openThread: { path.append(.thread(id: $0)) },
                         runningChanged: { _ in Task { await loadActivity() } },
                         followThread: { _ in attempt += 1 })
    }

    @ToolbarContentBuilder
    private func toolbar(_ bot: BotInfo) -> some ToolbarContent {
        if let back {
            ToolbarItem(placement: .topBarLeading) {
                Button(action: back) { Image(systemName: "chevron.backward") }
                    .accessibilityLabel("Bots")
                    .accessibilityHint("Shows all your bots")
            }
        }
        ToolbarItemGroup(placement: .topBarTrailing) {
            if let id = bot.lead.threadId {
                Button { model.startVoiceChat(threadId: id) } label: { Image(systemName: "phone.fill") }
                    .accessibilityLabel("Talk to \(bot.name)")
                    .accessibilityHint("Starts a hands-free voice chat")
            }
            Button { sheet = .activity } label: {
                Image(systemName: needsYou > 0 ? "bell.badge.fill" : "bell")
                    .symbolRenderingMode(needsYou > 0 ? .multicolor : .monochrome)
                    .symbolEffect(.wiggle, value: needsYou)
            }
            .badge(needsYou)
            .accessibilityLabel(needsYou > 0 ? "Activity, \(needsYou) need\(needsYou == 1 ? "s" : "") you" : "Activity")
        }
        ToolbarSpacer(.fixed, placement: .topBarTrailing)
        ToolbarItem(placement: .topBarTrailing) { menu(bot) }
    }

    private func menu(_ bot: BotInfo) -> some View {
        Menu {
            Section {
                Button { sheet = .profile } label: { Label("Edit profile", systemImage: "person.crop.circle") }
                if bot.external {
                    Text("Runs on another provider, so it has no memory, skills or runners.")
                } else {
                    Button { openMemory() } label: { Label("Memory", systemImage: "brain") }
                    Button { sheet = .skills } label: { Label("Skills", systemImage: "wand.and.stars") }
                }
                Button { sheet = .checkIns } label: { Label("Check-ins", systemImage: "alarm") }
                    .disabled(bot.state != .active)
            }
            Section {
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
            Image(systemName: "ellipsis")
        }
        .accessibilityLabel("\(bot.name) options")
    }

    @ViewBuilder
    private func banner(_ bot: BotInfo) -> some View {
        if bot.state != .active {
            HStack(spacing: 10) {
                Image(systemName: bot.state == .paused ? "pause.fill" : "stop.fill")
                    .font(.caption.weight(.bold))
                    .foregroundStyle(.white)
                    .frame(width: 24, height: 24)
                    .background(.orange, in: .circle)
                Text("\(bot.name) is \(bot.state.rawValue) and won't start new work.").font(.footnote)
                Spacer(minLength: 0)
                Button("Resume") { change(.resume) }
                    .font(.footnote.weight(.semibold))
                    .buttonStyle(.glassProminent)
                    .tint(.orange)
            }
            .padding(.horizontal, 14).padding(.vertical, 8)
            .glassEffect(.regular, in: .capsule)
            .padding(.horizontal, 12)
            .padding(.top, 4)
        }
    }

    private func load() async {
        #if DEBUG
        if let demo = BotDemo.current {
            lead = BotLead(demo.bot)
            activity = demo.bot == nil ? nil : demo.activity
            chain = demo.chain
            startedThreads = demo.startedThreads
            if sheet == nil, attempt == 0, let shown = BotDemo.sheet.flatMap(BotSheet.init(rawValue:)) {
                try? await Task.sleep(for: .milliseconds(800))
                sheet = shown
            }
            return
        }
        #endif
        let client = model.client
        // Another server's Bot is never shown for this one.
        if botId == nil, case .bot(let shown) = lead, client.cachedBotThreadId != shown.lead.threadId {
            lead = .loading
            chain = []
            startedThreads = [:]
        }
        do {
            lead = BotLead(try await client.bot(botId))
        } catch where BBClient.isCancellation(error) {
            return
        } catch {
            guard client.baseURL == model.serverURL else { return }
            // Offline or a server without Studio: keep what this server last said.
            if case .bot = lead {
            } else if botId == nil, let cached = client.cachedBotThreadId {
                let look = client.cachedBotLook
                lead = .bot(BotInfo(name: client.cachedBotName, avatar: look.emoji, state: .active, lead: ThreadLead(threadId: cached),
                                    shape: look.shape?.rawValue, color: look.color))
            } else {
                lead = .unavailable(BBClient.describe(error, server: client.baseURL))
            }
        }
        if bot?.lead.threadId != nil, let ids = try? await client.botChain(botId: botId) { chain = ids }
        // An Action button press with nothing to talk to must not start recording later.
        if botId == nil, bot?.lead.threadId == nil { model.botTalkPending = false }
        await loadActivity()
    }

    private func loadActivity() async {
        guard bot != nil else { activity = nil; return }
        let client = model.client
        guard let next = try? await client.botActivity(botId: botId) else { return }
        activity = next
        let ids = Set((next.needsYou + (next.waiting ?? []) + next.inProgress + next.completed).filter { $0.relation == "started" }.map(\.id))
        let missing = ids.subtracting(startedThreads.keys)
        guard !missing.isEmpty else { return }
        let fetched = await withTaskGroup(of: ThreadEntry?.self) { group in
            for id in missing { group.addTask { try? await client.thread(id) } }
            var out: [ThreadEntry] = []
            for await thread in group { if let thread { out.append(thread) } }
            return out
        }
        guard client.baseURL == model.serverURL else { return }
        for thread in fetched { startedThreads[thread.id] = thread }
    }

    private func create(prompt: String) async throws {
        let name = BotInfo.defaultName
        let made = try await model.client.createBot(name: name, shape: .default, color: BotPalette.hex(forName: name), prompt: prompt)
        lead = BotLead(made)
    }

    private func openMemory() {
        Task {
            do {
                if let id = try await model.client.botMemoryPageId(botId: botId) {
                    path.append(.page(id: id))
                } else {
                    error = "\(bot?.name ?? BotInfo.defaultName) hasn't written any memory yet."
                }
            } catch {
                self.error = BBClient.describe(error, server: model.client.baseURL)
            }
        }
    }

    private func change(_ action: BotInfo.Action) {
        Task {
            do {
                if let next = try await model.client.setBotState(action, botId: botId) { lead = .bot(next) }
                await loadActivity()
            } catch {
                self.error = BBClient.describe(error, server: model.client.baseURL)
            }
        }
    }
}

private enum BotSheet: String, Identifiable {
    case activity, profile, checkIns, skills
    var id: String { rawValue }
}
