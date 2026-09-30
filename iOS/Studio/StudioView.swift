import SwiftUI

/// Everything the Studio add-ons made, in one list: pages, Talk recordings and
/// dictations, drawings, artifacts. Reads the Studio plugin when it's running
/// and the add-ons directly when it isn't.
@MainActor
final class StudioStore: ObservableObject {
    static let shared = StudioStore()
    static let addOns: Set<String> = ["studio", "pages", "talk", "excalidraw", "artifacts"]

    /// Archived ones too; the list shows them on request.
    @Published private(set) var items: [StudioItem] = []
    /// What each add-on says its kinds can do, from the Studio plugin.
    @Published private(set) var kindInfo: [StudioKindInfo] = []
    /// Studio's tags, in name order.
    @Published private(set) var tags: [StudioTag] = []
    @Published private(set) var supportsTags = false
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
        guard realtime !== app.realtime else { return }
        if let listener { realtime?.removeListener(listener) }
        realtime = app.realtime
        listener = app.realtime.listen { [weak self] event in
            guard let self else { return }
            switch event {
            // Studio's open-tabs channel changes nothing listed here.
            case .pluginSignal("studio", "studio-tabs", _): break
            case .pluginSignal(let pluginId, _, _) where Self.addOns.contains(pluginId): scheduleReload(app.client)
            case .connected: scheduleReload(app.client)
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
        if let snapshot = DiskCache.load(StudioSnapshot.self, key: StudioSnapshot.cacheKey) {
            items = snapshot.items
            kindInfo = snapshot.kinds ?? []
            tags = snapshot.tags ?? []
            supportsTags = snapshot.tags != nil
            loaded = true
        }
        if let inbox = DiskCache.load(InboxSnapshot.self, key: InboxSnapshot.cacheKey) {
            projectNames.merge(inbox.projectNames) { current, _ in current }
        }
        plugins = Set(UserDefaults.standard.string(forKey: "runningPlugins")?.split(separator: ",").map(String.init) ?? [])
    }

    func load(_ client: BBClient) async {
        async let projects = try? client.projects()
        if let running = try? await client.runningPlugins() {
            plugins = running
            UserDefaults.standard.set(running.sorted().joined(separator: ","), forKey: "runningPlugins")
        }
        do {
            let items = try await fetch(client)
            self.items = items.sorted { $0.updatedAt > $1.updatedAt }
            error = nil
            DiskCache.save(StudioSnapshot(items: self.items, kinds: kindInfo, tags: supportsTags ? tags : nil), as: StudioSnapshot.cacheKey)
        } catch where BBClient.isCancellation(error) {
        } catch {
            self.error = BBClient.describe(error, server: client.baseURL)
        }
        for project in await projects ?? [] { projectNames[project.id] = project.name }
        loaded = true
    }

    private func fetch(_ client: BBClient) async throws -> [StudioItem] {
        if plugins.contains("studio"), let overview = try? await client.studioOverview() {
            viaStudio = true
            kindInfo = overview.kinds
            tags = overview.tags ?? []
            supportsTags = overview.tags != nil
            return overview.items
        }
        viaStudio = false
        kindInfo = []
        tags = []
        supportsTags = false
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
        return loaded.flatMap { $0 }
    }

    private nonisolated static func attempt<T>(_ running: Bool, _ fetch: @Sendable () async throws -> T) async -> Result<T, Error>? {
        guard running else { return nil }
        do { return .success(try await fetch()) } catch { return .failure(error) }
    }

    func search(_ query: String, client: BBClient) async -> Set<String> {
        if viaStudio { return (try? await client.studioSearch(query)) ?? [] }
        guard plugins.contains("pages"), let pages = try? await client.searchPages(query) else { return [] }
        return Set(pages.map { "pages:\($0.id)" })
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
    ]

    static func other(_ id: String) -> StudioKind {
        StudioKind(id: id, label: id.capitalized, plural: id.capitalized, symbol: "square.dashed", tint: .gray)
    }

    static func of(_ id: String) -> StudioKind { known.first { $0.id == id } ?? other(id) }
}

struct StudioView: View {
    @EnvironmentObject private var app: AppModel
    @ObservedObject private var store = StudioStore.shared
    @AppStorage("studioProject") private var project = ""
    @State private var query = ""
    @State private var contentMatches: Set<String> = []
    @State private var recordingKind: String?
    @State private var dictatingPage = false
    @State private var deleting: StudioItem?
    @State private var showArchived = false
    @State private var notice: String?
    @State private var tagFilter: String?
    @State private var tagging: StudioItem?
    @State private var newTag = ""

    var body: some View {
        List {
            if let error = store.error {
                Section { PagesErrorRow(message: error) { await store.load(app.client) } }
            }
            if query.isEmpty, store.plugins.contains("talk") {
                Section { quickActions }
                    .listRowInsets(EdgeInsets())
                    .listRowBackground(Color.clear)
            }
            if store.kinds.count > 1 || hasArchived || !usedTags.isEmpty {
                Section { kindFilter }
                    .listRowInsets(EdgeInsets())
                    .listRowBackground(Color.clear)
            }
            ForEach(sections, id: \.title) { section in
                Section(section.title) {
                    ForEach(section.items) { item in
                        row(item)
                    }
                }
            }
        }
        .listSectionSpacing(.compact)
        .overlay {
            if !store.loaded {
                ProgressView()
            } else if !query.isEmpty, visible.isEmpty {
                ContentUnavailableView.search(text: query)
            } else if visible.isEmpty, showArchived {
                ContentUnavailableView("Nothing archived", systemImage: "archivebox")
            } else if visible.isEmpty, store.error == nil {
                ContentUnavailableView("Nothing here yet", systemImage: "square.stack",
                    description: Text(emptyText))
            }
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
        .navigationTitle(showArchived ? "Archived" : "Studio")
        .searchable(text: $query, prompt: "Search Studio")
        .toolbar {
            if !store.creatable.isEmpty {
                ToolbarItem(placement: .topBarTrailing) { newMenu }
            }
            ToolbarItem(placement: .topBarTrailing) { projectMenu }
        }
        .task(id: query) { await search() }
        .refreshable { await store.load(app.client) }
        .task(id: app.serverURL) {
            store.restore()
            store.attach(app)
            await store.load(app.client)
        }
        .sheet(item: $recordingKind) { kind in
            DictationView(threadId: nil, autoStart: true, kind: kind)
                .onDisappear { Task { await store.load(app.client) } }
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
            Text("Tags work across pages, recordings, drawings and artifacts.")
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

    // MARK: Header

    private var quickActions: some View {
        HStack(spacing: 10) {
            tile("Dictate", "mic.fill", .orange) { recordingKind = "dictation" }
            tile("Record", "record.circle", .red) { recordingKind = "recording" }
            if store.plugins.contains("pages") {
                tile("Dictate Page", "doc.badge.plus", .blue) { dictatingPage = true }
            }
        }
        .padding(.vertical, 4)
    }

    private func tile(_ title: String, _ symbol: String, _ tint: Color, action: @escaping () -> Void) -> some View {
        Button(action: action) {
            VStack(spacing: 6) {
                Image(systemName: symbol).font(.title2).foregroundStyle(tint)
                Text(title).font(.footnote.weight(.medium)).foregroundStyle(.primary)
            }
            .frame(maxWidth: .infinity, minHeight: 72)
            .background(Color(.secondarySystemGroupedBackground), in: .rect(cornerRadius: 14))
        }
        .buttonStyle(.plain)
        .accessibilityIdentifier("studioAction")
    }

    private var kindFilter: some View {
        ScrollView(.horizontal, showsIndicators: false) {
            HStack(spacing: 8) {
                chip("All", nil, selected: app.studioKind == nil) { app.studioKind = nil }
                ForEach(store.kinds) { kind in
                    chip(kind.plural, kind.symbol, selected: app.studioKind == kind.id) {
                        app.studioKind = app.studioKind == kind.id ? nil : kind.id
                    }
                }
                ForEach(usedTags) { tag in
                    chip(tag.name, "tag.fill", selected: tagFilter == tag.id, tint: Color(hex: tag.color)) {
                        tagFilter = tagFilter == tag.id ? nil : tag.id
                    }
                }
                if hasArchived {
                    chip("Archived", "archivebox", selected: showArchived) { showArchived.toggle() }
                }
            }
            .padding(.vertical, 2)
        }
        .scrollClipDisabled()
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
            tags: store.tags.filter { item.tags?.contains($0.id) == true })
        Group {
            if let route = route(item) {
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
                app.newThread(text: "[\(item.displayTitle.replacingOccurrences(of: "[", with: "").replacingOccurrences(of: "]", with: ""))](\(href)) ")
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

    private var visible: [StudioItem] {
        store.items.filter { item in
            if item.archived != showArchived { return false }
            if let kind = app.studioKind, item.kind != kind { return false }
            if let tagFilter, item.tags?.contains(tagFilter) != true { return false }
            switch project {
            case "": break
            case "none": if item.projectId != nil { return false }
            default: if item.projectId != project { return false }
            }
            guard !query.isEmpty else { return true }
            return contentMatches.contains(item.id)
                || item.title.localizedCaseInsensitiveContains(query)
                || (item.preview?.localizedCaseInsensitiveContains(query) ?? false)
        }
    }

    private struct DaySection {
        let title: String
        let items: [StudioItem]
    }

    /// Today, Yesterday, Previous 7 Days, then by month.
    private var sections: [DaySection] {
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

    private var emptyText: String {
        switch app.studioKind {
        case "page": "Pages you and your agents write show up here."
        case "recording", "dictation": "Dictate or record, and Talk keeps the audio and transcript here."
        case "drawing": "Ask an agent to sketch something, or draw in BB web."
        case "artifact": "Files agents save from threads, and ones you save from a reply, show up here."
        default: "Pages, recordings, dictations, drawings and artifacts show up here."
        }
    }

    // MARK: Actions

    private func search() async {
        let trimmed = query.trimmingCharacters(in: .whitespaces)
        guard trimmed.count >= 2 else {
            contentMatches = []
            return
        }
        try? await Task.sleep(for: .milliseconds(300))
        guard !Task.isCancelled else { return }
        let matches = await store.search(trimmed, client: app.client)
        if !Task.isCancelled { contentMatches = matches }
    }

    private func createPage(_ text: String) async {
        do {
            let page = try await app.client.createPage(title: PageTitle.from(text), markdown: text)
            app.studioPath.append(.page(id: page.id))
            await store.load(app.client)
        } catch {
            store.error = BBClient.describe(error, server: app.client.baseURL)
        }
    }

    private func create(_ kind: StudioKindInfo) async {
        let projectId = project.isEmpty || project == "none" ? nil : project
        do {
            let item = try await store.create(kind, projectId: projectId, client: app.client)
            if let route = route(item) { app.studioPath.append(route) }
        } catch {
            flash(BBClient.describe(error, server: app.client.baseURL))
        }
    }

    private func toggle(_ tag: StudioTag, on item: StudioItem) async {
        do {
            try await store.toggle(tag, on: item, client: app.client)
        } catch {
            flash(BBClient.describe(error, server: app.client.baseURL))
        }
    }

    private func addTag(_ name: String, to item: StudioItem) async {
        do {
            try await store.addTag(named: name, to: item, client: app.client)
            flash("Tagged \(name)")
        } catch {
            flash(BBClient.describe(error, server: app.client.baseURL))
        }
    }

    private func delete(_ item: StudioItem) async {
        do {
            try await store.delete(item, client: app.client)
        } catch {
            store.error = BBClient.describe(error, server: app.client.baseURL)
        }
    }

    private func archive(_ item: StudioItem) async {
        do {
            try await store.archive(item, !item.archived, client: app.client)
            flash(item.archived ? "Restored" : "Archived")
        } catch {
            flash(BBClient.describe(error, server: app.client.baseURL))
        }
    }

    private func move(_ item: StudioItem, to projectId: String?) async {
        guard projectId != item.projectId else { return }
        do {
            try await store.move(item, to: projectId, client: app.client)
            flash(projectId.flatMap { store.projectNames[$0] }.map { "Moved to \($0)" } ?? "Moved out of its project")
        } catch {
            flash(BBClient.describe(error, server: app.client.baseURL))
        }
    }

    /// An add-on's own action, like Copy Transcript: copies what it returns, or says what it did.
    private func run(_ action: StudioKindInfo.Action, on item: StudioItem) async {
        do {
            let result = try await app.client.studioAction(pluginId: item.pluginId, action: action.id, ids: [item.itemId])
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
            flash(BBClient.describe(error, server: app.client.baseURL))
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
    let item: StudioItem
    let project: String?
    var tags: [StudioTag] = []

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
                HStack(alignment: .firstTextBaseline) {
                    Text(item.displayTitle)
                        .fontWeight(.medium)
                        .foregroundStyle(item.title.isEmpty ? .secondary : .primary)
                        .lineLimit(2)
                    Spacer(minLength: 4)
                    Text(Date(timeIntervalSince1970: item.updatedAt / 1000), format: .relative(presentation: .named, unitsStyle: .abbreviated))
                        .font(.caption)
                        .foregroundStyle(.secondary)
                        .lineLimit(1)
                }
                if let preview = item.preview, !preview.isEmpty {
                    Text(preview).font(.subheadline).foregroundStyle(.secondary).lineLimit(2)
                }
                HStack(spacing: 4) {
                    Text(([kind.label] + [project].compactMap { $0 } + item.facts.map(\.display)).joined(separator: " · "))
                        .lineLimit(1)
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
                            .lineLimit(1)
                    }
                }
                .font(.caption)
                .foregroundStyle(.tertiary)
            }
        }
        .padding(.vertical, 2)
        .accessibilityElement(children: .combine)
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
    let item: StudioItem
    let path: String
    let kind: StudioKind
    @State private var drawn: UIImage?

    @MainActor private static let drawings = NSCache<NSString, UIImage>()

    private var key: NSString { "\(item.itemId):\(item.updatedAt)" as NSString }

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
            AsyncImage(url: URL(string: path, relativeTo: app.client.baseURL)) { image in
                image.resizable().scaledToFill()
            } placeholder: {
                Image(systemName: kind.symbol).font(.body.weight(.medium)).foregroundStyle(kind.tint)
            }
        }
    }

    private func draw() async {
        guard Self.drawings.object(forKey: key) == nil,
            let drawing = try? await app.client.drawing(item.itemId), !drawing.scene.elements.isEmpty
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
