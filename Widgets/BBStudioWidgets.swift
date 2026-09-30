import ActivityKit
import SwiftUI
import WidgetKit

@main
struct BBStudioWidgets: WidgetBundle {
    var body: some Widget {
        BBStatusLiveActivity()
        StatusWidget()
        DictateControl()
        VoiceControl()
        NewThreadControl()
    }
}

struct BBStatusLiveActivity: Widget {
    var body: some WidgetConfiguration {
        ActivityConfiguration(for: BBStatusAttributes.self) { context in
            LockScreenView(state: context.state)
                .activityBackgroundTint(Color.black.opacity(0.6))
                .activitySystemActionForegroundColor(.white)
                .widgetURL(context.state.url)
        } dynamicIsland: { context in
            let state = context.state
            return DynamicIsland {
                DynamicIslandExpandedRegion(.leading) {
                    NeedsYouLabel(count: state.needsYou, long: true).padding(.leading, 4)
                }
                DynamicIslandExpandedRegion(.trailing) {
                    RunningLabel(count: state.running, long: true).padding(.trailing, 4)
                }
                DynamicIslandExpandedRegion(.bottom) {
                    Details(state: state).frame(maxWidth: .infinity, alignment: .leading).padding(.horizontal, 4)
                }
            } compactLeading: {
                if state.needsYou > 0 {
                    NeedsYouLabel(count: state.needsYou, long: false)
                } else {
                    Text("BB").font(.caption.weight(.heavy)).foregroundStyle(.secondary)
                }
            } compactTrailing: {
                RunningLabel(count: state.running, long: false)
            } minimal: {
                if state.needsYou > 0 {
                    NeedsYouLabel(count: state.needsYou, long: false)
                } else {
                    RunningLabel(count: state.running, long: false)
                }
            }
            .widgetURL(state.url)
            .keylineTint(state.needsYou > 0 ? .orange : .green)
        }
    }
}

private struct LockScreenView: View {
    let state: BBStatusAttributes.ContentState

    var body: some View {
        VStack(alignment: .leading, spacing: 6) {
            HStack(spacing: 14) {
                if state.isClear {
                    Label("All clear", systemImage: "checkmark.circle.fill")
                        .font(.headline)
                        .foregroundStyle(.green)
                } else {
                    if state.needsYou > 0 { NeedsYouLabel(count: state.needsYou, long: true) }
                    if state.running > 0 { RunningLabel(count: state.running, long: true) }
                }
                Spacer()
            }
            Details(state: state)
        }
        .padding(14)
    }
}

private struct Details: View {
    let state: BBStatusAttributes.ContentState

    var body: some View {
        VStack(alignment: .leading, spacing: 2) {
            if let headline = state.headline, !state.isClear {
                Text(headline)
                    .font(.subheadline.weight(.semibold))
                    .lineLimit(1)
            }
            if let latest = state.latest {
                Text(latest)
                    .font(.caption)
                    .foregroundStyle(.secondary)
                    .lineLimit(1)
            }
        }
    }
}

private struct NeedsYouLabel: View {
    let count: Int
    let long: Bool

    var body: some View {
        HStack(spacing: 4) {
            Image(systemName: "exclamationmark.circle.fill")
            Text(long ? "\(count) needs you" : "\(count)")
        }
        .font(long ? .headline : .body.weight(.semibold))
        .foregroundStyle(count > 0 ? Color.orange : Color.secondary)
        .monospacedDigit()
    }
}

private struct RunningLabel: View {
    let count: Int
    let long: Bool

    var body: some View {
        HStack(spacing: 4) {
            Image(systemName: "circle.fill").font(.system(size: long ? 8 : 7))
            Text(long ? "\(count) running" : "\(count)")
        }
        .font(long ? .headline : .body.weight(.semibold))
        .foregroundStyle(count > 0 ? Color.green : Color.secondary)
        .monospacedDigit()
    }
}
