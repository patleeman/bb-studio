import SwiftUI
import WidgetKit

struct StatusEntry: TimelineEntry {
    var serverURL: URL = ServerScope.selectedURL
    var date: Date
    var needsYou: [ThreadEntry]
    var running: [ThreadEntry]
    /// True when this came from the app's cache because the server was unreachable.
    var stale: Bool
    /// The Bot's attention; nil counts `needsYou`, BB's threads waiting on you (an older Studio).
    var bot: NeedsYouCount? = nil
    /// BB's threads waiting on an answer, newest first, even when the Bot counts
    /// what needs you: the large sizes list them by title.
    var waiting: [ThreadEntry] = []

    static let placeholder = StatusEntry(date: .now, needsYou: [], running: [], stale: false)

    /// Made-up rows for the gallery and the redacted placeholder.
    static var sample: StatusEntry {
        let running = [("Lisbon offsite options", 3.0), ("Draft the Q4 roadmap page", 12), ("Refactor the widget timeline", 26),
                       ("Triage this week's inbox", 41), ("Summarize the design review", 55), ("Port the sync worker", 80)]
            .enumerated().map { ThreadEntry.widgetSample("thr_sr\($0.offset)", $0.element.0, minutesAgo: $0.element.1) }
        let waiting = [
            ThreadEntry.widgetSample("thr_sw0", "Approve deploy to prod", minutesAgo: 4, pending: true),
            ThreadEntry.widgetSample("thr_sw1", "Rename the billing tables", minutesAgo: 25, pending: true),
            ThreadEntry.widgetSample("thr_sw2", "Nightly import", minutesAgo: 130, status: "error"),
        ]
        return StatusEntry(date: .now, needsYou: [], running: running, stale: false,
                           bot: .bot(count: 1, reason: "Asked you a question"), waiting: waiting)
    }

    /// How many things need you: the Bot's count, else the threads waiting on you.
    var needsCount: Int { bot?.count ?? needsYou.count }
}

struct StatusProvider: TimelineProvider {
    func placeholder(in context: Context) -> StatusEntry { .sample }

    func getSnapshot(in context: Context, completion: @escaping (StatusEntry) -> Void) {
        completion(cached() ?? (context.isPreview ? .sample : .placeholder))
    }

    func getTimeline(in context: Context, completion: @escaping (Timeline<StatusEntry>) -> Void) {
        Task {
            let client = BBClient()
            var entry: StatusEntry
            do {
                let summary = ThreadSummary(try await client.threads(limit: 100))
                let needs = await client.needsYouCount(fallback: summary)
                entry = Self.entry(summary, needs: needs)
                DiskCache.save(needs, as: Self.needsKey, serverURL: client.baseURL)
            } catch {
                entry = cached() ?? .placeholder
                entry.stale = true
            }
            // The app also reloads widgets whenever the counts change while it's open.
            entry.serverURL = client.baseURL
            if client.baseURL != ServerScope.selectedURL { entry = .placeholder }
            completion(Timeline(entries: [entry], policy: .after(.now + 15 * 60)))
        }
    }

    private static let needsKey = "status-widget-needs"

    /// The Bot's attention when there is one; BB's waiting threads only on the fallback.
    static func entry(_ summary: ThreadSummary, needs: NeedsYouCount?) -> StatusEntry {
        let fromBot = needs?.fromBot == true
        return StatusEntry(date: .now, needsYou: fromBot ? [] : summary.needsYou, running: summary.running, stale: false,
                           bot: fromBot ? needs : nil, waiting: Array(summary.needsYou.prefix(12)))
    }

    private func cached() -> StatusEntry? {
        guard let snapshot = DiskCache.load(InboxSnapshot.self, key: InboxSnapshot.cacheKey) else { return nil }
        return Self.entry(ThreadSummary(snapshot.threads), needs: DiskCache.load(NeedsYouCount.self, key: Self.needsKey))
    }
}

struct StatusWidget: Widget {
    var body: some WidgetConfiguration {
        StaticConfiguration(kind: "BBStatus", provider: StatusProvider()) { entry in
            StatusWidgetView(entry: entry)
                .containerBackground(.fill.tertiary, for: .widget)
        }
        .configurationDisplayName("BB status")
        .description("What needs you and what's running.")
        .supportedFamilies([.systemSmall, .systemMedium, .systemLarge, .systemExtraLarge, .accessoryCircular, .accessoryRectangular, .accessoryInline])
    }
}

struct StatusWidgetView: View {
    @Environment(\.widgetFamily) private var widgetFamily
    private let snapshot: StatusEntry
    /// Set only by the app's `-qaStateDemo widgets` screenshots; WidgetKit sets the family.
    private let shownFamily: WidgetFamily?
    init(entry: StatusEntry, family: WidgetFamily? = nil) {
        snapshot = entry
        shownFamily = family
    }
    private var family: WidgetFamily { shownFamily ?? widgetFamily }
    private var entry: StatusEntry {
        snapshot.serverURL == ServerScope.selectedURL ? snapshot : .placeholder
    }

    private var headline: ThreadEntry? { entry.needsYou.first ?? entry.running.first }
    /// The Bot's reason while it needs you, else the headline thread.
    private var headlineText: String { reason ?? headline?.displayTitle ?? "All clear" }
    private var reason: String? { entry.needsCount > 0 ? entry.bot?.reason : nil }
    private var url: URL {
        if reason != nil { return AppLink.scoped(URL(string: "bbstudio://bot")!, serverURL: entry.serverURL) }
        if let first = entry.needsYou.first { return AppLink.scoped(URL(string: "bbstudio://thread/\(first.id)")!, serverURL: entry.serverURL) }
        return AppLink.scoped(URL(string: "bbstudio://inbox")!, serverURL: entry.serverURL)
    }

    var body: some View {
        switch family {
        case .accessoryCircular:
            ZStack {
                AccessoryWidgetBackground()
                VStack(spacing: 0) {
                    Image(systemName: entry.needsCount == 0 ? "circle.fill" : "exclamationmark.circle.fill")
                        .font(.caption2)
                    Text("\(entry.needsCount == 0 ? entry.running.count : entry.needsCount)")
                        .font(.title3.weight(.semibold))
                }
            }
            .widgetURL(url)
        case .accessoryInline:
            Text(reason.map { "⚠ \($0) · ● \(entry.running.count)" } ?? "⚠ \(entry.needsCount) · ● \(entry.running.count) running").widgetURL(url)
        case .accessoryRectangular:
            VStack(alignment: .leading, spacing: 1) {
                Text("⚠ \(entry.needsCount) needs you · ● \(entry.running.count)").font(.headline)
                Text(headlineText).font(.caption).lineLimit(2)
            }
            .frame(maxWidth: .infinity, alignment: .leading)
            .widgetURL(url)
        case .systemMedium:
            HStack(alignment: .top, spacing: 12) {
                counts
                VStack(alignment: .leading, spacing: 6) {
                    if let reason {
                        Link(destination: AppLink.scoped(URL(string: "bbstudio://bot")!, serverURL: entry.serverURL)) {
                            HStack(spacing: 6) {
                                Circle().fill(Color.orange).frame(width: 6, height: 6)
                                Text(reason).font(.caption.weight(.semibold)).lineLimit(1)
                            }
                        }
                    }
                    ForEach((entry.needsYou + entry.running).prefix(reason == nil ? 4 : 3)) { thread in
                        Link(destination: AppLink.scoped(URL(string: "bbstudio://thread/\(thread.id)")!, serverURL: entry.serverURL)) {
                            HStack(spacing: 6) {
                                Circle().fill(thread.needsYou ? Color.orange : .green).frame(width: 6, height: 6)
                                Text(thread.displayTitle).font(.caption).lineLimit(1)
                            }
                        }
                    }
                    if entry.needsCount == 0 && entry.running.isEmpty {
                        Text("Nothing running.").font(.caption).foregroundStyle(.secondary)
                    }
                    Spacer(minLength: 0)
                    HStack(spacing: 16) {
                        Link(destination: AppLink.scoped(URL(string: "bbstudio://dictate")!, serverURL: entry.serverURL)) { Label("Dictate", systemImage: "mic.fill") }
                    }
                    .font(.caption.weight(.semibold))
                }
                .frame(maxWidth: .infinity, alignment: .leading)
            }
            .widgetURL(url)
        case .systemLarge:
            VStack(alignment: .leading, spacing: 10) {
                bar
                needsSection(limit: 5)
                runningSection(limit: 10 - min(needRows, 5))
                Spacer(minLength: 0)
            }
            .frame(maxWidth: .infinity, maxHeight: .infinity, alignment: .topLeading)
            .widgetURL(url)
        case .systemExtraLarge:
            VStack(alignment: .leading, spacing: 10) {
                bar
                HStack(alignment: .top, spacing: 20) {
                    needsSection(limit: 10).frame(maxWidth: .infinity, alignment: .leading)
                    runningSection(limit: 10).frame(maxWidth: .infinity, alignment: .leading)
                }
                Spacer(minLength: 0)
            }
            .frame(maxWidth: .infinity, maxHeight: .infinity, alignment: .topLeading)
            .widgetURL(url)
        default:
            VStack(alignment: .leading) {
                counts
                Spacer(minLength: 0)
                Text(headlineText).font(.caption).lineLimit(2)
            }
            .frame(maxWidth: .infinity, alignment: .leading)
            .widgetURL(url)
        }
    }

    /// The large sizes' top line: both counts across, then Dictate.
    private var bar: some View {
        HStack(spacing: 14) {
            Label("\(entry.needsCount)", systemImage: "exclamationmark.circle.fill")
                .foregroundStyle(entry.needsCount == 0 ? Color.secondary : Color.orange)
            Label("\(entry.running.count)", systemImage: "circle.fill")
                .foregroundStyle(entry.running.isEmpty ? Color.secondary : Color.green)
            if entry.stale {
                Label("Offline", systemImage: "wifi.slash").font(.caption2).foregroundStyle(.secondary)
            }
            Spacer(minLength: 0)
            Link(destination: WidgetText.link("dictate", serverURL: entry.serverURL)) {
                Label("Dictate", systemImage: "mic.fill").font(.caption.weight(.semibold))
            }
        }
        .font(.title2.weight(.semibold))
        .monospacedDigit()
    }

    /// Rows under Needs you: the Bot's reason, then each thread waiting on an answer.
    private var needRows: Int { (reason == nil ? 0 : 1) + entry.waiting.count }

    private func needsSection(limit: Int) -> some View {
        let threads = Array(entry.waiting.prefix(max(0, limit - (reason == nil ? 0 : 1))))
        return VStack(alignment: .leading, spacing: 6) {
            WidgetSectionTitle(title: "Needs you", count: entry.needsCount)
            if let reason {
                WidgetRow(url: WidgetText.link("bot", serverURL: entry.serverURL), title: reason, note: "Bot",
                          dot: .orange)
                    .fontWeight(.semibold)
            }
            ForEach(threads) { thread in
                WidgetRow(url: WidgetText.thread(thread.id, serverURL: entry.serverURL), title: thread.displayTitle, note: thread.widgetNote,
                          age: WidgetText.age(thread.latestAttentionAt ?? thread.updatedAt, now: entry.date), dot: .orange)
            }
            WidgetMore(hidden: entry.waiting.count - threads.count)
            if needRows == 0 {
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

    private var counts: some View {
        VStack(alignment: .leading, spacing: 4) {
            Label("\(entry.needsCount)", systemImage: "exclamationmark.circle.fill")
                .foregroundStyle(entry.needsCount == 0 ? Color.secondary : Color.orange)
            Label("\(entry.running.count)", systemImage: "circle.fill")
                .foregroundStyle(entry.running.isEmpty ? Color.secondary : Color.green)
            if entry.stale {
                Label("Offline", systemImage: "wifi.slash").font(.caption2).foregroundStyle(.secondary)
            }
        }
        .font(.title2.weight(.semibold))
        .monospacedDigit()
    }
}
