import SwiftUI
import UIKit

/// Settings ▸ Diagnostics ▸ New chat transcript: the Bot chat and threads
/// on the UIKit transcript (`apps/ios/iOS/Transcript`). On by default (a
/// value someone set stays); turned off, the thread is the SwiftUI
/// transcript, untouched.
enum TranscriptV2 {
    static let key = "newChatTranscript"

    /// Debug: `-qaTranscriptV2` turns it on for a launch, `-qaTranscriptV1` off.
    static var launchArgument: Bool? {
        #if DEBUG
        let arguments = ProcessInfo.processInfo.arguments
        if arguments.contains("-qaTranscriptV1") { return false }
        if arguments.contains("-qaTranscriptV2") { return true }
        #endif
        return nil
    }
}

/// The flag's switch: reads the setting live, so turning it on applies to
/// a chat that's already open the next time it draws.
struct TranscriptV2Switch<Legacy: View, Next: View>: View {
    @AppStorage(TranscriptV2.key) private var on = true
    @ViewBuilder var legacy: () -> Legacy
    @ViewBuilder var next: () -> Next

    var body: some View {
        if TranscriptV2.launchArgument ?? on { next() } else { legacy() }
    }
}

/// The setting, in Diagnostics.
struct TranscriptV2Toggle: View {
    @AppStorage(TranscriptV2.key) private var on = true

    var body: some View {
        Toggle("New chat transcript", isOn: $on)
            .accessibilityIdentifier("settingsNewChatTranscript")
    }
}

/// What a row in the new transcript needs from its thread to act: the
/// same closures the SwiftUI transcript passes its rows.
struct ThreadTranscriptActions {
    var bot: BotInfo?
    var projectId: String?
    var reactionItems: [String]
    var cached: Bool
    var draftReply: (String) -> Void
    var sendReply: (String) -> Void
    var quote: (String) -> Void
    var select: (String) -> Void
    var edit: (String) -> Void
    var sideChat: ((String) -> Void)?
    var saveFiles: ((Int?) -> Void)?
    var readAloud: ((_ rowId: String, _ text: String) -> Void)?
    var openThread: (String) -> Void
    var replyInThread: (String) -> Void
    var resolve: (PendingInteraction, JSONValue) async -> Bool
    var cancel: (PendingInteraction) async -> Void
    var openWeb: () -> Void
}

/// One row of a thread's transcript, with everything that changes how it
/// draws, so a changed value is exactly a cell to redraw.
enum ThreadTranscriptRow: Identifiable, Equatable {
    /// The spinner above the rows while older ones load.
    case older
    case hero(BotInfo, status: String, working: Bool)
    case bot(BotChatEntry, BotState)
    case item(TimelineItem, ItemState)
    case pending(Outbox.Message)
    case interaction(PendingInteraction)
    case working(BotInfo?, thinking: String?)

    struct BotState: Equatable {
        var editable = false
        var sideThread: BotSideThread?
        var canReply = false
        var live: BotChildStatus?
    }

    struct ItemState: Equatable {
        var unread = false
        var match = false
        var editable = false
        var reading = false
        var piece: String?
    }

    var id: String {
        switch self {
        case .older: "transcript:older"
        case .hero: "transcript:hero"
        case .bot(let entry, _): entry.id
        case .item(let item, _): item.id
        case .pending(let message): "pending-message:\(message.id)"
        case .interaction(let interaction): interaction.id
        case .working: "transcript:working"
        }
    }

    static func == (a: Self, b: Self) -> Bool {
        switch (a, b) {
        case (.older, .older): true
        case let (.hero(x, s, w), .hero(y, t, v)): x == y && s == t && w == v
        case let (.bot(x, s), .bot(y, t)): x == y && s == t
        case let (.item(x, s), .item(y, t)): x.id == y.id && x.rows == y.rows && s == t
        case let (.pending(x), .pending(y)): x == y
        case let (.interaction(x), .interaction(y)): x == y
        case let (.working(x, s), .working(y, t)): x == y && s == t
        default: false
        }
    }

    /// The Bot's chat: the hero or the older-rows spinner, its entries, the
    /// outbox, and its typing dots.
    @MainActor
    static func bot(_ chrome: BotChrome, rows: [TimelineRow], status: String, working: Bool, canLoadOlder: Bool,
                    editableId: String?, threadRows: Set<String>, pending: [Outbox.Message], typing: Bool, thinking: String?) -> [Self] {
        var result: [Self] = [canLoadOlder ? .older : .hero(chrome.bot, status: status, working: working)]
        let live = Dictionary(chrome.started.map { ($0.id, $0.status) }, uniquingKeysWith: { first, _ in first })
        for entry in BotChatEntry.memo.entries(rows, started: chrome.started, compactions: chrome.compactions) {
            var state = BotState()
            switch entry {
            case .message(let row, _, _):
                state.editable = row.id == editableId
                state.sideThread = chrome.sideThreads[row.id]
                state.canReply = !row.isUser && threadRows.contains(row.id)
            case .child(let event, _):
                state.live = event.threadId.flatMap { live[$0] }
            default: break
            }
            result.append(.bot(entry, state))
        }
        result += pending.map(Self.pending)
        if typing { result.append(.working(chrome.bot, thinking: thinking)) }
        return result
    }

    /// A thread: its messages and activity, the outbox, questions, and the working line.
    static func thread(items: [TimelineItem], hasOlder: Bool, unread: String?, match: String?, editableId: String?,
                       reading: (String) -> Bool, readAlong: (row: String, piece: String?)?,
                       pending: [Outbox.Message], interactions: [PendingInteraction], working: Bool, thinking: String?) -> [Self] {
        var result: [Self] = hasOlder ? [.older] : []
        for item in items {
            var state = ItemState(unread: item.id == unread, match: item.id == match)
            if case .message(let row) = item {
                state.editable = row.id == editableId
                state.reading = reading(row.id)
                if readAlong?.row == row.id { state.piece = readAlong?.piece }
            }
            result.append(.item(item, state))
        }
        result += pending.map(Self.pending)
        result += interactions.map(Self.interaction)
        if working { result.append(.working(nil, thinking: thinking)) }
        return result
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
        case .hero(let bot, let status, let working):
            BotHero(bot: bot, status: status, working: working)
        case .bot(let entry, let state):
            bot(entry, state)
        case .item(let item, let state):
            VStack(alignment: .leading, spacing: 14) {
                if state.unread { UnreadDivider() }
                Group {
                    switch item {
                    case .message(let row):
                        MessageBubble(
                            row: row, projectId: actions.projectId, react: actions.draftReply,
                            reactionItems: actions.reactionItems, quote: actions.quote, select: actions.select,
                            sideChat: actions.sideChat, edit: state.editable ? actions.edit : nil,
                            saveFiles: actions.saveFiles,
                            readAloud: actions.readAloud.map { read in { read(row.id, $0) } },
                            reading: state.reading)
                        .environment(\.readAlongPiece, state.piece)
                    case .activity(let rows):
                        ActivityGroup(rows: rows)
                    }
                }
                .background {
                    if state.match { RoundedRectangle(cornerRadius: 12).fill(.yellow.opacity(0.22)).padding(-6) }
                }
            }
        case .pending(let message):
            PendingBubble(message: message)
        case .interaction(let interaction):
            InteractionCard(interaction: interaction,
                            resolve: { await actions.resolve(interaction, $0) },
                            cancel: { await actions.cancel(interaction) },
                            openWeb: actions.openWeb)
        case .working(let bot, let thinking):
            if let bot { BotTypingRow(bot: bot, thinking: thinking) } else { WorkingIndicator(thinking: thinking) }
        }
    }

    @ViewBuilder private func bot(_ entry: BotChatEntry, _ state: ThreadTranscriptRow.BotState) -> some View {
        switch entry {
        case .day(let date, _):
            BotDaySeparator(date: date)
        case .message(let row, let first, let last):
            if let bot = actions.bot {
                BotMessageRow(
                    bot: bot, row: row, first: first, last: last, projectId: actions.projectId,
                    react: actions.sendReply, quote: actions.quote, select: actions.select,
                    edit: state.editable ? actions.edit : nil, sideThread: state.sideThread,
                    replyInThread: state.canReply ? { actions.replyInThread(row.id) } : nil)
                .modifier(ChatPerfRow(row: row, cached: actions.cached))
            }
        case .work(let rows):
            BotWorkRow(rows: rows)
        case .autoCompacted(let compaction, _):
            BotAutoCompactedMarker(compaction: compaction)
        case .child(let event, _):
            BotChildCard(event: event, live: state.live) {
                if let id = event.threadId { actions.openThread(id) }
            }
        }
    }
}
