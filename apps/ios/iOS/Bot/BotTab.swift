import SwiftUI

/// One bot's chat, with its status, Activity, voice, profile, automations and
/// Pause / Resume / Stop. Without a Bot, it greets you and the first message
/// makes it. Every call is scoped to `botId`; nil is the primary bot.
struct BotTab: View {
    /// The bot to show; nil for the primary.
    var botId: String? = nil
    /// Back to the Bots list.
    var back: (() -> Void)? = nil
    @EnvironmentObject private var model: AppModel
    @Environment(\.scenePhase) private var scenePhase
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
    /// The chat's prompt cache (`bot_cache_state`), for the header.
    @State private var cache: BotCacheState?
    private struct LoadKey: Hashable { let visible: Bool; let server: URL; let botId: String?; let attempt: Int }
    private struct PollKey: Hashable { let interval: Duration?; let server: URL; let botId: String? }

    /// `known` is the bot as the Bots list has it.
    init(botId: String? = nil, known: BotInfo? = nil, back: (() -> Void)? = nil) {
        self.botId = botId
        self.back = back
        // The bot as last seen on this server, or as the list has it, so its
        // chat opens at once rather than after `bot_get` answers.
        if let saved = BotSnapshot.load(botId: botId, serverURL: ServerScope.selectedURL) {
            _lead = State(initialValue: .bot(saved.bot))
            _chain = State(initialValue: saved.chain)
        } else if let known, known.lead.threadId != nil {
            _lead = State(initialValue: .bot(known))
        }
    }

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
                        BotThreadsSheet(bot: bot, botId: botId, activity: activity) { id in
                            self.sheet = nil
                            path.append(.thread(id: id))
                        } refresh: { await loadActivity() }
                    case .profile:
                        BotProfileSheet(bot: bot, botId: botId) { next in
                            if let next { lead = .bot(next) }
                        }
                    case .checkIns:
                        BotAutomationsSheet(botId: botId, botName: bot?.name ?? BotInfo.defaultName, active: bot?.state == .active)
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
        }
        // Live status for the threads it started: on BB's thread changes, with
        // a slow poll behind them for the rest of the Activity.
        .task(id: PollKey(interval: pollInterval, server: model.serverURL, botId: botId)) {
            guard let interval = pollInterval else { return }
            let (changes, signal) = AsyncStream.makeStream(of: Void.self, bufferingPolicy: .bufferingNewest(1))
            let listener = model.realtime.listen { event in
                if BotActivityPoll.refreshes(on: event) { signal.yield() }
            }
            await withTaskGroup(of: Void.self) { group in
                group.addTask { @MainActor in
                    for await _ in changes {
                        // Settle a burst of changes into one refresh.
                        try? await Task.sleep(for: .seconds(1))
                        if Task.isCancelled { return }
                        await loadActivity()
                    }
                }
                group.addTask { @MainActor in
                    while !Task.isCancelled {
                        try? await Task.sleep(for: interval)
                        if Task.isCancelled { return }
                        await loadActivity()
                    }
                }
                await group.next()
                group.cancelAll()
            }
            signal.finish()
            model.realtime.removeListener(listener)
        }
    }

    private var pollInterval: Duration? {
        BotActivityPoll.interval(visible: model.tab == .bot, sceneActive: scenePhase == .active, running: activity?.running == true)
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
            BotOnboardingView { goal in
                try await create(goal: goal)
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
            ChatSkeleton(bot: true)
        }
    }

    private func chrome(_ bot: BotInfo) -> BotChrome {
        let chain = chain.last == bot.lead.threadId ? chain : bot.lead.threadId.map { [$0] } ?? []
        return BotChrome(bot: bot, chain: chain, started: BotStartedThread.list(activity: activity, threads: startedThreads, chain: chain),
                         openThread: { path.append(.thread(id: $0)) },
                         runningChanged: { _ in Task { await loadActivity() } },
                         followThread: { _ in attempt += 1 },
                         cache: cache)
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
                Button { sheet = .checkIns } label: { Label("Automations", systemImage: "alarm") }
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
            await BotDemo.latency()
            if BotLead(demo.bot) != lead { lead = BotLead(demo.bot) }
            activity = demo.bot == nil ? nil : demo.activity
            chain = demo.chain
            remember(model.serverURL)
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
            // The same bot as the cached one redraws nothing.
            let next = BotLead(try await client.bot(botId))
            if next != lead { lead = next }
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
        if bot?.lead.threadId != nil, let ids = try? await client.botChain(botId: botId), ids != chain { chain = ids }
        if client.baseURL == model.serverURL { remember(client.baseURL) }
        // An Action button press with nothing to talk to must not start recording later.
        if botId == nil, bot?.lead.threadId == nil { model.botTalkPending = false }
        await loadActivity()
    }

    /// Keeps the bot and its chain for the next open; forgets a bot that's gone.
    private func remember(_ serverURL: URL) {
        switch lead {
        case .bot(let bot): BotSnapshot.save(.init(bot: bot, chain: chain), botId: botId, serverURL: serverURL)
        case .none: BotSnapshot.remove(botId: botId, serverURL: serverURL)
        case .loading, .unavailable: break
        }
    }

    private func loadActivity() async {
        guard bot != nil else { activity = nil; return }
        let client = model.client
        if let threadId = bot?.lead.threadId, let state = try? await client.botCacheState(threadId: threadId), state != cache { cache = state }
        guard let next = try? await client.botActivity(botId: botId) else { return }
        // An unchanged Activity redraws nothing.
        if next != activity { activity = next }
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

    /// The welcome's Create: the first Bot, with Studio's setup as its first message.
    private func create(goal: String) async throws {
        let made = try await model.client.createBot(name: BotSetup.name(first: true), shape: BotSetup.shape(first: true),
                                                    color: BotSetup.color(first: true), setup: goal)
        lead = BotLead(made)
        if let threadId = made?.lead.threadId { chain = [threadId] }
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

/// A bot and its chain as last seen, per server, so the Bot tab draws its chat
/// before `bot_get` and `bot_chain` answer.
@MainActor
enum BotSnapshot {
    struct Saved: Codable, Equatable {
        var bot: BotInfo
        var chain: [String]
    }

    static func key(_ botId: String?) -> String { "bot-\(botId ?? "primary")" }

    static func load(botId: String?, serverURL: URL) -> Saved? {
        #if DEBUG
        BotDemo.dropCachesIfAsked(serverURL: serverURL)
        #endif
        return DiskCache.load(Saved.self, key: key(botId), serverURL: serverURL)
    }

    static func save(_ saved: Saved, botId: String?, serverURL: URL) {
        guard DiskCache.load(Saved.self, key: key(botId), serverURL: serverURL) != saved else { return }
        DiskCache.save(saved, as: key(botId), serverURL: serverURL)
    }

    static func remove(botId: String?, serverURL: URL) {
        DiskCache.remove(key(botId), serverURL: serverURL)
    }

    /// The Bots list, for deciding at once between it and the one bot's chat.
    static func bots(serverURL: URL) -> [BotInfo]? {
        #if DEBUG
        BotDemo.dropCachesIfAsked(serverURL: serverURL)
        #endif
        return DiskCache.load([BotInfo].self, key: "bots", serverURL: serverURL)
    }

    static func save(bots: [BotInfo], serverURL: URL) {
        DiskCache.save(bots, as: "bots", serverURL: serverURL)
    }
}

private enum BotSheet: String, Identifiable {
    case activity, profile, checkIns, skills
    var id: String { rawValue }
}

/// When the Bot tab refreshes the Activity.
enum BotActivityPoll {
    /// While the tab shows and the app is in front: every 30s while its
    /// threads run, every 2 minutes when idle. Nil otherwise: no polling.
    static func interval(visible: Bool, sceneActive: Bool, running: Bool) -> Duration? {
        guard visible, sceneActive else { return nil }
        return running ? .seconds(30) : .seconds(120)
    }

    /// A thread changed status, or the socket came back after missing changes.
    /// Streaming output alone changes nothing the Activity shows.
    static func refreshes(on event: RealtimeEvent) -> Bool {
        switch event {
        case .changed(let entity, _, let changes):
            entity == "thread" && !(!changes.isEmpty && changes.allSatisfy { $0 == "events-appended" })
        case .connected:
            true
        case .pluginSignal:
            false
        }
    }
}

extension BotActivity {
    /// Something of the Bot's is running or queued.
    var running: Bool { !inProgress.isEmpty || !(waiting ?? []).isEmpty }
}
