import SwiftUI

/// A conversation (or any thread) on a stack, under its native bar: the
/// system's Back, the title, the Workbench button (the tab count in its
/// label: SwiftUI's toolbar items take no badge), and ⋯
/// (round 8). The Workbench shows in the chat's place with the composer
/// kept; its title is then the tab, which opens the tab menu. The button or
/// a sideways swipe flips Chat and Workbench.
///
/// Beside two pages (`pane`, the open Duo) the chat is alone: the Workbench
/// is the side pane's, its tab's actions first in ⋯, and Home's button is
/// the bar's first (`ShellPages`).
/// Where the side pane is hidden (no tab the phone can show) the tab menu
/// takes the Workbench button's place.
struct ConversationScreen: View {
    let threadId: String
    var pane = false
    @ObservedObject private var session: ConversationSession
    @ObservedObject private var model: ThreadModel
    @ObservedObject private var router = Router.shared
    @State private var workbench = WorkbenchStore.shared
    @State private var addingTab = false
    @Environment(\.botConversation) private var shell
    @Environment(\.shellPaneAtEdge) private var atEdge
    @Environment(\.shellPosture) private var posture
    @EnvironmentObject private var app: AppModel

    init(threadId: String, pane: Bool = false) {
        self.threadId = threadId
        self.pane = pane
        let session = ConversationSessions.shared.session(threadId)
        self.session = session
        model = session.model
    }

    private var title: String {
        model.thread.map { ThreadTitles.resolve($0.displayTitle) } ?? shell?.conversation?.title ?? "Conversation"
    }

    private var showsWorkbench: Bool { !pane && session.showsWorkbench }
    /// The shown tab's actions lead ⋯ while its Workbench shows: in the chat's
    /// place, or beside two pages in the side pane (which has no bar of its own).
    private var showsTabActions: Bool { showsWorkbench || (pane && !atEdge) }

    var body: some View {
        ThreadView(session: session, workbench: showsWorkbench ? { AnyView(workbenchView) } : nil, flips: !pane)
            .id(threadId)
            // A pane left of another: its stack still hands it the window's
            // trailing inset (the status column, a screen away), which it never reaches.
            .ignoresSafeArea(.container, edges: pane && !atEdge ? .trailing : [])
            .navigationTitle(title)
            .toolbar { toolbar }
            // On the iPhone a conversation has the screen to itself, as in a messaging app: the
            // composer at the bottom, no tab bar under it. The Duo keeps the system's column.
            .toolbar(posture == .phone ? .hidden : .automatic, for: .tabBar)
            .sensoryFeedback(.selection, trigger: session.showsWorkbench)
            .sheet(isPresented: $addingTab) { WorkbenchNewTab(threadId: threadId) }
            .task(id: threadId) {
                // A conversation is the one on screen (the open Duo's column); a worker or reply pushed over it isn't.
                if shell?.threadId == threadId, shell?.kind == .conversation { router.shown(threadId) }
                workbench.attach(app.realtime)
                await workbench.load(threadId)
            }
            // Studio counts the phone as showing it, so an agent's workbench_open lands here.
            .onAppear { WorkbenchShown.shared.show(threadId) }
            .onDisappear { WorkbenchShown.shared.hide(threadId) }
            .accessibilityElement(children: .contain)
            .accessibilityIdentifier("conversation-\(threadId)")
    }

    @ToolbarContentBuilder private var toolbar: some ToolbarContent {
        ToolbarItem(placement: .principal) {
            if showsWorkbench {
                WorkbenchTitleMenu(threadId: threadId, subtitle: title) { addingTab = true }
            } else {
                Text(title).font(.headline).lineLimit(1).accessibilityAddTraits(.isHeader).accessibilityIdentifier("conversationTitle")
            }
        }
        if !pane {
            ToolbarItem(placement: .topBarTrailing) { workbenchButton }
        } else if atEdge {
            ToolbarItem(placement: .topBarTrailing) {
                Menu { WorkbenchTabMenuItems(threadId: threadId) { addingTab = true } } label: {
                    Label(Self.tabs(workbench.count(threadId)), systemImage: "rectangle.split.2x1")
                }
                .menuOrder(.fixed)
                .accessibilityIdentifier("workbenchTabs")
            }
        }
        ToolbarItem(placement: .topBarTrailing) {
            Menu { ConversationMenuItems(session: session, conversation: shell, tabActions: showsTabActions ? session.tabActions : []) } label: {
                Label("Conversation menu", systemImage: "ellipsis")
            }
            .menuOrder(.fixed)
            .accessibilityIdentifier("conversationMore")
        }
    }

    @ViewBuilder private var workbenchButton: some View {
        let count = workbench.count(threadId)
        Button { flip(to: !showsWorkbench) } label: {
            Label(showsWorkbench ? "Show chat" : Self.tabs(count), systemImage: showsWorkbench ? "bubble.left" : "rectangle.split.2x1")
        }
        .accessibilityIdentifier("workbenchButton")
    }

    // MARK: The Workbench in the chat's place

    private var workbenchView: some View {
        WorkbenchView(threadId: threadId, webURL: model.thread.map { app.client.webURL(forThread: $0) },
                      openThread: { router.push(.thread(id: $0)) },
                      actionsChanged: { if session.tabActions != $0 { session.tabActions = $0 } })
            .simultaneousGesture(DragGesture(minimumDistance: 30).onEnded { drag in
                // A swipe to the right, back to the chat; not a scroll.
                let dx = drag.predictedEndTranslation.width
                if dx > ThreadView.flipDistance * 2, abs(drag.translation.width) > abs(drag.translation.height) * 2 { flip(to: false) }
            })
    }

    /// The Workbench button's name, with its tab count: SwiftUI's toolbar items take no badge.
    static func tabs(_ count: Int) -> String { count == 1 ? "Workbench, 1 tab" : "Workbench, \(count) tabs" }

    private func flip(to workbench: Bool) {
        guard session.showsWorkbench != workbench else { return }
        withAnimation(.snappy(duration: 0.25)) { session.showsWorkbench = workbench }
    }
}

/// The Workbench's title in a bar: the shown tab (and the conversation under
/// it), which opens the tab menu.
struct WorkbenchTitleMenu: View {
    let threadId: String
    let subtitle: String?
    let newTab: () -> Void
    @State private var workbench = WorkbenchStore.shared

    var body: some View {
        let tab = workbench.selected(threadId)
        Menu { WorkbenchTabMenuItems(threadId: threadId, newTab: newTab) } label: {
            VStack(spacing: 0) {
                HStack(spacing: 4) {
                    Text(tab?.title ?? "Workbench").font(.headline).lineLimit(1)
                    Image(systemName: "chevron.down").font(.caption.weight(.semibold)).foregroundStyle(.secondary)
                }
                if let subtitle { Text(subtitle).font(.caption).foregroundStyle(.secondary).lineLimit(1) }
            }
            .foregroundStyle(.primary)
            .frame(minHeight: 44)
        }
        .menuOrder(.fixed)
        .accessibilityLabel("Tab: \(tab?.title ?? "none"). Show tabs")
        .accessibilityIdentifier("workbenchTitle")
    }
}
