import SwiftUI

/// What the conversation's More menu asks of its `ThreadView`. The menu sits
/// in the conversation's bar, outside the thread's own views; the thread
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
    private var isAttached = false

    /// Each screen showing the thread holds it once, as it appears (and loads
    /// it in its task); the last to go detaches.
    func hold(_ app: AppModel) {
        attached += 1
        attach(app)
    }

    /// Attached, without holding: a `.task` (which SwiftUI starts before the
    /// view appears) loads with the client set, whichever runs first.
    func attach(_ app: AppModel) {
        guard !isAttached else { return }
        isAttached = true
        model.attach(app)
    }

    /// The last holder going detaches, a run loop turn later: a screen that
    /// replaces another in the same update (Home over the conversation, a
    /// posture change) takes over without the thread stopping.
    func stop() {
        guard attached > 0 else { return }
        attached -= 1
        guard attached == 0 else { return }
        DispatchQueue.main.async { [weak self] in
            MainActor.assumeIsolated {
                guard let self, self.attached == 0, self.isAttached else { return }
                #if DEBUG
                RenderCount.bump("session.detach")
                #endif
                self.isAttached = false
                self.talk.end()
                self.model.detach()
            }
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
