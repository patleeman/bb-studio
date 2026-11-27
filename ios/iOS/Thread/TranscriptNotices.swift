import SwiftUI

/// Something that happened once, as a quiet line at the end of a Bot
/// conversation's transcript: the model was switched, a hand-off finished,
/// the last turn failed, the outbox couldn't save. One action at most.
struct TranscriptNotice: Identifiable, Equatable {
    enum Action: Equatable {
        case dismissFallback(Int)
        case retryTurn
        case retryStorage
        case dismissHandoff
    }

    enum Tone: Equatable { case quiet, error, done }

    var id: String
    var icon: String
    var text: String
    var tone: Tone = .quiet
    var action: Action?
    var actionLabel: String?

    /// The lines for what holds now, in a fixed order.
    static func lines(fallback: ModelFallback?, dismissedFallbacks: String, handoffDone: String?, storageError: String?,
                      turnFailed: Bool) -> [TranscriptNotice] {
        var out: [TranscriptNotice] = []
        if let fallback, let seq = fallback.sourceSeq,
           !dismissedFallbacks.split(separator: ",").contains(Substring(String(Int(seq)))) {
            out.append(TranscriptNotice(id: "fallback-\(Int(seq))", icon: "arrow.triangle.swap",
                                        text: "Switched from \(fallback.originalModel) to \(fallback.fallbackModel)",
                                        action: .dismissFallback(Int(seq)), actionLabel: "Dismiss"))
        }
        if let handoffDone {
            out.append(TranscriptNotice(id: "handoff", icon: "checkmark.circle", text: handoffDone, tone: .done,
                                        action: .dismissHandoff, actionLabel: "Dismiss"))
        }
        if let storageError {
            out.append(TranscriptNotice(id: "storage", icon: "exclamationmark.triangle", text: storageError, tone: .error,
                                        action: .retryStorage, actionLabel: "Retry"))
        }
        if turnFailed {
            out.append(TranscriptNotice(id: "turn-failed", icon: "exclamationmark.triangle", text: "The last turn failed", tone: .error,
                                        action: .retryTurn, actionLabel: "Retry"))
        }
        return out
    }
}

struct TranscriptNoticeRow: View {
    let notice: TranscriptNotice
    let act: (TranscriptNotice.Action) -> Void

    var body: some View {
        HStack(spacing: 8) {
            Image(systemName: notice.icon)
                .foregroundStyle(notice.tone == .error ? AnyShapeStyle(.red) : AnyShapeStyle(.secondary))
                .frame(width: 18)
                .accessibilityHidden(true)
            Text(notice.text).foregroundStyle(.secondary).lineLimit(3)
            Spacer(minLength: 4)
            if let action = notice.action, let label = notice.actionLabel {
                Button(label) { act(action) }
                    .font(.subheadline.weight(.semibold))
                    .frame(minWidth: 44, minHeight: 44)
                    .accessibilityIdentifier("notice-\(notice.id)-action")
            }
        }
        .font(.footnote)
        .frame(minHeight: 44)
        .overlay(alignment: .top) { Divider().opacity(0.5) }
        .accessibilityElement(children: .contain)
        .accessibilityIdentifier("notice-\(notice.id)")
    }
}
