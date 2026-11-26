import SwiftUI

/// A conversation (or any thread) pushed over Home: its chat, or its
/// Workbench in the chat's place with the composer kept (round 7).
///
/// - iPhone: one 44 pt bar (back to Home, the title, the Workbench button
///   with the tab count, ⋯); in the Workbench the title is the tab and opens
///   the tab menu (9b). A sideways swipe flips Chat and Workbench.
/// - Duo, one column (folded, vertical): a title line on top, every control
///   in the rail at the right edge (9c, 9f).
/// - Duo, two pages (`pane`): the chat alone under its title line; the
///   Workbench and the rail are the right page's (9d, 9e).
struct ConversationScreen: View {
    let threadId: String
    var pane = false
    @ObservedObject private var session: ConversationSession
    @ObservedObject private var model: ThreadModel
    @ObservedObject private var router = Router.shared
    @State private var workbench = WorkbenchStore.shared
    @State private var addingTab = false
    @Environment(\.shellPosture) private var posture
    @Environment(\.botConversation) private var shell
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
    private var tab: WorkbenchTab? { workbench.selected(threadId) }

    var body: some View {
        VStack(spacing: 0) {
            if posture.usesRail { titleLine }
            ThreadView(session: session, workbench: showsWorkbench ? { AnyView(workbenchView) } : nil, flips: !pane)
                .id(threadId)
        }
        .modifier(ConversationChrome(posture: posture, pane: pane, title: title, phoneTitle: AnyView(phoneTitle),
                                     trailing: AnyView(phoneButtons), slots: slots, actions: railActions))
        .sensoryFeedback(.selection, trigger: session.showsWorkbench)
        .sheet(isPresented: $addingTab) { WorkbenchNewTab(threadId: threadId) }
        .task(id: threadId) {
            if shell?.threadId == threadId { router.shown(threadId) }
            workbench.attach(app.realtime)
            await workbench.load(threadId)
        }
        // Studio counts the phone as showing it, so an agent's workbench_open lands here.
        .onAppear { WorkbenchShown.shared.show(threadId) }
        .onDisappear { WorkbenchShown.shared.hide(threadId) }
        .accessibilityElement(children: .contain)
        .accessibilityIdentifier("conversation-\(threadId)")
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

    private func flip(to workbench: Bool) {
        guard session.showsWorkbench != workbench else { return }
        withAnimation(.snappy(duration: 0.25)) { session.showsWorkbench = workbench }
    }

    // MARK: The Duo's title line and rail

    @ViewBuilder private var titleLine: some View {
        if showsWorkbench, let tab {
            ShellTitleLine(title: tab.title, subtitle: title, posture: posture) { tabMenu }
        } else {
            ShellTitleLine(title: title, posture: posture)
        }
    }

    private var slots: [RailSlot] {
        RailLayout.slots(posture, screen: .conversation(workbench: showsWorkbench, over: router.path.count > 1),
                         tabs: workbench.count(threadId), homeShown: false)
    }

    private var railActions: RailActions {
        RailActions(tap: { slot in
            switch slot {
            case .workbench: flip(to: true)
            case .chat: flip(to: false)
            case .home: router.path = []
            case .back: if !router.path.isEmpty { router.path.removeLast() }
            default: break
            }
        }, tabs: AnyView(tabMenu), more: AnyView(moreMenu))
    }

    private var tabMenu: some View {
        WorkbenchTabMenuItems(threadId: threadId) { addingTab = true }
    }

    private var moreMenu: some View {
        ConversationMenuItems(session: session, conversation: shell, tabActions: showsWorkbench ? session.tabActions : [])
    }

    // MARK: The iPhone's bar

    @ViewBuilder private var phoneTitle: some View {
        if showsWorkbench {
            Menu { tabMenu } label: {
                VStack(spacing: 0) {
                    HStack(spacing: 4) {
                        Text(tab?.title ?? "Workbench").font(.headline).lineLimit(1)
                        Image(systemName: "chevron.down").font(.caption.weight(.semibold)).foregroundStyle(.secondary)
                    }
                    Text(title).font(.caption).foregroundStyle(.secondary).lineLimit(1)
                }
                .foregroundStyle(.primary)
                .frame(minHeight: 44)
            }
            .menuOrder(.fixed)
            .accessibilityLabel("Tab: \(tab?.title ?? "none"). Show tabs")
            .accessibilityIdentifier("workbenchTitle")
        } else {
            Text(title).font(.headline).lineLimit(1).accessibilityIdentifier("conversationTitle")
        }
    }

    @ViewBuilder private var phoneButtons: some View {
        let count = workbench.count(threadId)
        Button { flip(to: !showsWorkbench) } label: {
            Image(systemName: showsWorkbench ? "bubble.left" : "rectangle.split.2x1")
                .overlay(alignment: .topTrailing) { if !showsWorkbench, count > 0 { RailCount(count: count) } }
        }
        .accessibilityLabel(showsWorkbench ? "Show chat" : count == 1 ? "Workbench, 1 tab" : "Workbench, \(count) tabs")
        .accessibilityIdentifier("workbenchButton")
        Menu { moreMenu } label: { Image(systemName: "ellipsis") }
            .menuOrder(.fixed)
            .accessibilityLabel("Conversation menu")
            .accessibilityIdentifier("conversationMore")
    }
}

/// The conversation's chrome by posture: the iPhone's bar, or (Duo) no bar
/// and the rail; beside two pages, neither.
private struct ConversationChrome: ViewModifier {
    let posture: ShellPosture
    let pane: Bool
    let title: String
    let phoneTitle: AnyView
    let trailing: AnyView
    let slots: [RailSlot]
    let actions: RailActions

    func body(content: Content) -> some View {
        if pane {
            // The left page of two: its stack still hands it the window's
            // trailing inset (the status column, a screen away), which it never reaches.
            content
                .ignoresSafeArea(.container, edges: .trailing)
                .toolbar(.hidden, for: .navigationBar)
        } else if posture.usesRail {
            content
                .toolbar(.hidden, for: .navigationBar)
                .rail(slots, actions: actions, large: posture.largeType)
        } else {
            content
                .navigationTitle(title)
                .navigationBarTitleDisplayMode(.inline)
                .toolbar {
                    ToolbarItem(placement: .principal) { phoneTitle }
                    ToolbarItemGroup(placement: .topBarTrailing) { trailing }
                }
        }
    }
}
