import SwiftUI
import WidgetKit

struct WorkEntry: TimelineEntry {
    var serverURL: URL = ServerScope.selectedURL
    var date: Date
    var attention: Int
    var approvals: Int
    var running: [ThreadEntry]
    var stale: Bool
    static let placeholder = WorkEntry(date: .now, attention: 0, approvals: 0, running: [], stale: false)
}

struct WorkProvider: TimelineProvider {
    func placeholder(in context: Context) -> WorkEntry { .placeholder }
    func getSnapshot(in context: Context, completion: @escaping (WorkEntry) -> Void) {
        completion(cached() ?? .placeholder)
    }
    func getTimeline(in context: Context, completion: @escaping (Timeline<WorkEntry>) -> Void) {
        Task {
            let client = BBClient()
            var entry = cached() ?? .placeholder
            do {
                let threadRows = try await client.threads(limit: 100)
                let summary = ThreadSummary(threadRows)
                entry.running = summary.running
                entry.attention = summary.needsYou.count
                entry.approvals = threadRows.filter { $0.hasPendingInteraction == true }.count
                entry.stale = false
                DiskCache.save(WorkCache(attention: entry.attention, approvals: entry.approvals, running: entry.running), as: "work-widget", serverURL: client.baseURL)
            } catch { entry.stale = true }
            entry.date = .now
            entry.serverURL = client.baseURL
            if client.baseURL != ServerScope.selectedURL { entry = .placeholder }
            completion(Timeline(entries: [entry], policy: .after(.now + 15 * 60)))
        }
    }
    private func cached() -> WorkEntry? {
        guard let value = DiskCache.load(WorkCache.self, key: "work-widget") else { return nil }
        return WorkEntry(date: .now, attention: value.attention, approvals: value.approvals, running: value.running, stale: false)
    }
}

private struct WorkCache: Codable {
    var attention: Int
    var approvals: Int
    var running: [ThreadEntry]
}

struct WorkWidget: Widget {
    var body: some WidgetConfiguration {
        StaticConfiguration(kind: "BBWork", provider: WorkProvider()) { entry in
            WorkWidgetView(entry: entry).containerBackground(.fill.tertiary, for: .widget)
        }
        .configurationDisplayName("BB work")
        .description("Bot attention, pending approvals, and running agents.")
        .supportedFamilies([.systemMedium, .systemLarge])
    }
}

private struct WorkWidgetView: View {
    private let snapshot: WorkEntry
    init(entry: WorkEntry) { snapshot = entry }
    private var entry: WorkEntry {
        snapshot.serverURL == ServerScope.selectedURL ? snapshot : .placeholder
    }
    var body: some View {
        VStack(alignment: .leading, spacing: 8) {
            HStack {
                Label("Today", systemImage: "checklist").font(.headline)
                Spacer()
                if entry.stale { Image(systemName: "wifi.slash").foregroundStyle(.secondary) }
            }
            HStack(spacing: 12) {
                Link(destination: AppLink.scoped(URL(string: "bbstudio://inbox")!, serverURL: entry.serverURL)) {
                    Label("\(entry.attention) attention", systemImage: "exclamationmark.bubble")
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
