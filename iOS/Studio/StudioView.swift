import SwiftUI

/// Everything the Studio add-ons made, in one list: pages, Talk recordings and
/// dictations, drawings. Reads the Studio plugin when it's running and the
/// add-ons directly when it isn't.
@MainActor
final class StudioStore: ObservableObject {
    static let shared = StudioStore()
    static let addOns: Set<String> = ["studio", "pages", "talk", "excalidraw"]

    @Published private(set) var items: [StudioItem] = []
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
            self.items = items.filter { !$0.archived }.sorted { $0.updatedAt > $1.updatedAt }
            error = nil
            DiskCache.save(StudioSnapshot(items: self.items), as: StudioSnapshot.cacheKey)
        } catch where BBClient.isCancellation(error) {
        } catch {
            self.error = BBClient.describe(error, server: client.baseURL)
        }
        for project in await projects ?? [] { projectNames[project.id] = project.name }
        loaded = true
    }

    private func fetch(_ client: BBClient) async throws -> [StudioItem] {
        if plugins.contains("studio"), let items = try? await client.studioItems() {
            viaStudio = true
            return items
        }
        viaStudio = false
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

    /// Kinds in the order the filter shows them.
    var kinds: [StudioKind] {
        let present = Set(items.map(\.kind))
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
            if store.kinds.count > 1 {
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
            } else if visible.isEmpty, store.error == nil {
                ContentUnavailableView("Nothing here yet", systemImage: "square.stack",
                    description: Text(emptyText))
            }
        }
        .navigationTitle("Studio")
        .searchable(text: $query, prompt: "Search Studio")
        .toolbar { ToolbarItem(placement: .topBarTrailing) { projectMenu } }
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
            }
            .padding(.vertical, 2)
        }
        .scrollClipDisabled()
    }

    private func chip(_ title: String, _ symbol: String?, selected: Bool, action: @escaping () -> Void) -> some View {
        Button(action: action) {
            HStack(spacing: 5) {
                if let symbol { Image(systemName: symbol).font(.caption) }
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
        let content = StudioRow(item: item, project: project.isEmpty ? projectName(item) : nil)
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
        }
        .contextMenu {
            Button { UIPasteboard.general.string = item.displayTitle } label: { Label("Copy Title", systemImage: "doc.on.doc") }
            if canDelete(item) {
                Button(role: .destructive) { deleting = item } label: { Label("Delete", systemImage: "trash") }
            }
        }
    }

    private func route(_ item: StudioItem) -> Route? {
        switch item.pluginId {
        case "pages": .page(id: item.itemId)
        case "talk": .recording(id: item.itemId)
        case "excalidraw": .drawing(id: item.itemId)
        default: nil
        }
    }

    private func canDelete(_ item: StudioItem) -> Bool {
        store.viaStudio || ["pages", "talk", "excalidraw"].contains(item.pluginId)
    }

    private func projectName(_ item: StudioItem) -> String? {
        item.projectId.map { store.projectNames[$0] ?? "Project" }
    }

    private var visible: [StudioItem] {
        store.items.filter { item in
            if let kind = app.studioKind, item.kind != kind { return false }
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
        default: "Pages, recordings, dictations and drawings show up here."
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

    private func delete(_ item: StudioItem) async {
        do {
            try await store.delete(item, client: app.client)
        } catch {
            store.error = BBClient.describe(error, server: app.client.baseURL)
        }
    }
}

struct StudioRow: View {
    let item: StudioItem
    let project: String?

    var body: some View {
        let kind = StudioKind.of(item.kind)
        HStack(alignment: .top, spacing: 12) {
            Group {
                if let emoji = item.emoji {
                    Text(emoji).font(.title3)
                } else {
                    Image(systemName: kind.symbol).font(.body.weight(.medium)).foregroundStyle(kind.tint)
                }
            }
            .frame(width: 36, height: 36)
            .background(kind.tint.opacity(0.12), in: .rect(cornerRadius: 9))
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
