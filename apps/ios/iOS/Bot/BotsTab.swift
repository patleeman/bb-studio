import SwiftUI

/// The Bots tab. With one bot (or none) it opens that bot's chat; with several,
/// a list of them, primary first. Each chat has a way back to the list, whose +
/// makes another bot.
struct BotsTab: View {
    @EnvironmentObject private var model: AppModel
    @State private var bots: [BotInfo]?
    @State private var summaries: [String: BotSummary] = [:]
    /// The open bot; nil shows the list.
    @State private var open: BotRoute?
    /// The tab chose a view on its own for this server already.
    @State private var decided: URL?
    @State private var adding = false
    @State private var error: String?
    @State private var attempt = 0
    private struct LoadKey: Hashable { let visible: Bool; let server: URL; let attempt: Int }

    init() {
        // The list as last seen: with one bot, its chat opens straight away
        // instead of after `bot_list` answers.
        let server = ServerScope.selectedURL
        if let cached = BotSnapshot.bots(serverURL: server) {
            _bots = State(initialValue: cached)
            _decided = State(initialValue: server)
            _open = State(initialValue: cached.count <= 1 ? .primary : nil)
        }
    }

    var body: some View {
        Group {
            if let open {
                BotTab(botId: botId(open), known: known(open), back: { withAnimation(.snappy) { self.open = nil } })
                    .id("\(model.serverURL.absoluteString)|\(botId(open) ?? "primary")")
                    .transition(.move(edge: .trailing))
            } else {
                list.transition(.move(edge: .leading))
            }
        }
        .task(id: LoadKey(visible: model.tab == .bot, server: model.serverURL, attempt: attempt)) {
            guard model.tab == .bot else { return }
            ChatPerf.open()
            consumeRoute()
            await load()
        }
        .onChange(of: model.botRoute) { _, _ in consumeRoute() }
    }

    /// The primary bot is always called without an id, so older Studios and the
    /// widgets' cache keep working.
    private func botId(_ route: BotRoute) -> String? {
        guard case .bot(let id) = route else { return nil }
        return bots?.first { $0.id == id }?.primary == true ? nil : id
    }

    private func known(_ route: BotRoute) -> BotInfo? {
        guard case .bot(let id) = route else { return bots?.first(where: \.primary) }
        return bots?.first { $0.id == id }
    }

    private var list: some View {
        NavigationStack {
            List {
                ForEach(bots ?? [], id: \.key) { bot in
                    Button { withAnimation(.snappy) { open = bot.primary ? .primary : bot.id.map(BotRoute.bot) ?? .primary } } label: {
                        BotRow(bot: bot, summary: summaries[bot.key])
                    }
                    .foregroundStyle(.primary)
                }
            }
            .listStyle(.insetGrouped)
            .overlay {
                if let error, bots == nil {
                    ContentUnavailableView {
                        Label("Bots unavailable", systemImage: "exclamationmark.triangle")
                    } description: { Text(error) } actions: { Button("Retry") { attempt += 1 } }
                } else if bots == nil {
                    // Most people have one bot: the shape of its chat, not a spinner.
                    ChatSkeleton(bot: true)
                } else if bots?.isEmpty == true {
                    // Only from a bbstudio://bots link: the tab itself opens the welcome.
                    ContentUnavailableView {
                        Label("No bots yet", systemImage: "face.smiling")
                    } actions: {
                        Button("Make your Bot") { adding = true }.buttonStyle(.glassProminent)
                    }
                }
            }
            .refreshable { await load() }
            .navigationTitle("Bots")
            .toolbar {
                ToolbarItem(placement: .topBarTrailing) {
                    Button { adding = true } label: { Image(systemName: "plus") }
                        .accessibilityLabel("New bot")
                }
            }
            .sheet(isPresented: $adding) {
                NavigationStack {
                    BotOnboardingView(first: bots?.isEmpty != false) { goal in
                        let first = bots?.isEmpty != false
                        let made = try await model.client.createBot(name: BotSetup.name(first: first), shape: BotSetup.shape(first: first),
                                                                    color: BotSetup.color(first: first), setup: goal)
                        adding = false
                        await load()
                        guard let made else { return }
                        withAnimation(.snappy) { open = made.primary ? .primary : made.id.map(BotRoute.bot) ?? .primary }
                    }
                    .toolbar { ToolbarItem(placement: .cancellationAction) { Button("Cancel") { adding = false } } }
                }
            }
        }
    }

    private func consumeRoute() {
        guard let route = model.botRoute else { return }
        model.botRoute = nil
        decided = model.serverURL
        withAnimation(.snappy) { open = route == .list ? nil : route }
    }

    private func load() async {
        #if DEBUG
        if let demo = BotDemo.bots {
            await BotDemo.latency()
            bots = demo
            BotSnapshot.save(bots: demo, serverURL: model.serverURL)
            summaries = BotDemo.summaries
            if decided == nil { decided = model.serverURL; open = demo.count > 1 ? nil : .primary }
            return
        }
        #endif
        let client = model.client
        if decided != nil, decided != client.baseURL {
            bots = nil
            summaries = [:]
            open = nil
            decided = nil
        }
        do {
            let next = try await client.bots()
            guard client.baseURL == model.serverURL else { return }
            if next != bots { bots = next }
            BotSnapshot.save(bots: next, serverURL: client.baseURL)
            error = nil
            if decided == nil {
                decided = client.baseURL
                if next.count <= 1 { open = .primary }
            }
            await loadSummaries(next, client: client)
        } catch where BBClient.isCancellation(error) {
            return
        } catch {
            guard client.baseURL == model.serverURL else { return }
            self.error = BBClient.describe(error, server: client.baseURL)
            // The primary bot's chat explains what went wrong and keeps the cached chat.
            if decided == nil { decided = client.baseURL; open = .primary }
        }
    }

    /// Each bot's latest reply, whether it's working, and what needs you.
    private func loadSummaries(_ bots: [BotInfo], client: BBClient) async {
        let fetched = await withTaskGroup(of: (String, BotSummary).self) { group in
            for bot in bots {
                group.addTask {
                    let botId = bot.primary ? nil : bot.id
                    var summary = BotSummary()
                    if let threadId = bot.lead.threadId {
                        async let reply = try? client.latestReply(threadId, skippingPass: true)
                        async let thread = try? client.thread(threadId)
                        summary.preview = (await reply)?.text.map(BotSummary.plain)
                        let entry = await thread
                        summary.running = entry?.isRunning ?? false
                        summary.updatedAt = entry?.updatedAt
                    }
                    summary.needsYou = (try? await client.botActivity(botId: botId))?.needsYou.count ?? 0
                    return (bot.key, summary)
                }
            }
            var out: [String: BotSummary] = [:]
            for await (key, summary) in group { out[key] = summary }
            return out
        }
        guard client.baseURL == model.serverURL else { return }
        summaries = fetched
    }
}

/// What the Bots list shows under a bot's name.
struct BotSummary: Hashable {
    var preview: String?
    var needsYou = 0
    var running = false
    var updatedAt: Double?

    /// Markdown and the chat's reply chips read as noise in a one-line preview.
    static func plain(_ text: String) -> String {
        text.replacingOccurrences(of: #"::[\w-]+\{[^}]*\}"#, with: "", options: .regularExpression)
            .replacingOccurrences(of: #"\[([^\]]+)\]\([^)]+\)"#, with: "$1", options: .regularExpression)
            .replacingOccurrences(of: #"[*_`#>]+"#, with: "", options: .regularExpression)
            .replacingOccurrences(of: #"\s+"#, with: " ", options: .regularExpression)
            .trimmingCharacters(in: .whitespacesAndNewlines)
    }
}

extension BotInfo {
    /// Its key in lists: its id, or "primary" from a Studio without ids.
    var key: String { id ?? "primary" }

    /// "Working…", "Paused", "Stopped", or "Active".
    func status(running: Bool) -> String {
        switch state {
        case .stopped: "Stopped"
        case .paused: "Paused"
        case .active: running ? "Working…" : "Active"
        }
    }
}

private struct BotRow: View {
    let bot: BotInfo
    let summary: BotSummary?

    var body: some View {
        HStack(spacing: 14) {
            // Still in the list: only the open chat's avatar and typing row animate.
            BotAvatar(bot.look, size: 48)
            VStack(alignment: .leading, spacing: 3) {
                HStack(spacing: 6) {
                    Text(bot.name).font(.headline).lineLimit(1)
                    if bot.primary {
                        Text("Primary").font(.caption2.weight(.semibold)).foregroundStyle(.secondary)
                            .padding(.horizontal, 6).padding(.vertical, 1)
                            .background(.fill.tertiary, in: .capsule)
                    }
                    Spacer(minLength: 4)
                    if let at = summary?.updatedAt.flatMap(BotChatEntry.date) {
                        Text(at.formatted(.relative(presentation: .named))).font(.caption).foregroundStyle(.secondary).lineLimit(1)
                    }
                }
                HStack(spacing: 4) {
                    Circle().fill(dot).frame(width: 7, height: 7)
                    Text(bot.external ? "\(bot.status(running: summary?.running == true)) · External" : bot.status(running: summary?.running == true))
                }
                .font(.caption.weight(.medium))
                .foregroundStyle(summary?.running == true ? AnyShapeStyle(BotPalette.color(bot.color)) : AnyShapeStyle(.secondary))
                HStack(alignment: .top) {
                    Text(summary?.preview ?? (bot.lead.threadId == nil ? "No chat yet" : " "))
                        .font(.subheadline).foregroundStyle(.secondary).lineLimit(2)
                    Spacer(minLength: 4)
                    if let count = summary?.needsYou, count > 0 {
                        Text("\(count)")
                            .font(.caption.weight(.bold)).foregroundStyle(.white)
                            .padding(.horizontal, 7).padding(.vertical, 2)
                            .background(.orange, in: .capsule)
                            .accessibilityLabel("\(count) need\(count == 1 ? "s" : "") you")
                    }
                }
            }
        }
        .padding(.vertical, 4)
        .accessibilityElement(children: .combine)
    }

    private var dot: Color {
        switch bot.state {
        case .active: summary?.running == true ? BotPalette.color(bot.color) : .green
        case .paused: .orange
        case .stopped: .red
        }
    }
}
