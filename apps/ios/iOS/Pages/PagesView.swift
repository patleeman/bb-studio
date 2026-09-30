import SwiftUI

/// The page tree, shared by the list and every open page. Read-only.
@MainActor
final class PagesStore: ObservableObject {
    static let shared = PagesStore()

    @Published private(set) var pages: [PageMeta] = []
    @Published private(set) var projectNames: [String: String] = [:]
    @Published var error: String?
    @Published private(set) var loaded = false
    /// Pages the server said were deleted since launch.
    @Published private(set) var deleted: Set<String> = []

    private var listener: UUID?
    private weak var realtime: BBRealtime?
    private var reloadTask: Task<Void, Never>?

    /// Listens for page changes on the app's current socket; once per socket.
    func attach(_ app: AppModel) {
        guard realtime !== app.realtime else { return }
        if let listener { realtime?.removeListener(listener) }
        realtime = app.realtime
        listener = app.realtime.listen { [weak self] event in
            guard let self else { return }
            switch event {
            case .pluginSignal(let pluginId, _, let payload) where pluginId == "pages":
                switch payload["type"]?.stringValue {
                case "deleted":
                    let ids = payload["pageIds"]?.arrayValue?.compactMap(\.stringValue) ?? []
                    deleted.formUnion(ids)
                    pages.removeAll { ids.contains($0.id) }
                    scheduleReload(app.client)
                case "tree", "page":
                    scheduleReload(app.client)
                default:
                    break
                }
            case .connected:
                scheduleReload(app.client)
            default:
                break
            }
        }
    }

    /// Edits signal on every save; coalesce them.
    private func scheduleReload(_ client: BBClient) {
        reloadTask?.cancel()
        reloadTask = Task {
            try? await Task.sleep(for: .milliseconds(800))
            guard !Task.isCancelled else { return }
            await load(client)
        }
    }

    func restore() {
        guard !loaded else { return }
        if let snapshot = DiskCache.load(PagesSnapshot.self, key: PagesSnapshot.cacheKey) {
            pages = snapshot.pages
            projectNames = snapshot.projectNames
            loaded = true
        }
        if let inbox = DiskCache.load(InboxSnapshot.self, key: InboxSnapshot.cacheKey) {
            projectNames.merge(inbox.projectNames) { current, _ in current }
        }
    }

    func load(_ client: BBClient) async {
        do {
            async let projects = try? client.projects()
            let pages = try await client.pages()
            for project in await projects ?? [] { projectNames[project.id] = project.name }
            self.pages = pages
            error = nil
            DiskCache.save(PagesSnapshot(pages: pages, projectNames: projectNames), as: PagesSnapshot.cacheKey)
        } catch where BBClient.isCancellation(error) {
        } catch {
            self.error = BBClient.describe(error, server: client.baseURL)
        }
        loaded = true
    }

    func page(_ id: String) -> PageMeta? { pages.first { $0.id == id } }

    func children(of id: String) -> [PageMeta] {
        pages.filter { $0.parentId == id }.sorted(by: Self.order)
    }

    static func order(_ a: PageMeta, _ b: PageMeta) -> Bool {
        (a.position ?? 0, a.createdAt ?? 0) < (b.position ?? 0, b.createdAt ?? 0)
    }

    struct Row: Identifiable {
        var page: PageMeta
        var depth: Int
        var id: String { page.id }
    }

    struct Group: Identifiable {
        var id: String
        var title: String
        var rows: [Row]
    }

    /// Global pages first, then one group per project by name; each a depth-first tree.
    var groups: [Group] {
        let byProject = Dictionary(grouping: pages) { $0.projectId ?? "" }
        let ids = Set(pages.map(\.id))
        let children = Dictionary(grouping: pages.filter { $0.parentId.map(ids.contains) ?? false }) { $0.parentId! }

        func rows(_ list: [PageMeta], depth: Int) -> [Row] {
            list.sorted(by: Self.order).flatMap { page in
                [Row(page: page, depth: depth)] + rows(children[page.id] ?? [], depth: depth + 1)
            }
        }

        return byProject.map { projectId, list in
            // A page whose parent is gone or elsewhere stands at the top.
            let roots = list.filter { $0.parentId.map { !ids.contains($0) } ?? true }
            return Group(
                id: projectId.isEmpty ? "global" : projectId,
                title: projectId.isEmpty ? "Global" : projectNames[projectId] ?? "Project",
                rows: rows(roots, depth: 0))
        }
        .sorted { a, b in
            if (a.id == "global") != (b.id == "global") { return a.id == "global" }
            return a.title.localizedStandardCompare(b.title) == .orderedAscending
        }
    }
}

struct PagesView: View {
    @EnvironmentObject private var app: AppModel
    @ObservedObject private var store = PagesStore.shared
    @State private var query = ""
    @State private var serverMatches: [PageMeta] = []
    @State private var collapsed: Set<String> = []

    var body: some View {
        List {
            if let error = store.error {
                Section { PagesErrorRow(message: error) { await store.load(app.client) } }
            }
            if query.isEmpty {
                ForEach(store.groups) { group in
                    Section(isExpanded: expanded(group.id)) {
                        ForEach(group.rows) { row in
                            NavigationLink(value: Route.page(id: row.page.id)) {
                                PageRow(page: row.page).padding(.leading, CGFloat(min(row.depth, 4)) * 18)
                            }
                        }
                    } header: {
                        Text(group.title)
                    }
                }
            } else if matches.isEmpty {
                ContentUnavailableView.search(text: query)
            } else {
                Section("Matches") {
                    ForEach(matches) { page in
                        NavigationLink(value: Route.page(id: page.id)) {
                            PageRow(page: page, project: projectName(page))
                        }
                    }
                }
            }
        }
        .listStyle(.sidebar)
        .overlay {
            if !store.loaded {
                ProgressView()
            } else if store.pages.isEmpty, store.error == nil, query.isEmpty {
                ContentUnavailableView(
                    "No pages", systemImage: "doc.richtext",
                    description: Text("Pages you and your agents write in BB show up here."))
            }
        }
        .navigationTitle("Pages")
        .searchable(text: $query, prompt: "Search pages")
        .task(id: query) { await search() }
        .refreshable { await store.load(app.client) }
        .task(id: app.serverURL) {
            store.restore()
            store.attach(app)
            await store.load(app.client)
        }
    }

    /// Title matches from the tree, then content matches from the server.
    private var matches: [PageMeta] {
        let titles = store.pages.filter { $0.displayTitle.localizedCaseInsensitiveContains(query) }
        let seen = Set(titles.map(\.id))
        return titles + serverMatches.filter { !seen.contains($0.id) && !store.deleted.contains($0.id) }
    }

    private func search() async {
        let trimmed = query.trimmingCharacters(in: .whitespaces)
        guard trimmed.count >= 2 else {
            serverMatches = []
            return
        }
        try? await Task.sleep(for: .milliseconds(300))
        guard !Task.isCancelled else { return }
        if let pages = try? await app.client.searchPages(trimmed), !Task.isCancelled { serverMatches = pages }
    }

    private func projectName(_ page: PageMeta) -> String {
        page.projectId.map { store.projectNames[$0] ?? "Project" } ?? "Global"
    }

    private func expanded(_ id: String) -> Binding<Bool> {
        Binding(
            get: { !collapsed.contains(id) },
            set: { open in
                if open { collapsed.remove(id) } else { collapsed.insert(id) }
            })
    }
}

struct PageRow: View {
    let page: PageMeta
    var project: String?

    var body: some View {
        HStack(spacing: 10) {
            Group {
                if let emoji = page.emoji {
                    Text(emoji)
                } else {
                    Image(systemName: "doc.text").foregroundStyle(.secondary)
                }
            }
            .frame(width: 24)
            VStack(alignment: .leading, spacing: 2) {
                Text(page.displayTitle)
                    .foregroundStyle(page.title?.isEmpty == false ? .primary : .secondary)
                    .lineLimit(2)
                HStack(spacing: 4) {
                    if let project {
                        Text(project)
                        Text("·")
                    }
                    if let updatedAt = page.updatedAt {
                        Text(
                            Date(timeIntervalSince1970: updatedAt / 1000),
                            format: .relative(presentation: .named, unitsStyle: .abbreviated))
                    }
                }
                .font(.caption)
                .foregroundStyle(.secondary)
                .lineLimit(1)
            }
        }
    }
}

/// Says why pages couldn't load, with a retry. The cached tree stays on screen.
struct PagesErrorRow: View {
    let message: String
    let retry: () async -> Void
    @State private var retrying = false

    var body: some View {
        HStack {
            Label(message, systemImage: "wifi.exclamationmark")
                .foregroundStyle(.orange)
                .font(.footnote.weight(.medium))
            Spacer()
            Button {
                retrying = true
                Task {
                    await retry()
                    retrying = false
                }
            } label: {
                if retrying { ProgressView() } else { Text("Retry") }
            }
            .buttonStyle(.bordered)
            .controlSize(.small)
        }
    }
}
