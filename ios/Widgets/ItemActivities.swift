import ActivityKit
import SwiftUI
import WidgetKit

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
