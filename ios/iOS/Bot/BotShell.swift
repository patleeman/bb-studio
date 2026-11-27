import SwiftUI

enum BotPage: String, CaseIterable, Hashable, Identifiable {
    case memory, library, automations, archive

    var id: String { rawValue }

    var title: String {
        switch self {
        case .memory: "Memory"
        case .library: "Library"
        case .automations: "Automations"
        case .archive: "Archive"
        }
    }

    var symbol: String {
        switch self {
        case .memory: "brain.head.profile"
        case .library: "books.vertical"
        case .automations: "arrow.triangle.2.circlepath"
        case .archive: "archivebox"
        }
    }
}

enum BotShellItem: Hashable {
    case conversation(String)
    case worker(String)
    case page(BotPage)

    var threadId: String? {
        switch self {
        case .conversation(let id), .worker(let id): id
        case .page: nil
        }
    }
}

/// A conversation's line on Home: its title, when it last changed, whether
/// it runs, and its latest words.
struct BotConversationLine: Equatable, Identifiable {
    var id: String { threadId }
    var threadId: String
    var title: String
    var updatedAt: Double
    var running: Bool
    var text: String
    /// BB's provider id for its logo (`claude-code`, `codex`…), nil when unknown.
    var providerId: String? = nil
}

/// What the root shows: the room once Studio's Bots answer (or from what
/// they answered last time), loading until then, and Studio unreachable after
/// a real failure (not installed, or an error answer) or `timeout`.
enum StudioLaunch {
    enum Shown: Equatable { case loading, room, unreachable }

    static let timeout: Duration = .seconds(10)
    static let retries: [Duration] = [.seconds(5), .seconds(15), .seconds(60)]

    static func shown(support: BotSpacesSupport, failed: Bool, timedOut: Bool) -> Shown {
        switch support {
        case .available: .room
        case .unavailable: .unreachable
        case .unknown: failed || timedOut ? .unreachable : .loading
        }
    }

    static func retryDelay(_ attempt: Int, delays: [Duration] = retries) -> Duration {
        guard let last = delays.last else { return .seconds(60) }
        return attempt < delays.count ? delays[max(0, attempt)] : last
    }
}

enum BotShell {
    static func shownBot(_ spaces: BotSpaces?, chosen: String?) -> BotSpace? {
        guard let spaces else { return nil }
        return spaces.bots.first { $0.id == chosen } ?? spaces.current
    }

    static func mainThreadId(_ bot: BotSpace?, view: BotThreadsView?) -> String? {
        if let view, view.botId == nil || view.botId == bot?.id, let main = view.main { return main.threadId }
        return bot?.mainThreadId
    }

    static func lines(_ view: BotThreadsView?) -> [BotConversationLine] {
        guard let view else { return [] }
        var out: [BotConversationLine] = []
        var seen: Set<String> = []
        for conversation in view.conversations where seen.insert(conversation.threadId).inserted {
            let latest = conversation.latest.flatMap { $0.isEmpty ? nil : $0 }
            out.append(BotConversationLine(threadId: conversation.threadId, title: conversation.title.isEmpty ? "Untitled" : conversation.title,
                                           updatedAt: conversation.updatedAt, running: conversation.running,
                                           text: latest ?? (conversation.running ? "Working…" : ""),
                                           providerId: conversation.providerId))
        }
        return out
    }

    @MainActor
    static func context(threadId: String, kind: BotConversationContext.Kind, bot: BotSpace, view: BotThreadsView?,
                        push: @escaping (Route) -> Void, openConversation: @escaping (String) -> Void,
                        showList: @escaping () -> Void, refresh: @escaping () -> Void) -> BotConversationContext {
        BotConversationContext(
            threadId: threadId, kind: kind, botId: bot.id, botName: bot.name,
            look: BotLook(shape: bot.shape, color: bot.color, emoji: bot.avatar),
            mainThreadId: mainThreadId(bot, view: view),
            conversation: view?.conversations.first { $0.threadId == threadId },
            workers: WorkersLine(conversationId: threadId, view: kind == .conversation ? view : nil),
            allWorkers: view?.workers ?? [],
            push: push, openConversation: openConversation, showList: showList, refresh: refresh,
            botPause: bot.paused ? (bot.state ?? "paused") : nil)
    }

    static func shortAge(_ at: Double, now: Date = Date()) -> String {
        WorkerInfo.age(at, now: now)
    }
}
