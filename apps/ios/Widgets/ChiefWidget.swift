import AppIntents
import SwiftUI
import WidgetKit

/// The Chief of Staff, the Personal Space's lead: its latest message, a mic,
/// and Approve and Deny when it is waiting on an approval.
struct ChiefEntry: TimelineEntry {
    var serverURL: URL = ServerScope.selectedURL
    var date: Date
    var threadId: String?
    var message: String?
    var running = false
    var approval: ChiefApproval?
    var stale = false

    static let placeholder = ChiefEntry(date: .now, message: "Your chief of staff's latest message shows here.")
}

struct ChiefApproval: Codable, Hashable {
    var interactionId: String
    var summary: String
    var canApprove: Bool
    var canDeny: Bool
    var subjectKind: String?
}

private struct ChiefCache: Codable {
    var threadId: String?
    var message: String?
    var running: Bool
    var approval: ChiefApproval?
}

struct ChiefProvider: TimelineProvider {
    func placeholder(in context: Context) -> ChiefEntry { .placeholder }

    func getSnapshot(in context: Context, completion: @escaping (ChiefEntry) -> Void) {
        completion(cached() ?? .placeholder)
    }

    func getTimeline(in context: Context, completion: @escaping (Timeline<ChiefEntry>) -> Void) {
        Task {
            let client = BBClient()
            var entry = cached() ?? ChiefEntry(date: .now)
            do {
                guard let threadId = try await client.chiefOfStaffThreadId() else {
                    entry = ChiefEntry(date: .now)
                    // Forget the old lead, so a later offline refresh doesn't bring it back.
                    DiskCache.save(ChiefCache(threadId: nil, message: nil, running: false, approval: nil), as: "chief-widget", serverURL: client.baseURL)
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
                        ChiefApproval(interactionId: $0.id, summary: $0.payload.subject?.command ?? $0.payload.subject?.plan ?? $0.summary,
                                      canApprove: $0.decisions.contains("allow_once"), canDeny: $0.decisions.contains("deny"),
                                      subjectKind: $0.payload.subject?.kind)
                    }
                entry.stale = false
                DiskCache.save(ChiefCache(threadId: threadId, message: entry.message, running: entry.running, approval: entry.approval),
                               as: "chief-widget", serverURL: client.baseURL)
            } catch is CancellationError {
            } catch {
                entry.stale = true
            }
            entry.date = .now
            entry.serverURL = client.baseURL
            if client.baseURL != ServerScope.selectedURL { entry = .placeholder }
            // The app reloads widgets when a thread starts or stops running.
            completion(Timeline(entries: [entry], policy: .after(.now + (entry.running ? 5 : 15) * 60)))
        }
    }

    private func cached() -> ChiefEntry? {
        guard let value = DiskCache.load(ChiefCache.self, key: "chief-widget") else { return nil }
        return ChiefEntry(date: .now, threadId: value.threadId, message: value.message, running: value.running, approval: value.approval)
    }

    /// Markdown markers read as noise at widget size.
    static func plain(_ text: String) -> String {
        text.replacingOccurrences(of: #"[*_`#>]+"#, with: "", options: .regularExpression)
            .replacingOccurrences(of: #"\[([^\]]+)\]\([^)]+\)"#, with: "$1", options: .regularExpression)
            .trimmingCharacters(in: .whitespacesAndNewlines)
    }
}

/// Answers the chief's pending approval from the widget, without opening the app.
struct ChiefDecisionIntent: AppIntent {
    static let title: LocalizedStringResource = "Answer Chief of Staff"
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

struct ChiefWidget: Widget {
    var body: some WidgetConfiguration {
        StaticConfiguration(kind: "BBChief", provider: ChiefProvider()) { entry in
            ChiefWidgetView(entry: entry).containerBackground(.fill.tertiary, for: .widget)
        }
        .configurationDisplayName("Chief of Staff")
        .description("Your chief of staff's latest message, with a mic to talk to it.")
        .supportedFamilies([.systemSmall, .systemMedium, .accessoryCircular, .accessoryRectangular])
    }
}

private struct ChiefWidgetView: View {
    @Environment(\.widgetFamily) private var family
    private let snapshot: ChiefEntry
    init(entry: ChiefEntry) { snapshot = entry }
    private var entry: ChiefEntry { snapshot.serverURL == ServerScope.selectedURL ? snapshot : .placeholder }

    private var talkURL: URL { AppLink.scoped(URL(string: "bbstudio://chief-talk")!, serverURL: entry.serverURL) }
    private var openURL: URL { AppLink.scoped(URL(string: "bbstudio://chief")!, serverURL: entry.serverURL) }
    private var message: String {
        if entry.threadId == nil && entry.message == nil { return "Make a thread the Personal Space's lead to see it here." }
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
                Label(entry.approval != nil ? "Needs approval" : entry.running ? "Working…" : "Chief of Staff",
                      systemImage: "person.crop.circle.badge.checkmark")
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
            Text(entry.approval != nil ? "Needs approval" : entry.running ? "Working…" : "Chief of Staff")
                .font(.caption.weight(.semibold))
                .foregroundStyle(entry.approval != nil ? Color.orange : entry.running ? .green : .secondary)
                .lineLimit(1)
            if entry.stale { Image(systemName: "wifi.slash").font(.caption2).foregroundStyle(.secondary) }
            Spacer(minLength: 0)
            Link(destination: talkURL) {
                Image(systemName: "mic.fill")
                    .font(.footnote.weight(.semibold))
                    .foregroundStyle(.white)
                    .frame(width: 30, height: 30)
                    .background(Color.red, in: .circle)
            }
            .accessibilityLabel("Talk to Chief of Staff")
        }
    }

    @ViewBuilder
    private func decisions(_ approval: ChiefApproval) -> some View {
        if let threadId = entry.threadId {
            HStack(spacing: 6) {
                if approval.canApprove {
                    Button(intent: ChiefDecisionIntent(threadId: threadId, interactionId: approval.interactionId, decision: "allow_once", serverURL: entry.serverURL)) {
                        Text(approvalLabel("allow_once", subjectKind: approval.subjectKind)).frame(maxWidth: .infinity)
                    }
                    .tint(.green)
                }
                if approval.canDeny {
                    Button(intent: ChiefDecisionIntent(threadId: threadId, interactionId: approval.interactionId, decision: "deny", serverURL: entry.serverURL)) {
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
