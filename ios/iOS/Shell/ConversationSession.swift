import SwiftUI

/// What the conversation's More menu asks of its `ThreadView`. The menu sits
/// in the shell's bar or rail, outside the thread's own views; the thread
/// takes the command and presents what it needs (a sheet, an alert, a push).
enum ConversationCommand: Equatable {
    case find, rename, model, files, terminals, history, saveFiles, sourcePage
    case makeMain, archive, delete, fork
    case contextUsage, compact, clearContext
    case toggleMute, openWeb, copyId
}

/// One open thread: its model, hold-to-talk, and the commands its menu sends.
/// Kept by `ConversationSessions` while it is among the last few shown, so a
/// posture change (folding, turning) keeps the loaded thread and its place.
@MainActor
final class ConversationSession: ObservableObject {
    let threadId: String
    let model: ThreadModel
    let talk: HoldToTalk
    /// The transcript's handle, for the Duo rail's Jump to latest.
    weak var transcript: TranscriptHandle?
    /// The menu's request, taken by the thread (`take()`).
    @Published private(set) var command: ConversationCommand?
    /// Studio's page this chat belongs to (`studio.chatPage`), for Open <page>.
    @Published var sourcePage: PageMeta?
    /// Archive or delete is on its way.
    @Published var finishing = false
    /// One column: the Workbench shows in place of the chat (the composer stays).
    @Published var showsWorkbench = false
    /// The shown Workbench tab's actions, for the More menu.
    @Published var tabActions: [ScreenAction] = []

    init(threadId: String) {
        self.threadId = threadId
        model = ThreadModel(threadId: threadId)
        talk = HoldToTalk(threadId: threadId)
    }

    func run(_ command: ConversationCommand) {
        self.command = command
    }

    func take() -> ConversationCommand? {
        defer { command = nil }
        return command
    }

    private var attached = 0

    /// Each screen showing the thread attaches once; the last to go detaches.
    func start(_ app: AppModel) async {
        attached += 1
        if attached == 1 { model.attach(app) }
        await model.load()
    }

    func stop() {
        guard attached > 0 else { return }
        attached -= 1
        if attached == 0 {
            talk.end()
            model.detach()
        }
    }
}

/// The last few threads shown, so going back to one (or changing posture)
/// doesn't load it again.
@MainActor
final class ConversationSessions {
    static let shared = ConversationSessions()
    static let limit = 6
    private var sessions: [String: ConversationSession] = [:]
    private var recent: [String] = []

    func session(_ threadId: String) -> ConversationSession {
        recent.removeAll { $0 == threadId }
        recent.append(threadId)
        if let session = sessions[threadId] { return session }
        let session = ConversationSession(threadId: threadId)
        sessions[threadId] = session
        while recent.count > Self.limit, let oldest = recent.first {
            recent.removeFirst()
            sessions[oldest] = nil
        }
        return session
    }

    func reset() {
        sessions = [:]
        recent = []
    }
}
