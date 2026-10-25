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

    static let placeholder = StatusEntry(date: .now, needsYou: [], running: [], stale: false)

    /// How many things need you: the Bot's count, else the threads waiting on you.
    var needsCount: Int { bot?.count ?? needsYou.count }
}

struct StatusProvider: TimelineProvider {
    func placeholder(in context: Context) -> StatusEntry { .placeholder }

    func getSnapshot(in context: Context, completion: @escaping (StatusEntry) -> Void) {
        completion(cached() ?? .placeholder)
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
                           bot: fromBot ? needs : nil)
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
        .supportedFamilies([.systemSmall, .systemMedium, .accessoryCircular, .accessoryRectangular, .accessoryInline])
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
