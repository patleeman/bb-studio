import SwiftUI
import WidgetKit

struct WorkEntry: TimelineEntry {
    var date: Date
    var tasks: [StudioTask]
    var attention: Int
    var approvals: Int
    var running: [ThreadEntry]
    var stale: Bool
    static let placeholder = WorkEntry(date: .now, tasks: [], attention: 0, approvals: 0, running: [], stale: false)
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
                async let tasks = client.tasksBoard()
                async let threads = client.threads(limit: 100)
                async let attention = client.attention()
                async let teams = client.botTeams()
                let today = StudioTask.day(.now)
                entry.tasks = try await tasks.filter { !$0.archived && $0.status != "done" && $0.due == today }
                entry.running = ThreadSummary(try await threads).running
                entry.attention = (try? await attention.openCount) ?? entry.attention
                entry.approvals = (try? await teams.approvalCounts?.values.reduce(0, +)) ?? entry.approvals
                entry.stale = false
                DiskCache.save(WorkCache(tasks: entry.tasks, attention: entry.attention, approvals: entry.approvals, running: entry.running), as: "work-widget")
            } catch { entry.stale = true }
            entry.date = .now
            completion(Timeline(entries: [entry], policy: .after(.now + 15 * 60)))
        }
    }
    private func cached() -> WorkEntry? {
        guard let value = DiskCache.load(WorkCache.self, key: "work-widget") else { return nil }
        return WorkEntry(date: .now, tasks: value.tasks, attention: value.attention, approvals: value.approvals, running: value.running, stale: false)
    }
}

private struct WorkCache: Codable {
    var tasks: [StudioTask]
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
        .description("Tasks due today, bot attention, and running agents.")
        .supportedFamilies([.systemMedium, .systemLarge])
    }
}

private struct WorkWidgetView: View {
    let entry: WorkEntry
    var body: some View {
        VStack(alignment: .leading, spacing: 8) {
            HStack {
                Label("Today", systemImage: "checklist").font(.headline)
                Spacer()
                if entry.stale { Image(systemName: "wifi.slash").foregroundStyle(.secondary) }
            }
            HStack(spacing: 12) {
                Link(destination: URL(string: "bbstudio://tasks")!) {
                    Label("\(entry.tasks.count) due", systemImage: "calendar")
                }
                Link(destination: URL(string: "bbstudio://attention")!) {
                    Label("\(entry.attention) attention", systemImage: "exclamationmark.bubble")
                }
                Label("\(entry.running.count) running", systemImage: "circle.fill")
            }.font(.caption).lineLimit(1)
            if entry.approvals > 0 {
                Link(destination: URL(string: "bbstudio://inbox")!) {
                    Label("Review \(entry.approvals) pending approval\(entry.approvals == 1 ? "" : "s")", systemImage: "hand.raised")
                }
                .accessibilityIdentifier("workReviewApprovals")
            }
            ForEach(entry.tasks.prefix(3)) { task in
                Link(destination: URL(string: "bbstudio://task/\(task.id)")!) {
                    Label(task.displayTitle, systemImage: "checkmark.circle").lineLimit(1)
                }.accessibilityIdentifier("workTask_\(task.id)")
            }
            ForEach(entry.running.prefix(2)) { thread in
                Link(destination: URL(string: "bbstudio://thread/\(thread.id)")!) {
                    Label(thread.displayTitle, systemImage: "circle.dotted.circle").lineLimit(1)
                }
            }
            if entry.tasks.isEmpty && entry.running.isEmpty {
                Text("Nothing due or running.").foregroundStyle(.secondary)
            }
            Spacer(minLength: 0)
        }
        .font(.caption)
        .frame(maxWidth: .infinity, alignment: .leading)
        .padding(4)
    }
}
