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
}

struct BotProvider: TimelineProvider {
    func placeholder(in context: Context) -> BotEntry { .sample }

    func getSnapshot(in context: Context, completion: @escaping (BotEntry) -> Void) {
        completion(cached() ?? (context.isPreview ? .sample : .placeholder))
    }

    /// Only the large sizes show what the Bot is working on, so only they ask for it.
    private static func wantsActivity(_ family: WidgetFamily) -> Bool { family == .systemLarge || family == .systemExtraLarge }

    func getTimeline(in context: Context, completion: @escaping (Timeline<BotEntry>) -> Void) {
        Task {
            let client = BBClient()
            var entry = cached() ?? BotEntry(date: .now)
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
                async let activity = Self.wantsActivity(context.family) ? try? await client.botActivity() : nil
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
            entry.date = .now
            entry.serverURL = client.baseURL
            entry.title = client.cachedBotName
            entry.look = client.cachedBotLook
            if client.baseURL != ServerScope.selectedURL { entry = .placeholder }
            // The app reloads widgets when a thread starts or stops running.
            completion(Timeline(entries: [entry], policy: .after(.now + (entry.running ? 5 : 15) * 60)))
        }
    }

    private func cached() -> BotEntry? {
        guard let value = DiskCache.load(BotCache.self, key: "chief-widget") else { return nil }
        let client = BBClient()
        return BotEntry(date: .now, threadId: value.threadId, message: value.message, running: value.running, approval: value.approval,
                        title: client.cachedBotName, look: client.cachedBotLook, history: value.history ?? [], tracking: value.tracking ?? [])
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
        self.server = ServerScope.namespace(serverURL)
        self.threadId = threadId
        self.interactionId = interactionId
        self.decision = decision
        self.worker = worker
    }

    func perform() async throws -> some IntentResult {
        // The widget may predate a server switch; never answer another server's request.
        guard server == ServerScope.namespace(ServerScope.selectedURL) else { return .result() }
        if let worker, !worker.isEmpty, let choice = WorkerApproval.Decision(rawValue: decision) {
            _ = try await BBClient().resolveWorkerApproval(workerThreadId: worker, interactionId: interactionId, decision: choice)
        } else {
            try await BBClient().resolve(threadId: threadId, interactionId: interactionId, decision: decision)
        }
        return .result()
    }
}

struct BotWidget: Widget {
    var body: some WidgetConfiguration {
        // Kept from the Chief of Staff widget, so widgets people placed stay.
        StaticConfiguration(kind: "BBChief", provider: BotProvider()) { entry in
            BotWidgetView(entry: entry).containerBackground(.fill.tertiary, for: .widget)
        }
        .configurationDisplayName("Bot")
        .description("Your Bot's latest message, with a mic to talk to it.")
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

    private var talkURL: URL { AppLink.scoped(URL(string: "bbstudio://bot-talk")!, serverURL: entry.serverURL) }
    private var openURL: URL { AppLink.scoped(URL(string: "bbstudio://bot")!, serverURL: entry.serverURL) }
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
                    BotAvatar(entry.look, size: 16)
                    Text(entry.approval != nil ? "Needs approval" : entry.running ? "\(entry.title) · Thinking…" : entry.title)
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
            BotAvatar(entry.look, size: 30)
            VStack(alignment: .leading, spacing: 0) {
                Text(entry.title).font(.caption.weight(.semibold)).lineLimit(1)
                Text(entry.approval != nil ? "Needs you" : entry.running ? "Thinking…" : entry.stale ? "Offline" : "Ready")
                    .font(.caption2)
                    .foregroundStyle(entry.approval != nil ? Color.orange : entry.running ? BotPalette.color(entry.look.color) : .secondary)
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
