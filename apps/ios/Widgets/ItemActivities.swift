import ActivityKit
import SwiftUI
import WidgetKit

struct ThreadLiveActivity: Widget {
    var body: some WidgetConfiguration {
        ActivityConfiguration(for: BBThreadAttributes.self) { context in
            HStack {
                Image(systemName: context.state.needsYou ? "exclamationmark.circle.fill" : "circle.dotted.circle")
                VStack(alignment: .leading) {
                    Text(context.state.title).font(.headline).lineLimit(1)
                    Text(context.state.needsYou ? "Needs you" : context.state.status.capitalized).font(.caption)
                }
                Spacer()
            }
            .padding()
            .widgetURL(URL(string: "bbstudio://thread/\(context.attributes.threadId)"))
        } dynamicIsland: { context in
            DynamicIsland {
                DynamicIslandExpandedRegion(.center) { Text(context.state.title).lineLimit(1) }
                DynamicIslandExpandedRegion(.bottom) { Text(context.state.needsYou ? "Needs you" : context.state.status.capitalized) }
            } compactLeading: { Image(systemName: context.state.needsYou ? "exclamationmark.circle" : "circle.dotted.circle") }
            compactTrailing: { Text(context.state.title).lineLimit(1) }
            minimal: { Image(systemName: "circle.dotted.circle") }
            .widgetURL(URL(string: "bbstudio://thread/\(context.attributes.threadId)"))
        }
    }
}

struct RecordingLiveActivity: Widget {
    var body: some WidgetConfiguration {
        ActivityConfiguration(for: BBRecordingAttributes.self) { context in
            HStack {
                Image(systemName: "record.circle.fill").foregroundStyle(.red)
                Text("Recording")
                Spacer()
                Text(Date(timeIntervalSince1970: context.state.startedAt), style: .timer).monospacedDigit()
            }
            .padding()
            .widgetURL(URL(string: "bbstudio://recording/\(context.attributes.recordingId)"))
        } dynamicIsland: { context in
            DynamicIsland {
                DynamicIslandExpandedRegion(.center) { Text("Recording in BB Studio") }
                DynamicIslandExpandedRegion(.bottom) { Text(Date(timeIntervalSince1970: context.state.startedAt), style: .timer) }
            } compactLeading: { Image(systemName: "record.circle.fill").foregroundStyle(.red) }
            compactTrailing: { Text(Date(timeIntervalSince1970: context.state.startedAt), style: .timer) }
            minimal: { Image(systemName: "record.circle.fill").foregroundStyle(.red) }
            .widgetURL(URL(string: "bbstudio://recording/\(context.attributes.recordingId)"))
        }
    }
}
