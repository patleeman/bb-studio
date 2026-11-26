import SwiftUI

/// Each conversation's strands, polled while its screen is open
/// (`strands.list`, every 30 s as on the desktop, longer while the phone is
/// idle, and held in the background).
@MainActor @Observable
final class StrandsModel {
    static let shared = StrandsModel()

    private(set) var lists: [String: StrandList] = [:]
    /// Each conversation's sorted turns (`strands.tags`): the dividers and "Only this strand".
    private(set) var tags: [String: StrandTags] = [:]
    /// The strand a conversation shows only (a divider or a strand tapped); nil shows everything.
    var only: [String: String] = [:]
    /// Jump to reply: the reply (its message seq) a conversation brings into view and flashes.
    private(set) var flash: [String: Double] = [:]
    private var flashEnds: [String: Task<Void, Never>] = [:]
    /// Servers where `strands.list` has answered once, so list and tags fetch concurrently.
    @ObservationIgnored private var supportedServers: Set<URL> = []
    private var client: BBClient { AppModel.shared.client }

    func list(_ threadId: String) -> StrandList? { lists[threadId] }

    func load(_ threadId: String) async {
        let base = client.baseURL
        if supportedServers.contains(base) {
            async let listRequest = client.strandsList(threadId: threadId)
            async let tagsRequest = try? client.strandsTags(threadId: threadId)
            do {
                let next = try await listRequest
                guard base == client.baseURL else { return }
                if lists[threadId] != next { lists[threadId] = next }
            } catch {
                _ = await tagsRequest
                return
            }
            if let next = await tagsRequest, base == client.baseURL, tags[threadId] != next { tags[threadId] = next }
            return
        }
        do {
            let next = try await client.strandsList(threadId: threadId)
            guard base == client.baseURL else { return }
            supportedServers.insert(base)
            if lists[threadId] != next { lists[threadId] = next }
        } catch {
            return
        }
        if let next = try? await client.strandsTags(threadId: threadId), base == client.baseURL, tags[threadId] != next { tags[threadId] = next }
    }

    /// The strand's name for the filter bar.
    func title(_ strandId: String, in threadId: String) -> String {
        let list = lists[threadId]
        return (list?.strands ?? []).first { $0.id == strandId }?.title
            ?? (list?.earlier ?? []).first { $0.id == strandId }?.title
            ?? tags[threadId]?.title(strandId) ?? "This strand"
    }

    /// Polls one conversation while its screen shows; the caller's task ends it.
    func poll(_ threadId: String) async {
        while !Task.isCancelled {
            await load(threadId)
            await EnergyGate.shared.pollWait(.seconds(30))
        }
    }

    /// The user opened a strand: what finished in it counts as seen.
    func opened(_ strand: Strand, in threadId: String) async {
        try? await client.strandOpened(strand.id)
        await load(threadId)
    }

    /// Jump to reply: the conversation scrolls to the reply and its asking sentence flashes for a moment.
    func flashReply(_ seq: Double, in threadId: String) {
        flashEnds[threadId]?.cancel()
        flash[threadId] = seq
        var duration = 1_600
        #if DEBUG
        // Long enough for a UI test to see it past XCUITest's wait for the app to settle.
        if BotSpacesDemo.replyAsk { duration = 4_000 }
        #endif
        flashEnds[threadId] = Task { [weak self, duration] in
            try? await Task.sleep(for: .milliseconds(duration))
            guard !Task.isCancelled else { return }
            self?.flash[threadId] = nil
        }
    }

    func decide(_ ask: Strand.Ask, _ decision: WorkerApproval.Decision, in threadId: String) async throws {
        _ = try await client.resolveWorkerApproval(workerThreadId: ask.threadId, interactionId: ask.id, decision: decision)
        await load(threadId)
    }
}

/// The strands box above the composer, in In flight's old place (desktop's
/// `StrandsBox`). Closed, one line: what needs you, the current strand and the
/// running count. Opened in place: Needs you (an approval's buttons, a
/// worker's question with Open, a Tool Gateway ask approved on the desktop),
/// then Active with each strand's workers, then the workers no strand holds.
struct StrandsBox: View {
    let threadId: String
    var typing = false
    /// Always open, under a heading, without its own scroller: the unfolded Duo's left screen.
    var panel = false
    var openThread: (String) -> Void
    @State private var model = StrandsModel.shared
    @State private var open = false
    @State private var showsQuiet = false
    @State private var deciding: String?
    @EnvironmentObject private var app: AppModel
    @Environment(\.accessibilityReduceMotion) private var reduceMotion
    @Environment(\.look) private var look

    var body: some View {
        let list = model.list(threadId)
        if panel {
            VStack(alignment: .leading, spacing: 0) {
                if StrandsBoxModel.shown(list), let list {
                    content(list)
                } else {
                    Text("Nothing open in this conversation").font(.footnote).foregroundStyle(.secondary)
                        .padding(12).frame(maxWidth: .infinity, alignment: .leading)
                }
            }
            .background(look.stackFill, in: .rect(cornerRadius: 14, style: .continuous))
            .accessibilityElement(children: .contain)
            .accessibilityIdentifier("strands-panel")
            .task(id: threadId) { await model.load(threadId) }
        } else if StrandsBoxModel.shown(list), let list {
            VStack(spacing: 0) {
                header(list)
                if open && !typing {
                    Divider().opacity(0.5)
                    ScrollView { content(list) }
                        .scrollBounceBehavior(.basedOnSize)
                        .frame(maxHeight: 340)
                        .fixedSize(horizontal: false, vertical: true)
                }
            }
            .background(look.stackFill, in: .rect(cornerRadius: 14, style: .continuous))
            .overlay(RoundedRectangle(cornerRadius: 14, style: .continuous).strokeBorder(.separator.opacity(0.6), lineWidth: 0.5))
            .accessibilityElement(children: .contain)
            .accessibilityIdentifier("strands-box")
        }
    }

    private func header(_ list: StrandList) -> some View {
        let counts = StrandsBoxModel.counts(list)
        // What runs, never a needs-you count: approvals take the slot, and
        // replies that ask are ordinary messages.
        let headline = StrandsBoxModel.line(list)
        let current = StrandsBoxModel.lineStrand(list)
        return Button {
            if typing {
                UIApplication.shared.sendAction(#selector(UIResponder.resignFirstResponder), to: nil, from: nil, for: nil)
                open = true
                return
            }
            withAnimation(reduceMotion ? nil : .smooth(duration: 0.2)) { open.toggle() }
        } label: {
            HStack(spacing: 7) {
                if let current {
                    StrandMark(state: current.state == .needsYou ? .active : current.state)
                }
                Text(headline)
                    .lineLimit(1).truncationMode(.tail)
                Spacer(minLength: 4)
                if counts.running > 0 {
                    HStack(spacing: 4) {
                        ProgressView().controlSize(.mini)
                        Text("\(counts.running) running").monospacedDigit()
                    }
                    .foregroundStyle(.secondary).fixedSize()
                    .accessibilityIdentifier("strands-running")
                } else if counts.finished > 0 {
                    Text("\(counts.finished) finished").foregroundStyle(.secondary).fixedSize()
                }
                Image(systemName: open && !typing ? "chevron.down" : "chevron.up").font(.caption2.weight(.semibold)).foregroundStyle(.secondary)
            }
            .font(.footnote)
            .padding(.horizontal, 12)
            .frame(minHeight: 44)
            .contentShape(.rect)
        }
        .buttonStyle(.plain)
        .accessibilityElement(children: .combine)
        .accessibilityLabel(["Strands", headline, counts.running > 0 ? "\(counts.running) running" : nil].compactMap { $0 }.joined(separator: ", "))
        .accessibilityValue(open && !typing ? "Expanded" : "Collapsed")
        .accessibilityIdentifier("strands-toggle")
    }

    @ViewBuilder private func content(_ list: StrandList) -> some View {
        let now = Date().timeIntervalSince1970 * 1000
        VStack(alignment: .leading, spacing: 0) {
            ForEach(StrandsBoxModel.groups(list)) { group in
                if group.label != "Quiet" || showsQuiet {
                    section(group.label == "Needs you" ? "Needs you · \(group.strands.count)" : group.label)
                    ForEach(group.strands) { strand in row(strand, now: now) }
                } else {
                    Button { withAnimation(.snappy) { showsQuiet = true } } label: {
                        HStack {
                            Text("\(group.strands.count) quiet")
                            Spacer()
                            Image(systemName: "chevron.right").font(.caption2.weight(.semibold))
                        }
                        .font(.footnote).foregroundStyle(.secondary)
                        .padding(.horizontal, 12).frame(minHeight: 40).contentShape(.rect)
                    }
                    .buttonStyle(.plain)
                    .accessibilityIdentifier("strands-quiet")
                }
            }
            if !list.strayWorkers.isEmpty {
                section("In no strand")
                ForEach(list.strayWorkers) { worker in workerRow(worker).padding(.leading, 12) }
            }
        }
        .padding(.bottom, 6)
    }

    private func section(_ title: String) -> some View {
        Text(title.uppercased())
            .font(.caption2.weight(.semibold)).foregroundStyle(.secondary)
            .padding(.horizontal, 12).padding(.top, 10).padding(.bottom, 2)
            .accessibilityAddTraits(.isHeader)
    }

    private func row(_ strand: Strand, now: Double) -> some View {
        VStack(alignment: .leading, spacing: 4) {
            Button {
                if strand.state == .doneUnseen { Task { await model.opened(strand, in: threadId) } }
                if !panel { withAnimation(reduceMotion ? nil : .smooth(duration: 0.2)) { open = false } }
                model.only[threadId] = strand.id
                if let reply = StrandsBoxModel.replyAsk(strand), reply.threadId == threadId, let seq = reply.seq { model.flashReply(seq, in: threadId) }
            } label: {
                HStack(alignment: .firstTextBaseline, spacing: 8) {
                    StrandMark(state: strand.state).frame(width: 12)
                    VStack(alignment: .leading, spacing: 2) {
                        Text(strand.title).font(.subheadline.weight(.semibold)).lineLimit(2)
                        if let line = StrandsBoxModel.summary(strand.summary) ?? StrandsBoxModel.summary(strand.detail) {
                            Text(line).font(.footnote).foregroundStyle(.secondary).lineLimit(2)
                        }
                    }
                    Spacer(minLength: 0)
                }
                .contentShape(.rect)
            }
            .buttonStyle(.plain)
            .accessibilityIdentifier("strand-\(strand.id)")
            ForEach(strand.asks) { ask in askView(ask).padding(.leading, 20) }
            ForEach(StrandsBoxModel.rowWorkers(strand, now: now)) { worker in workerRow(worker).padding(.leading, 20) }
        }
        .padding(.horizontal, 12)
        .padding(.vertical, 8)
    }

    /// What tapping an ask's row does: a reply in this conversation comes into
    /// view and flashes; one elsewhere opens there. Approvals have their own buttons.
    private func askAction(_ ask: Strand.Ask) -> (() -> Void)? {
        switch ask.kind {
        case .approval, .gateway: return nil
        case .reply:
            if let seq = ask.seq, ask.threadId == threadId {
                return {
                    if !panel { withAnimation(reduceMotion ? nil : .smooth(duration: 0.2)) { open = false } }
                    model.flashReply(seq, in: threadId)
                }
            }
            return ask.threadId != threadId ? { openThread(ask.threadId) } : nil
        case .question, .other:
            return ask.threadId != threadId ? { openThread(ask.threadId) } : nil
        }
    }

    @ViewBuilder private func askView(_ ask: Strand.Ask) -> some View {
        if let action = askAction(ask) {
            // The row is the button: one per ask, not a Show under each.
            Button(action: action) {
                HStack(alignment: .firstTextBaseline, spacing: 8) {
                    Text(ask.label.isEmpty ? "A reply needs you" : ask.label).font(.footnote).multilineTextAlignment(.leading)
                    Spacer(minLength: 4)
                    Image(systemName: "chevron.right").font(.caption2.weight(.semibold)).foregroundStyle(.secondary)
                }
                .frame(minHeight: 32)
                .contentShape(.rect)
            }
            .buttonStyle(.plain)
            .accessibilityHint(ask.threadId == threadId ? "Shows the reply" : "Opens its conversation")
            .accessibilityIdentifier(ask.kind == .reply && ask.threadId == threadId ? "strand-reply-\(Int(ask.seq ?? 0))" : "strand-ask-\(ask.id)")
        } else {
            decisionAsk(ask)
        }
    }

    @ViewBuilder private func decisionAsk(_ ask: Strand.Ask) -> some View {
        if let cardId = ApprovalSlots.shared.cardId(for: ask, in: threadId) {
            // The card above the composer answers it; here it only brings the card up.
            Button {
                if !panel { withAnimation(reduceMotion ? nil : .smooth(duration: 0.2)) { open = false } }
                ApprovalSlots.shared.bringUp(cardId, in: threadId)
            } label: {
                HStack(alignment: .firstTextBaseline, spacing: 8) {
                    Text(ask.label.isEmpty ? "An approval" : ask.label).font(.footnote).multilineTextAlignment(.leading)
                    Spacer(minLength: 4)
                    Text("Show").font(.footnote.weight(.semibold)).foregroundStyle(.tint)
                }
                .frame(minHeight: 44)
                .contentShape(.rect)
            }
            .buttonStyle(.plain)
            .accessibilityHint("Brings up the approval above the composer")
            .accessibilityIdentifier("strand-show-\(ask.id)")
        } else {
            decisionButtons(ask)
        }
    }

    @ViewBuilder private func decisionButtons(_ ask: Strand.Ask) -> some View {
        VStack(alignment: .leading, spacing: 6) {
            if !ask.label.isEmpty { Text(ask.label).font(.footnote) }
            if ask.kind == .approval, !ask.details.isEmpty {
                Text(ask.details.joined(separator: "\n"))
                    .font(.caption.monospaced()).foregroundStyle(.secondary).lineLimit(6)
                    .padding(8).frame(maxWidth: .infinity, alignment: .leading)
                    .background(.fill.tertiary, in: .rect(cornerRadius: 8))
            }
            switch ask.kind {
            case .approval:
                HStack(spacing: 6) {
                    ForEach(StrandsBoxModel.decisionButtons(ask), id: \.label) { button in
                        Button(button.label) { decide(ask, button.decision) }
                            .font(.footnote.weight(button.primary ? .semibold : .regular))
                            .buttonStyle(.bordered)
                            .tint(button.primary ? .primary : .secondary)
                            .disabled(deciding == ask.id)
                            .accessibilityIdentifier("strand-decide-\(button.decision.rawValue)")
                    }
                }
            case .gateway:
                Text("Approve on the desktop").font(.caption).foregroundStyle(.secondary)
            case .reply, .question, .other:
                EmptyView()
            }
        }
    }

    private func workerRow(_ worker: Strand.Worker) -> some View {
        Button { openThread(worker.threadId) } label: {
            HStack(spacing: 8) {
                BotWorkerGlyph(status: worker.status).frame(width: 14)
                Text(worker.title.isEmpty ? "Worker" : worker.title).font(.footnote).lineLimit(1)
                Spacer(minLength: 4)
                Image(systemName: "chevron.right").font(.caption2.weight(.semibold)).foregroundStyle(.secondary)
            }
            .frame(minHeight: 32)
            .contentShape(.rect)
        }
        .buttonStyle(.plain)
        .accessibilityIdentifier("strand-worker-\(worker.threadId)")
    }

    private func decide(_ ask: Strand.Ask, _ decision: WorkerApproval.Decision) {
        deciding = ask.id
        Task {
            do { try await model.decide(ask, decision, in: threadId) } catch {
                app.flash("Couldn't answer the approval: " + BBClient.describe(error, server: app.client.baseURL))
            }
            deciding = nil
        }
    }
}

/// A strand's state mark: amber for needs you, a spinner while it runs, a
/// tick when it finished unseen, two bars while it waits on someone else.
struct StrandMark: View {
    let state: Strand.State
    @Environment(\.look) private var look

    var body: some View {
        switch state {
        case .needsYou: Circle().fill(look.needsYou).frame(width: 7, height: 7).accessibilityLabel("Needs you")
        case .running: ProgressView().controlSize(.mini).accessibilityLabel("Running")
        case .doneUnseen: Image(systemName: "checkmark").font(.caption2.weight(.bold)).foregroundStyle(.secondary).accessibilityLabel("Finished")
        case .waiting: Image(systemName: "pause").font(.caption2.weight(.bold)).foregroundStyle(.secondary).accessibilityLabel("Waiting")
        case .active, .quiet, .other: Circle().strokeBorder(.secondary, lineWidth: 1).frame(width: 7, height: 7).accessibilityHidden(true)
        }
    }
}

/// The strands of one conversation, always open: the unfolded Duo's left screen
/// (the conversation on the right polls them).
struct StrandsPanel: View {
    let threadId: String
    let title: String
    var openThread: (String) -> Void

    var body: some View {
        VStack(alignment: .leading, spacing: 6) {
            Text("\(title) · strands".uppercased())
                .font(.caption2.weight(.semibold)).foregroundStyle(.secondary)
                .accessibilityAddTraits(.isHeader)
            StrandsBox(threadId: threadId, panel: true, openThread: openThread)
        }
    }
}
