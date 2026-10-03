import SwiftUI
import UIKit

/// The office as tabs, like the web sidebar (docs/office-tabs.md): Essentials
/// as big tiles, then Pinned (with folders) and Today. Search finds anything
/// in the Space; whatever you open joins Today. Swipe to archive or pin, press
/// and hold for the rest.
struct TabsTab: View {
    @EnvironmentObject private var app: AppModel
    @Environment(OfficeContext.self) private var office
    @State private var query = ""
    @State private var addingBot = false
    @State private var namingFolder = false
    @State private var folderName = ""

    var body: some View {
        NavigationStack(path: $app.path) {
            Group {
                if let tabs = office.tabs {
                    TabsList(store: tabs, query: $query)
                } else {
                    ProgressView()
                }
            }
            .toolbar {
                ToolbarItem(placement: .principal) { SpaceSwitcher() }
                ToolbarItem(placement: .primaryAction) {
                    Menu {
                        Button { app.newThread() } label: { Label("New Thread", systemImage: "square.and.pencil") }
                        Button { addingBot = true } label: { Label("Add a Bot", systemImage: "person.badge.plus") }
                        Button { app.push(.officeHome) } label: { Label("Home", systemImage: "house") }
                        Button { app.push(.officeTeam) } label: { Label("Team", systemImage: "person.2") }
                        Button { app.push(.studioCollection) } label: { Label("Library", systemImage: "square.stack") }
                        Button { folderName = ""; namingFolder = true } label: { Label("New Folder", systemImage: "folder.badge.plus") }
                        Button {
                            Task {
                                if let tab = await office.tabs?.reopen() { openTab(tab, app: app) }
                            }
                        } label: { Label("Reopen Closed Tab", systemImage: "arrow.uturn.backward") }
                    } label: {
                        Image(systemName: "plus")
                    }
                    .accessibilityLabel("New")
                    .accessibilityIdentifier("officeTabsNew")
                }
            }
            .navigationBarTitleDisplayMode(.inline)
            .navigationDestination(for: Route.self) { RouteDestination(route: $0) }
            .alert("New Folder", isPresented: $namingFolder) {
                TextField("Name", text: $folderName)
                Button("Cancel", role: .cancel) {}
                Button("Create") {
                    let name = folderName.trimmingCharacters(in: .whitespaces)
                    if !name.isEmpty { Task { await office.tabs?.createFolder(name: name) } }
                }
            } message: { Text("A folder in Pinned. Move tabs into it from their menu.") }
            .sheet(isPresented: $addingBot) {
                if let space = office.currentSpace { AddBotSheet(space: space) }
            }
        }
    }
}

private struct TabsList: View {
    @EnvironmentObject private var app: AppModel
    @Environment(OfficeContext.self) private var office
    @FocusState private var searchFocused: Bool
    let store: TabsStore
    @Binding var query: String

    var body: some View {
        List {
            GrowingSearchField(text: $query, prompt: "Search or open", label: "Search or open",
                               identifier: "officeTabsSearch", isFocused: $searchFocused, onSubmit: submitSearch)
                .listRowInsets(EdgeInsets(top: 0, leading: 0, bottom: 0, trailing: 0))
                .listRowBackground(Color.clear)
            if searchFocused || !query.isEmpty {
                SearchResults(store: store, query: query, endSearch: endSearch)
            } else {
                if let error = store.error, store.today.isEmpty, store.essentials.isEmpty {
                    Section { ConnectionBanner(message: error) { await store.refresh() } }
                }
                if !store.essentials.isEmpty {
                    Section {
                        EssentialsGrid(store: store)
                            .listRowInsets(EdgeInsets(top: 4, leading: 0, bottom: 4, trailing: 0))
                            .listRowBackground(Color.clear)
                    }
                }
                // Drag to reorder within a section. Swipe or use the menu
                // to move tabs between sections and folders.
                let loose = store.pinned.filter { $0.folderId == nil }
                Section {
                    ForEach(loose) { tab in TabRow(store: store, tab: tab) }
                        .onMove { from, to in Task { await store.reorder(loose, from: from, to: to, zone: .pinned) } }
                    ForEach(store.folders.sorted { $0.position < $1.position }) { folder in
                        FolderRows(store: store, folder: folder)
                    }
                } header: {
                    Text("Pinned").foregroundStyle(Color(.label))
                        .frame(maxWidth: .infinity, minHeight: 44, alignment: .leading)
                }
                Section {
                    ForEach(store.today) { tab in TabRow(store: store, tab: tab) }
                        .onMove { from, to in Task { await store.reorder(store.today, from: from, to: to, zone: .today) } }
                    if store.today.isEmpty, !store.isLoading {
                        Text("What you open shows up here, and is archived after a few days.")
                            .font(.subheadline)
                            .foregroundStyle(Color(.label))
                    }
                } header: {
                    HStack(alignment: .firstTextBaseline) {
                        Text("Today").foregroundStyle(Color(.label))
                            .frame(maxWidth: .infinity, alignment: .leading)
                        Spacer()
                        if !store.today.isEmpty {
                            Button { Task { await store.clearToday() } } label: {
                                Text("Clear")
                                    .frame(minWidth: 44, minHeight: 44, alignment: .trailing)
                                    .contentShape(Rectangle())
                            }
                                .font(.subheadline)
                                .textCase(nil)
                                .accessibilityLabel("Archive every Today tab")
                        }
                    }
                    .frame(minHeight: 44)
                }
            }
        }
        .listStyle(.insetGrouped)
        // A faint wash of the Space's color, as Arc tints its sidebar.
        .scrollContentBackground(.hidden)
        .background {
            ZStack {
                Color(.systemGroupedBackground)
                (office.currentSpace?.tint ?? .clear).opacity(0.1)
            }
            .ignoresSafeArea()
        }
        .refreshable { await office.refreshCurrent() }
        .task(id: store.spaceId) { await store.refresh() }
    }

    private func endSearch() {
        query = ""
        searchFocused = false
    }

    private func submitSearch() {
        let submitted = query
        let trimmed = submitted.trimmingCharacters(in: .whitespacesAndNewlines)
        Task {
            let matches = trimmed.isEmpty
                ? try? await store.archived(query: nil)
                : try? await store.search(trimmed)
            guard query == submitted, let first = matches?.first else { return }
            endSearch()
            openTab(first, app: app)
        }
    }
}

extension TabsStore {
    /// A List move within one section. `to` is SwiftUI's insertion point in
    /// the original order; the server wants the index among the others.
    func reorder(_ list: [OfficeTab], from: IndexSet, to: Int, zone: OfficeTabZone, folderId: String? = nil) async {
        guard let at = from.first, list.indices.contains(at) else { return }
        await move(list[at].ref, to: zone, folderId: folderId, index: to > at ? to - 1 : to)
    }

    /// Makes a Pinned folder and files a tab in it, like "New Folder…" on the web.
    func createFolder(name: String, filing ref: String) async {
        await createFolder(name: name)
        if let folder = folders.filter({ $0.name == name }).max(by: { $0.position < $1.position }) {
            await move(ref, to: .pinned, folderId: folder.id)
        }
    }
}

/// A split tab's tabs side by side, as Arc draws them; each half opens its own.
private struct SplitHalves: View {
    @EnvironmentObject private var app: AppModel
    let store: TabsStore
    let members: [OfficeTab]

    var body: some View {
        HStack(spacing: 8) {
            ForEach(Array(members.enumerated()), id: \.element.ref) { index, member in
                if index > 0 { Divider().frame(height: 18) }
                Button { openTab(member, app: app) } label: {
                    HStack(spacing: 6) {
                        TabGlyph(tab: member, title: store.title(for: member), size: 20)
                        Text(store.title(for: member)).foregroundStyle(Color(.label)).lineLimit(1)
                    }
                    .frame(maxWidth: .infinity, alignment: .leading)
                    .contentShape(Rectangle())
                }
                .buttonStyle(.borderless)
                .accessibilityLabel("Open \(store.title(for: member))")
            }
        }
    }
}

/// What a dragged tab looks like under your finger.

// MARK: - Opening

/// Opens a tab where it belongs: Inbox switches tabs, Home pushes the office
/// Home, anything else pushes its native screen or opens BB web.
@MainActor func openTab(_ tab: OfficeTab, app: AppModel) {
    switch tab.kind {
    case .inbox: app.tab = .inbox
    case .home: app.push(.officeHome)
    default:
        if let route = tab.route { app.push(route) } else if let href = tab.href { app.openHref(href) }
    }
}

// MARK: - Essentials

private struct EssentialsGrid: View {
    @EnvironmentObject private var app: AppModel
    @Environment(\.dynamicTypeSize) private var dynamicTypeSize
    let store: TabsStore
    private var columns: [GridItem] {
        Array(repeating: GridItem(.flexible(), spacing: 10), count: dynamicTypeSize.isAccessibilitySize ? 2 : 4)
    }

    var body: some View {
        LazyVGrid(columns: columns, spacing: 10) {
            ForEach(store.essentials) { tab in
                let title = store.title(for: tab)
                Button { openTab(tab, app: app) } label: {
                    EssentialTile(tab: tab, title: title)
                }
                .buttonStyle(.plain)
                .contextMenu {
                    Button { Task { await store.move(tab.ref, to: .pinned) } } label: { Label("Remove from Essentials", systemImage: "star.slash") }
                    CopyLinkButton(tab: tab, title: title)
                }
                .accessibilityIdentifier("officeEssential")
            }
        }
    }
}

private struct EssentialTile: View {
    let tab: OfficeTab
    let title: String
    @ScaledMetric(relativeTo: .title2) private var tileHeight: CGFloat = 60
    @ScaledMetric(relativeTo: .title2) private var glyphSize: CGFloat = 30

    var body: some View {
        RoundedRectangle(cornerRadius: 14, style: .continuous)
            .fill(Color(.secondarySystemGroupedBackground))
            .frame(height: tileHeight)
            .overlay { TabGlyph(tab: tab, title: title, size: min(glyphSize, 60)) }
            .overlay(alignment: .topTrailing) {
                if let badge = tab.badge, badge > 0 {
                    Text("\(badge)")
                        .font(.caption2.weight(.bold).monospacedDigit())
                        .foregroundStyle(Color(.systemBackground))
                        .padding(.horizontal, 5)
                        .frame(minWidth: 18, minHeight: 18)
                        .background(Capsule().fill(Color(.label)))
                        .padding(5)
                } else if tab.needsYou == true || tab.unread == true {
                    Circle()
                        .fill(tab.needsYou == true ? Color.orange : Color(.label))
                        .frame(width: 8, height: 8)
                        .padding(8)
                }
            }
            .accessibilityElement(children: .ignore)
            .accessibilityLabel([title, tab.badge.flatMap { $0 > 0 ? "\($0) waiting" : nil },
                tab.providerId.flatMap { ["hermes": "Hermes", "openclaw": "OpenClaw", "dot": "Dot"][$0] }.map { "\($0) agent" },
                tab.needsYou == true || tab.botState == .needsYou ? "needs you" : nil,
                tab.botState == .working ? "working" : nil, tab.unread == true ? "unread" : nil]
                .compactMap { $0 }.joined(separator: ", "))
            .accessibilityAddTraits(.isButton)
            .accessibilityShowsLargeContentViewer { Text(title) }
    }
}

// MARK: - Rows

/// A bot's face, a channel's #, an item's emoji, or its kind's symbol.
struct TabGlyph: View {
    let tab: OfficeTab
    let title: String
    var size: CGFloat = 24

    var body: some View {
        switch tab.kind {
        case .bot:
            Face(name: title, avatar: tab.icon, state: tab.botState ?? .idle, size: size, external: externalName)
        case .conversation:
            Text("#").font(.system(size: size * 0.75, weight: .semibold)).foregroundStyle(Color(.secondaryLabel))
                .frame(width: size, height: size).accessibilityHidden(true)
        case .item where tab.icon?.isEmpty == false:
            Text(tab.icon!).font(.system(size: size * 0.75)).frame(width: size, height: size).accessibilityHidden(true)
        default:
            Image(systemName: tab.symbol).font(.system(size: size * 0.6)).foregroundStyle(Color(.secondaryLabel))
                .frame(width: size, height: size).accessibilityHidden(true)
        }
    }

    private var externalName: String? {
        switch tab.providerId {
        case "hermes": "Hermes"
        case "openclaw": "OpenClaw"
        case "dot": "Dot"
        default: nil
        }
    }
}

private struct TabRow: View {
    @EnvironmentObject private var app: AppModel
    @Environment(OfficeContext.self) private var office
    @Environment(\.dynamicTypeSize) private var dynamicTypeSize
    let store: TabsStore
    let tab: OfficeTab
    @State private var namingFolder = false
    @State private var folderName = ""

    var body: some View {
        let title = store.title(for: tab)
        Button { openTab(tab, app: app) } label: {
            HStack(spacing: 12) {
                if let members = tab.members {
                    SplitHalves(store: store, members: members)
                } else {
                TabGlyph(tab: tab, title: title)
                Text(title)
                    .font(.body.weight(tab.unread == true ? .semibold : .regular))
                    .foregroundStyle(Color(.label))
                    .lineLimit(dynamicTypeSize.isAccessibilitySize ? nil : 2)
                    .fixedSize(horizontal: false, vertical: true)
                    .accessibilityIdentifier("officeTabTitle:\(tab.ref)")
                }
                Spacer(minLength: 4)
                if tab.needsYou == true {
                    Circle().fill(Color.orange).frame(width: 8, height: 8).accessibilityLabel("Needs you")
                } else if tab.unread == true {
                    Circle().fill(Color(.label)).frame(width: 6, height: 6).accessibilityLabel("Unread")
                }
            }
            .contentShape(Rectangle())
        }
        .accessibilityIdentifier("officeTab")
        .swipeActions(edge: .trailing) {
            Button { Task { await store.archive(tab.ref) } } label: { Label("Close", systemImage: "xmark") }
                .tint(.gray)
        }
        .swipeActions(edge: .leading) {
            Button { Task { await store.move(tab.ref, to: tab.zone == .pinned ? .today : .pinned) } } label: {
                Label(tab.zone == .pinned ? "Unpin" : "Pin", systemImage: tab.zone == .pinned ? "pin.slash" : "pin")
            }
            .tint(.orange)
        }
        .contextMenu {
            Button { Task { await store.move(tab.ref, to: tab.zone == .pinned ? .today : .pinned) } } label: {
                Label(tab.zone == .pinned ? "Unpin" : "Pin", systemImage: tab.zone == .pinned ? "pin.slash" : "pin")
            }
            if tab.members != nil {
                Button { Task { await store.separate(tab.ref) } } label: { Label("Separate Tabs", systemImage: "rectangle.split.2x1.slash") }
            }
            if tab.zone != .essential {
                Button { Task { await store.move(tab.ref, to: .essential) } } label: { Label("Add to Essentials (\(store.essentials.count)/8)", systemImage: "star") }
                    .disabled(store.essentials.count >= 8)
            }
            Menu {
                ForEach(store.folders.filter { $0.id != tab.folderId }) { folder in
                    Button(folder.name) { Task { await store.move(tab.ref, to: .pinned, folderId: folder.id) } }
                }
                if tab.folderId != nil {
                    Button { Task { await store.move(tab.ref, to: .pinned) } } label: { Label("Out of Folder", systemImage: "arrow.up") }
                }
                Button { folderName = ""; namingFolder = true } label: { Label("New Folder…", systemImage: "folder.badge.plus") }
            } label: { Label("Move to Folder", systemImage: "folder") }
            let otherSpaces = office.spaces.spaces.filter { $0.id != store.spaceId }
            if !otherSpaces.isEmpty {
                Menu {
                    ForEach(otherSpaces) { space in
                        Button(space.icon.map { "\($0) \(space.name)" } ?? space.name) { Task { await store.moveToSpace(tab.ref, to: space.id) } }
                    }
                } label: { Label("Move to Space", systemImage: "arrow.left.arrow.right") }
            }
            CopyLinkButton(tab: tab, title: title)
            Divider()
            let siblings = (tab.zone == .today ? store.today : store.pinned.filter { $0.folderId == tab.folderId }).map(\.ref)
            let below = siblings.firstIndex(of: tab.ref).map { Array(siblings[($0 + 1)...]) } ?? []
            let others = siblings.filter { $0 != tab.ref }
            Button { Task { await store.archive(tab.ref) } } label: { Label("Close Tab", systemImage: "xmark") }
            if !below.isEmpty {
                Button { Task { await store.closeMany(below) } } label: { Label("Close Tabs Below", systemImage: "chevron.down.2") }
            }
            if !others.isEmpty {
                Button { Task { await store.closeMany(others) } } label: { Label("Close Other Tabs", systemImage: "xmark.circle") }
            }
        }
        .alert("New Folder", isPresented: $namingFolder) {
            TextField("Name", text: $folderName)
            Button("Cancel", role: .cancel) {}
            Button("Create") {
                let name = folderName.trimmingCharacters(in: .whitespaces)
                if !name.isEmpty { Task { await store.createFolder(name: name, filing: tab.ref) } }
            }
        } message: { Text("“\(title)” goes in it.") }
    }
}

private struct FolderRows: View {
    let store: TabsStore
    let folder: OfficeTabFolder
    @State private var renaming = false
    @State private var name = ""

    var body: some View {
        DisclosureGroup(isExpanded: Binding(get: { folder.open }, set: { open in Task { await store.setFolderOpen(folder.id, open) } })) {
            let inside = store.pinned.filter { $0.folderId == folder.id }
            ForEach(inside) { tab in TabRow(store: store, tab: tab) }
                .onMove { from, to in Task { await store.reorder(inside, from: from, to: to, zone: .pinned, folderId: folder.id) } }
        } label: {
            Label(folder.name, systemImage: "folder").fontWeight(.medium)
                .frame(maxWidth: .infinity, alignment: .leading)
                .contentShape(Rectangle())

                .contextMenu {
                    Button { name = folder.name; renaming = true } label: { Label("Rename", systemImage: "pencil") }
                    Button { Task { await store.deleteFolder(folder.id) } } label: { Label("Remove Folder", systemImage: "folder.badge.minus") }
                }
        }
        .alert("Rename Folder", isPresented: $renaming) {
            TextField("Name", text: $name)
            Button("Cancel", role: .cancel) {}
            Button("Rename") {
                let trimmed = name.trimmingCharacters(in: .whitespaces)
                if !trimmed.isEmpty { Task { await store.renameFolder(folder.id, to: trimmed) } }
            }
        }
    }
}

private struct CopyLinkButton: View {
    let tab: OfficeTab
    let title: String

    var body: some View {
        Button {
            if let threadId = tab.threadId {
                UIPasteboard.general.string = "@thread:\(threadId)"
            } else if let href = tab.href {
                UIPasteboard.general.string = "[\(title)](\(href))"
            }
        } label: { Label("Copy Link", systemImage: "link") }
    }
}

// MARK: - Search

private struct SearchResults: View {
    @EnvironmentObject private var app: AppModel
    let store: TabsStore
    let query: String
    var endSearch: () -> Void
    @State private var results: [OfficeTab] = []
    @State private var archived: [OfficeTab] = []
    @State private var failed: String?

    var body: some View {
        let trimmed = query.trimmingCharacters(in: .whitespaces)
        Section {
            Button {
                endSearch()
                app.newThread(text: trimmed)
            } label: {
                Label(trimmed.isEmpty ? "New Thread" : "New Thread: “\(trimmed)”", systemImage: "square.and.pencil")
            }
        }
        if trimmed.isEmpty {
            if !archived.isEmpty {
                Section("Recently Archived") { ForEach(archived) { tab in resultRow(tab) } }
            }
        } else if !results.isEmpty {
            Section("Results") { ForEach(results) { tab in resultRow(tab) } }
        } else if let failed {
            Section { Text(failed).foregroundStyle(.secondary) }
        }
        Color.clear
            .frame(height: 0)
            .listRowBackground(Color.clear)
            .task(id: trimmed) {
                // Debounced: one request per pause in typing.
                try? await Task.sleep(for: .milliseconds(180))
                guard !Task.isCancelled else { return }
                do {
                    if trimmed.isEmpty {
                        archived = Array(try await store.archived(query: nil).prefix(8))
                    } else {
                        results = try await store.search(trimmed)
                    }
                    failed = nil
                } catch {
                    failed = BBClient.describe(error)
                }
            }
    }

    private func resultRow(_ tab: OfficeTab) -> some View {
        let title = store.title(for: tab)
        return Button {
            endSearch()
            openTab(tab, app: app)
        } label: {
            HStack(spacing: 12) {
                TabGlyph(tab: tab, title: title)
                Text(title).foregroundStyle(Color(.label)).lineLimit(2)
                Spacer(minLength: 4)
                Text(detail(tab)).font(.caption).foregroundStyle(Color(.secondaryLabel))
            }
        }
        .accessibilityIdentifier("officeSearchResult:\(tab.ref)")
    }

    private func detail(_ tab: OfficeTab) -> String {
        switch tab.zone {
        case .essential, .pinned, .today: return "Tab"
        case .archived: break
        }
        switch tab.kind {
        case .bot: return "Bot"
        case .conversation: return "Channel"
        case .thread: return "Thread"
        case .item: return (tab.itemKind ?? "Item").capitalized
        default: return ""
        }
    }
}
