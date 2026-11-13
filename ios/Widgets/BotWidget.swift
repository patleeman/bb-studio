import AppIntents
import SwiftUI
import WidgetKit

/// The user's Bot (the lead of BB's personal project): its latest message, a mic,
/// and Approve and Deny when it is waiting on an approval.
struct BotEntry: TimelineEntry {
    var serverURL: URL = ServerScope.selectedURL
    var date: Date
    var threadId: String?
    var message: String?
    var running = false
    var approval: BotApproval?
    var stale = false
    /// The Bot's name and emoji, as last loaded.
    var title = BotInfo.defaultName
    /// Its drawn avatar, as last loaded.
    var look = BotLook(shape: BotShape.default.rawValue, color: nil, emoji: BotInfo.defaultAvatar)
    /// The chat before the latest reply, newest first (large sizes).
    var history: [BotLine] = []
    /// Threads the Bot is working on or waiting behind (large sizes; `bot_activity`).
    var tracking: [BotTracked] = []
    /// From Bot spaces: which Bot, its presence state and running workers. Nil on an older Studio.
    var botId: String? = nil
    var presence: BotPresenceState = .idle
    var workers = 0

    static let placeholder = BotEntry(date: .now, message: "Your Bot's latest message shows here.")

    /// Made-up content for the gallery and the redacted placeholder.
    static var sample: BotEntry {
        let now = Date.now.timeIntervalSince1970 * 1000
        let minute = 60_000.0
        return BotEntry(
            date: .now, threadId: "thr_bot",
            message: "Morning. Two things before standup: the deploy to prod is waiting on your approval, and the Lisbon offsite has three venue options left. I've drafted the Q4 roadmap page from Friday's notes; it needs a look before I share it with the team.",
            running: true,
            history: [
                BotLine(id: "m3", fromYou: true, text: "Can you check where the offsite planning is?", at: now - 20 * minute),
                BotLine(id: "m2", fromYou: false, text: "Started a thread to compare venues against the budget sheet.", at: now - 18 * minute),
                BotLine(id: "m1", fromYou: true, text: "And draft the roadmap page from Friday's notes.", at: now - 60 * minute),
                BotLine(id: "m0", fromYou: false, text: "On it. I'll put it in Pages when it's ready.", at: now - 58 * minute),
            ],
            tracking: [
                BotTracked(id: "thr_bt0", title: "Lisbon offsite options", status: "active", waitingFor: nil, at: now - 6 * minute),
                BotTracked(id: "thr_bt1", title: "Approve deploy to prod", status: "active", waitingFor: "Waiting for approval", at: now - 9 * minute),
                BotTracked(id: "thr_bt2", title: "Draft the Q4 roadmap page", status: "active", waitingFor: nil, at: now - 31 * minute),
                BotTracked(id: "thr_bt3", title: "Weekly digest", status: "pending", waitingFor: "Queued", at: now - 45 * minute),
            ])
    }
}

/// One message in the Bot's chat, trimmed for a widget.
struct BotLine: Codable, Hashable, Identifiable {
    var id: String
    var fromYou: Bool
    var text: String
    /// Milliseconds.
    var at: Double?
}

/// A thread the Bot started that is still going.
struct BotTracked: Codable, Hashable, Identifiable {
    var id: String
    var title: String
    var status: String
    /// "Waiting for approval" while a question holds it.
    var waitingFor: String?
    /// Milliseconds: when its turn started, else its last change.
    var at: Double?
}

struct BotApproval: Codable, Hashable {
    var interactionId: String
    var summary: String
    var canApprove: Bool
    var canDeny: Bool
    var subjectKind: String?
    var workerThreadId: String? = nil

    init(interactionId: String, summary: String, canApprove: Bool, canDeny: Bool, subjectKind: String?, workerThreadId: String? = nil) {
        self.interactionId = interactionId
        self.summary = summary
        self.canApprove = canApprove
        self.canDeny = canDeny
        self.subjectKind = subjectKind
        self.workerThreadId = workerThreadId
    }

    init?(worker approval: WorkerApproval) {
        guard approval.state == .pending else { return nil }
        let what = approval.short.isEmpty ? approval.title : approval.short
        self.init(interactionId: approval.interactionId, summary: "\(approval.worker.title): \(what)",
                  canApprove: approval.decisions.contains(.allowOnce), canDeny: approval.decisions.contains(.deny),
                  subjectKind: nil, workerThreadId: approval.worker.threadId)
    }
}

private struct BotCache: Codable {
    var threadId: String?
    var message: String?
    var running: Bool
    var approval: BotApproval?
    var history: [BotLine]? = nil
    var tracking: [BotTracked]? = nil
    // Bot spaces: which Bot, and how it looks.
    var botId: String? = nil
    var title: String? = nil
    var presence: BotPresenceState? = nil
    var workers: Int? = nil
    var shape: String? = nil
    var color: String? = nil
    var avatar: String? = nil
}

struct BotProvider: AppIntentTimelineProvider {
    func placeholder(in context: Context) -> BotEntry { .sample }

    func snapshot(for configuration: BotWidgetIntent, in context: Context) async -> BotEntry {
        cached(botId: configuration.bot?.id) ?? (context.isPreview ? .sample : .placeholder)
    }

    /// Only the large sizes show what the Bot is working on, so only they ask for it.
    private static func wantsActivity(_ family: WidgetFamily) -> Bool { family == .systemLarge || family == .systemExtraLarge }

    static func cacheKey(_ botId: String?) -> String { "bot-widget-\(botId ?? "current")" }

    func timeline(for configuration: BotWidgetIntent, in context: Context) async -> Timeline<BotEntry> {
        let client = BBClient()
        let botId = configuration.bot?.id
        var entry: BotEntry
        if BotWidgetData.usesSpaces(serverURL: client.baseURL) {
            do {
                let facts = try await BotWidgetData.load(client: client, botId: botId)
                entry = await Self.entry(facts, client: client, cacheKey: Self.cacheKey(botId))
            } catch where BBClient.isUnknownRPC(error) {
                entry = await legacy(client: client, family: context.family)
            } catch {
                entry = cached(botId: botId) ?? BotEntry(date: .now)
                entry.stale = true
            }
        } else {
            entry = await legacy(client: client, family: context.family)
        }
        entry.date = .now
        entry.serverURL = client.baseURL
        if client.baseURL != ServerScope.selectedURL { entry = .placeholder }
        // The app reloads widgets when a Bot's presence, workers or latest line change.
        return Timeline(entries: [entry], policy: .after(.now + (entry.running ? 5 : 15) * 60))
    }

    /// One Bot from `bot_spaces` and `bot_threads_view`: Main's latest message and
    /// the ones before it, its workers and running conversations, and the first
    /// approval waiting in Main or in a conversation that needs you.
    static func entry(_ facts: BotWidgetFacts, client: BBClient, cacheKey: String) async -> BotEntry {
        var entry = BotEntry(date: .now)
        entry.botId = facts.botId
        entry.title = facts.bot?.name ?? BotInfo.defaultName
        entry.look = facts.look
        entry.presence = facts.presence
        entry.workers = facts.view?.workers.filter { $0.status == .running }.count ?? facts.bot?.activity.workers ?? 0
        entry.running = entry.presence == .thinking || entry.presence == .working
        entry.tracking = tracking(facts)
        entry.threadId = facts.mainThreadId
        if let threadId = facts.mainThreadId {
            async let page = client.timeline(threadId, segments: 2)
            async let pending = client.interactions(threadId)
            if let rows = try? await page.rows {
                let reply = rows.last { $0.isConversation && $0.role == "assistant" }
                entry.message = reply?.text.map(plain)
                entry.history = history(rows, before: reply?.id)
            } else {
                entry.message = facts.view?.main?.latest.map(plain)
            }
            entry.approval = (try? await pending)?
                .first { $0.status == "pending" && $0.payload.kind == "approval" }
                .map {
                    BotApproval(interactionId: $0.id, summary: $0.payload.subject?.command ?? $0.payload.subject?.plan ?? $0.summary,
                                canApprove: $0.decisions.contains("allow_once"), canDeny: $0.decisions.contains("deny"),
                                subjectKind: $0.payload.subject?.kind)
                }
        }
        if entry.approval == nil {
            var owners = [facts.mainThreadId].compactMap { $0 }
            owners += (facts.view?.conversations ?? []).filter { $0.needsYou != nil }.map(\.threadId).filter { !owners.contains($0) }
            for owner in owners.prefix(3) {
                if let found = (try? await client.conversationApprovals(threadId: owner))?.lazy.compactMap(BotApproval.init(worker:)).first {
                    entry.approval = found
                    break
                }
            }
        }
        DiskCache.save(BotCache(threadId: entry.threadId, message: entry.message, running: entry.running, approval: entry.approval,
                                history: entry.history, tracking: entry.tracking, botId: entry.botId, title: entry.title,
                                presence: entry.presence, workers: entry.workers, shape: facts.bot?.shape, color: facts.bot?.color,
                                avatar: facts.bot?.avatar),
                       as: cacheKey, serverURL: client.baseURL)
        return entry
    }

    /// Workers waiting on you, then running workers and conversations; never Main.
    static func tracking(_ facts: BotWidgetFacts) -> [BotTracked] {
        let workers = (facts.view?.workers ?? []).filter { $0.status == .needsYou || $0.status == .running }
            .sorted { ($0.status == .needsYou ? 1 : 0, $0.updatedAt) > ($1.status == .needsYou ? 1 : 0, $1.updatedAt) }
            .map { BotTracked(id: $0.threadId, title: $0.title.isEmpty ? "Worker" : $0.title, status: "active",
                              waitingFor: $0.status == .needsYou ? "Waiting on you" : nil, at: $0.updatedAt) }
        let conversations = (facts.view?.conversations ?? []).filter { !$0.isMain && ($0.running || $0.needsYou != nil) }
            .map { BotTracked(id: $0.threadId, title: $0.title.isEmpty ? "Conversation" : $0.title, status: "active",
                              waitingFor: $0.needsYou?.reason, at: $0.updatedAt) }
        return Array((workers + conversations).prefix(8))
    }

    /// An older Studio, without Bot spaces: the lead thread, as before.
    private func legacy(client: BBClient, family: WidgetFamily) async -> BotEntry {
        var entry = cached(botId: nil, key: "chief-widget") ?? BotEntry(date: .now)
        do {
            guard let threadId = try await client.botThreadId() else {
                entry = BotEntry(date: .now)
                // Forget the old lead, so a later offline refresh doesn't bring it back.
                DiskCache.save(BotCache(threadId: nil, message: nil, running: false, approval: nil), as: "chief-widget", serverURL: client.baseURL)
                throw CancellationError()
            }
            async let page = client.timeline(threadId, segments: 2)
            async let thread = client.thread(threadId)
            async let pending = client.interactions(threadId)
            async let activity = Self.wantsActivity(family) ? try? await client.botActivity() : nil
            entry.threadId = threadId
            let rows = try await page.rows
            // As `latestReply`: the newest assistant message.
            let reply = rows.last { $0.isConversation && $0.role == "assistant" }
            entry.message = reply?.text.map(Self.plain)
            entry.history = Self.history(rows, before: reply?.id)
            entry.running = try await thread.isRunning
            if let activity = await activity { entry.tracking = Self.tracking(activity) }
            entry.approval = (try? await pending)?
                .first { $0.status == "pending" && $0.payload.kind == "approval" }
                .map {
                    BotApproval(interactionId: $0.id, summary: $0.payload.subject?.command ?? $0.payload.subject?.plan ?? $0.summary,
                                  canApprove: $0.decisions.contains("allow_once"), canDeny: $0.decisions.contains("deny"),
                                  subjectKind: $0.payload.subject?.kind)
                }
            if entry.approval == nil, let workers = try? await client.conversationApprovals(threadId: threadId) {
                entry.approval = workers.lazy.compactMap(BotApproval.init(worker:)).first
            }
            entry.stale = false
            DiskCache.save(BotCache(threadId: threadId, message: entry.message, running: entry.running, approval: entry.approval,
                                    history: entry.history, tracking: entry.tracking),
                           as: "chief-widget", serverURL: client.baseURL)
        } catch is CancellationError {
        } catch {
            entry.stale = true
        }
        entry.title = client.cachedBotName
        entry.look = client.cachedBotLook
        return entry
    }

    private func cached(botId: String?, key: String? = nil) -> BotEntry? {
        let key = key ?? (BotWidgetData.usesSpaces(serverURL: ServerScope.selectedURL) ? Self.cacheKey(botId) : "chief-widget")
        guard let value = DiskCache.load(BotCache.self, key: key) else { return nil }
        let client = BBClient()
        var entry = BotEntry(date: .now, threadId: value.threadId, message: value.message, running: value.running, approval: value.approval,
                             title: value.title ?? client.cachedBotName, look: client.cachedBotLook, history: value.history ?? [],
                             tracking: value.tracking ?? [])
        if let botId = value.botId {
            entry.botId = botId
            entry.presence = value.presence ?? .idle
            entry.workers = value.workers ?? 0
            entry.look = BotLook(shape: value.shape, color: value.color, emoji: value.avatar?.isEmpty == false ? value.avatar! : BotInfo.defaultAvatar)
        }
        return entry
    }

    /// The four messages before the latest reply, newest first, each cut short:
    /// the widget's payload stays small.
    static func history(_ rows: [TimelineRow], before replyId: String?) -> [BotLine] {
        var rows = rows.filter { $0.isConversation && ($0.role == "assistant" || $0.isUser && ($0.initiator ?? "user") == "user") }
        if let replyId, let index = rows.lastIndex(where: { $0.id == replyId }) { rows = Array(rows[..<index]) }
        return rows.reversed().compactMap { row -> BotLine? in
            guard !row.isPassReply, let text = row.text.map(plain), !text.isEmpty else { return nil }
            return BotLine(id: row.id, fromYou: row.isUser, text: String(text.prefix(200)), at: row.createdAt)
        }
        .prefix(4).map { $0 }
    }

    /// What the Bot waits behind, then what it's working on; never its own chat.
    static func tracking(_ activity: BotActivity) -> [BotTracked] {
        ((activity.waiting ?? []) + activity.inProgress)
            .filter { $0.relation != "self" }
            .prefix(6)
            .map { BotTracked(id: $0.id, title: $0.title, status: $0.status, waitingFor: $0.waitingFor, at: $0.runningSince ?? $0.updatedAt) }
    }

    /// Markdown markers read as noise at widget size.
    static func plain(_ text: String) -> String {
        text.replacingOccurrences(of: #"[*_`#>]+"#, with: "", options: .regularExpression)
            .replacingOccurrences(of: #"\[([^\]]+)\]\([^)]+\)"#, with: "$1", options: .regularExpression)
            .trimmingCharacters(in: .whitespacesAndNewlines)
    }
}

/// Answers the Bot's pending approval from the widget, without opening the app.
struct BotDecisionIntent: AppIntent {
    static let title: LocalizedStringResource = "Answer Bot"
    static let isDiscoverable = false

    @Parameter(title: "Thread") var threadId: String
    @Parameter(title: "Request") var interactionId: String
    @Parameter(title: "Decision") var decision: String
    @Parameter(title: "Server") var server: String
    @Parameter(title: "Worker") var worker: String?

    init() {}
    init(threadId: String, interactionId: String, decision: String, serverURL: URL, worker: String? = nil) {
        self.init(threadId: threadId, interactionId: interactionId, decision: decision, server: ServerScope.namespace(serverURL), worker: worker)
    }
    init(threadId: String, interactionId: String, decision: String, server: String, worker: String? = nil) {
        self.server = server
        self.threadId = threadId
        self.interactionId = interactionId
        self.decision = decision
        self.worker = worker
    }

    func perform() async throws -> some IntentResult {
        // The widget may predate a server switch; never answer another server's request.
        // An empty server is a Live Activity Studio started without knowing the phone's URL.
        guard server.isEmpty || server == ServerScope.namespace(ServerScope.selectedURL) else { return .result() }
        if let worker, !worker.isEmpty, let choice = WorkerApproval.Decision(rawValue: decision) {
            _ = try await BBClient().resolveWorkerApproval(workerThreadId: worker, interactionId: interactionId, decision: choice)
        } else {
            try await BBClient().resolve(threadId: threadId, interactionId: interactionId, decision: decision)
        }
        WidgetCenter.shared.reloadAllTimelines()
        return .result()
    }
}

struct BotWidget: Widget {
    var body: some WidgetConfiguration {
        // Kept from the Chief of Staff widget, so widgets people placed stay.
        AppIntentConfiguration(kind: "BBChief", intent: BotWidgetIntent.self, provider: BotProvider()) { entry in
            BotWidgetView(entry: entry).containerBackground(.fill.tertiary, for: .widget)
        }
        .configurationDisplayName("Bot")
        .description("A Bot's latest message, what it's working on, and a mic to talk to it.")
        .supportedFamilies([.systemSmall, .systemMedium, .systemLarge, .systemExtraLarge, .accessoryCircular, .accessoryRectangular])
    }
}

struct BotWidgetView: View {
    @Environment(\.widgetFamily) private var widgetFamily
    private let snapshot: BotEntry
    /// Set only by the app's `-qaStateDemo widgets` screenshots; WidgetKit sets the family.
    private let shownFamily: WidgetFamily?
    init(entry: BotEntry, family: WidgetFamily? = nil) {
        snapshot = entry
        shownFamily = family
    }
    private var family: WidgetFamily { shownFamily ?? widgetFamily }
    private var entry: BotEntry { snapshot.serverURL == ServerScope.selectedURL ? snapshot : .placeholder }

    private var talkURL: URL { WidgetText.link("bot-talk" + (entry.botId.map { "/\($0)" } ?? ""), serverURL: entry.serverURL) }
    private var openURL: URL { WidgetText.link("bot" + (entry.botId.map { "/\($0)" } ?? ""), serverURL: entry.serverURL) }
    /// The header's status: needs you, else the Bot's presence ("Working · 2 workers").
    private var status: String {
        if entry.approval != nil { return "Needs you" }
        if entry.stale { return "Offline" }
        guard entry.botId != nil else { return entry.running ? "Thinking…" : "Ready" }
        if entry.presence == .working, entry.workers > 0 { return "Working · \(entry.workers) worker\(entry.workers == 1 ? "" : "s")" }
        return entry.presence.widgetLabel
    }
    private var needsYou: Bool { entry.approval != nil || entry.presence == .needs }
    private var message: String {
        if entry.threadId == nil && entry.message == nil { return "You don't have a Bot yet. Make one in Studio → Bot." }
        return entry.message ?? "No messages yet."
    }

    var body: some View {
        switch family {
        case .accessoryCircular:
            ZStack {
                AccessoryWidgetBackground()
                Image(systemName: entry.approval != nil ? "hand.raised.fill" : "mic.fill").font(.title3)
            }
            .widgetURL(entry.approval != nil ? openURL : talkURL)
        case .accessoryRectangular:
            VStack(alignment: .leading, spacing: 1) {
                HStack(spacing: 4) {
                    WidgetPresence(botId: entry.botId, state: entry.presence, look: entry.look, size: 16)
                    Text(entry.approval != nil ? "Needs approval" : entry.running ? "\(entry.title) · \(status)" : entry.title)
                }
                .font(.headline)
                Text(entry.approval?.summary ?? message).font(.caption).lineLimit(2)
            }
            .frame(maxWidth: .infinity, alignment: .leading)
            .widgetURL(openURL)
        case .systemLarge:
            VStack(alignment: .leading, spacing: 10) {
                header
                latest(lines: 8)
                if entry.threadId != nil { trackingSection(limit: 3) }
                historySection(limit: 2)
                Spacer(minLength: 0)
            }
            .frame(maxWidth: .infinity, maxHeight: .infinity, alignment: .topLeading)
            .widgetURL(openURL)
        case .systemExtraLarge:
            HStack(alignment: .top, spacing: 20) {
                VStack(alignment: .leading, spacing: 10) {
                    header
                    latest(lines: 13)
                    Spacer(minLength: 0)
                }
                .frame(maxWidth: .infinity, alignment: .leading)
                VStack(alignment: .leading, spacing: 10) {
                    if entry.threadId != nil { trackingSection(limit: 5) }
                    historySection(limit: 4)
                    Spacer(minLength: 0)
                }
                .frame(maxWidth: .infinity, alignment: .leading)
            }
            .frame(maxWidth: .infinity, maxHeight: .infinity, alignment: .topLeading)
            .widgetURL(openURL)
        default:
            VStack(alignment: .leading, spacing: 6) {
                header
                if let approval = entry.approval {
                    Text(approval.summary).font(.caption).lineLimit(family == .systemSmall ? 2 : 3)
                    Spacer(minLength: 0)
                    decisions(approval)
                } else {
                    Text(message).font(.caption).lineLimit(family == .systemSmall ? 4 : 5)
                    Spacer(minLength: 0)
                }
            }
            .frame(maxWidth: .infinity, maxHeight: .infinity, alignment: .topLeading)
            .widgetURL(openURL)
        }
    }

    private var header: some View {
        HStack(spacing: 6) {
            WidgetPresence(botId: entry.botId, state: entry.presence, look: entry.look, size: 30)
            VStack(alignment: .leading, spacing: 0) {
                Text(entry.title).font(.caption.weight(.semibold)).lineLimit(1)
                Text(status)
                    .font(.caption2)
                    .foregroundStyle(needsYou ? Color.orange : entry.running ? BotPalette.color(entry.look.color) : .secondary)
                    .lineLimit(1)
            }
            if entry.stale { Image(systemName: "wifi.slash").font(.caption2).foregroundStyle(.secondary) }
            Spacer(minLength: 0)
            Link(destination: talkURL) {
                Image(systemName: "mic.fill")
                    .font(.footnote.weight(.semibold))
                    .foregroundStyle(.white)
                    .frame(width: 30, height: 30)
                    .background(Color.red, in: .circle)
            }
            .accessibilityLabel("Talk to \(entry.title)")
        }
    }

    /// The large sizes' latest message: the approval first when there is one.
    @ViewBuilder
    private func latest(lines: Int) -> some View {
        if let approval = entry.approval {
            VStack(alignment: .leading, spacing: 6) {
                Label("Wants your approval", systemImage: "hand.raised.fill")
                    .font(.caption.weight(.semibold))
                    .foregroundStyle(.orange)
                Text(approval.summary).font(.footnote).lineLimit(4)
                decisions(approval)
            }
            Text(message).font(.caption).foregroundStyle(.secondary).lineLimit(max(2, lines - 6))
        } else {
            Text(message).font(.footnote).lineLimit(lines)
        }
    }

    private func trackingSection(limit: Int) -> some View {
        let shown = Array(entry.tracking.prefix(limit))
        return VStack(alignment: .leading, spacing: 6) {
            WidgetSectionTitle(title: "Working on", count: entry.tracking.isEmpty ? nil : entry.tracking.count)
            ForEach(shown) { item in
                WidgetRow(url: WidgetText.thread(item.id, serverURL: entry.serverURL), title: item.title, note: item.waitingFor,
                          age: WidgetText.age(item.at, now: entry.date),
                          dot: item.waitingFor != nil ? .orange : BotPalette.color(entry.look.color))
            }
            WidgetMore(hidden: entry.tracking.count - shown.count)
            if entry.tracking.isEmpty {
                Text("Nothing in progress.").font(.caption).foregroundStyle(.secondary)
            }
        }
    }

    @ViewBuilder
    private func historySection(limit: Int) -> some View {
        if !entry.history.isEmpty {
            VStack(alignment: .leading, spacing: 6) {
                WidgetSectionTitle(title: "Earlier")
                ForEach(entry.history.prefix(limit)) { line in
                    HStack(alignment: .firstTextBaseline, spacing: 6) {
                        Text(line.fromYou ? "You" : entry.title)
                            .font(.caption2.weight(.semibold))
                            .foregroundStyle(line.fromYou ? Color.secondary : BotPalette.color(entry.look.color))
                            .lineLimit(1)
                            .frame(width: 52, alignment: .leading)
                        Text(line.text).font(.caption).lineLimit(2)
                        Spacer(minLength: 0)
                        if let age = WidgetText.age(line.at, now: entry.date) {
                            Text(age).font(.caption).foregroundStyle(.secondary).monospacedDigit()
                        }
                    }
                }
            }
        }
    }

    @ViewBuilder
    private func decisions(_ approval: BotApproval) -> some View {
        if let threadId = entry.threadId {
            HStack(spacing: 6) {
                if approval.canApprove {
                    Button(intent: BotDecisionIntent(threadId: threadId, interactionId: approval.interactionId, decision: "allow_once", serverURL: entry.serverURL, worker: approval.workerThreadId)) {
                        Text(approvalLabel("allow_once", subjectKind: approval.subjectKind)).frame(maxWidth: .infinity)
                    }
                    .tint(.green)
                }
                if approval.canDeny {
                    Button(intent: BotDecisionIntent(threadId: threadId, interactionId: approval.interactionId, decision: "deny", serverURL: entry.serverURL, worker: approval.workerThreadId)) {
                        Text(approvalLabel("deny", subjectKind: approval.subjectKind)).frame(maxWidth: .infinity)
                    }
                    .tint(.red)
                }
            }
            .font(.caption.weight(.semibold))
            .buttonStyle(.borderedProminent)
        }
    }
}
