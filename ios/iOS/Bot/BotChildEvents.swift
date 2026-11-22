import Foundation

/// The Bot's chain as one conversation (desktop `chat-model.ts`). A thread
/// after the first starts with the handoff request the previous one wrote;
/// that's plumbing, so its first user message is left out once its start is
/// loaded, and the history reads on.
enum BotChain {
    struct Page: Equatable {
        var threadId: String
        var rows: [TimelineRow]
        /// A thread after the first whose start is loaded.
        var continuation: Bool
    }

    static func merge(_ pages: [Page]) -> [TimelineRow] {
        var out: [TimelineRow] = []
        var seen = Set<String>()
        for page in pages {
            var skippedHandoff = !page.continuation
            for row in page.rows {
                if !skippedHandoff, row.isConversation, row.isUser { skippedHandoff = true; continue }
                if seen.insert("\(page.threadId):\(row.id)").inserted { out.append(row) }
            }
        }
        return out
    }
}

enum BotChildStatus: String, Equatable {
    case running, waiting, finished, failed, stopped, needsYou

    var label: String {
        switch self {
        case .running: "Running"
        case .waiting: "Waiting to start"
        case .finished: "Finished"
        case .failed: "Failed"
        case .stopped: "Stopped"
        case .needsYou: "Needs you"
        }
    }

    /// From a BB system message about a child thread.
    static func of(systemMessage kind: String?) -> BotChildStatus? {
        switch kind {
        case "child-completed": .finished
        case "child-failed": .failed
        case "child-interrupted": .stopped
        case "child-needs-attention": .needsYou
        default: nil
        }
    }
}

/// A card in the chat about a thread the Bot started: when it started, or BB's word that it finished.
struct BotChildEvent: Equatable {
    enum Verb: Equatable { case started, update }
    var threadId: String?
    var title: String
    var status: BotChildStatus
    var verb: Verb
}

/// Which of BB's rows a Bot conversation shows, and which become cards
/// about the threads the Bot started.
enum BotChatRows {
    /// Rows the chat leaves out: BB's own messages that aren't about a child
    /// thread, the Bot's bare "✓" after a quiet check-in, and its [PASS].
    static func shows(_ row: TimelineRow) -> Bool {
        guard row.isConversation else { return true }
        if row.isUser, let initiator = row.initiator, initiator != "user" { return childEvent(row) != nil }
        if !row.isUser, row.text?.trimmingCharacters(in: .whitespacesAndNewlines) == "✓", !row.hasAttachments { return false }
        if row.isPassReply { return false }
        return true
    }

    /// BB's message that a thread the Bot started finished, failed, stopped or needs you.
    static func childEvent(_ row: TimelineRow) -> BotChildEvent? {
        guard row.isUser, let initiator = row.initiator, initiator != "user", let subject = row.systemMessageSubject else { return nil }
        if subject.kind == "thread", let status = BotChildStatus.of(systemMessage: row.systemMessageKind) {
            return BotChildEvent(threadId: subject.threadId, title: subject.threadName ?? "A thread", status: status, verb: .update)
        }
        if row.systemMessageKind == "child-outcome-batch", subject.kind == "thread-batch" {
            let outcomes = subject.outcomes ?? []
            let count = subject.count ?? outcomes.count
            return BotChildEvent(threadId: nil, title: "\(count) threads", status: outcomes.contains { $0.status == "failed" } ? .failed : .finished, verb: .update)
        }
        return nil
    }
}
