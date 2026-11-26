import SwiftUI

/// A conversation's Workspace, the desktop's side panel on the phone (round 5):
/// a strip of tabs (Info and Strands first, then what you or the agent opened,
/// ✦ for the agent's), and the selected tab below. Tabs change only with the
/// strip; ✕ closes the active tab. At most two heavy views stay loaded.
/// The iPhone shows it as a sheet from the title; the unfolded Duo as its right screen.
struct WorkspaceView<Info: View, Strands: View>: View {
    let threadId: String
    /// Kept clear at the trailing edge: the unfolded Duo's status column.
    var trailingClear: CGFloat = 0
    /// Opens a conversation or worker tab in the chat.
    var openThread: (String) -> Void = { _ in }
    /// The conversation in BB web: where tabs the phone has no view for open.
    var webURL: URL? = nil
    @ViewBuilder let info: () -> Info
    @ViewBuilder let strands: () -> Strands
    @State private var store = WorkspaceStore.shared
    @EnvironmentObject private var app: AppModel

    private var selected: String { store.selected[threadId] ?? WorkspaceStore.info }
    private var tabs: [WorkspaceTab] { store.tabs(threadId) }

    var body: some View {
        VStack(spacing: 0) {
            strip
                .padding(.trailing, trailingClear)
            Divider().opacity(0.5)
            content
                .padding(.trailing, trailingClear)
                .frame(maxWidth: .infinity, maxHeight: .infinity, alignment: .top)
        }
        .task(id: threadId) {
            store.attach(app.realtime)
            await store.load(threadId)
        }
        .accessibilityElement(children: .contain)
        .accessibilityIdentifier("workspace")
    }

    // MARK: The strip

    private var strip: some View {
        ScrollViewReader { proxy in
            ScrollView(.horizontal) {
                HStack(spacing: 6) {
                    chip(id: WorkspaceStore.info, title: "Info", agent: false, closes: false)
                    chip(id: WorkspaceStore.strands, title: "Strands", agent: false, closes: false)
                    ForEach(tabs) { tab in chip(id: tab.id, title: tab.title, agent: tab.openedByAgent, closes: true) }
                }
                .padding(.horizontal, 12)
                .padding(.vertical, 6)
            }
            .scrollIndicators(.hidden)
            .clipped()
            .onChange(of: selected) { _, id in withAnimation(.snappy) { proxy.scrollTo(id, anchor: .center) } }
        }
        .accessibilityElement(children: .contain)
        .accessibilityIdentifier("workspaceStrip")
    }

    private func chip(id: String, title: String, agent: Bool, closes: Bool) -> some View {
        let on = selected == id
        return HStack(spacing: 0) {
            Button {
                if id == WorkspaceStore.info || id == WorkspaceStore.strands {
                    store.selected[threadId] = id
                } else {
                    store.select(id, in: threadId)
                }
            } label: {
                HStack(spacing: 5) {
                    if agent {
                        Image(systemName: "sparkle").font(.caption2).foregroundStyle(.tint)
                            .accessibilityLabel("Opened by the agent")
                    }
                    Text(title).lineLimit(1)
                }
                .padding(.leading, 12)
                .padding(.trailing, on && closes ? 2 : 12)
                .frame(minHeight: 44)
                .contentShape(.rect)
            }
            .buttonStyle(.plain)
            .accessibilityAddTraits(on ? .isSelected : [])
            .accessibilityIdentifier("workspaceTab-\(id)")
            // Close only on the active tab, so a tap on a tab never closes it by accident.
            if on && closes {
                Button { store.close(id, in: threadId) } label: {
                    Image(systemName: "xmark").font(.caption.weight(.semibold))
                        .frame(width: 32, height: 44).contentShape(.rect)
                }
                .buttonStyle(.plain)
                .foregroundStyle(.secondary)
                .accessibilityLabel("Close \(title)")
                .accessibilityIdentifier("workspaceClose-\(id)")
            }
        }
        .font(.subheadline)
        .foregroundStyle(on ? .primary : .secondary)
        .background(on ? AnyShapeStyle(.fill.secondary) : AnyShapeStyle(.fill.quaternary), in: .rect(cornerRadius: 10))
        .id(id)
    }

    // MARK: The selected tab

    @ViewBuilder private var content: some View {
        ZStack(alignment: .top) {
            if selected == WorkspaceStore.info {
                info()
            } else if selected == WorkspaceStore.strands {
                strands()
            }
            // Heavy views stay loaded (hidden) while among the two newest; the rest load when shown.
            ForEach(tabs.filter { $0.heavy && store.mounted.contains($0.id) && $0.id != selected }) { tab in
                WorkbenchTabContent(tab: tab)
                    .opacity(0).allowsHitTesting(false).accessibilityHidden(true)
            }
            if let tab = tabs.first(where: { $0.id == selected }) {
                WorkbenchTabContent(tab: tab)
                    .id(tab.id)
            }
        }
        .environment(\.workbenchContext, WorkbenchContext(threadId: threadId, webURL: webURL, openThread: openThread))
    }
}

/// What Info's rows and buttons ask of the conversation.
enum WorkspaceInfoAction: Equatable {
    case approval(String), model, notifications, find, rename, handsFree, archive, more
}

/// Info asks the conversation on screen (ThreadView) to act: on the
/// unfolded Duo, Info sits on the right screen, outside the chat's views.
@MainActor @Observable
final class WorkspaceRequests {
    static let shared = WorkspaceRequests()
    private(set) var pending: [String: WorkspaceInfoAction] = [:]
    func ask(_ action: WorkspaceInfoAction, in threadId: String) { pending[threadId] = action }
    func take(_ threadId: String) -> WorkspaceInfoAction? {
        defer { pending[threadId] = nil }
        return pending[threadId]
    }
}

/// The Workspace's Info tab (round 5): what needs you, the model, workspace
/// and notifications, Find / Rename / Hands-free / Share, Archive, and More.
struct WorkspaceInfoView<More: View>: View {
    let thread: ThreadEntry?
    let modelLabel: String?
    let cards: [ConversationApprovals.Card]
    let muted: Bool
    let canArchive: Bool
    var archiving = false
    let shareURL: URL?
    let act: (WorkspaceInfoAction) -> Void
    @ViewBuilder let more: () -> More
    @Environment(\.look) private var look

    var body: some View {
        List {
            if !cards.isEmpty {
                Section("Needs you") {
                    ForEach(cards) { card in
                        Button { act(.approval(card.id)) } label: {
                            HStack(spacing: 10) {
                                Circle().fill(look.needsYou).frame(width: 8, height: 8).accessibilityHidden(true)
                                VStack(alignment: .leading, spacing: 2) {
                                    Text(card.approval.worker.title)
                                    Text(card.approval.title).font(.footnote).foregroundStyle(.secondary).lineLimit(1)
                                }
                            }
                            .frame(minHeight: 44)
                        }
                        .accessibilityLabel("Needs you, \(card.approval.worker.title), \(card.approval.title)")
                        .accessibilityIdentifier("workspaceNeeds-\(card.id)")
                    }
                }
            }
            Section("This conversation") {
                Button { act(.model) } label: { LabeledContent("Model", value: modelLabel ?? "Model") }
                    .accessibilityIdentifier("workspaceModel")
                if let thread {
                    LabeledContent("Workspace", value: thread.environmentBranchName
                        ?? thread.environmentPath.map { ($0 as NSString).lastPathComponent } ?? "Project default")
                }
                Button { act(.notifications) } label: { LabeledContent("Notifications", value: muted ? "Muted" : "All") }
                    .accessibilityIdentifier("workspaceNotifications")
            }
            Section {
                HStack(spacing: 8) {
                    action("Find", "magnifyingglass", .find, id: "workspaceFind")
                    action("Rename", "pencil", .rename, id: "workspaceRename")
                    action("Hands-free", "waveform", .handsFree, id: "workspaceHandsFree")
                    if let shareURL {
                        ShareLink(item: shareURL) { label("Share", "square.and.arrow.up") }
                            .buttonStyle(.plain)
                            .accessibilityIdentifier("workspaceShare")
                    }
                }
                .listRowInsets(EdgeInsets(top: 8, leading: 12, bottom: 8, trailing: 12))
            }
            Section {
                if canArchive {
                    Button { act(.archive) } label: {
                        LabeledContent(archiving ? "Archiving…" : "Archive", value: "Saves a summary first")
                    }
                    .disabled(archiving)
                    .accessibilityIdentifier("workspaceArchive")
                }
                more()
            }
        }
        .listStyle(.insetGrouped)
        .scrollContentBackground(.hidden)
        .accessibilityIdentifier("workspaceInfo")
    }

    private func action(_ title: String, _ icon: String, _ what: WorkspaceInfoAction, id: String) -> some View {
        Button { act(what) } label: { label(title, icon) }
            .buttonStyle(.plain)
            .accessibilityIdentifier(id)
    }

    private func label(_ title: String, _ icon: String) -> some View {
        VStack(spacing: 4) {
            Image(systemName: icon).font(.body)
            Text(title).font(.footnote)
        }
        .frame(maxWidth: .infinity, minHeight: 58)
        .background(.fill.tertiary, in: .rect(cornerRadius: 14))
        .contentShape(.rect)
    }
}

/// The unfolded Duo's right screen beside the conversation: its Workspace,
/// with Info asking the conversation on the left to act.
struct DuoWorkspacePane: View {
    let threadId: String
    @ObservedObject var model: ThreadModel
    let conversation: BotConversation?
    let openThread: (String) -> Void
    @ObservedObject private var muted = MutedThreads.shared
    @EnvironmentObject private var app: AppModel
    @State private var slots = ApprovalSlots.shared

    var body: some View {
        let thread = model.thread
        WorkspaceView(threadId: threadId, openThread: openThread, webURL: model.thread.map { app.client.webURL(forThread: $0) }) {
            WorkspaceInfoView(thread: thread, modelLabel: conversation?.modelName,
                              cards: slots.waiting[threadId] ?? [], muted: muted.ids.contains(threadId),
                              canArchive: ConversationFinish.canRemove(conversation, running: thread?.isRunning == true),
                              shareURL: thread.map { app.client.webURL(forThread: $0).absoluteURL },
                              act: { WorkspaceRequests.shared.ask($0, in: threadId) }) {
                Button { WorkspaceRequests.shared.ask(.more, in: threadId) } label: {
                    LabeledContent("More", value: "Main, context, files, web, ID")
                }
                .accessibilityIdentifier("workspaceMore")
            }
        } strands: {
            ScrollView {
                StrandsBox(threadId: threadId, panel: true, openThread: openThread).padding(12)
            }
        }
    }
}
