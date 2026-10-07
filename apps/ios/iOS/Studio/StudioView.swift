import SwiftUI

/// Everything the Studio add-ons made, in one list: pages, Talk recordings and
/// dictations, drawings, artifacts. Reads the Studio plugin when it's running
/// and the add-ons directly when it isn't.
@MainActor
final class StudioStore: ObservableObject {
    let serverURL = ServerScope.selectedURL
    static var shared = StudioStore()
    static let addOns: Set<String> = ["studio", "pages", "talk", "excalidraw", "artifacts", "studio-tables", "design"]

    /// Archived ones too; the list shows them on request.
    @Published private(set) var items: [StudioItem] = []
    /// What each add-on says its kinds can do, from the Studio plugin.
    @Published private(set) var kindInfo: [StudioKindInfo] = []
    /// Studio's tags, in name order.
    @Published private(set) var tags: [StudioTag] = []
    @Published private(set) var supportsTags = false
    /// Studio's spaces, in name order.
    @Published private(set) var spaces: [StudioSpace] = []
    @Published private(set) var supportsSpaces = false
    @Published private(set) var projectNames: [String: String] = [:]
    @Published private(set) var plugins: Set<String> = []
    /// Listed by the Studio plugin, which can also search content and delete anything.
    @Published private(set) var viaStudio = false
    @Published var error: String?
    @Published private(set) var loaded = false

    private var listener: UUID?
    private weak var realtime: BBRealtime?
    private var reloadTask: Task<Void, Never>?

    func attach(_ app: AppModel) {
        guard app.serverURL == serverURL else { return }
        let client = app.client
        guard realtime !== app.realtime else { return }
        if let listener { realtime?.removeListener(listener) }
        realtime = app.realtime
        listener = app.realtime.listen { [weak self] event in
            guard let self else { return }
            switch event {
            // Studio's open-tabs channel changes nothing listed here.
            case .pluginSignal("studio", "studio-tabs", _): break
            case .pluginSignal(let pluginId, _, _) where Self.addOns.contains(pluginId): scheduleReload(client)
            case .connected: scheduleReload(client)
            default: break
            }
        }
    }

    /// Pages signal on every save and Talk on every segment; coalesce them.
    private func scheduleReload(_ client: BBClient) {
        reloadTask?.cancel()
        reloadTask = Task {
            try? await Task.sleep(for: .seconds(1))
            guard !Task.isCancelled else { return }
            await load(client)
        }
    }

    func restore() {
        guard !loaded else { return }
        if let snapshot = DiskCache.load(StudioSnapshot.self, key: StudioSnapshot.cacheKey, serverURL: serverURL) {
            items = snapshot.items
            kindInfo = snapshot.kinds ?? []
            tags = snapshot.tags ?? []
            supportsTags = snapshot.tags != nil
            spaces = snapshot.spaces ?? []
            supportsSpaces = snapshot.spaces != nil
            loaded = true
        }
        if let inbox = DiskCache.load(InboxSnapshot.self, key: InboxSnapshot.cacheKey, serverURL: serverURL) {
            projectNames.merge(inbox.projectNames) { current, _ in current }
        }
        plugins = Set(UserDefaults.standard.string(forKey: ServerScope.key("runningPlugins", serverURL: serverURL))?.split(separator: ",").map(String.init) ?? [])
    }

    /// Loads overlap (pull to refresh, signals, a sheet closing); only the newest one may land.
    private var loadGeneration = 0

    func load(_ client: BBClient) async {
        guard client.baseURL == serverURL else { return }
        loadGeneration += 1
        let generation = loadGeneration
        async let projects = try? client.projects()
        if let running = try? await client.runningPlugins(), generation == loadGeneration {
            plugins = running
            UserDefaults.standard.set(running.sorted().joined(separator: ","), forKey: ServerScope.key("runningPlugins", serverURL: serverURL))
        }
        do {
            let listing = try await fetch(client)
            guard generation == loadGeneration else { return }
            viaStudio = listing.viaStudio
            kindInfo = listing.kinds
            tags = listing.tags ?? []
            supportsTags = listing.tags != nil
            spaces = Self.sorted(listing.spaces ?? [])
            supportsSpaces = listing.spaces != nil
            self.items = listing.items.sorted { $0.updatedAt > $1.updatedAt }
            Spotlight.indexStudio(self.items, serverURL: serverURL)
            error = nil
            DiskCache.save(
                StudioSnapshot(items: self.items, kinds: kindInfo, tags: supportsTags ? tags : nil, spaces: supportsSpaces ? spaces : nil),
                as: StudioSnapshot.cacheKey, serverURL: serverURL)
        } catch where BBClient.isCancellation(error) {
        } catch {
            guard generation == loadGeneration else { return }
            self.error = BBClient.describe(error, server: client.baseURL)
        }
        for project in await projects ?? [] { projectNames[project.id] = project.name }
        loaded = true
    }

    /// What one load found. Nil tags or spaces: the source doesn't have them.
    private struct Listing {
        var items: [StudioItem]
        var viaStudio = false
        var kinds: [StudioKindInfo] = []
        var tags: [StudioTag]?
        var spaces: [StudioSpace]?
    }

    private func fetch(_ client: BBClient) async throws -> Listing {
        if plugins.contains("studio") {
            do {
                let overview = try await client.studioOverview()
                return Listing(items: overview.items, viaStudio: true, kinds: overview.kinds, tags: overview.tags, spaces: overview.spaces)
            } catch where BBClient.isCancellation(error) {
                // A superseded reload: keep Studio's tags, Spaces and kinds rather than falling back.
                throw error
            } catch {
                // Studio failed; list the add-ons directly below.
            }
        }
        async let pages = Self.attempt(plugins.contains("pages")) { try await client.pages() }
        async let recordings = Self.attempt(plugins.contains("talk")) { try await client.recordings(limit: 200) }
        async let drawings = Self.attempt(plugins.contains("excalidraw")) { try await client.drawings() }
        let (p, r, d) = await (pages, recordings, drawings)
        let lists: [Result<[StudioItem], Error>] = [
            p.map { $0.map { $0.map(StudioItem.init(page:)) } },
            r.map { $0.map { $0.map(StudioItem.init(recording:)) } },
            d.map { $0.map { $0.map(StudioItem.init(drawing:)) } },
        ].compactMap { $0 }
        // One add-on failing shouldn't hide the others.
        let loaded = lists.compactMap { try? $0.get() }
        if loaded.isEmpty, case .failure(let error)? = lists.first { throw error }
        return Listing(items: loaded.flatMap { $0 })
    }

    private nonisolated static func attempt<T>(_ running: Bool, _ fetch: @Sendable () async throws -> T) async -> Result<T, Error>? {
        guard running else { return nil }
        do { return .success(try await fetch()) } catch { return .failure(error) }
    }

    /// Keys of items whose content matches, with the matching text when there is one.
    func search(_ query: String, client: BBClient) async -> [String: String] {
        if viaStudio { return (try? await client.studioSearch(query)) ?? [:] }
        guard plugins.contains("pages"), let pages = try? await client.searchPages(query) else { return [:] }
        return Dictionary(pages.map { ("pages:\($0.id)", "") }, uniquingKeysWith: { a, _ in a })
    }

    func delete(_ item: StudioItem, client: BBClient) async throws {
        if viaStudio {
            try await client.studioRemove(pluginId: item.pluginId, ids: [item.itemId])
        } else {
            switch item.pluginId {
            case "talk": try await client.deleteRecording(item.itemId)
            case "excalidraw": try await client.deleteDrawing(item.itemId)
            case "pages": try await client.deletePage(item.itemId)
            default: return
            }
        }
        removed(pluginId: item.pluginId, id: item.itemId)
    }

    func removed(pluginId: String, id: String) {
        items.removeAll { $0.pluginId == pluginId && $0.itemId == id }
    }

    func info(_ item: StudioItem) -> StudioKindInfo? {
        kindInfo.first { $0.pluginId == item.pluginId && $0.id == item.kind }
    }

    func archive(_ item: StudioItem, _ archived: Bool, client: BBClient) async throws {
        let results = try await client.studioArchive(pluginId: item.pluginId, ids: [item.itemId], archived: archived)
        if let failure = results.failed.first { throw BBError(status: 0, message: failure.error) }
        update(item) { $0.archived = archived }
    }

    func move(_ item: StudioItem, to projectId: String?, client: BBClient) async throws {
        let results = try await client.studioMove(pluginId: item.pluginId, ids: [item.itemId], projectId: projectId)
        if let failure = results.failed.first { throw BBError(status: 0, message: failure.error) }
        update(item) { $0.projectId = projectId }
    }

    /// Kinds Studio's New can make, like pages and drawings.
    var creatable: [StudioKindInfo] { kindInfo.filter { $0.createMode == "rpc" } }

    func create(_ kind: StudioKindInfo, projectId: String?, client: BBClient) async throws -> StudioItem {
        let item = try await client.studioCreate(pluginId: kind.pluginId, kind: kind.id, projectId: projectId)
        items.insert(item, at: 0)
        return item
    }

    /// Puts the tag on the item, or takes it off.
    func toggle(_ tag: StudioTag, on item: StudioItem, client: BBClient) async throws {
        let has = item.tags?.contains(tag.id) == true
        try await client.tagStudioItems([item], add: has ? [] : [tag.id], remove: has ? [tag.id] : [])
        update(item) { item in
            var ids = item.tags ?? []
            if has { ids.removeAll { $0 == tag.id } } else { ids.append(tag.id) }
            item.tags = ids
        }
    }

    /// Makes a tag (or finds the one with this name) and puts it on the item.
    func addTag(named name: String, to item: StudioItem, client: BBClient) async throws {
        let tag = try await client.createStudioTag(name)
        if !tags.contains(where: { $0.id == tag.id }) {
            tags.append(tag)
            tags.sort { $0.name.localizedCaseInsensitiveCompare($1.name) == .orderedAscending }
        }
        if item.tags?.contains(tag.id) != true { try await toggle(tag, on: item, client: client) }
    }

    // MARK: Many at once

    /// Runs `change` once per add-on, since Studio takes one add-on's ids at a
    /// time. Returns what couldn't be changed, as "title: why".
    private func perPlugin(
        _ items: [StudioItem], _ change: (String, [String]) async throws -> BBClient.StudioResults
    ) async -> (done: Set<String>, failures: [String]) {
        var done: Set<String> = []
        var failures: [String] = []
        for (pluginId, group) in Dictionary(grouping: items, by: \.pluginId) {
            do {
                let results = try await change(pluginId, group.map(\.itemId))
                done.formUnion(results.done.map { "\(pluginId):\($0)" })
                for failure in results.failed {
                    let title = group.first { $0.itemId == failure.id }?.displayTitle ?? failure.id
                    failures.append("\(title): \(failure.error)")
                }
            } catch {
                failures.append((error as? BBError)?.message ?? error.localizedDescription)
            }
        }
        return (done, failures)
    }

    func archive(_ items: [StudioItem], _ archived: Bool, client: BBClient) async -> [String] {
        let result = await perPlugin(items) { try await client.studioArchive(pluginId: $0, ids: $1, archived: archived) }
        for index in self.items.indices where result.done.contains(self.items[index].id) { self.items[index].archived = archived }
        return result.failures
    }

    func move(_ items: [StudioItem], to projectId: String?, client: BBClient) async -> [String] {
        let result = await perPlugin(items) { try await client.studioMove(pluginId: $0, ids: $1, projectId: projectId) }
        for index in self.items.indices where result.done.contains(self.items[index].id) { self.items[index].projectId = projectId }
        return result.failures
    }

    func delete(_ items: [StudioItem], client: BBClient) async -> [String] {
        let result = await perPlugin(items) { try await client.studioRemove(pluginId: $0, ids: $1) }
        self.items.removeAll { result.done.contains($0.id) }
        return result.failures
    }

    /// Puts the tag on all of them, or takes it off all of them when they all have it.
    func toggle(_ tag: StudioTag, on items: [StudioItem], client: BBClient) async throws {
        let all = items.allSatisfy { $0.tags?.contains(tag.id) == true }
        try await client.tagStudioItems(items, add: all ? [] : [tag.id], remove: all ? [tag.id] : [])
        let keys = Set(items.map(\.id))
        for index in self.items.indices where keys.contains(self.items[index].id) {
            var ids = self.items[index].tags ?? []
            ids.removeAll { $0 == tag.id }
            if !all { ids.append(tag.id) }
            self.items[index].tags = ids
        }
    }

    func renameTag(_ tag: StudioTag, to name: String, client: BBClient) async throws {
        let renamed = try await client.renameStudioTag(tag.id, name: name)
        tags = (tags.filter { $0.id != tag.id } + [renamed]).sorted { $0.name.localizedCaseInsensitiveCompare($1.name) == .orderedAscending }
    }

    func deleteTag(_ tag: StudioTag, client: BBClient) async throws {
        try await client.deleteStudioTag(tag.id)
        tags.removeAll { $0.id == tag.id }
        for index in items.indices { items[index].tags?.removeAll { $0 == tag.id } }
    }

    // MARK: Spaces

    func space(_ id: String) -> StudioSpace? { spaces.first { $0.id == id } }

    /// Puts a changed or new space in the list.
    func saved(_ space: StudioSpace) {
        spaces = Self.sorted(spaces.filter { $0.id != space.id } + [space])
    }

    func deleteSpace(_ space: StudioSpace, client: BBClient) async throws {
        try await client.deleteSpace(space.id)
        spaces.removeAll { $0.id == space.id }
        removed(pluginId: "studio", id: space.id)
        for index in items.indices { items[index].spaces?.removeAll { $0 == space.id } }
    }

    func reloadSpaces(_ client: BBClient) async {
        guard let spaces = try? await client.studioSpaces() else { return }
        self.spaces = Self.sorted(spaces)
        supportsSpaces = true
    }

    private static func sorted(_ spaces: [StudioSpace]) -> [StudioSpace] {
        spaces.sorted { $0.name.localizedCaseInsensitiveCompare($1.name) == .orderedAscending }
    }

    private func update(_ item: StudioItem, _ change: (inout StudioItem) -> Void) {
        guard let index = items.firstIndex(where: { $0.id == item.id }) else { return }
        change(&items[index])
    }

    /// Kinds in the order the filter shows them.
    var kinds: [StudioKind] {
        let present = Set(items.filter { !$0.archived }.map(\.kind))
        let known = StudioKind.known.filter { present.contains($0.id) }
        let others = present.subtracting(StudioKind.known.map(\.id)).sorted().map(StudioKind.other)
        return known + others
    }
}

struct StudioKind: Identifiable, Hashable {
    let id: String
    let label: String
    let plural: String
    let symbol: String
    let tint: Color

    static let known = [
        StudioKind(id: "page", label: "Page", plural: "Pages", symbol: "doc.richtext", tint: .blue),
        StudioKind(id: "recording", label: "Recording", plural: "Recordings", symbol: "waveform", tint: .red),
        StudioKind(id: "dictation", label: "Dictation", plural: "Dictations", symbol: "mic", tint: .orange),
        StudioKind(id: "drawing", label: "Drawing", plural: "Drawings", symbol: "scribble.variable", tint: .purple),
        StudioKind(id: "artifact", label: "Artifact", plural: "Artifacts", symbol: "doc.text.image", tint: .teal),
        StudioKind(id: "table", label: "Table", plural: "Tables", symbol: "tablecells", tint: .cyan),
        StudioKind(id: "design", label: "Design", plural: "Designs", symbol: "rectangle.on.rectangle.angled", tint: .pink),
        StudioKind(id: "space", label: "Space", plural: "Spaces", symbol: "square.stack.3d.up", tint: .mint),
    ]

    static func other(_ id: String) -> StudioKind {
        StudioKind(id: id, label: id.capitalized, plural: id.capitalized, symbol: "square.dashed", tint: .gray)
    }

    static func of(_ id: String) -> StudioKind { known.first { $0.id == id } ?? other(id) }
}

struct StudioView: View {
    @Environment(\.dynamicTypeSize) private var dynamicTypeSize
    @EnvironmentObject private var app: AppModel
    private let operation = ServerOperation()
    private var client: BBClient { operation.client }
    @ObservedObject private var store = StudioStore.shared
    @AppStorage(ServerScope.key("studioProject")) private var project = ""
    @State private var query = ""
    /// Content matches, keyed like items, with the matching text.
    @State private var contentMatches: [String: String] = [:]
    @State private var externalMatches: [Studio.SearchAllOutputItem] = []
    @State private var recordingKind: String?
    @State private var dictatingPage = false
    @State private var deleting: StudioItem?
    @State private var showArchived = false
    @State private var notice: String?
    @State private var tagFilter: String?
    @State private var tagging: StudioItem?
    @State private var newTag = ""
    @State private var editMode: EditMode = .inactive
    @State private var selection: Set<String> = []
    @State private var deletingSelected = false
    @State private var taggingSelected = false
    @State private var renamingTag: StudioTag?
    @State private var deletingTag: StudioTag?
    /// The space settings sheet: `.new` for a new space.
    @State private var spaceSheet: SpaceSheet?

    private var selecting: Bool { editMode.isEditing }
    private var selected: [StudioItem] { store.items.filter { selection.contains($0.id) } }

    var body: some View {
        studioPages
        .overlay {
            if !store.loaded { ProgressView() }
        }
        .overlay(alignment: .bottom) {
            if let notice {
                Text(notice)
                    .font(.subheadline.weight(.medium))
                    .padding(.horizontal, 14)
                    .padding(.vertical, 8)
                    .background(.regularMaterial, in: .capsule)
                    .padding(.bottom, 12)
                    .transition(.move(edge: .bottom).combined(with: .opacity))
            }
        }
        .animation(.snappy, value: notice)
        .safeAreaInset(edge: .bottom) {
            if selecting { selectionBar }
        }
        .environment(\.editMode, $editMode)
        .navigationTitle(selecting ? (selection.isEmpty ? "Select Items" : "\(selection.count) Selected") : showArchived ? "Archived" : "Studio")
        .navigationBarTitleDisplayMode(selecting ? .inline : .automatic)
        .searchable(text: $query, prompt: "Search Studio")
        // Keep Select reachable, so search results can be acted on together.
        .searchPresentationToolbarBehavior(.avoidHidingContent)
        .toolbar {
            if selecting {
                ToolbarItem(placement: .topBarLeading) {
                    let all = Set(visible.map(\.id))
                    Button(all.isSubset(of: selection) && !all.isEmpty ? "Deselect All" : "Select All") {
                        selection = all.isSubset(of: selection) ? [] : all
                    }
                }
                ToolbarItem(placement: .topBarTrailing) {
                    Button("Done") { endSelecting() }.fontWeight(.semibold)
                }
            } else {
                if !store.creatable.isEmpty || store.supportsSpaces {
                    ToolbarItem(placement: .topBarTrailing) { newMenu }
                }
                ToolbarItem(placement: .topBarTrailing) { projectMenu }
                if store.viaStudio, !visible.isEmpty {
                    ToolbarItem(placement: .topBarTrailing) {
                        Button("Select") { withAnimation { editMode = .active } }
                    }
                }
            }
        }
        .task(id: query) { await search() }
        .refreshable { await store.load(client) }
        .task(id: app.serverURL) {
            store.restore()
            store.attach(app)
            await store.load(client)
        }
        .sheet(item: $spaceSheet) { sheet in
            SpaceSettingsSheet(space: sheet.space) { saved in
                if let saved, sheet.space == nil { operation.complete(on: app) { app.studioSpace = saved.id } }
            }
        }
        .onChange(of: store.spaces) {
            if let id = app.studioSpace, store.loaded, store.supportsSpaces, store.space(id) == nil { app.studioSpace = nil }
        }
        .sheet(item: $recordingKind) { kind in
            DictationView(threadId: nil, autoStart: true, kind: kind)
                .onDisappear { Task { await store.load(client) } }
        }
        .sheet(isPresented: $dictatingPage) {
            DictationView(threadId: nil, autoStart: true, insertLabel: ("Create Page", "doc.richtext")) { text in
                Task { await createPage(text) }
            }
        }
        .alert("New Tag", isPresented: Binding(get: { tagging != nil }, set: { if !$0 { tagging = nil } })) {
            TextField("Name", text: $newTag)
            Button("Cancel", role: .cancel) { newTag = "" }
            Button("Add") {
                guard let item = tagging else { return }
                let name = newTag.trimmingCharacters(in: .whitespacesAndNewlines)
                newTag = ""
                guard !name.isEmpty else { return }
                Task { await addTag(name, to: item) }
            }
        } message: {
            Text("Tags work across every kind of Studio item.")
        }
        .alert("New Tag", isPresented: $taggingSelected) {
            TextField("Name", text: $newTag)
            Button("Cancel", role: .cancel) { newTag = "" }
            Button("Add") {
                let name = newTag.trimmingCharacters(in: .whitespacesAndNewlines)
                newTag = ""
                guard !name.isEmpty else { return }
                Task { await addTag(name, toSelected: selected) }
            }
        } message: {
            Text("Adds it to the \(selection.count) selected items.")
        }
        .alert("Rename Tag", isPresented: Binding(get: { renamingTag != nil }, set: { if !$0 { renamingTag = nil } })) {
            TextField("Name", text: $newTag)
            Button("Cancel", role: .cancel) { newTag = "" }
            Button("Rename") {
                guard let tag = renamingTag else { return }
                let name = newTag.trimmingCharacters(in: .whitespacesAndNewlines)
                newTag = ""
                guard !name.isEmpty, name != tag.name else { return }
                Task { await attempt { try await store.renameTag(tag, to: name, client: client) } }
            }
        }
        .confirmationDialog(
            "Delete the tag \u{201C}\(deletingTag?.name ?? "")\u{201D}?",
            isPresented: Binding(get: { deletingTag != nil }, set: { if !$0 { deletingTag = nil } }),
            titleVisibility: .visible
        ) {
            Button("Delete Tag", role: .destructive) {
                guard let tag = deletingTag else { return }
                if tagFilter == tag.id { tagFilter = nil }
                Task { await attempt { try await store.deleteTag(tag, client: client) } }
            }
        } message: {
            Text("It comes off every item. The items stay.")
        }
        .confirmationDialog(
            "Delete \(selection.count) items?", isPresented: $deletingSelected, titleVisibility: .visible
        ) {
            Button("Delete", role: .destructive) { Task { await bulk("Deleted") { await store.delete(selected, client: client) } } }
        } message: {
            Text(selected.contains { $0.kind == "page" } ? "Sub-pages of any pages go too. This can't be undone." : "This can't be undone.")
        }
        .confirmationDialog(
            "Delete \u{201C}\(deleting?.displayTitle ?? "")\u{201D}?",
            isPresented: Binding(get: { deleting != nil }, set: { if !$0 { deleting = nil } }),
            titleVisibility: .visible
        ) {
            Button("Delete", role: .destructive) {
                guard let item = deleting else { return }
                Task { await delete(item) }
            }
        } message: {
            Text(deleting?.kind == "page" ? "Its sub-pages go too. This can't be undone." : "This can't be undone.")
        }
    }

    // MARK: Pages

    /// Each kind is a page, All first, in the chips' order: a horizontal swipe
    /// moves between them, as By space does on Home. Search is one list.
    @ViewBuilder
    private var studioPages: some View {
        if query.isEmpty {
            TabView(selection: Binding(get: { app.studioKind ?? "" }, set: { app.studioKind = $0.isEmpty ? nil : $0 })) {
                ForEach(kindPages, id: \.self) { kind in
                    studioList(kind: kind.isEmpty ? nil : kind, chips: false)
                        .background(YieldsRowSwipesToPager())
                        .tag(kind)
                }
            }
            .tabViewStyle(.page(indexDisplayMode: .never))
            .safeAreaBar(edge: .top) {
                if showsFilter {
                    kindFilter
                        .contentMargins(.horizontal, 20, for: .scrollContent)
                        .padding(.vertical, 6)
                }
            }
            .sensoryFeedback(.selection, trigger: app.studioKind)
        } else {
            studioList(kind: app.studioKind, chips: true)
        }
    }

    /// "" is All; a kind chosen elsewhere keeps its page even with nothing in it.
    private var kindPages: [String] {
        let kinds = store.kinds.map(\.id)
        return [""] + kinds + (app.studioKind.map { kinds.contains($0) ? [] : [$0] } ?? [])
    }

    private var showsFilter: Bool {
        store.kinds.count > 1 || hasArchived || !usedTags.isEmpty || !store.spaces.isEmpty
    }

    private func studioList(kind: String?, chips: Bool) -> some View {
        let visible = visible(kind: kind)
        return List(selection: $selection) {
            if let error = store.error {
                Section { PagesErrorRow(message: error) { await store.load(client) } }
            }
            if !query.isEmpty, !externalMatches.isEmpty {
                Section("Threads") {
                    ForEach(Array(externalMatches.enumerated()), id: \.offset) { _, match in
                        if let id = match.ref?.id {
                            NavigationLink(value: Route.thread(id: id)) {
                                Label(match.title ?? "Thread", systemImage: Symbols.thread)
                            }
                        }
                    }
                }
            }
            if query.isEmpty, !selecting, !store.plugins.isDisjoint(with: ["talk", "pages"]) {
                Section { quickActions }
                    .listRowInsets(EdgeInsets())
                    .listRowBackground(Color.clear)
            }
            if chips, showsFilter {
                Section { kindFilter }
                    .listRowInsets(EdgeInsets())
                    .listRowBackground(Color.clear)
            }
            ForEach(sections(visible), id: \.title) { section in
                Section {
                    ForEach(section.items) { item in
                        row(item)
                    }
                } header: {
                    Text(section.title).foregroundStyle(Color.primary.opacity(0.75))
                }
            }
        }
        .listSectionSpacing(.compact)
        .overlay {
            if !store.loaded {
            } else if !query.isEmpty, visible.isEmpty, externalMatches.isEmpty {
                ContentUnavailableView.search(text: query)
            } else if visible.isEmpty, showArchived {
                ContentUnavailableView("Nothing archived", systemImage: "archivebox")
            } else if visible.isEmpty, store.error == nil {
                ContentUnavailableView("Nothing here yet", systemImage: "square.stack",
                    description: Text(emptyText(kind)))
            }
        }
    }

    // MARK: Header

    /// Capture first, file later: each tile opens straight into typing or recording.
    private var quickActions: some View {
        let count = store.plugins.contains("talk") || dynamicTypeSize.isAccessibilitySize ? 2 : 1
        return LazyVGrid(columns: Array(repeating: GridItem(.flexible(), spacing: 10), count: count), spacing: 10) {
            if store.plugins.contains("talk") {
                tile("Dictate", "mic.fill", .orange) { recordingKind = "dictation" } menu: {
                    if store.plugins.contains("pages") {
                        Button("Dictate a Page", systemImage: "doc.badge.plus") { dictatingPage = true }
                    }
                    Button("Record", systemImage: "record.circle") { recordingKind = "recording" }
                }
            }
            tile("Write", "square.and.pencil", .blue) { app.sheet = .write } menu: {
                ForEach(store.creatable, id: \.id) { kind in
                    Button("New \(kind.label)", systemImage: StudioKind.of(kind.id).symbol) {
                        Task { await create(kind) }
                    }
                }
            }
        }
        .padding(.vertical, 4)
    }

    private func tile(
        _ title: String, _ symbol: String, _ tint: Color, action: @escaping () -> Void,
        @ViewBuilder menu: () -> some View
    ) -> some View {
        Button(action: action) {
            VStack(spacing: 6) {
                Image(systemName: symbol).font(.title2).foregroundStyle(tint)
                Text(title).font(.footnote.weight(.medium)).foregroundStyle(.primary)
                    .fixedSize(horizontal: false, vertical: true)
            }
            .frame(maxWidth: .infinity, minHeight: 72)
            .background(Color(.secondarySystemGroupedBackground), in: .rect(cornerRadius: 14))
            .contentShape(.contextMenuPreview, .rect(cornerRadius: 14))
        }
        .buttonStyle(.plain)
        .contextMenu(menuItems: menu)
        .accessibilityIdentifier("studioAction")
    }

    private var kindFilter: some View {
        ScrollViewReader { proxy in
            ScrollView(.horizontal, showsIndicators: false) {
                HStack(spacing: 8) {
                    chip("All", nil, selected: app.studioKind == nil) { withAnimation { app.studioKind = nil } }
                        .id("")
                    ForEach(store.kinds) { kind in
                        chip(kind.plural, kind.symbol, selected: app.studioKind == kind.id) {
                            withAnimation { app.studioKind = app.studioKind == kind.id ? nil : kind.id }
                        }
                        .id(kind.id)
                    }
                    ForEach(store.spaces) { space in
                        chip(space.emoji.map { "\($0) \(space.name)" } ?? space.name, space.emoji == nil ? "square.stack.3d.up" : nil,
                            selected: app.studioSpace == space.id, tint: Color(hex: space.color)) {
                            app.studioSpace = app.studioSpace == space.id ? nil : space.id
                        }
                        .contextMenu {
                            Button { spaceSheet = SpaceSheet(space: space) } label: { Label("Space Settings…", systemImage: "gearshape") }
                        }
                    }
                    ForEach(usedTags) { tag in
                        chip(tag.name, "tag.fill", selected: tagFilter == tag.id, tint: Color(hex: tag.color)) {
                            tagFilter = tagFilter == tag.id ? nil : tag.id
                        }
                        .contextMenu {
                            Button {
                                newTag = tag.name
                                renamingTag = tag
                            } label: { Label("Rename Tag…", systemImage: "pencil") }
                            Button(role: .destructive) { deletingTag = tag } label: { Label("Delete Tag…", systemImage: "trash") }
                        }
                    }
                    if hasArchived {
                        chip("Archived", "archivebox", selected: showArchived) { showArchived.toggle() }
                    }
                }
                .padding(.vertical, 2)
            }
            .scrollClipDisabled()
            // A swipe to another kind brings its chip into view.
            .onChange(of: app.studioKind) { withAnimation { proxy.scrollTo(app.studioKind ?? "", anchor: .center) } }
        }
    }

    private func chip(_ title: String, _ symbol: String?, selected: Bool, tint: Color? = nil, action: @escaping () -> Void) -> some View {
        Button(action: action) {
            HStack(spacing: 5) {
                if let symbol { Image(systemName: symbol).font(.caption).foregroundStyle(selected ? .white : tint ?? .primary) }
                Text(title).font(.subheadline.weight(.medium))
            }
            .padding(.horizontal, 12)
            .padding(.vertical, 7)
            .foregroundStyle(selected ? Color.white : .primary)
            .background(selected ? AnyShapeStyle(Color.accentColor) : AnyShapeStyle(.background.secondary), in: .capsule)
        }
        .buttonStyle(.plain)
        .accessibilityAddTraits(selected ? .isSelected : [])
        .sensoryFeedback(.selection, trigger: selected)
    }

    private var newMenu: some View {
        Menu {
            ForEach(store.creatable, id: \.id) { kind in
                Button { Task { await create(kind) } } label: {
                    Label("New \(kind.label)", systemImage: StudioKind.of(kind.id).symbol)
                }
            }
            if store.supportsSpaces {
                Button { spaceSheet = SpaceSheet(space: nil) } label: {
                    Label("New Space…", systemImage: StudioKind.of("space").symbol)
                }
            }
        } label: {
            Image(systemName: "plus")
        }
        .accessibilityLabel("New")
    }

    /// Tags on at least one item, plus the one being filtered by.
    private var usedTags: [StudioTag] {
        let used = Set(store.items.flatMap { $0.tags ?? [] })
        return store.tags.filter { used.contains($0.id) || $0.id == tagFilter }
    }

    private var projectMenu: some View {
        Menu {
            Picker("Project", selection: $project) {
                Text("All Projects").tag("")
                Text("No Project").tag("none")
                ForEach(projects, id: \.id) { project in
                    Text(project.name).tag(project.id)
                }
            }
        } label: {
            Image(systemName: project.isEmpty ? "folder" : "folder.fill")
        }
        .accessibilityLabel("Project")
    }

    private var projects: [(id: String, name: String)] {
        Set(store.items.compactMap(\.projectId))
            .map { ($0, store.projectNames[$0] ?? "Project") }
            .sorted { $0.1.localizedStandardCompare($1.1) == .orderedAscending }
    }

    // MARK: List

    @ViewBuilder
    private func row(_ item: StudioItem) -> some View {
        let content = StudioRow(
            item: item, project: project.isEmpty ? projectName(item) : nil,
            tags: store.tags.filter { item.tags?.contains($0.id) == true },
            snippet: query.isEmpty ? nil : contentMatches[item.id].flatMap { $0.isEmpty ? nil : $0 },
            highlight: query.trimmingCharacters(in: .whitespaces))
        Group {
            if !selecting, let route = route(item) {
                NavigationLink(value: route) { content }
                    .accessibilityIdentifier("studioItem")
            } else {
                content
            }
        }
        .swipeActions(edge: .trailing) {
            if canDelete(item) {
                Button { deleting = item } label: { Label("Delete", systemImage: "trash") }
                    .tint(.red)
            }
            if store.info(item)?.canArchive == true {
                Button { Task { await archive(item) } } label: {
                    Label(item.archived ? "Restore" : "Archive", systemImage: item.archived ? "tray.and.arrow.up" : "archivebox")
                }
                .tint(.indigo)
            }
        }
        .contextMenu { menu(item) }
    }

    @ViewBuilder
    private func menu(_ item: StudioItem) -> some View {
        if let href = item.href {
            Button {
                operation.complete(on: app) { app.newThread(text: "[\(item.displayTitle.replacingOccurrences(of: "[", with: "").replacingOccurrences(of: "]", with: ""))](\(href)) ") }
            } label: { Label("New Thread with This", systemImage: "square.and.pencil") }
        }
        ForEach(store.info(item)?.actions ?? [], id: \.id) { action in
            Button { Task { await run(action, on: item) } } label: {
                Label(action.label.replacingOccurrences(of: "{count}", with: "1"), systemImage: action.result == "copy" ? "doc.on.doc" : "bolt")
            }
        }
        Button { UIPasteboard.general.string = item.displayTitle } label: { Label("Copy Title", systemImage: "textformat") }
        if store.viaStudio {
            Section {
                if store.supportsTags {
                    Menu {
                        ForEach(store.tags) { tag in
                            Button { Task { await toggle(tag, on: item) } } label: {
                                if item.tags?.contains(tag.id) == true { Label(tag.name, systemImage: "checkmark") } else { Text(tag.name) }
                            }
                        }
                        Button { tagging = item } label: { Label("New Tag…", systemImage: "plus") }
                    } label: { Label("Tags", systemImage: "tag") }
                }
                Menu {
                    ForEach(moveChoices, id: \.id) { choice in
                        Button { Task { await move(item, to: choice.id) } } label: {
                            if choice.id == item.projectId { Label(choice.name, systemImage: "checkmark") } else { Text(choice.name) }
                        }
                    }
                } label: { Label("Move to Project", systemImage: "folder") }
                if store.spaces.count > 1 {
                    Menu {
                        ForEach(store.spaces) { space in
                            Button { Task { await move(item, toSpace: space) } } label: {
                                if item.spaces?.contains(space.id) == true { Label(space.label, systemImage: "checkmark") } else { Text(space.label) }
                            }
                            .disabled(item.spaces?.contains(space.id) == true)
                        }
                    } label: { Label("Move to Space", systemImage: "square.stack.3d.up") }
                }
                if store.info(item)?.canArchive == true {
                    Button { Task { await archive(item) } } label: {
                        Label(item.archived ? "Restore from Archive" : "Archive", systemImage: item.archived ? "tray.and.arrow.up" : "archivebox")
                    }
                }
            }
        }
        if canDelete(item) {
            Button(role: .destructive) { deleting = item } label: { Label("Delete", systemImage: "trash") }
        }
    }

    private func route(_ item: StudioItem) -> Route? {
        switch item.pluginId {
        case "pages": .page(id: item.itemId)
        case "talk": .recording(id: item.itemId)
        case "excalidraw": .drawing(id: item.itemId)
        case "artifacts": .artifact(id: item.itemId)
        case "studio-tables": .table(id: item.itemId)
        case "design": .design(id: item.itemId)
        default: item.href.flatMap(Route.init(href:))
        }
    }

    /// Every project the phone knows, for Move.
    private var moveChoices: [(id: String?, name: String)] {
        [(nil, "No Project")] + store.projectNames
            .sorted { $0.value.localizedStandardCompare($1.value) == .orderedAscending }
            .map { ($0.key, $0.value) }
    }

    private var hasArchived: Bool { showArchived || store.items.contains(where: \.archived) }

    private func canDelete(_ item: StudioItem) -> Bool {
        store.viaStudio || ["pages", "talk", "excalidraw"].contains(item.pluginId)
    }

    private func projectName(_ item: StudioItem) -> String? {
        item.projectId.map { store.projectNames[$0] ?? "Project" }
    }

    /// The items on the page shown.
    private var visible: [StudioItem] { visible(kind: app.studioKind) }

    private func visible(kind: String?) -> [StudioItem] {
        store.items.filter { item in
            if item.archived != showArchived { return false }
            if let kind, item.kind != kind { return false }
            if kind == nil, query.isEmpty, store.info(item)?.background == true { return false }
            if let tagFilter, item.tags?.contains(tagFilter) != true { return false }
            if let space = app.studioSpace, item.spaces?.contains(space) != true { return false }
            switch project {
            case "": break
            case "none": if item.projectId != nil { return false }
            default: if item.projectId != project { return false }
            }
            guard !query.isEmpty else { return true }
            return contentMatches[item.id] != nil
                || item.title.localizedCaseInsensitiveContains(query)
                || (item.preview?.localizedCaseInsensitiveContains(query) ?? false)
        }
    }

    private struct DaySection {
        let title: String
        let items: [StudioItem]
    }

    /// Today, Yesterday, Previous 7 Days, then by month.
    private func sections(_ visible: [StudioItem]) -> [DaySection] {
        let calendar = Calendar.current
        let now = Date.now
        func title(_ item: StudioItem) -> String {
            let date = Date(timeIntervalSince1970: item.updatedAt / 1000)
            if calendar.isDateInToday(date) { return "Today" }
            if calendar.isDateInYesterday(date) { return "Yesterday" }
            if let week = calendar.date(byAdding: .day, value: -7, to: now), date > week { return "Previous 7 Days" }
            return date.formatted(calendar.isDate(date, equalTo: now, toGranularity: .year) ? .dateTime.month(.wide) : .dateTime.month(.wide).year())
        }
        var result: [DaySection] = []
        for item in visible {
            let key = title(item)
            if result.last?.title == key {
                result[result.count - 1] = DaySection(title: key, items: result[result.count - 1].items + [item])
            } else {
                result.append(DaySection(title: key, items: [item]))
            }
        }
        return result
    }

    private func emptyText(_ kind: String?) -> String {
        if let space = app.studioSpace.flatMap(store.space) {
            return "Nothing in \(space.name) yet. Make one with New, or move items here from their menus."
        }
        return switch kind {
        case "page": "Pages you and your agents write show up here."
        case "recording", "dictation": "Dictate or record, and Talk keeps the audio and transcript here."
        case "drawing": "Ask an agent to sketch something, or draw in BB web."
        case "artifact": "Files agents save from threads, and ones you save from a reply, show up here."
        case "design": "Ask an agent to design a screen, and its rounds of options show up here."
        case "space": "Spaces gather threads and Studio items. Make one with New."
        default: "Pages, recordings, dictations, drawings and artifacts show up here."
        }
    }

    // MARK: Actions

    private func search() async {
        let trimmed = query.trimmingCharacters(in: .whitespaces)
        guard trimmed.count >= 2 else {
            contentMatches = [:]
            externalMatches = []
            return
        }
        try? await Task.sleep(for: .milliseconds(300))
        guard !Task.isCancelled else { return }
        if let results = try? await client.studioSearchAll(trimmed) {
            if !Task.isCancelled {
                externalMatches = results.filter { $0.kind == "thread" }
                contentMatches = Dictionary(results.compactMap { result in
                    guard let ref = result.ref, let pluginId = ref.pluginId, let id = ref.id else { return nil }
                    return ("\(pluginId):\(id)", result.snippet?.text ?? "")
                }, uniquingKeysWith: { first, _ in first })
            }
        } else {
            let matches = await store.search(trimmed, client: client)
            if !Task.isCancelled { contentMatches = matches; externalMatches = [] }
        }
    }

    private func createPage(_ text: String) async {
        do {
            let page = try await client.createPage(title: PageTitle.from(text), markdown: text)
            operation.complete(on: app) { app.studioPath.append(.page(id: page.id)) }
            await store.load(client)
        } catch {
            store.error = BBClient.describe(error, server: client.baseURL)
        }
    }

    private func create(_ kind: StudioKindInfo) async {
        let projectId = project.isEmpty || project == "none" ? nil : project
        // Filtered to a Space, a new item goes in its folder so it shows there.
        if projectId == nil, let space = app.studioSpace {
            do {
                let href = try await client.createInSpace(space, pluginId: kind.pluginId, kind: kind.id)
                if let route = Route(href: href) { operation.complete(on: app) { app.studioPath.append(route) } }
                await store.load(client)
            } catch {
                flash(BBClient.describe(error, server: client.baseURL))
            }
            return
        }
        do {
            let item = try await store.create(kind, projectId: projectId, client: client)
            if let route = route(item) { operation.complete(on: app) { app.studioPath.append(route) } }
        } catch {
            flash(BBClient.describe(error, server: client.baseURL))
        }
    }

    private func move(_ item: StudioItem, toSpace space: StudioSpace) async {
        do {
            try await client.moveItems([(pluginId: item.pluginId, id: item.itemId)], toSpace: space.id)
            flash("Moved to \(space.name)")
            await store.load(client)
        } catch {
            flash(BBClient.describe(error, server: client.baseURL))
        }
    }

    private func toggle(_ tag: StudioTag, on item: StudioItem) async {
        do {
            try await store.toggle(tag, on: item, client: client)
        } catch {
            flash(BBClient.describe(error, server: client.baseURL))
        }
    }

    private func addTag(_ name: String, to item: StudioItem) async {
        do {
            try await store.addTag(named: name, to: item, client: client)
            flash("Tagged \(name)")
        } catch {
            flash(BBClient.describe(error, server: client.baseURL))
        }
    }

    private func delete(_ item: StudioItem) async {
        do {
            try await store.delete(item, client: client)
        } catch {
            store.error = BBClient.describe(error, server: client.baseURL)
        }
    }

    private func archive(_ item: StudioItem) async {
        do {
            try await store.archive(item, !item.archived, client: client)
            flash(item.archived ? "Restored" : "Archived")
        } catch {
            flash(BBClient.describe(error, server: client.baseURL))
        }
    }

    private func move(_ item: StudioItem, to projectId: String?) async {
        guard projectId != item.projectId else { return }
        do {
            try await store.move(item, to: projectId, client: client)
            flash(projectId.flatMap { store.projectNames[$0] }.map { "Moved to \($0)" } ?? "Moved out of its project")
        } catch {
            flash(BBClient.describe(error, server: client.baseURL))
        }
    }

    /// An add-on's own action, like Copy Transcript: copies what it returns, or says what it did.
    private func run(_ action: StudioKindInfo.Action, on item: StudioItem) async {
        do {
            let result = try await client.studioAction(pluginId: item.pluginId, action: action.id, ids: [item.itemId])
            if action.result == "copy" {
                guard let text = result.text, !text.isEmpty else {
                    flash(result.message ?? "Nothing to copy")
                    return
                }
                UIPasteboard.general.string = text
                flash(result.message ?? "Copied")
            } else {
                flash(result.message ?? "Done")
            }
        } catch {
            flash(BBClient.describe(error, server: client.baseURL))
        }
    }

    // MARK: Selection

    private var selectionBar: some View {
        let items = selected
        let archivable = !items.isEmpty && items.allSatisfy { store.info($0)?.canArchive == true }
        let restoring = !items.isEmpty && items.allSatisfy(\.archived)
        // Add-on actions work when everything picked is the same kind.
        let kinds = Set(items.map { "\($0.pluginId):\($0.kind)" })
        let actions = kinds.count == 1 ? store.info(items[0])?.actions ?? [] : []
        return HStack(spacing: 0) {
            if archivable {
                barButton(restoring ? "Restore" : "Archive", restoring ? "tray.and.arrow.up" : "archivebox") {
                    Task { await bulk(restoring ? "Restored" : "Archived") { await store.archive(items, !restoring, client: client) } }
                }
            }
            Menu {
                ForEach(moveChoices, id: \.id) { choice in
                    Button(choice.name) {
                        Task {
                            await bulk(choice.id.flatMap { store.projectNames[$0] }.map { "Moved to \($0)" } ?? "Moved out of projects") {
                                await store.move(items, to: choice.id, client: client)
                            }
                        }
                    }
                }
            } label: { barLabel("Move", "folder") }
            if store.supportsTags {
                Menu {
                    ForEach(store.tags) { tag in
                        Button { Task { await attempt { try await store.toggle(tag, on: items, client: client) } } } label: {
                            if items.allSatisfy({ $0.tags?.contains(tag.id) == true }) { Label(tag.name, systemImage: "checkmark") } else { Text(tag.name) }
                        }
                    }
                    Button { taggingSelected = true } label: { Label("New Tag…", systemImage: "plus") }
                } label: { barLabel("Tags", "tag") }
            }
            if !actions.isEmpty {
                Menu {
                    ForEach(actions, id: \.id) { action in
                        Button(action.label.replacingOccurrences(of: "{count}", with: "\(items.count)")) {
                            Task { await run(action, on: items) }
                        }
                    }
                } label: { barLabel("More", "ellipsis.circle") }
            }
            barButton("Delete", "trash", role: .destructive) { deletingSelected = true }
        }
        .disabled(items.isEmpty)
        .padding(.horizontal, 8)
        .padding(.vertical, 6)
        .glassEffect(in: .capsule)
        .padding(.horizontal)
        .padding(.bottom, 4)
        .accessibilityIdentifier("studioSelectionBar")
    }

    private func barLabel(_ title: String, _ symbol: String) -> some View {
        VStack(spacing: 3) {
            Image(systemName: symbol).font(.body)
            Text(title).font(.caption2)
        }
        .frame(maxWidth: .infinity, minHeight: 44)
        .contentShape(.rect)
    }

    private func barButton(_ title: String, _ symbol: String, role: ButtonRole? = nil, action: @escaping () -> Void) -> some View {
        Button(role: role, action: action) { barLabel(title, symbol) }
            .buttonStyle(.plain)
            .foregroundStyle(role == .destructive ? Color.red : .accentColor)
            .accessibilityLabel(title)
    }

    private func endSelecting() {
        withAnimation { editMode = .inactive }
        selection = []
    }

    /// A bulk change: says what happened, or what didn't work.
    private func bulk(_ done: String, _ change: () async -> [String]) async {
        let count = selection.count
        let failures = await change()
        if failures.isEmpty {
            flash("\(done) \(count) item\(count == 1 ? "" : "s")")
            endSelecting()
        } else {
            flash(failures.count == 1 ? failures[0] : "\(failures.count) couldn't be changed: \(failures[0])")
        }
    }

    private func attempt(_ change: () async throws -> Void) async {
        do { try await change() } catch { flash(BBClient.describe(error, server: client.baseURL)) }
    }

    private func addTag(_ name: String, toSelected items: [StudioItem]) async {
        await attempt {
            let tag = try await client.createStudioTag(name)
            await store.load(client)
            let fresh = store.items.filter { item in items.contains { $0.id == item.id } }
            if !fresh.allSatisfy({ $0.tags?.contains(tag.id) == true }) {
                try await store.toggle(tag, on: fresh, client: client)
            }
            flash("Tagged \(name)")
        }
    }

    private func run(_ action: StudioKindInfo.Action, on items: [StudioItem]) async {
        guard let pluginId = items.first?.pluginId else { return }
        do {
            let result = try await client.studioAction(pluginId: pluginId, action: action.id, ids: items.map(\.itemId))
            if action.result == "copy", let text = result.text, !text.isEmpty {
                UIPasteboard.general.string = text
                flash(result.message ?? "Copied")
            } else {
                flash(result.message ?? "Done")
            }
            endSelecting()
        } catch {
            flash(BBClient.describe(error, server: client.baseURL))
        }
    }

    private func flash(_ message: String) {
        notice = message
        Task {
            try? await Task.sleep(for: .seconds(2.5))
            if notice == message { notice = nil }
        }
    }
}

struct StudioRow: View {
    @Environment(\.dynamicTypeSize) private var dynamicTypeSize
    let item: StudioItem
    let project: String?
    var tags: [StudioTag] = []
    /// Content that matched a search, shown in place of the preview.
    var snippet: String?
    var highlight = ""

    var body: some View {
        let kind = StudioKind.of(item.kind)
        HStack(alignment: .top, spacing: 12) {
            Group {
                if let path = item.thumbnailUrl {
                    StudioThumbnail(item: item, path: path, kind: kind)
                } else if let emoji = item.emoji {
                    Text(emoji).font(.title3)
                } else {
                    Image(systemName: kind.symbol).font(.body.weight(.medium)).foregroundStyle(kind.tint)
                }
            }
            .frame(width: item.thumbnailUrl == nil ? 36 : 52, height: item.thumbnailUrl == nil ? 36 : 52)
            .background(kind.tint.opacity(0.12), in: .rect(cornerRadius: 9))
            .clipShape(.rect(cornerRadius: 9))
            VStack(alignment: .leading, spacing: 3) {
                (dynamicTypeSize.isAccessibilitySize
                    ? AnyLayout(VStackLayout(alignment: .leading, spacing: 3))
                    : AnyLayout(HStackLayout(alignment: .firstTextBaseline))) {
                    Text(item.displayTitle)
                        .fontWeight(.medium)
                        .foregroundStyle(item.title.isEmpty ? .secondary : .primary)
                        .lineLimit(dynamicTypeSize.isAccessibilitySize ? nil : 2)
                    if !dynamicTypeSize.isAccessibilitySize { Spacer(minLength: 4) }
                    Text(Date(timeIntervalSince1970: item.updatedAt / 1000), format: .relative(presentation: .named, unitsStyle: .abbreviated))
                        .font(.caption)
                        .foregroundStyle(Color.primary.opacity(0.75))
                        .lineLimit(dynamicTypeSize.isAccessibilitySize ? nil : 1)
                        .fixedSize(horizontal: false, vertical: true)
                }
                if let snippet {
                    Text(Self.highlighted(snippet, highlight)).font(.subheadline).foregroundStyle(Color.primary.opacity(0.75)).lineLimit(3)
                        .accessibilityIdentifier("studioSnippet")
                } else if let preview = item.preview, !preview.isEmpty {
                    Text(preview).font(.subheadline).foregroundStyle(Color.primary.opacity(0.75)).lineLimit(dynamicTypeSize.isAccessibilitySize ? nil : 2)
                }
                (dynamicTypeSize.isAccessibilitySize
                    ? AnyLayout(VStackLayout(alignment: .leading, spacing: 4))
                    : AnyLayout(HStackLayout(spacing: 4))) {
                    // Empty facts, like a task with no due day, and ones the badge already says, are left out.
                    let facts = item.facts.map(\.display).filter { !$0.isEmpty && $0 != item.badge?.label }
                    Text(([kind.label] + [project].compactMap { $0 } + facts).joined(separator: " · "))
                        .lineLimit(dynamicTypeSize.isAccessibilitySize ? nil : 1)
                        .fixedSize(horizontal: false, vertical: true)
                    if let badge = item.badge {
                        Text(badge.label)
                            .font(.caption2.weight(.semibold))
                            .padding(.horizontal, 6)
                            .padding(.vertical, 1)
                            .foregroundStyle(tone(badge.tone))
                            .background(tone(badge.tone).opacity(0.15), in: .capsule)
                    }
                    ForEach(tags) { tag in
                        Text(tag.name)
                            .font(.caption2.weight(.medium))
                            .padding(.horizontal, 6)
                            .padding(.vertical, 1)
                            .foregroundStyle(Color(hex: tag.color))
                            .background(Color(hex: tag.color).opacity(0.15), in: .capsule)
                            .lineLimit(dynamicTypeSize.isAccessibilitySize ? nil : 1)
                        .fixedSize(horizontal: false, vertical: true)
                    }
                }
                .font(.caption)
                .foregroundStyle(Color.primary.opacity(0.75))
            }
        }
        .padding(.vertical, 2)
        .accessibilityElement(children: .combine)
    }

    /// The snippet with each match of the search in bold.
    static func highlighted(_ text: String, _ query: String) -> AttributedString {
        var result = AttributedString(text.trimmingCharacters(in: .whitespacesAndNewlines))
        guard !query.isEmpty else { return result }
        var searchRange = result.startIndex..<result.endIndex
        while let found = result[searchRange].range(of: query, options: [.caseInsensitive, .diacriticInsensitive]) {
            result[found].font = .subheadline.weight(.semibold)
            result[found].foregroundColor = .primary
            searchRange = found.upperBound..<result.endIndex
        }
        return result
    }

    private func tone(_ tone: String) -> Color {
        switch tone {
        case "live": .red
        case "progress": .blue
        case "warning": .orange
        case "danger": .red
        case "success": .green
        default: .secondary
        }
    }
}

/// A drawing or image artifact's picture. Drawings come as SVG, which UIKit
/// can't show, so they're drawn from the scene instead and kept per revision.
struct StudioThumbnail: View {
    @EnvironmentObject private var app: AppModel
    private let operation = ServerOperation()
    private var client: BBClient { operation.client }
    let item: StudioItem
    let path: String
    let kind: StudioKind
    @State private var drawn: UIImage?

    @MainActor private static let drawings = NSCache<NSString, UIImage>()

    private let serverURL = ServerScope.selectedURL
    private var key: NSString { ServerScope.key("\(item.itemId):\(item.updatedAt)", serverURL: serverURL) as NSString }

    var body: some View {
        if item.pluginId == "excalidraw" {
            Group {
                if let image = drawn ?? Self.drawings.object(forKey: key) {
                    Image(uiImage: image).resizable().scaledToFill()
                } else {
                    Image(systemName: kind.symbol).font(.body.weight(.medium)).foregroundStyle(kind.tint)
                }
            }
            .task(id: key) { await draw() }
        } else {
            AsyncImage(url: URL(string: path, relativeTo: client.baseURL)) { image in
                image.resizable().scaledToFill()
            } placeholder: {
                Image(systemName: kind.symbol).font(.body.weight(.medium)).foregroundStyle(kind.tint)
            }
        }
    }

    private func draw() async {
        guard Self.drawings.object(forKey: key) == nil,
            let drawing = try? await client.drawing(item.itemId), !drawing.scene.elements.isEmpty
        else { return }
        let renderer = ImageRenderer(content: ExcalidrawCanvas(scene: drawing.scene)
            .frame(width: 160, height: 160)
            .background(.white)
            .environment(\.colorScheme, .light))
        renderer.scale = 2
        guard let image = renderer.uiImage else { return }
        Self.drawings.setObject(image, forKey: key)
        drawn = image
    }
}

extension Color {
    /// `#rrggbb`, or gray when it isn't one.
    init(hex: String) {
        let digits = hex.hasPrefix("#") ? String(hex.dropFirst()) : hex
        guard digits.count == 6, let value = UInt32(digits, radix: 16) else {
            self = .gray
            return
        }
        self.init(
            red: Double(value >> 16 & 0xFF) / 255, green: Double(value >> 8 & 0xFF) / 255, blue: Double(value & 0xFF) / 255)
    }
}
