import SwiftUI

@MainActor
final class ConversationApprovals: ObservableObject {
    struct Card: Identifiable, Equatable {
        var approval: WorkerApproval
        var busy: WorkerApproval.Decision?
        var error: String?
        var id: String { approval.id }
    }

    @Published private(set) var cards: [Card] = []
    @Published private(set) var loaded = false
    var settleDelay: Duration = .seconds(4)

    var waiting: Bool { cards.contains { $0.approval.state.waiting } }

    func load(_ threadId: String, client: BBClient) async {
        guard let fetched = try? await client.conversationApprovals(threadId: threadId) else { return }
        let ids = Set(fetched.map(\.id))
        var next = fetched.map { approval in
            var card = cards.first { $0.id == approval.id } ?? Card(approval: approval)
            if card.approval.state.waiting { card.approval = approval }
            return card
        }
        next += cards.filter { !ids.contains($0.id) && !$0.approval.state.waiting }
        if next != cards { cards = next }
        loaded = true
    }

    @discardableResult
    func decide(_ id: String, _ decision: WorkerApproval.Decision, client: BBClient) async -> WorkerApproval.State? {
        guard let card = cards.first(where: { $0.id == id }), card.busy == nil, card.approval.state.waiting else { return nil }
        update(id) {
            $0.busy = decision
            $0.error = nil
        }
        do {
            let state = try await client.resolveWorkerApproval(workerThreadId: card.approval.worker.threadId,
                                                               interactionId: card.approval.interactionId, decision: decision)
            update(id) {
                $0.busy = nil
                $0.approval.state = state
            }
            let delay = settleDelay
            Task { [weak self] in
                try? await Task.sleep(for: delay)
                self?.cards.removeAll { $0.id == id }
            }
            return state
        } catch {
            update(id) {
                $0.busy = nil
                $0.error = WorkerApproval.failure(error, server: client.baseURL)
            }
            return nil
        }
    }

    private func update(_ id: String, _ change: (inout Card) -> Void) {
        guard let index = cards.firstIndex(where: { $0.id == id }) else { return }
        change(&cards[index])
    }
}

struct WorkerApprovalCard: View {
    let card: ConversationApprovals.Card
    let openWorker: () -> Void
    let decide: (WorkerApproval.Decision) -> Void

    private var approval: WorkerApproval { card.approval }

    var body: some View {
        VStack(alignment: .leading, spacing: 8) {
            HStack(spacing: 8) {
                if approval.state.waiting { Circle().fill(.orange).frame(width: 8, height: 8) }
                Button(action: openWorker) {
                    Text(approval.worker.title).lineLimit(1).foregroundStyle(.orange)
                }
                .buttonStyle(.plain)
                .accessibilityLabel("Open \(approval.worker.title)")
                .accessibilityIdentifier("approvalWorker")
                Text(approval.askLine).foregroundStyle(.secondary).lineLimit(1).layoutPriority(-1)
                Spacer(minLength: 0)
            }
            .font(.subheadline.weight(.semibold))
            Text(approval.title)
                .font(.headline)
                .fixedSize(horizontal: false, vertical: true)
                .accessibilityIdentifier("approvalTitle")
            if let detail = approval.detail {
                Text(detail)
                    .font(.footnote.monospaced())
                    .lineLimit(6)
                    .frame(maxWidth: .infinity, alignment: .leading)
                    .padding(.horizontal, 11)
                    .padding(.vertical, 9)
                    .background(.fill.tertiary, in: .rect(cornerRadius: 10))
                    .textSelection(.enabled)
                    .accessibilityIdentifier("approvalLines")
            }
            if let settled = approval.state.settledLabel {
                Label(settled, systemImage: approval.state == .denied ? "xmark" : "checkmark")
                    .font(.footnote.weight(.semibold))
                    .foregroundStyle(.secondary)
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
        .padding(14)
        .background(.orange.opacity(approval.state.waiting ? 0.09 : 0.04), in: .rect(cornerRadius: 20))
        .overlay(RoundedRectangle(cornerRadius: 20).strokeBorder(.orange.opacity(approval.state.waiting ? 0.34 : 0.15)))
        .accessibilityElement(children: .contain)
        .accessibilityLabel("Approval for \(approval.worker.title)")
        .accessibilityIdentifier("workerApproval")
    }

    private var buttons: some View {
        HStack(spacing: 10) {
            ForEach(approval.decisions, id: \.self) { decision in
                Button { decide(decision) } label: {
                    Group {
                        if card.busy == decision { ProgressView() } else { Text(decision.label).lineLimit(1).minimumScaleFactor(0.8) }
                    }
                    .font(.body.weight(.semibold))
                    .frame(maxWidth: .infinity)
                    .frame(height: 44)
                    .foregroundStyle(decision == .allowOnce ? Color(uiColor: .systemBackground) : .primary)
                    .background(decision == .allowOnce ? Color.primary : .clear, in: .capsule)
                    .glassEffect(decision == .allowOnce ? .identity : .regular, in: .capsule)
                    .contentShape(.capsule)
                }
                .buttonStyle(.plain)
                .disabled(card.busy != nil || approval.state == .resolving)
                .accessibilityIdentifier("approval-\(decision.rawValue)")
            }
        }
    }
}

struct WorkerApprovalCards: View {
    @ObservedObject var approvals: ConversationApprovals
    let openWorker: (String) -> Void
    let decide: (String, WorkerApproval.Decision) -> Void

    var body: some View {
        if !approvals.cards.isEmpty {
            VStack(spacing: 8) {
                ForEach(approvals.cards) { card in
                    WorkerApprovalCard(card: card, openWorker: { openWorker(card.approval.worker.threadId) },
                                       decide: { decide(card.id, $0) })
                }
            }
        }
    }
}

struct WorkerPendingApproval: View {
    let title: String
    let owner: String
    let open: () -> Void

    var body: some View {
        HStack(spacing: 10) {
            Circle().fill(.orange).frame(width: 8, height: 8)
            Text(title).font(.subheadline).lineLimit(1).frame(maxWidth: .infinity, alignment: .leading)
            Button(action: open) {
                HStack(spacing: 4) {
                    Text(owner).lineLimit(1)
                    Image(systemName: "chevron.right").font(.caption2.weight(.semibold))
                }
                .font(.subheadline.weight(.semibold))
                .foregroundStyle(.orange)
                .contentShape(Rectangle())
            }
            .buttonStyle(.plain)
            .accessibilityLabel("Approve or deny it in \(owner)")
            .accessibilityIdentifier("workerPendingOpen")
        }
        .padding(.horizontal, 14)
        .padding(.vertical, 11)
        .background(.orange.opacity(0.09), in: .rect(cornerRadius: 16))
        .overlay(RoundedRectangle(cornerRadius: 16).strokeBorder(.orange.opacity(0.3)))
        .accessibilityElement(children: .contain)
        .accessibilityIdentifier("workerPendingApproval")
    }
}
