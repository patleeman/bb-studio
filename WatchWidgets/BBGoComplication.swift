import SwiftUI
import WidgetKit

/// Watch face complication: how many threads need you, and how many are running.
/// The phone sends the counts (PhoneRelay.pushStatus); this only reads them.
struct StatusEntry: TimelineEntry {
    var date: Date
    var status: StatusSnapshot?
}

struct StatusProvider: TimelineProvider {
    func placeholder(in context: Context) -> StatusEntry {
        StatusEntry(date: .now, status: nil)
    }

    func getSnapshot(in context: Context, completion: @escaping (StatusEntry) -> Void) {
        completion(StatusEntry(date: .now, status: StatusSnapshot.load()))
    }

    func getTimeline(in context: Context, completion: @escaping (Timeline<StatusEntry>) -> Void) {
        let entry = StatusEntry(date: .now, status: StatusSnapshot.load())
        completion(Timeline(entries: [entry], policy: .after(.now.addingTimeInterval(30 * 60))))
    }
}

struct ComplicationView: View {
    @Environment(\.widgetFamily) private var family
    let entry: StatusEntry

    private var needsYou: Int { entry.status?.needsYou ?? 0 }
    private var running: Int { entry.status?.running ?? 0 }
    private var tint: Color { needsYou > 0 ? .orange : running > 0 ? .green : .secondary }

    var body: some View {
        switch family {
        case .accessoryCircular:
            ZStack {
                AccessoryWidgetBackground()
                VStack(spacing: 0) {
                    Image(systemName: needsYou > 0 ? "hand.raised.fill" : running > 0 ? "circle.dotted" : "checkmark")
                        .font(.caption)
                    if needsYou + running > 0 {
                        Text("\(needsYou > 0 ? needsYou : running)").font(.title3.weight(.semibold))
                    }
                }
                .foregroundStyle(tint)
            }
            .widgetAccentable()
        case .accessoryCorner:
            Image(systemName: needsYou > 0 ? "hand.raised.fill" : "checkmark")
                .foregroundStyle(tint)
                .widgetLabel { Text(label) }
        case .accessoryInline:
            Text(label)
        default:
            VStack(alignment: .leading, spacing: 2) {
                Text("BB").font(.headline).foregroundStyle(tint).widgetAccentable()
                Text(label).font(.caption)
                if let headline = entry.status?.headline, needsYou + running > 0 {
                    Text(headline).font(.caption2).foregroundStyle(.secondary).lineLimit(1)
                }
            }
            .frame(maxWidth: .infinity, alignment: .leading)
        }
    }

    private var label: String {
        if entry.status == nil { return "BB" }
        switch (needsYou, running) {
        case (0, 0): return "All clear"
        case (0, _): return "\(running) running"
        case (_, 0): return "\(needsYou) need\(needsYou == 1 ? "s" : "") you"
        default: return "\(needsYou) need you · \(running) running"
        }
    }
}

@main
struct BBGoComplication: Widget {
    var body: some WidgetConfiguration {
        StaticConfiguration(kind: "BBGoStatus", provider: StatusProvider()) { entry in
            ComplicationView(entry: entry)
                .containerBackground(.fill.tertiary, for: .widget)
                .widgetURL(URL(string: "bbgo://inbox"))
        }
        .configurationDisplayName("BB status")
        .description("Threads that need you and threads running.")
        .supportedFamilies([.accessoryCircular, .accessoryCorner, .accessoryInline, .accessoryRectangular])
    }
}
