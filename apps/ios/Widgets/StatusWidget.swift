import SwiftUI
import WidgetKit

struct StatusEntry: TimelineEntry {
    var serverURL: URL = ServerScope.selectedURL
    var date: Date
    var needsYou: [ThreadEntry]
    var running: [ThreadEntry]
    /// True when this came from the app's cache because the server was unreachable.
    var stale: Bool

    static let placeholder = StatusEntry(date: .now, needsYou: [], running: [], stale: false)
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
                entry = StatusEntry(date: .now, needsYou: summary.needsYou, running: summary.running, stale: false)
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

    private func cached() -> StatusEntry? {
        guard let snapshot = DiskCache.load(InboxSnapshot.self, key: InboxSnapshot.cacheKey) else { return nil }
        let summary = ThreadSummary(snapshot.threads)
        return StatusEntry(date: .now, needsYou: summary.needsYou, running: summary.running, stale: false)
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
    @Environment(\.widgetFamily) private var family
    private let snapshot: StatusEntry
    init(entry: StatusEntry) { snapshot = entry }
    private var entry: StatusEntry {
        snapshot.serverURL == ServerScope.selectedURL ? snapshot : .placeholder
    }

    private var headline: ThreadEntry? { entry.needsYou.first ?? entry.running.first }
    private var url: URL {
        if let first = entry.needsYou.first { return AppLink.scoped(URL(string: "bbstudio://thread/\(first.id)")!, serverURL: entry.serverURL) }
        return AppLink.scoped(URL(string: "bbstudio://inbox")!, serverURL: entry.serverURL)
    }

    var body: some View {
        switch family {
        case .accessoryCircular:
            ZStack {
                AccessoryWidgetBackground()
                VStack(spacing: 0) {
                    Image(systemName: entry.needsYou.isEmpty ? "circle.fill" : "exclamationmark.circle.fill")
                        .font(.caption2)
                    Text("\(entry.needsYou.isEmpty ? entry.running.count : entry.needsYou.count)")
                        .font(.title3.weight(.semibold))
                }
            }
            .widgetURL(url)
        case .accessoryInline:
            Text("⚠ \(entry.needsYou.count) · ● \(entry.running.count) running").widgetURL(url)
        case .accessoryRectangular:
            VStack(alignment: .leading, spacing: 1) {
                Text("⚠ \(entry.needsYou.count) needs you · ● \(entry.running.count)").font(.headline)
                Text(headline?.displayTitle ?? "All clear").font(.caption).lineLimit(2)
            }
            .frame(maxWidth: .infinity, alignment: .leading)
            .widgetURL(url)
        case .systemMedium:
            HStack(alignment: .top, spacing: 12) {
                counts
                VStack(alignment: .leading, spacing: 6) {
                    ForEach((entry.needsYou + entry.running).prefix(4)) { thread in
                        Link(destination: AppLink.scoped(URL(string: "bbstudio://thread/\(thread.id)")!, serverURL: entry.serverURL)) {
                            HStack(spacing: 6) {
                                Circle().fill(thread.needsYou ? Color.orange : .green).frame(width: 6, height: 6)
                                Text(thread.displayTitle).font(.caption).lineLimit(1)
                            }
                        }
                    }
                    if entry.needsYou.isEmpty && entry.running.isEmpty {
                        Text("Nothing running.").font(.caption).foregroundStyle(.secondary)
                    }
                    Spacer(minLength: 0)
                    HStack(spacing: 16) {
                        Link(destination: AppLink.scoped(URL(string: "bbstudio://dictate")!, serverURL: entry.serverURL)) { Label("Dictate", systemImage: "mic.fill") }
                        Link(destination: AppLink.scoped(URL(string: "bbstudio://voice")!, serverURL: entry.serverURL)) { Label("Voice", systemImage: Symbols.voiceChat) }
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
                Text(headline?.displayTitle ?? "All clear").font(.caption).lineLimit(2)
            }
            .frame(maxWidth: .infinity, alignment: .leading)
            .widgetURL(url)
        }
    }

    private var counts: some View {
        VStack(alignment: .leading, spacing: 4) {
            Label("\(entry.needsYou.count)", systemImage: "exclamationmark.circle.fill")
                .foregroundStyle(entry.needsYou.isEmpty ? Color.secondary : Color.orange)
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
