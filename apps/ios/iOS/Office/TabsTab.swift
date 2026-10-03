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
                    } label: {
                        Image(systemName: "plus")
                    }
                    .accessibilityLabel("New")
                    .accessibilityIdentifier("officeTabsNew")
                }
            }
            .navigationBarTitleDisplayMode(.inline)
            .searchable(text: $query, prompt: "Search or open")
            .navigationDestination(for: Route.self) { RouteDestination(route: $0) }
            .sheet(isPresented: $addingBot) {
                if let space = office.currentSpace { AddBotSheet(space: space) }
            }
        }
    }
}

private struct TabsList: View {
    @EnvironmentObject private var app: AppModel
    @Environment(OfficeContext.self) private var office
    @Environment(\.isSearching) private var isSearching
    let store: TabsStore
    @Binding var query: String

    var body: some View {
        List {
            if isSearching || !query.isEmpty {
                SearchResults(store: store, query: query)
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
                // Press and hold a tab, then drag it onto a tab, a section's
                // title or a folder: the same moves as the web sidebar.
                let loose = store.pinned.filter { $0.folderId == nil }
                Section {
                    ForEach(loose) { tab in TabRow(store: store, tab: tab) }
                    ForEach(store.folders.sorted { $0.position < $1.position }) { folder in
                        FolderRows(store: store, folder: folder)
                    }
                    if loose.isEmpty, store.folders.isEmpty, !store.isLoading {
                        Text("Drag tabs here to keep them.")
                            .font(.subheadline)
                            .foregroundStyle(.secondary)
                            .dropDestination(for: String.self) { refs, _ in drop(refs, zone: .pinned) }
                    }
                } header: {
                    Text("Pinned").foregroundStyle(Color(.label))
                        .frame(maxWidth: .infinity, alignment: .leading)
                        .dropDestination(for: String.self) { refs, _ in drop(refs, zone: .pinned) }
                }
                Section {
                    ForEach(store.today) { tab in TabRow(store: store, tab: tab) }
                    if store.today.isEmpty, !store.isLoading {
                        Text("What you open shows up here, and is archived after a few days.")
                            .font(.subheadline)
                            .foregroundStyle(.secondary)
                            .dropDestination(for: String.self) { refs, _ in drop(refs, zone: .today) }
                    }
                } header: {
                    HStack {
                        Text("Today").foregroundStyle(Color(.label))
                            .frame(maxWidth: .infinity, alignment: .leading)
                            .dropDestination(for: String.self) { refs, _ in drop(refs, zone: .today) }
                        Spacer()
                        if !store.today.isEmpty {
                            Button("Clear") { Task { await store.clearToday() } }
                                .font(.subheadline)
                                .textCase(nil)
                                .accessibilityLabel("Archive every Today tab")
                        }
                    }
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

    private func drop(_ refs: [String], zone: OfficeTabZone) -> Bool {
        guard let ref = refs.first else { return false }
        Task { await store.drop(ref, zone: zone) }
        return true
    }
}

extension TabsStore {
    /// Drops a dragged tab just before `target`, or first in its list (last
    /// for Essentials and folders, which grow at the end).
    func drop(_ ref: String, zone: OfficeTabZone, folderId: String? = nil, before target: String? = nil) async {
        let list: [OfficeTab] = switch zone {
        case .essential: essentials
        case .pinned: pinned.filter { $0.folderId == folderId }
        case .today: today
        case .archived: []
        }
        let others = list.map(\.ref).filter { $0 != ref }
        let atEnd = zone == .essential || folderId != nil
        let index = target.flatMap { others.firstIndex(of: $0) } ?? (atEnd ? others.count : 0)
        await move(ref, to: zone, folderId: folderId, index: index)
    }
}

/// What a dragged tab looks like under your finger.
private struct TabDragPreview: View {
    let tab: OfficeTab
    let title: String

    var body: some View {
        HStack(spacing: 10) {
            TabGlyph(tab: tab, title: title)
            Text(title).lineLimit(1)
        }
        .padding(.horizontal, 12)
        .padding(.vertical, 8)
        .background(RoundedRectangle(cornerRadius: 12, style: .continuous).fill(Color(.secondarySystemGroupedBackground)))
    }
}

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
    let store: TabsStore
    private let columns = Array(repeating: GridItem(.flexible(), spacing: 10), count: 4)

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
                .draggable(tab.ref) { TabDragPreview(tab: tab, title: title) }
                .dropDestination(for: String.self) { refs, _ in drop(refs, before: tab.ref) }
                .accessibilityIdentifier("officeEssential")
            }
        }
        .dropDestination(for: String.self) { refs, _ in drop(refs, before: nil) }
    }

    private func drop(_ refs: [String], before target: String?) -> Bool {
        guard let ref = refs.first, ref != target else { return false }
        Task { await store.drop(ref, zone: .essential, before: target) }
        return true
    }
}

private struct EssentialTile: View {
    let tab: OfficeTab
    let title: String

    var body: some View {
        RoundedRectangle(cornerRadius: 14, style: .continuous)
            .fill(Color(.secondarySystemGroupedBackground))
            .frame(height: 60)
            .overlay { TabGlyph(tab: tab, title: title, size: 30) }
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
            .accessibilityLabel([title, tab.badge.flatMap { $0 > 0 ? "\($0) waiting" : nil }, tab.needsYou == true ? "needs you" : nil, tab.unread == true ? "unread" : nil]
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
    let store: TabsStore
    let tab: OfficeTab

    var body: some View {
        let title = store.title(for: tab)
        Button { openTab(tab, app: app) } label: {
            HStack(spacing: 12) {
                TabGlyph(tab: tab, title: title)
                Text(title)
                    .fontWeight(tab.unread == true ? .semibold : .regular)
                    .foregroundStyle(Color(.label))
                    .lineLimit(2)
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
        .draggable(tab.ref) { TabDragPreview(tab: tab, title: title) }
        .dropDestination(for: String.self) { refs, _ in
            guard let ref = refs.first, ref != tab.ref else { return false }
            Task { await store.drop(ref, zone: tab.zone, folderId: tab.folderId, before: tab.ref) }
            return true
        }
        .swipeActions(edge: .trailing) {
            Button { Task { await store.archive(tab.ref) } } label: { Label("Archive", systemImage: "archivebox") }
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
            Button { Task { await store.move(tab.ref, to: .essential) } } label: { Label("Add to Essentials", systemImage: "star") }
            if !store.folders.isEmpty || tab.folderId != nil {
                Menu {
                    ForEach(store.folders.filter { $0.id != tab.folderId }) { folder in
                        Button(folder.name) { Task { await store.move(tab.ref, to: .pinned, folderId: folder.id) } }
                    }
                    if tab.folderId != nil {
                        Button { Task { await store.move(tab.ref, to: .pinned) } } label: { Label("Out of Folder", systemImage: "arrow.up") }
                    }
                } label: { Label("Move to Folder", systemImage: "folder") }
            }
            CopyLinkButton(tab: tab, title: title)
            Divider()
            Button { Task { await store.archive(tab.ref) } } label: { Label("Archive Tab", systemImage: "archivebox") }
        }
    }
}

private struct FolderRows: View {
    let store: TabsStore
    let folder: OfficeTabFolder
    @State private var renaming = false
    @State private var name = ""

    var body: some View {
        DisclosureGroup(isExpanded: Binding(get: { folder.open }, set: { open in Task { await store.setFolderOpen(folder.id, open) } })) {
            ForEach(store.pinned.filter { $0.folderId == folder.id }) { tab in TabRow(store: store, tab: tab) }
        } label: {
            Label(folder.name, systemImage: "folder").fontWeight(.medium)
                .frame(maxWidth: .infinity, alignment: .leading)
                .contentShape(Rectangle())
                .dropDestination(for: String.self) { refs, _ in
                    guard let ref = refs.first else { return false }
                    Task { await store.drop(ref, zone: .pinned, folderId: folder.id) }
                    return true
                }
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
    @Environment(\.dismissSearch) private var dismissSearch
    let store: TabsStore
    let query: String
    @State private var results: [OfficeTab] = []
    @State private var archived: [OfficeTab] = []
    @State private var failed: String?

    var body: some View {
        let trimmed = query.trimmingCharacters(in: .whitespaces)
        Section {
            Button {
                dismissSearch()
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
            dismissSearch()
            openTab(tab, app: app)
        } label: {
            HStack(spacing: 12) {
                TabGlyph(tab: tab, title: title)
                Text(title).foregroundStyle(Color(.label)).lineLimit(2)
                Spacer(minLength: 4)
                Text(detail(tab)).font(.caption).foregroundStyle(Color(.secondaryLabel))
            }
        }
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
