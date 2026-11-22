import SwiftUI

/// Each Bot's strands overview (`strands.overview`), polled every 30 s while
/// the Strands screen shows (as the desktop's page does).
@MainActor @Observable
final class StrandOverviewModel {
    static let shared = StrandOverviewModel()

    enum Shown: Equatable {
        case loading
        case failed(String)
        case empty
        case cards(StrandOverview)
    }

    static let emptyText = "No open strands"

    private(set) var overviews: [String: StrandOverview] = [:]
    private(set) var errors: [String: String] = [:]
    private let client: @MainActor () -> BBClient

    init(client: @escaping @MainActor () -> BBClient = { AppModel.shared.client }) {
        self.client = client
    }

    func overview(_ botId: String) -> StrandOverview? { overviews[botId] }

    /// Strands that need the user in the Bot's conversations (the ⋯ menu's count).
    func needs(_ botId: String?) -> Int { botId.flatMap { overviews[$0]?.needs } ?? 0 }

    func shown(_ botId: String?) -> Shown {
        guard let botId else { return .empty }
        if let overview = overviews[botId] { return overview.conversations.isEmpty ? .empty : .cards(overview) }
        if let error = errors[botId] { return .failed(error) }
        return .loading
    }

    func load(_ botId: String) async {
        let client = client()
        let base = client.baseURL
        do {
            let next = try await client.strandsOverview(botId: botId)
            guard base == self.client().baseURL else { return }
            errors[botId] = nil
            if overviews[botId] != next { overviews[botId] = next }
        } catch {
            guard base == self.client().baseURL, !(error is CancellationError) else { return }
            errors[botId] = BBClient.describe(error, server: base)
        }
    }

    /// Polls one Bot's overview while the screen shows; the caller's task ends it.
    func poll(_ botId: String) async {
        while !Task.isCancelled {
            await load(botId)
            await EnergyGate.shared.pollWait(.seconds(30))
        }
    }
}

/// The Strands screen, in place of Tasks: every conversation of the Bot with
/// open strands, needs you first. Each card: up to 2 asks, then the other
/// strands as chips. An ask or a chip opens the conversation showing only
/// that strand; Open opens the conversation.
struct StrandsOverviewView: View {
    let botId: String?
    /// Opens a conversation (the conversation is home, or a thread to push).
    var openConversation: (String) -> Void
    @State private var model = StrandOverviewModel.shared
    @Environment(\.look) private var look
    @Environment(\.accessibilityReduceMotion) private var reduceMotion

    var body: some View {
        let shown = model.shown(botId)
        ScrollView {
            VStack(alignment: .leading, spacing: 12) {
                switch shown {
                case .loading:
                    ProgressView().frame(maxWidth: .infinity).padding(.top, 40)
                case .failed(let message):
                    notice(message, id: "strands-failed")
                case .empty:
                    notice(StrandOverviewModel.emptyText, id: "strands-empty")
                case .cards(let overview):
                    let line = StrandOverviewRules.line(overview)
                    if !line.isEmpty {
                        // Amber only for what needs you; the running count stays quiet.
                        let needs = StrandOverviewRules.line(needs: overview.needs, running: 0)
                        let running = StrandOverviewRules.line(needs: 0, running: overview.running)
                        HStack(spacing: 0) {
                            if !needs.isEmpty { Text(needs).foregroundStyle(look.needsYou) }
                            if !needs.isEmpty && !running.isEmpty { Text(" · ").foregroundStyle(.secondary) }
                            if !running.isEmpty { Text(running).foregroundStyle(.secondary) }
                        }
                        .font(.subheadline)
                        .accessibilityElement(children: .ignore)
                        .accessibilityLabel(line)
                        .accessibilityIdentifier("strands-line")
                    }
                    ForEach(overview.conversations) { conversation in card(conversation) }
                }
            }
            .padding(.horizontal, 16)
            .padding(.vertical, 8)
            .frame(maxWidth: 720, alignment: .leading)
            .frame(maxWidth: .infinity)
            .animation(reduceMotion ? nil : .smooth(duration: 0.2), value: shown)
        }
        .refreshable { if let botId { await model.load(botId) } }
        .modifier(PageChrome(title: "Strands") { EmptyView() })
        .accessibilityIdentifier("strands-overview")
        .task(id: botId) {
            guard let botId else { return }
            await model.poll(botId)
        }
    }

    private func notice(_ text: String, id: String) -> some View {
        Text(text)
            .font(.subheadline).foregroundStyle(.secondary)
            .frame(maxWidth: .infinity, alignment: .leading)
            .padding(.top, 8)
            .accessibilityIdentifier(id)
    }

    private func card(_ conversation: StrandOverview.Conversation) -> some View {
        let card = StrandOverviewRules.card(conversation)
        let title = conversation.title.isEmpty ? "Untitled" : conversation.title
        return VStack(alignment: .leading, spacing: 8) {
            HStack(spacing: 8) {
                if !card.asks.isEmpty {
                    Circle().fill(look.needsYou).frame(width: 7, height: 7).accessibilityLabel("Needs you")
                }
                Text(title).font(.subheadline.weight(.semibold)).lineLimit(1)
                if StrandOverviewRules.showsMainTag(conversation) {
                    Text("Main").font(.caption).foregroundStyle(.secondary)
                        .accessibilityIdentifier("strands-main")
                }
                Spacer(minLength: 4)
                Button { open(conversation.threadId, nil) } label: {
                    HStack(spacing: 3) {
                        Text("Open")
                        Image(systemName: "arrow.up.right").font(.caption2.weight(.semibold))
                    }
                    .font(.footnote).foregroundStyle(.secondary)
                    .frame(minWidth: 44, minHeight: 32)
                    .contentShape(.rect)
                }
                .buttonStyle(.plain)
                .accessibilityLabel("Open \(title)")
                .accessibilityIdentifier("strands-open-\(conversation.threadId)")
            }
            ForEach(card.asks) { row in
                Button { open(conversation.threadId, row.strand) } label: {
                    HStack(alignment: .firstTextBaseline, spacing: 8) {
                        Circle().fill(look.needsYou).frame(width: 6, height: 6).alignmentGuide(.firstTextBaseline) { $0[.bottom] - 1 }
                        Text("\(Text(row.strand.title).fontWeight(.semibold)) \(Text("· \(row.detail)").foregroundStyle(.secondary))")
                            .font(.footnote)
                            .lineLimit(2)
                        Spacer(minLength: 0)
                    }
                    .frame(minHeight: 32)
                    .contentShape(.rect)
                }
                .buttonStyle(.plain)
                .accessibilityLabel("\(row.text), needs you")
                .accessibilityIdentifier("strands-ask-\(row.strand.id)")
            }
            if card.more > 0 || !card.chips.isEmpty {
                if !card.asks.isEmpty { Divider().opacity(0.6) }
                FlowLayout(spacing: 6) {
                    if card.more > 0 {
                        Button { open(conversation.threadId, nil) } label: {
                            HStack(spacing: 5) {
                                Circle().fill(look.needsYou).frame(width: 6, height: 6)
                                Text("\(card.more) more need\(card.more == 1 ? "s" : "") you")
                            }
                            .modifier(StrandChipShape(dim: false))
                        }
                        .buttonStyle(.plain)
                        .accessibilityIdentifier("strands-more-\(conversation.threadId)")
                    }
                    ForEach(card.chips) { strand in
                        Button { open(conversation.threadId, strand) } label: {
                            HStack(spacing: 5) {
                                Text(strand.title).lineLimit(1)
                                StrandMark(state: strand.state)
                            }
                            .modifier(StrandChipShape(dim: strand.state == .quiet))
                        }
                        .buttonStyle(.plain)
                        .accessibilityElement(children: .ignore)
                        .accessibilityLabel([strand.title, StrandOverviewRules.stateLabel(strand.state)].filter { !$0.isEmpty }.joined(separator: ", "))
                        .accessibilityAddTraits(.isButton)
                        .accessibilityIdentifier("strands-chip-\(strand.id)")
                    }
                }
            }
        }
        .padding(12)
        .frame(maxWidth: .infinity, alignment: .leading)
        .background(look.stackFill, in: .rect(cornerRadius: 14, style: .continuous))
        .overlay(RoundedRectangle(cornerRadius: 14, style: .continuous).strokeBorder(.separator.opacity(0.6), lineWidth: 0.5))
        .accessibilityElement(children: .contain)
        .accessibilityIdentifier("strands-card-\(conversation.threadId)")
    }

    /// Opens the conversation; with a strand, it shows only that strand (the filter bar's ✕ shows everything).
    private func open(_ threadId: String, _ strand: Strand?) {
        let strands = StrandsModel.shared
        strands.only[threadId] = strand?.id
        if let strand, strand.state == .doneUnseen { Task { await strands.opened(strand, in: threadId) } }
        openConversation(threadId)
    }
}

/// A strand chip's capsule: quiet ones dimmer.
private struct StrandChipShape: ViewModifier {
    let dim: Bool

    func body(content: Content) -> some View {
        content
            .font(.footnote)
            .foregroundStyle(dim ? AnyShapeStyle(.tertiary) : AnyShapeStyle(.secondary))
            .padding(.horizontal, 10)
            .frame(minHeight: 30)
            .frame(maxWidth: 240)
            .overlay(Capsule().strokeBorder(dim ? AnyShapeStyle(.separator.opacity(0.5)) : AnyShapeStyle(.separator), lineWidth: 0.5))
            .contentShape(.capsule)
    }
}
