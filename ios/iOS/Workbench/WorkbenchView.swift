import SwiftUI

/// A conversation's Workbench (round 7): the shown tab's content, under the
/// conversation's bar. Tabs change from the title's tab menu
/// (`WorkbenchTabMenuItems`); there is no tab row. At most
/// two heavy tab views stay loaded.
struct WorkbenchView: View {
    let threadId: String
    /// The conversation in BB web: where tabs the phone has no view for open.
    var webURL: URL?
    /// The conversation's project, where the menu's New page and the rest go.
    var projectId: String?
    var openThread: (String) -> Void = { _ in }
    /// The shown tab's actions, for the shell's More menu.
    var actionsChanged: ([ScreenAction]) -> Void = { _ in }
    @State private var store = WorkbenchStore.shared
    @State private var adding: WorkbenchAdd?
    @EnvironmentObject private var app: AppModel

    var body: some View {
        let tabs = store.tabs(threadId)
        let shown = store.selected(threadId)
        ZStack(alignment: .top) {
            // Heavy views stay loaded (hidden) while among the two newest; the
            // rest load when shown. One ForEach keyed by tab: showing or hiding
            // a tab never moves it to another branch, which would rebuild it.
            ForEach(WorkbenchMounted.kept(tabs, mounted: store.mounted, shown: shown?.id)) { tab in
                WorkbenchTabContent(tab: tab).modifier(WorkbenchHiddenTab(hidden: tab.id != shown?.id))
            }
            if shown == nil {
                WorkbenchEmpty(unsupported: store.unsupported, unshown: tabs.count) { adding = $0 }
            }
        }
        .frame(maxWidth: .infinity, maxHeight: .infinity, alignment: .top)
        .environment(\.workbenchContext, WorkbenchContext(threadId: threadId, webURL: webURL, openThread: openThread))
        .onPreferenceChange(ScreenActionsKey.self) { actions in
            MainActor.assumeIsolated { actionsChanged(shown == nil ? [] : actions) }
        }
        .workbenchAdding(threadId, projectId: projectId, request: $adding)
        .task(id: threadId) {
            store.attach(app.realtime)
            await store.load(threadId)
        }
        .accessibilityElement(children: .contain)
        .accessibilityIdentifier("workbench")
    }
}

/// A heavy tab kept loaded while another shows: unseen, untouchable, and its
/// actions don't reach the More menu (the shown tab's do).
struct WorkbenchHiddenTab: ViewModifier {
    var hidden = true

    func body(content: Content) -> some View {
        content
            .transformPreference(ScreenActionsKey.self) { if hidden { $0 = [] } }
            .opacity(hidden ? 0 : 1)
            .allowsHitTesting(!hidden)
            .accessibilityHidden(hidden)
    }
}

/// No tabs open: what the Workbench is, and the menu's New page, New design and the rest.
/// Tabs the phone can't show count as none, as on the Workbench button;
/// the tab menu still lists them.
private struct WorkbenchEmpty: View {
    let unsupported: Bool
    /// Open tabs the phone can't show (shown is nil, so that is all of them).
    let unshown: Int
    let add: (WorkbenchAdd) -> Void

    var body: some View {
        ContentUnavailableView {
            Label("No tabs", systemImage: "rectangle.split.2x1")
        } description: {
            Text(Self.description(unsupported: unsupported, unshown: unshown))
        } actions: {
            if !unsupported {
                Menu { WorkbenchAddItems(add: add) } label: { Label("New tab", systemImage: "plus") }
                    .menuOrder(.fixed)
                    .buttonStyle(.bordered)
                    .accessibilityIdentifier("workbenchNewTab")
            }
        }
        .accessibilityIdentifier("workbenchEmpty")
    }

    static func description(unsupported: Bool, unshown: Int) -> String {
        if unsupported { return "This server's Studio has no Workbench yet." }
        let opens = "Pages, designs, files and links the conversation opens show here."
        guard unshown > 0 else { return opens }
        return opens + (unshown == 1 ? " The tab menu lists 1 tab the phone can't open." : " The tab menu lists \(unshown) tabs the phone can't open.")
    }
}

/// The Workbench menu (9b): the open tabs with a check on the shown one,
/// then the desktop's New actions, Open link and New tab… (`WorkbenchAddItems`),
/// then Close. From the Workbench's title and the Workbench button, on every posture.
struct WorkbenchTabMenuItems: View {
    let threadId: String
    let add: (WorkbenchAdd) -> Void
    @State private var store = WorkbenchStore.shared

    var body: some View {
        let shown = store.selected(threadId)
        Section {
            ForEach(store.tabs(threadId)) { tab in
                if let unshown = WorkbenchTabKind(tab).unshown {
                    // Listed, never shown: the phone has nothing to put in a pane for it.
                    Button {} label: {
                        Label { Text(tab.title); Text(unshown.label) } icon: { Image(systemName: unshown.symbol) }
                    }
                    .disabled(true)
                    .accessibilityIdentifier("workbenchTab-\(tab.id)")
                } else {
                    Button { store.select(tab.id, in: threadId) } label: {
                        Label(tab.title, systemImage: tab.id == shown?.id ? "checkmark" : Self.symbol(tab.ref.kind))
                    }
                    .accessibilityAddTraits(tab.id == shown?.id ? .isSelected : [])
                    .accessibilityIdentifier("workbenchTab-\(tab.id)")
                }
            }
        }
        Section {
            if !store.unsupported { WorkbenchAddItems(add: add) }
        }
        Section {
            if let shown {
                Button(role: .destructive) { store.close(shown.id, in: threadId) } label: {
                    Label("Close “\(shown.title)”", systemImage: "xmark")
                }
                .accessibilityIdentifier("workbenchClose")
            }
        }
    }

    static func symbol(_ kind: String) -> String {
        switch kind {
        case "page": "doc.text"
        case "design": "display"
        case "file": "doc"
        case "diff": "plus.forwardslash.minus"
        case "browser": "globe"
        case "terminal": "apple.terminal"
        case "whiteboard": "scribble"
        case "app", "artifact": "app"
        case "recording": "waveform"
        case "conversation", "worker": "bubble.left"
        default: "square"
        }
    }
}

/// New tab: a Studio item, found by name, opened in this conversation's Workbench.
struct WorkbenchNewTab: View {
    let threadId: String
    /// After the tab opened: the open Duo shows a Workbench hidden by hand again.
    var opened: () -> Void = {}
    @State private var query = ""
    @State private var found: [Studio.SearchAllOutputItem] = []
    @Environment(\.dismiss) private var dismiss
    @EnvironmentObject private var app: AppModel

    var body: some View {
        NavigationStack {
            List(found.indices, id: \.self) { index in
                let item = found[index]
                Button {
                    if let ref = Self.ref(item) {
                        WorkbenchStore.shared.open(ref, title: item.title ?? "Untitled", in: threadId)
                        opened()
                        dismiss()
                    }
                } label: {
                    Label(item.title ?? "Untitled", systemImage: WorkbenchTabMenuItems.symbol(Self.ref(item)?.kind ?? ""))
                }
                .tint(.primary)
                .disabled(Self.ref(item) == nil)
                .accessibilityIdentifier("workbenchNewTab-\(index)")
            }
            .overlay {
                if found.isEmpty {
                    ContentUnavailableView("Find a page, design or app", systemImage: "magnifyingglass",
                                           description: Text("It opens as a tab here and on the desktop."))
                }
            }
            .searchable(text: $query, placement: .navigationBarDrawer(displayMode: .always), prompt: "Search Studio")
            .navigationTitle("New tab")
            .navigationBarTitleDisplayMode(.inline)
            .toolbar { Button("Cancel") { dismiss() } }
            .task(id: query) { await search() }
        }
        .presentationDetents([.medium, .large])
    }

    private func search() async {
        let trimmed = query.trimmingCharacters(in: .whitespaces)
        guard trimmed.count >= 2 else { return found = [] }
        try? await Task.sleep(for: .milliseconds(250))
        guard !Task.isCancelled, let items = try? await app.client.studioSearchAll(trimmed), !Task.isCancelled else { return }
        found = Array(items.filter { Self.ref($0) != nil }.prefix(20))
    }

    /// A Studio search result as a tab's ref: its kind from the item's route.
    static func ref(_ item: Studio.SearchAllOutputItem) -> WorkbenchTab.Ref? {
        guard let href = item.href, let route = Route(href: href) else { return nil }
        switch route {
        case .page(let id): return .init(kind: "page", id: id)
        case .design(let id): return .init(kind: "design", id: id)
        case .drawing(let id): return .init(kind: "whiteboard", id: id)
        case .artifact(let id): return .init(kind: "artifact", id: id)
        case .mini(let id): return .init(kind: "app", id: id)
        case .recording(let id): return .init(kind: "recording", id: id)
        default: return nil
        }
    }
}
