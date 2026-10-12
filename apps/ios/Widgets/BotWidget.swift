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

    static let placeholder = BotEntry(date: .now, message: "Your Bot's latest message shows here.")
}

struct BotApproval: Codable, Hashable {
    var interactionId: String
    var summary: String
    var canApprove: Bool
    var canDeny: Bool
    var subjectKind: String?
}

private struct BotCache: Codable {
    var threadId: String?
    var message: String?
    var running: Bool
    var approval: BotApproval?
}

struct BotProvider: TimelineProvider {
    func placeholder(in context: Context) -> BotEntry { .placeholder }

    func getSnapshot(in context: Context, completion: @escaping (BotEntry) -> Void) {
        completion(cached() ?? .placeholder)
    }

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
                async let reply = client.latestReply(threadId)
                async let thread = client.thread(threadId)
                async let pending = client.interactions(threadId)
                entry.threadId = threadId
                entry.message = try await reply?.text.map(Self.plain)
                entry.running = try await thread.isRunning
                entry.approval = (try? await pending)?
                    .first { $0.status == "pending" && $0.payload.kind == "approval" }
                    .map {
                        BotApproval(interactionId: $0.id, summary: $0.payload.subject?.command ?? $0.payload.subject?.plan ?? $0.summary,
                                      canApprove: $0.decisions.contains("allow_once"), canDeny: $0.decisions.contains("deny"),
                                      subjectKind: $0.payload.subject?.kind)
                    }
                entry.stale = false
                DiskCache.save(BotCache(threadId: threadId, message: entry.message, running: entry.running, approval: entry.approval),
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
                        title: client.cachedBotName, look: client.cachedBotLook)
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

    init() {}
    init(threadId: String, interactionId: String, decision: String, serverURL: URL) {
        self.server = ServerScope.namespace(serverURL)
        self.threadId = threadId
        self.interactionId = interactionId
        self.decision = decision
    }

    func perform() async throws -> some IntentResult {
        // The widget may predate a server switch; never answer another server's request.
        guard server == ServerScope.namespace(ServerScope.selectedURL) else { return .result() }
        try await BBClient().resolve(threadId: threadId, interactionId: interactionId, decision: decision)
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
        .supportedFamilies([.systemSmall, .systemMedium, .accessoryCircular, .accessoryRectangular])
    }
}

private struct BotWidgetView: View {
    @Environment(\.widgetFamily) private var family
    private let snapshot: BotEntry
    init(entry: BotEntry) { snapshot = entry }
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

    @ViewBuilder
    private func decisions(_ approval: BotApproval) -> some View {
        if let threadId = entry.threadId {
            HStack(spacing: 6) {
                if approval.canApprove {
                    Button(intent: BotDecisionIntent(threadId: threadId, interactionId: approval.interactionId, decision: "allow_once", serverURL: entry.serverURL)) {
                        Text(approvalLabel("allow_once", subjectKind: approval.subjectKind)).frame(maxWidth: .infinity)
                    }
                    .tint(.green)
                }
                if approval.canDeny {
                    Button(intent: BotDecisionIntent(threadId: threadId, interactionId: approval.interactionId, decision: "deny", serverURL: entry.serverURL)) {
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
