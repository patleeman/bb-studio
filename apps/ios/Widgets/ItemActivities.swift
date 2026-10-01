import ActivityKit
import SwiftUI
import WidgetKit

struct ThreadLiveActivity: Widget {
    var body: some WidgetConfiguration {
        ActivityConfiguration(for: BBThreadAttributes.self) { context in
            ThreadActivityView(threadId: context.attributes.threadId, state: context.state)
                .padding(14)
                .activityBackgroundTint(Color.black.opacity(0.6))
                .activitySystemActionForegroundColor(.white)
                .widgetURL(threadURL(context.attributes.threadId))
        } dynamicIsland: { context in
            let state = context.state
            return DynamicIsland {
                DynamicIslandExpandedRegion(.leading) { PhaseIcon(phase: state.phase).padding(.leading, 4) }
                DynamicIslandExpandedRegion(.center) { Text(state.title).font(.headline).lineLimit(1) }
                DynamicIslandExpandedRegion(.trailing) { PhaseLabel(phase: state.phase).padding(.trailing, 4) }
                DynamicIslandExpandedRegion(.bottom) {
                    ThreadActivityBody(threadId: context.attributes.threadId, state: state).padding(.horizontal, 4)
                }
            } compactLeading: {
                PhaseIcon(phase: state.phase)
            } compactTrailing: {
                Text(state.title).font(.caption).lineLimit(1).frame(maxWidth: 64)
            } minimal: {
                PhaseIcon(phase: state.phase)
            }
            .widgetURL(threadURL(context.attributes.threadId))
            .keylineTint(phaseColor(state.phase))
        }
    }
}

private func threadURL(_ id: String) -> URL { URL(string: "bbstudio://thread/\(id)")! }

private func phaseColor(_ phase: String) -> Color {
    switch phase {
    case "needsYou": .orange
    case "failed": .red
    case "done": .blue
    default: .green
    }
}

private struct ThreadActivityView: View {
    let threadId: String
    let state: BBThreadAttributes.ContentState

    var body: some View {
        VStack(alignment: .leading, spacing: 8) {
            HStack(spacing: 6) {
                PhaseIcon(phase: state.phase)
                Text(state.title).font(.headline).lineLimit(1)
                Spacer(minLength: 8)
                PhaseLabel(phase: state.phase)
            }
            ThreadActivityBody(threadId: threadId, state: state)
        }
    }
}

/// The ask, the latest reply, and what you can do from here.
private struct ThreadActivityBody: View {
    let threadId: String
    let state: BBThreadAttributes.ContentState

    var body: some View {
        VStack(alignment: .leading, spacing: 8) {
            if let ask = state.ask {
                Text(ask.text).font(.subheadline.weight(.semibold)).lineLimit(2)
            }
            if let last = state.last {
                Text(last)
                    .font(.subheadline)
                    .foregroundStyle(.secondary)
                    .lineLimit(state.ask == nil ? 3 : 2)
                    .truncationMode(.head)
            }
            HStack(spacing: 8) {
                if let ask = state.ask {
                    if ask.kind == "question" {
                        ForEach(Array(ask.choices.enumerated()), id: \.offset) { index, choice in
                            answer(choice, String(index))
                        }
                    } else {
                        answer(ask.kind == "plan" ? "Approve plan" : "Approve", "allow_once", tint: .green)
                        answer(ask.kind == "plan" ? "Keep planning" : "Deny", "deny", tint: .red)
                    }
                } else if state.phase == "running" {
                    Button(intent: StopThreadIntent(threadId: threadId)) {
                        Label("Stop", systemImage: "stop.fill")
                    }
                    .tint(.red)
                }
                Spacer(minLength: 0)
                Link(destination: URL(string: "bbstudio://reply/\(threadId)")!) {
                    Label(state.ask?.kind == "question" && state.ask?.choices.isEmpty == true ? "Answer" : "Reply", systemImage: "arrowshape.turn.up.left.fill")
                        .padding(.horizontal, 10)
                        .padding(.vertical, 6)
                        .background(.white.opacity(0.15), in: Capsule())
                }
            }
            .font(.caption.weight(.semibold))
            .buttonStyle(.bordered)
            .buttonBorderShape(.capsule)
            .lineLimit(1)
        }
    }

    private func answer(_ title: String, _ value: String, tint: Color = .orange) -> some View {
        Button(intent: AnswerThreadIntent(threadId: threadId, interactionId: state.ask?.id ?? "", answer: value)) {
            Text(title)
        }
        .tint(tint)
    }
}

private struct PhaseIcon: View {
    let phase: String

    var body: some View {
        Image(systemName: {
            switch phase {
            case "needsYou": "exclamationmark.circle.fill"
            case "failed": "xmark.circle.fill"
            case "done": "checkmark.circle.fill"
            default: "circle.dotted.circle"
            }
        }())
        .foregroundStyle(phaseColor(phase))
    }
}

private struct PhaseLabel: View {
    let phase: String

    var body: some View {
        Text({
            switch phase {
            case "needsYou": "Needs you"
            case "failed": "Failed"
            case "done": "Done"
            default: "Running"
            }
        }())
        .font(.caption.weight(.semibold))
        .foregroundStyle(phaseColor(phase))
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
