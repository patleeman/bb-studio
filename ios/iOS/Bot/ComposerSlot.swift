import SwiftUI

/// The one thing above a Bot conversation's composer. Each kind takes the
/// slot alone, in this order: a waiting approval (actionable ones first,
/// desktop-only Tool Gateway asks last), the model router's offer to hand
/// off, a plan to review, a strand filter, then the strands line. Questions
/// and asks are ordinary messages in the transcript; things that happened
/// once are lines there too (`TranscriptNotice`), and states that last are
/// chips in the composer's top row (`ComposerChip`).
enum ComposerSlot: Equatable {
    case approval
    case routerNotice
    case planReview
    case onlyStrand
    case strands
    case none

    struct Inputs: Equatable {
        var approvals = 0
        var routerNotice = false
        var planReview = false
        var onlyStrand = false
        var strands = false
    }

    static func pick(_ inputs: Inputs) -> ComposerSlot {
        if inputs.approvals > 0 { return .approval }
        if inputs.routerNotice { return .routerNotice }
        if inputs.planReview { return .planReview }
        if inputs.onlyStrand { return .onlyStrand }
        if inputs.strands { return .strands }
        return .none
    }

    /// One page of the approval card: a worker's approval you can answer, or a
    /// Tool Gateway ask that only the desktop can approve.
    enum Page: Identifiable, Equatable {
        case approval(ConversationApprovals.Card)
        case gateway(Strand.Ask)

        var id: String {
            switch self {
            case .approval(let card): card.id
            case .gateway(let ask): "gateway:\(ask.threadId):\(ask.id)"
            }
        }
    }

    /// The pages, actionable approvals first (waiting, then just answered,
    /// which stay a moment with their result), then the desktop-only asks,
    /// minus those put away. Desktop-only asks never take the slot alone: the
    /// phone can't answer them, so without an approval to page from they stay
    /// view-only rows in the strands box and the strands line keeps its place.
    static func pages(_ cards: [ConversationApprovals.Card], gateway: [Strand.Ask], hidden: Set<String>) -> [Page] {
        let waiting = cards.filter { $0.approval.state.waiting }.map(Page.approval)
        let settled = cards.filter { !$0.approval.state.waiting }.map(Page.approval)
        let actionable = (waiting + settled).filter { !hidden.contains($0.id) }
        guard !actionable.isEmpty else { return [] }
        return actionable + gateway.map(Page.gateway).filter { !hidden.contains($0.id) }
    }

    /// The page to show after the pages change: the same one if it is still there, else the nearest.
    static func page(_ current: Int, previousId: String?, in pages: [Page]) -> Int {
        guard !pages.isEmpty else { return 0 }
        if let previousId, let index = pages.firstIndex(where: { $0.id == previousId }) { return index }
        return min(max(0, current), pages.count - 1)
    }

    /// The strand asks the desktop alone can approve.
    static func gatewayAsks(_ list: StrandList?) -> [Strand.Ask] {
        (list?.strands ?? []).flatMap(\.asks).filter { $0.kind == .gateway }
    }
}

/// Which approvals each open conversation shows as its card, so the strands
/// box (above the composer, or the unfolded Duo's pane) lists the ask without
/// buttons of its own and brings the card up instead.
@MainActor @Observable
final class ApprovalSlots {
    static let shared = ApprovalSlots()

    /// Card ids (`<worker thread>:<interaction>`) by conversation.
    private(set) var cards: [String: Set<String>] = [:]
    /// The waiting cards themselves, for the Workspace's Info (Needs you).
    private(set) var waiting: [String: [ConversationApprovals.Card]] = [:]

    func setWaiting(_ list: [ConversationApprovals.Card], for threadId: String) {
        if waiting[threadId] != list { waiting[threadId] = list }
    }
    /// A card a conversation was asked to bring up (an ask tapped in the strands box).
    private(set) var requests: [String: String] = [:]

    func set(_ ids: Set<String>, for threadId: String) {
        if cards[threadId] != ids { cards[threadId] = ids }
    }

    func clear(_ threadId: String) {
        cards[threadId] = nil
        waiting[threadId] = nil
        requests[threadId] = nil
    }

    /// The card for a strand's approval ask, when the conversation shows one.
    func cardId(for ask: Strand.Ask, in threadId: String) -> String? {
        guard ask.kind == .approval else { return nil }
        let id = "\(ask.threadId):\(ask.id)"
        return cards[threadId]?.contains(id) == true ? id : nil
    }

    func bringUp(_ cardId: String, in threadId: String) { requests[threadId] = cardId }

    func take(_ threadId: String) -> String? {
        guard let id = requests[threadId] else { return nil }
        requests[threadId] = nil
        return id
    }
}

/// The card's top line: needs you (or desktop only), who asks, "1 of 3 ›", and ⌄ to put it away.
private struct SlotCardHeader: View {
    let mark: AnyView
    let label: String
    let index: Int
    let count: Int
    let next: () -> Void
    let hide: () -> Void
    var openOwner: (() -> Void)?

    var body: some View {
        HStack(spacing: 7) {
            mark
            if let openOwner {
                Button(action: openOwner) { Text(label).lineLimit(1).foregroundStyle(.secondary) }
                    .buttonStyle(.plain)
                    .frame(minHeight: 44)
                    .accessibilityIdentifier("approvalWorker")
            } else {
                Text(label).lineLimit(1).foregroundStyle(.secondary)
            }
            Spacer(minLength: 4)
            if count > 1 {
                Button(action: next) {
                    Text("\(index + 1) of \(count) ›").monospacedDigit().foregroundStyle(.secondary)
                        .frame(minWidth: 44, minHeight: 44).contentShape(.rect)
                }
                .buttonStyle(.plain)
                .accessibilityLabel("Next approval, \(index + 1) of \(count)")
                .accessibilityIdentifier("approvalNext")
            }
            Button(action: hide) {
                Image(systemName: "chevron.down").font(.caption.weight(.semibold)).foregroundStyle(.secondary)
                    .frame(width: 44, height: 44).contentShape(.rect)
            }
            .buttonStyle(.plain)
            .accessibilityLabel("Show strands")
            .accessibilityHint("Puts the approval away; it stays in the strands")
            .accessibilityIdentifier("approvalHide")
        }
        .font(.footnote)
    }
}

/// A waiting approval in the composer's slot: who asks, what, the whole
/// command, Deny and Approve, and "Always allow for this worker" when BB
/// offers it. "1 of 3 ›" pages through the others, so they never stack.
struct ApprovalSlotCard: View {
    let card: ConversationApprovals.Card
    let index: Int
    let count: Int
    let next: () -> Void
    let hide: () -> Void
    let openWorker: () -> Void
    let decide: (WorkerApproval.Decision) -> Void
    @Environment(\.look) private var look

    private var approval: WorkerApproval { card.approval }
    private var always: Bool { approval.decisions.contains(.allowForSession) && approval.state.settledLabel == nil }

    var body: some View {
        VStack(alignment: .leading, spacing: 4) {
            SlotCardHeader(mark: AnyView(mark), label: approval.state.waiting ? "Needs you · \(approval.worker.title)" : approval.worker.title,
                           index: index, count: count, next: next, hide: hide, openOwner: openWorker)
            Text(approval.title)
                .font(.body.weight(.semibold))
                .fixedSize(horizontal: false, vertical: true)
                .accessibilityIdentifier("approvalTitle")
            if let detail = approval.detail {
                Text(detail)
                    .font(.footnote.monospaced())
                    .lineLimit(6)
                    .frame(maxWidth: .infinity, alignment: .leading)
                    .padding(.horizontal, 10)
                    .padding(.vertical, 8)
                    .background(.black.opacity(0.3), in: .rect(cornerRadius: 10))
                    .textSelection(.enabled)
                    .padding(.vertical, 4)
                    .accessibilityIdentifier("approvalLines")
            }
            if let settled = approval.state.settledLabel {
                Label(settled, systemImage: approval.state == .denied ? "xmark" : "checkmark")
                    .font(.footnote.weight(.semibold))
                    .foregroundStyle(.secondary)
                    .frame(minHeight: 44)
                    .accessibilityIdentifier("approvalSettled")
            } else {
                buttons
            }
            if let error = card.error {
                Text(error)
                    .font(.footnote)
                    .foregroundStyle(.red)
                    .fixedSize(horizontal: false, vertical: true)
                    .accessibilityIdentifier("approvalError")
            }
        }
        .padding(.leading, 14)
        .padding(.trailing, 4)
        .padding(.bottom, always ? 0 : 12)
        .background(look.stackFill, in: .rect(cornerRadius: 18, style: .continuous))
        .overlay(RoundedRectangle(cornerRadius: 18, style: .continuous)
            .strokeBorder(look.needsYou.opacity(approval.state.waiting ? 0.45 : 0.15)))
        .accessibilityElement(children: .contain)
        .accessibilityLabel("Needs you, approval \(index + 1) of \(count), \(approval.title)")
        .accessibilityIdentifier("workerApproval")
    }

    @ViewBuilder private var mark: some View {
        if approval.state.waiting { Circle().fill(look.needsYou).frame(width: 8, height: 8).accessibilityHidden(true) }
    }

    private var buttons: some View {
        VStack(spacing: 0) {
            HStack(spacing: 10) {
                ForEach(approval.decisions.filter { $0 != .allowForSession }, id: \.self) { decision in
                    Button { decide(decision) } label: {
                        Group {
                            if card.busy == decision { ProgressView() } else { Text(decision.label).lineLimit(1).minimumScaleFactor(0.8) }
                        }
                        .font(.body.weight(.semibold))
                        .frame(maxWidth: .infinity)
                        .frame(height: 44)
                        .foregroundStyle(decision == .allowOnce ? Color(uiColor: .systemBackground) : .primary)
                        .background(decision == .allowOnce ? AnyShapeStyle(Color.primary) : AnyShapeStyle(.fill.tertiary), in: .capsule)
                        .contentShape(.capsule)
                    }
                    .buttonStyle(.plain)
                    .disabled(card.busy != nil || approval.state == .resolving)
                    .accessibilityIdentifier("approval-\(decision.rawValue)")
                }
            }
            .padding(.trailing, 10)
            if always {
                Button { decide(.allowForSession) } label: {
                    Group {
                        if card.busy == .allowForSession { ProgressView() } else { Text("Always allow for this worker") }
                    }
                    .font(.subheadline)
                    .foregroundStyle(.secondary)
                    .frame(maxWidth: .infinity, minHeight: 44)
                    .contentShape(.rect)
                }
                .buttonStyle(.plain)
                .disabled(card.busy != nil || approval.state == .resolving)
                .accessibilityIdentifier("approval-\(WorkerApproval.Decision.allowForSession.rawValue)")
            }
        }
    }
}

/// A Tool Gateway ask in the slot's pages: shown, but approved on the desktop.
struct GatewaySlotCard: View {
    let ask: Strand.Ask
    let index: Int
    let count: Int
    let next: () -> Void
    let hide: () -> Void
    @Environment(\.look) private var look

    var body: some View {
        VStack(alignment: .leading, spacing: 4) {
            SlotCardHeader(mark: AnyView(RoundedRectangle(cornerRadius: 2).strokeBorder(.secondary, lineWidth: 1.5).frame(width: 8, height: 8)),
                           label: "Desktop only · Tool Gateway", index: index, count: count, next: next, hide: hide)
            Text(ask.label.isEmpty ? "A Tool Gateway ask" : ask.label)
                .font(.body.weight(.semibold))
                .fixedSize(horizontal: false, vertical: true)
            if !ask.details.isEmpty {
                Text(ask.details.joined(separator: "\n"))
                    .font(.footnote.monospaced()).lineLimit(4)
                    .frame(maxWidth: .infinity, alignment: .leading)
                    .padding(.horizontal, 10).padding(.vertical, 8)
                    .background(.black.opacity(0.3), in: .rect(cornerRadius: 10))
                    .padding(.vertical, 4)
            }
            Text("Approve on the desktop")
                .font(.subheadline).foregroundStyle(.secondary)
                .frame(maxWidth: .infinity, minHeight: 44)
        }
        .padding(.leading, 14)
        .padding(.trailing, 4)
        .background(look.stackFill, in: .rect(cornerRadius: 18, style: .continuous))
        .overlay(RoundedRectangle(cornerRadius: 18, style: .continuous).strokeBorder(.separator.opacity(0.8)))
        .accessibilityElement(children: .contain)
        .accessibilityLabel("Desktop only, \(index + 1) of \(count), \(ask.label)")
        .accessibilityIdentifier("gatewayAsk")
    }
}
