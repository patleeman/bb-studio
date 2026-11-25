import SwiftUI
import UIKit

/// What a row in the new transcript needs from its thread to act: the
/// same closures the SwiftUI transcript passes its rows.
struct ThreadTranscriptActions {
    /// Shows only one strand (a divider tapped); nil where strands don't run.
    var onlyStrand: ((String) -> Void)? = nil
    var projectId: String?
    var reactionItems: [String]
    var cached: Bool
    var draftReply: (String) -> Void
    var sendReply: (String) -> Void
    var quote: (String) -> Void
    var select: (String) -> Void
    var edit: (String) -> Void
    var saveFiles: ((Int?) -> Void)?
    var openThread: (String) -> Void
    var replyInThread: (String) -> Void
    var messageThread: ((TimelineRow) -> Void)? = nil
    var forkConversation: ((TimelineRow) -> Void)? = nil
    var openSideThread: ((String) -> Void)? = nil
    var replier: BotLook? = nil
    var resolve: (PendingInteraction, JSONValue) async -> Bool
    var cancel: (PendingInteraction) async -> Void
    var openWeb: () -> Void
    /// A one-shot notice's action (a Bot conversation's lines at the end).
    var notice: (TranscriptNotice.Action) -> Void = { _ in }
    var threadTitle: (String) -> String? = { _ in nil }
}

/// One row of a thread's transcript, with everything that changes how it
/// draws, so a changed value is exactly a cell to redraw.
enum ThreadTranscriptRow: Identifiable, Equatable {
    /// The spinner above the rows while older ones load.
    case older
    /// A card about a thread the Bot started (the room's conversations).
    case child(BotChildEvent, id: String)
    case item(TimelineItem, ItemState)
    case pending(Outbox.Message)
    case interaction(PendingInteraction)
    case working(thinking: String?)
    /// Strands in the timeline: a divider where the strand changes, or "N other messages" under a filter.
    case strand(StrandTimeline.Mark, key: String)
    /// Something that happened once, as a quiet line at the end (a Bot conversation).
    case notice(TranscriptNotice)

    struct ItemState: Equatable {
        var unread = false
        var match = false
        var editable = false
        var sideThread: BotSideThread?
        var sameTurn = false
        var relayed: RelayedMessage?
        var quiet = false
        /// A reply that needs the user: its asking sentence marked (its turn's newest message).
        var ask: ReplyAskMark?
    }

    var id: String {
        switch self {
        case .older: "transcript:older"
        case .child(_, let id): "child:\(id)"
        case .item(let item, _): item.id
        case .pending(let message): "pending-message:\(message.id)"
        case .interaction(let interaction): interaction.id
        case .working: "transcript:working"
        case .strand(_, let key): "strand:\(key)"
        case .notice(let notice): "notice:\(notice.id)"
        }
    }

    static func == (a: Self, b: Self) -> Bool {
        switch (a, b) {
        case (.older, .older): true
        case let (.child(x, i), .child(y, j)): x == y && i == j
        case let (.item(x, s), .item(y, t)): x.id == y.id && x.rows == y.rows && s == t
        case let (.pending(x), .pending(y)): x == y
        case let (.interaction(x), .interaction(y)): x == y
        case let (.working(x), .working(y)): x == y
        case let (.strand(x, k), .strand(y, l)): x == y && k == l
        case let (.notice(x), .notice(y)): x == y
        default: false
        }
    }

    /// A thread: its messages and activity, the outbox, questions, and the working line.
    static func thread(items: [TimelineItem], hasOlder: Bool, unread: String?, match: String?, editableId: String?,
                       pending: [Outbox.Message], interactions: [PendingInteraction], working: Bool, thinking: String?,
                       sideThreads: [String: BotSideThread] = [:]) -> [Self] {
        var result: [Self] = hasOlder ? [.older] : []
        var speaker: Bool?
        var index = items.startIndex
        while index < items.endIndex {
            let item = items[index]
            index += 1
            var state = ItemState(unread: item.id == unread, match: item.id == match)
            let mine: Bool = if case .message(let row) = item { row.isUser } else { false }
            state.sameTurn = speaker == mine
            speaker = mine
            if case .message(let row) = item {
                state.editable = row.id == editableId
                state.sideThread = sideThreads[row.id]
                if let relayed = RelayedMessage.of(row) {
                    state.relayed = relayed
                    state.editable = false
                    state.sameTurn = false
                    speaker = nil
                    if !relayed.urgent, let pass = Self.passReply(after: index, in: items) {
                        state.quiet = true
                        index = pass + 1
                    }
                }
            }
            result.append(.item(item, state))
        }
        result += pending.map(Self.pending)
        result += interactions.map(Self.interaction)
        if working { result.append(.working(thinking: thinking)) }
        return result
    }
}

extension ThreadTranscriptRow {
    static func passReply(after start: Int, in items: [TimelineItem]) -> Int? {
        var at = start
        while at < items.endIndex, case .activity = items[at] { at += 1 }
        guard at < items.endIndex, case .message(let reply) = items[at], !reply.isUser, SilentOutput.isPass(reply.text) else { return nil }
        return at
    }
}

/// A row as the SwiftUI transcript drew it: the same views, the same menus.
struct ThreadTranscriptRowView: View {
    let row: ThreadTranscriptRow
    let actions: ThreadTranscriptActions

    var body: some View {
        content.frame(maxWidth: .infinity, alignment: .leading)
    }

    @ViewBuilder private var content: some View {
        switch row {
        case .older:
            ProgressView().frame(maxWidth: .infinity).padding(.vertical, 8)
        case .child(let event, _):
            BotChildCard(event: event, live: nil) {
                if let id = event.threadId { actions.openThread(id) }
            }
        case .item(let item, let state):
            VStack(alignment: .leading, spacing: 14) {
                if state.unread { UnreadDivider() }
                Group {
                    switch item {
                    case .message where state.relayed != nil:
                        RelayedRow(relayed: state.relayed!, quiet: state.quiet, title: state.relayed!.senderThreadId.flatMap(actions.threadTitle))
                    case .message(let row):
                        MessageBubble(
                            row: row, projectId: actions.projectId, react: actions.draftReply,
                            reactionItems: actions.reactionItems, quote: actions.quote, select: actions.select,
                            edit: state.editable ? actions.edit : nil,
                            saveFiles: actions.saveFiles, thread: state.sideThread, replier: actions.replier,
                            replyInThread: actions.messageThread.flatMap { open in ConversationReplies.canThread(row) ? { open(row) } : nil },
                            fork: actions.forkConversation.flatMap { fork in ConversationReplies.canFork(row) ? { fork(row) } : nil },
                            openSideThread: actions.openSideThread, ask: state.ask)
                    case .activity(let rows):
                        ActivityGroup(rows: rows)
                    }
                }
                .background {
                    if state.match { RoundedRectangle(cornerRadius: 12).fill(.yellow.opacity(0.22)).padding(-6) }
                }
            }
            .padding(.top, state.unread ? 0 : state.sameTurn ? -4 : 6)
        case .pending(let message):
            PendingBubble(message: message)
        case .interaction(let interaction):
            InteractionCard(interaction: interaction,
                            resolve: { await actions.resolve(interaction, $0) },
                            cancel: { await actions.cancel(interaction) },
                            openWeb: actions.openWeb)
        case .working(let thinking):
            WorkingIndicator(thinking: thinking)
        case .strand(.divider(let strandId, let title), _):
            StrandDividerRow(title: title, only: actions.onlyStrand.map { only in { only(strandId) } })
        case .strand(.gap(let count), _):
            StrandGapRow(count: count)
        case .notice(let notice):
            TranscriptNoticeRow(notice: notice, act: actions.notice)
        }
    }
}

extension ThreadTranscriptRow {
    /// Strands in a conversation's rows (`StrandTimeline.plan`): dividers where
    /// the strand changes, or, showing only one strand, its rows with the others
    /// folded into "N other messages". Rows that aren't from a turn stay.
    static func strands(_ rows: [Self], tags: StrandTags?, only: String?, flash: Double? = nil) -> [Self] {
        guard let tags, !tags.tags.isEmpty else { return rows }
        let seqs: [Double?] = rows.map { row in
            if case .item(let item, _) = row { return item.rows.compactMap(\.sourceSeqEnd).max() }
            return nil
        }
        let rows = asks(rows, seqs: seqs, tags: tags, flash: flash)
        let messages: [Bool] = rows.map { row in
            if case .item(.message, _) = row { return true }
            return false
        }
        let plan = StrandTimeline.plan(seqs: seqs, messages: messages, tags: tags, only: only)
        var out: [Self] = []
        out.reserveCapacity(rows.count + plan.marks.count)
        for (index, row) in rows.enumerated() {
            for (n, mark) in (plan.marks[index] ?? []).enumerated() { out.append(.strand(mark, key: "\(row.id):\(n)")) }
            if plan.keep[index] { out.append(row) }
        }
        for (n, mark) in (plan.marks[rows.count] ?? []).enumerated() { out.append(.strand(mark, key: "end:\(n)")) }
        return out
    }

    /// Replies that still need the user (`strands.tags` replies): each is marked
    /// in its turn's newest reply message; `flash` is the reply Jump to reply flashes.
    static func asks(_ rows: [Self], seqs: [Double?], tags: StrandTags, flash: Double?) -> [Self] {
        guard tags.replies.contains(where: \.open) else { return rows }
        var newest: [String: Int] = [:]
        for (index, row) in rows.enumerated() {
            guard case .item(.message(let message), _) = row, !message.isUser, let turn = tags.turn(atSeq: seqs[index]) else { continue }
            newest[turn.turnId] = index
        }
        var out = rows
        for (turnId, index) in newest {
            guard let reply = tags.openReply(turnId: turnId), case .item(let item, var state) = out[index] else { continue }
            state.ask = ReplyAskMark(ask: reply.ask, seq: reply.seq, flash: flash == reply.seq)
            out[index] = .item(item, state)
        }
        return out
    }
}
