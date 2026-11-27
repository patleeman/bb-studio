import SwiftUI

/// The conversation's menu (⋯ in its bar): the shown
/// Workbench tab's own actions first, then the thread's. Each item sends a
/// `ConversationCommand` to the thread, which does it.
struct ConversationMenuItems: View {
    @ObservedObject var session: ConversationSession
    @ObservedObject var model: ThreadModel
    let conversation: BotConversationContext?
    var tabActions: [ScreenAction] = []
    @ObservedObject private var muted = MutedThreads.shared
    @AppStorage(ServerScope.key("runningPlugins")) private var runningPlugins = ""
    @EnvironmentObject private var app: AppModel

    init(session: ConversationSession, conversation: BotConversationContext?, tabActions: [ScreenAction] = []) {
        self.session = session
        model = session.model
        self.conversation = conversation
        self.tabActions = tabActions
    }

    private var plugins: [Substring] { runningPlugins.split(separator: ",") }
    private var isConversation: Bool { conversation?.threadId == session.threadId && conversation?.kind == .conversation }

    var body: some View {
        if !tabActions.isEmpty {
            Section { ScreenActionItems(actions: tabActions) }
        }
        Section {
            item("Find in conversation", "magnifyingglass", .find, id: "menuFind")
            item("Rename", "pencil", .rename, id: "menuRename")
            item("Model & permissions", "cpu", .model, id: "menuModel")
            if let conversation, isConversation, conversation.mainThreadId != session.threadId {
                item("Make this the Main", "star", .makeMain, id: "makeMain")
            }
        }
        Section {
            if TerminalScope.forThread(session.threadId, environmentId: model.thread?.environmentId) != nil {
                item("Files & changes", "folder", .files, id: "menuFiles")
                item("Terminals", "apple.terminal", .terminals, id: "menuTerminals")
            }
            item("Recent prompts", "clock.arrow.circlepath", .history, id: "menuHistory")
            if plugins.contains("studio") {
                item("Save Files to Studio…", "square.and.arrow.down.on.square", .saveFiles, id: "menuSaveFiles")
            }
            if let page = session.sourcePage {
                item("Open \(page.displayTitle)", "doc.richtext", .sourcePage, id: "menuSourcePage")
            }
        }
        Menu {
            if !isConversation { item("Fork thread", "arrow.triangle.branch", .fork, id: "menuFork") }
            item("Context usage", "chart.bar", .contextUsage, id: "menuContext")
            item("Compact context", "rectangle.compress.vertical", .compact, id: "menuCompact")
            item("Clear context", "eraser", .clearContext, id: "menuClearContext")
        } label: { Label("Context", systemImage: "chart.bar") }
        Menu {
            let isMuted = muted.ids.contains(session.threadId)
            item(isMuted ? "Unmute notifications" : "Mute notifications", isMuted ? "bell" : "bell.slash", .toggleMute, id: "menuMute")
            item("Open in BB web", "safari", .openWeb, id: "menuWeb")
            if let thread = model.thread {
                ShareLink(item: app.client.webURL(forThread: thread).absoluteURL) { Label("Share link", systemImage: "square.and.arrow.up") }
            }
            item("Copy Thread ID", "number", .copyId, id: "menuCopyId")
        } label: { Label("Share & notifications", systemImage: "square.and.arrow.up") }
        if isConversation, ConversationFinish.canRemove(conversation?.conversation, running: model.thread?.isRunning == true) {
            Section {
                Button { session.run(.archive) } label: {
                    Label(session.finishing ? "Archiving…" : "Archive", systemImage: "archivebox")
                    Text(ConversationFinish.archiveHint)
                }
                .disabled(session.finishing)
                .accessibilityIdentifier("menuArchive")
                Button(role: .destructive) { session.run(.delete) } label: { Label("Delete conversation…", systemImage: "trash") }
                    .disabled(session.finishing)
                    .accessibilityIdentifier("menuDelete")
            }
        }
    }

    private func item(_ title: String, _ symbol: String, _ command: ConversationCommand, id: String) -> some View {
        Button { session.run(command) } label: { Label(title, systemImage: symbol) }
            .accessibilityIdentifier(id)
    }
}
