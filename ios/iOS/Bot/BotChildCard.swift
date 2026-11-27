import SwiftUI

/// A thread the Bot started or heard back from, as one compact card (desktop's ChildCard).
struct BotChildCard: View {
    let event: BotChildEvent
    /// The thread's status now, from the Bot's Activity.
    let live: BotChildStatus?
    var inset: CGFloat = 0
    let open: () -> Void
    @Environment(\.look) private var look

    private var status: BotChildStatus { live ?? event.status }
    private var symbol: String {
        if event.verb == .started { return "arrow.up.right" }
        switch status {
        case .finished: return "checkmark.circle"
        case .failed: return "exclamationmark.circle"
        default: return "text.bubble"
        }
    }
    private var dot: Color {
        switch status {
        case .running, .finished: .green
        case .failed: .red
        case .needsYou: look.needsYou
        case .stopped, .waiting: .secondary
        }
    }
    private var label: String { "\(event.verb == .started ? "Started " : "")‘\(event.title)’" }

    var body: some View {
        Button(action: open) {
            HStack(spacing: 10) {
                Image(systemName: symbol)
                    .font(.footnote.weight(.semibold))
                    .foregroundStyle(.secondary)
                    .frame(width: 30, height: 30)
                    .background(.fill.tertiary, in: .rect(cornerRadius: 8, style: .continuous))
                VStack(alignment: .leading, spacing: 2) {
                    (Text(event.verb == .started ? "Started " : "").foregroundStyle(.secondary) + Text("‘\(event.title)’"))
                        .font(.subheadline)
                        .lineLimit(1)
                    HStack(spacing: 5) {
                        Circle().fill(dot).frame(width: 6, height: 6)
                        Text(status.label).font(.caption).foregroundStyle(.secondary)
                    }
                }
                Spacer(minLength: 0)
                if event.threadId != nil {
                    Image(systemName: "chevron.right").font(.caption.weight(.semibold)).foregroundStyle(.secondary)
                }
            }
            .padding(.horizontal, 10)
            .padding(.vertical, 8)
            .frame(maxWidth: 360, alignment: .leading)
            .background(inset == 0 ? AnyShapeStyle(look.canvas.opacity(0.28)) : AnyShapeStyle(Color(uiColor: .systemBackground)), in: .rect(cornerRadius: 14, style: .continuous))
            .overlay(RoundedRectangle(cornerRadius: 14, style: .continuous).strokeBorder(inset == 0 ? AnyShapeStyle(.white.opacity(0.14)) : AnyShapeStyle(.separator), lineWidth: inset == 0 ? 0.5 : 1))
        }
        .buttonStyle(.plain)
        .disabled(event.threadId == nil)
        .padding(.leading, inset)
        .frame(maxWidth: .infinity, alignment: .leading)
        .accessibilityLabel("\(label), \(status.label)")
        .accessibilityHint(event.threadId != nil ? "Opens the thread" : "")
    }
}
