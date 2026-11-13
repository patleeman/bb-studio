import ActivityKit
import SwiftUI
import WidgetKit

/// The Bot Live Activity (design 10e): the presence glyph, the Bot's name,
/// "N workers", the conversation's latest line, and what needs you in amber.
/// The expanded island answers a worker approval with Deny and Approve.
struct BotLiveActivity: Widget {
    var body: some WidgetConfiguration {
        ActivityConfiguration(for: BotActivityAttributes.self) { context in
            BotActivityLockView(attributes: context.attributes, state: context.state)
                .padding(.horizontal, 16)
                .padding(.vertical, 14)
                .activityBackgroundTint(Color.black.opacity(0.45))
                .activitySystemActionForegroundColor(.white)
                .widgetURL(BotActivityLinks.open(context.attributes, context.state))
        } dynamicIsland: { context in
            let state = context.state
            return DynamicIsland {
                DynamicIslandExpandedRegion(.leading) {
                    HStack(spacing: 8) {
                        BotActivityGlyph(botId: context.attributes.botId, state: state.presence, size: 28)
                        Text(context.attributes.botName).font(.headline).lineLimit(1)
                    }
                    .padding(.leading, 4)
                }
                DynamicIslandExpandedRegion(.trailing) {
                    BotActivityWorkers(count: state.workers).padding(.trailing, 4)
                }
                DynamicIslandExpandedRegion(.bottom) {
                    VStack(alignment: .leading, spacing: 6) {
                        BotActivityLine(state: state)
                        if let needs = state.needsYou { BotActivityNeeds(text: needs) }
                        if let approval = state.approval {
                            BotActivityDecisions(attributes: context.attributes, state: state, approval: approval)
                        }
                    }
                    .frame(maxWidth: .infinity, alignment: .leading)
                    .padding(.horizontal, 4)
                }
            } compactLeading: {
                BotActivityGlyph(botId: context.attributes.botId, state: state.presence, size: 22)
            } compactTrailing: {
                Text("\(state.workers)")
                    .font(.callout.weight(.semibold))
                    .monospacedDigit()
                    .foregroundStyle(state.presence == .needs ? BotActivityStyle.amber : .white)
                    .accessibilityLabel(BotActivityWorkers.label(state.workers))
            } minimal: {
                BotActivityGlyph(botId: context.attributes.botId, state: state.presence, size: 22)
            }
            .keylineTint(state.presence == .needs ? BotActivityStyle.amber : nil)
            .widgetURL(BotActivityLinks.open(context.attributes, state))
        }
    }
}

enum BotActivityStyle {
    /// Design 10e's needs-you amber (#f2b04a).
    static let amber = Color(red: 0xf2 / 255, green: 0xb0 / 255, blue: 0x4a / 255)
}

/// The lock screen banner.
struct BotActivityLockView: View {
    let attributes: BotActivityAttributes
    let state: BotActivityAttributes.ContentState

    var body: some View {
        VStack(alignment: .leading, spacing: 8) {
            HStack(spacing: 10) {
                BotActivityGlyph(botId: attributes.botId, state: state.presence, size: 30)
                Text(attributes.botName).font(.headline).lineLimit(1)
                Spacer(minLength: 4)
                BotActivityWorkers(count: state.workers)
            }
            BotActivityLine(state: state)
            if let needs = state.needsYou { BotActivityNeeds(text: needs) }
        }
        .foregroundStyle(.white)
    }
}

/// The Bot's presence still for its state, written by the app; a dot until it has one.
struct BotActivityGlyph: View {
    let botId: String
    let state: BotPresenceState
    let size: CGFloat

    var body: some View {
        Group {
            if let data = PresenceStillFiles.data(botId: botId, state: state), let image = UIImage(data: data) {
                Image(uiImage: image).resizable().interpolation(.high).scaledToFit()
            } else {
                Circle()
                    .fill(state == .needs ? BotActivityStyle.amber : Color.white.opacity(state == .idle ? 0.4 : 0.85))
                    .padding(size * 0.25)
            }
        }
        .frame(width: size, height: size)
        .accessibilityLabel(Self.label(state))
    }

    static func label(_ state: BotPresenceState) -> String {
        switch state {
        case .idle: "Idle"
        case .thinking: "Thinking"
        case .working: "Working"
        case .needs: "Needs you"
        }
    }
}

struct BotActivityWorkers: View {
    let count: Int

    var body: some View {
        if count > 0 {
            HStack(spacing: 5) {
                Image(systemName: "arrow.triangle.2.circlepath").font(.caption.weight(.semibold))
                Text(Self.label(count)).monospacedDigit()
            }
            .font(.subheadline)
            .foregroundStyle(.white.opacity(0.7))
        }
    }

    static func label(_ count: Int) -> String { count == 1 ? "1 worker" : "\(count) workers" }
}

/// "Main · the latest line".
struct BotActivityLine: View {
    let state: BotActivityAttributes.ContentState

    var body: some View {
        if let line = state.line {
            (Text("\(state.conversationTitle ?? "Main") · ").foregroundStyle(.white.opacity(0.55))
                + Text(line).foregroundStyle(.white.opacity(0.85)))
                .font(.subheadline)
                .lineLimit(2)
        } else if let title = state.conversationTitle {
            Text(state.presence == .thinking ? "\(title) · Thinking…" : title)
                .font(.subheadline)
                .foregroundStyle(.white.opacity(0.7))
                .lineLimit(1)
        }
    }
}

struct BotActivityNeeds: View {
    let text: String

    var body: some View {
        HStack(spacing: 8) {
            Circle().fill(BotActivityStyle.amber).frame(width: 8, height: 8)
            Text(text).lineLimit(2)
        }
        .font(.subheadline.weight(.semibold))
        .foregroundStyle(BotActivityStyle.amber)
    }
}

struct BotActivityDecisions: View {
    let attributes: BotActivityAttributes
    let state: BotActivityAttributes.ContentState
    let approval: BotActivityAttributes.Approval

    var body: some View {
        HStack(spacing: 8) {
            if approval.canDeny { button("Deny", decision: "deny", tint: .gray) }
            if approval.canApprove { button("Approve", decision: "allow_once", tint: .green) }
        }
        .font(.subheadline.weight(.semibold))
    }

    private func button(_ title: String, decision: String, tint: Color) -> some View {
        Button(intent: BotDecisionIntent(threadId: state.conversationId ?? approval.workerThreadId, interactionId: approval.interactionId,
                                         decision: decision, server: attributes.server, worker: approval.workerThreadId)) {
            Text(title).frame(maxWidth: .infinity)
        }
        .buttonStyle(.borderedProminent)
        .tint(tint)
    }
}
