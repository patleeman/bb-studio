import SwiftUI
import WidgetKit

struct WorkEntry: TimelineEntry {
    var serverURL: URL = ServerScope.selectedURL
    var date: Date
    /// The Bot's attention count, or BB's threads waiting on you from an older Studio.
    var attention: Int
    /// The Bot's reason ("Asked you a question"); nil on the fallback.
    var reason: String? = nil
    var approvals: Int
    var running: [ThreadEntry]
    var stale: Bool
    /// The threads waiting on an approval or answer, newest first (extra large).
    var pending: [ThreadEntry] = []
    static let placeholder = WorkEntry(date: .now, attention: 0, approvals: 0, running: [], stale: false)

    /// What Needs you counts: the rows it lists. The Bot's reason is one, plus each
    /// thread waiting on an approval; BB's own count already includes those threads.
    var needsCount: Int { reason != nil ? 1 + approvals : max(attention, approvals) }

    /// How many waiting and running threads the large size lists: up to five waiting,
    /// then running threads fill the rest of ten rows (the Bot's reason takes one).
    static func largeLimits(reason: Bool, pending: Int, running: Int) -> (pending: Int, running: Int) {
        let shownPending = min(pending, 5)
        return (shownPending, min(running, 10 - (reason ? 1 : 0) - shownPending))
    }

    /// Made-up rows for the gallery and the redacted placeholder.
    static var sample: WorkEntry {
        let running = [("Lisbon offsite options", 3.0), ("Draft the Q4 roadmap page", 12), ("Refactor the widget timeline", 26),
                       ("Triage this week's inbox", 41), ("Summarize the design review", 55), ("Port the sync worker", 80),
                       ("Weekly digest", 95)]
            .enumerated().map { ThreadEntry.widgetSample("thr_wr\($0.offset)", $0.element.0, minutesAgo: $0.element.1) }
        let pending = [
            ThreadEntry.widgetSample("thr_wp0", "Approve deploy to prod", minutesAgo: 4, pending: true),
            ThreadEntry.widgetSample("thr_wp1", "Rename the billing tables", minutesAgo: 25, pending: true),
        ]
        return WorkEntry(date: .now, attention: 1, reason: "Asked you a question", approvals: pending.count, running: running, stale: false,
                         pending: pending)
    }
}

struct WorkProvider: TimelineProvider {
    func placeholder(in context: Context) -> WorkEntry { .sample }
    func getSnapshot(in context: Context, completion: @escaping (WorkEntry) -> Void) {
        completion(cached() ?? (context.isPreview ? .sample : .placeholder))
    }
    func getTimeline(in context: Context, completion: @escaping (Timeline<WorkEntry>) -> Void) {
        Task {
            let client = BBClient()
            var entry = cached() ?? .placeholder
            do {
                let threadRows = try await client.threads(limit: 100)
                let summary = ThreadSummary(threadRows)
                entry.running = summary.running
                let needs = await client.needsYouCount(fallback: summary)
                entry.attention = needs.count
                entry.reason = needs.reason
                let pending = threadRows.filter { $0.hasPendingInteraction == true }
                entry.approvals = pending.count
                entry.pending = Array(pending.sorted { ($0.latestAttentionAt ?? $0.updatedAt) > ($1.latestAttentionAt ?? $1.updatedAt) }.prefix(8))
                entry.stale = false
                DiskCache.save(WorkCache(attention: entry.attention, reason: entry.reason, approvals: entry.approvals, running: entry.running,
                                         pending: entry.pending), as: "work-widget", serverURL: client.baseURL)
            } catch { entry.stale = true }
            entry.date = .now
            entry.serverURL = client.baseURL
            if client.baseURL != ServerScope.selectedURL { entry = .placeholder }
            completion(Timeline(entries: [entry], policy: .after(.now + 15 * 60)))
        }
    }
    private func cached() -> WorkEntry? {
        guard let value = DiskCache.load(WorkCache.self, key: "work-widget") else { return nil }
        return WorkEntry(date: .now, attention: value.attention, reason: value.reason, approvals: value.approvals, running: value.running, stale: false,
                         pending: value.pending ?? [])
    }
}

private struct WorkCache: Codable {
    var attention: Int
    var reason: String?
    var approvals: Int
    var running: [ThreadEntry]
    var pending: [ThreadEntry]? = nil
}

struct WorkWidget: Widget {
    var body: some WidgetConfiguration {
        StaticConfiguration(kind: "BBWork", provider: WorkProvider()) { entry in
            WorkWidgetView(entry: entry).containerBackground(.fill.tertiary, for: .widget)
        }
        .configurationDisplayName("BB work")
        .description("Pending approvals and running agents.")
        .supportedFamilies([.systemMedium, .systemLarge, .systemExtraLarge])
    }
}

struct WorkWidgetView: View {
    @Environment(\.widgetFamily) private var widgetFamily
    private let snapshot: WorkEntry
    /// Set only by the app's `-qaStateDemo widgets` screenshots; WidgetKit sets the family.
    private let shownFamily: WidgetFamily?
    init(entry: WorkEntry, family: WidgetFamily? = nil) {
        snapshot = entry
        shownFamily = family
    }
    private var family: WidgetFamily { shownFamily ?? widgetFamily }
    private var entry: WorkEntry {
        snapshot.serverURL == ServerScope.selectedURL ? snapshot : .placeholder
    }
    var body: some View {
        switch family {
        case .systemLarge: large
        case .systemExtraLarge: extraLarge
        default: standard
        }
    }

    /// Large: the extra large's two columns stacked, what waits on you above what's running.
    private var large: some View {
        let limits = WorkEntry.largeLimits(reason: needsReason, pending: entry.pending.count, running: entry.running.count)
        return VStack(alignment: .leading, spacing: 10) {
            header
            needsSection(limit: limits.pending)
            runningSection(limit: limits.running)
            Spacer(minLength: 0)
        }
        .frame(maxWidth: .infinity, maxHeight: .infinity, alignment: .topLeading)
        .padding(4)
    }

    /// Extra large: what waits on you on the left, everything running on the right.
    private var extraLarge: some View {
        VStack(alignment: .leading, spacing: 10) {
            header
            HStack(alignment: .top, spacing: 20) {
                needsSection(limit: 7).frame(maxWidth: .infinity, alignment: .leading)
                runningSection(limit: 10).frame(maxWidth: .infinity, alignment: .leading)
            }
            Spacer(minLength: 0)
        }
        .frame(maxWidth: .infinity, maxHeight: .infinity, alignment: .topLeading)
        .padding(4)
    }

    private var header: some View {
        HStack {
            Label("Today", systemImage: "checklist").font(.headline)
            Spacer()
            if entry.stale { Image(systemName: "wifi.slash").foregroundStyle(.secondary) }
        }
    }

    /// Whether Needs you starts with the Bot's reason or BB's count.
    private var needsReason: Bool { entry.attention > 0 || entry.reason != nil }

    /// The Bot's reason, "Review N pending approvals", then up to `limit` threads waiting on one.
    private func needsSection(limit: Int) -> some View {
        let threads = Array(entry.pending.prefix(max(0, limit)))
        return VStack(alignment: .leading, spacing: 6) {
            WidgetSectionTitle(title: "Needs you", count: entry.needsCount)
            if needsReason {
                WidgetRow(url: WidgetText.link(entry.reason == nil ? "inbox" : "bot", serverURL: entry.serverURL),
                          title: entry.reason ?? "\(entry.attention) attention", note: entry.reason == nil ? nil : "Bot", dot: .orange)
                    .fontWeight(.semibold)
            }
            if entry.approvals > 0 {
                Link(destination: WidgetText.link("inbox", serverURL: entry.serverURL)) {
                    Label("Review \(entry.approvals) pending approval\(entry.approvals == 1 ? "" : "s")", systemImage: "hand.raised")
                }
                .font(.caption.weight(.semibold))
                .padding(.top, 2)
            }
            ForEach(threads) { thread in
                WidgetRow(url: WidgetText.thread(thread.id, serverURL: entry.serverURL), title: thread.displayTitle,
                          age: WidgetText.age(thread.latestAttentionAt ?? thread.updatedAt, now: entry.date), dot: .orange)
            }
            WidgetMore(hidden: max(entry.approvals, entry.pending.count) - threads.count)
            if entry.needsCount == 0 {
                Text("Nothing needs you.").font(.caption).foregroundStyle(.secondary)
            }
        }
    }

    private func runningSection(limit: Int) -> some View {
        let threads = Array(entry.running.prefix(max(0, limit)))
        return VStack(alignment: .leading, spacing: 6) {
            WidgetSectionTitle(title: "Running", count: entry.running.count)
            ForEach(threads) { thread in
                WidgetRow(url: WidgetText.thread(thread.id, serverURL: entry.serverURL), title: thread.displayTitle,
                          note: thread.projectName, age: WidgetText.age(thread.latestAttentionAt ?? thread.updatedAt, now: entry.date))
            }
            WidgetMore(hidden: entry.running.count - threads.count)
            if entry.running.isEmpty {
                Text("Nothing running.").font(.caption).foregroundStyle(.secondary)
            }
        }
    }

    private var standard: some View {
        VStack(alignment: .leading, spacing: 8) {
            HStack {
                Label("Today", systemImage: "checklist").font(.headline)
                Spacer()
                if entry.stale { Image(systemName: "wifi.slash").foregroundStyle(.secondary) }
            }
            HStack(spacing: 12) {
                // The Bot's reason opens the Bot; the BB-wide count opens the inbox.
                Link(destination: AppLink.scoped(URL(string: entry.reason == nil ? "bbstudio://inbox" : "bbstudio://bot")!, serverURL: entry.serverURL)) {
                    Label(entry.reason ?? (entry.needsCount == 0 ? "Nothing needs you." : "\(entry.attention) attention"), systemImage: "exclamationmark.bubble")
                }
                Label("\(entry.running.count) running", systemImage: "circle.fill")
            }.font(.caption).lineLimit(1)
            if entry.approvals > 0 {
                Link(destination: AppLink.scoped(URL(string: "bbstudio://inbox")!, serverURL: entry.serverURL)) {
                    Label("Review \(entry.approvals) pending approval\(entry.approvals == 1 ? "" : "s")", systemImage: "hand.raised")
                }
                .accessibilityIdentifier("workReviewApprovals")
            }
            ForEach(entry.running.prefix(2)) { thread in
                Link(destination: AppLink.scoped(URL(string: "bbstudio://thread/\(thread.id)")!, serverURL: entry.serverURL)) {
                    Label(thread.displayTitle, systemImage: "circle.dotted.circle").lineLimit(1)
                }
            }
            if entry.running.isEmpty {
                Text("Nothing running.").foregroundStyle(.secondary)
            }
            Spacer(minLength: 0)
        }
        .font(.caption)
        .frame(maxWidth: .infinity, alignment: .leading)
        .padding(4)
    }
}
