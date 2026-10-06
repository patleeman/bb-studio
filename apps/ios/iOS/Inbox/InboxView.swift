import SwiftUI

@MainActor
final class InboxModel: ObservableObject {
    let serverURL = ServerScope.selectedURL
    /// Top-level threads, for the widgets, Spotlight and the watch.
    @Published var threads: [ThreadEntry] = []
    @Published var children: [String: [ThreadEntry]] = [:]
    @Published var sidebar: SidebarBootstrap?
    @Published var preferences: SidebarPreferences?
    @Published var projectNames: [String: String] = [:]
    @Published var error: String?
    @Published var loaded = false

    // By space (Studio Sidebar's organization), from Studio.
    /// Studio's Spaces, in its order: the default (Personal) first.
    @Published var spaces: [StudioSpace] = []
    @Published var spaceOf: [String: String] = [:]
    @Published var leads: [String: SpaceLead] = [:]
    @Published var openItems: [String: [SpaceOpenItem]] = [:]
    /// Each shown thread's latest line, for its second row.
    @Published var lines: [String: ThreadLine] = [:]
    private var lastSpaceLoad = ContinuousClock.now - .seconds(60)
    private var lastLinesLoad = ContinuousClock.now - .seconds(60)
    private var lastLineIds: [String] = []

    private var listener: UUID?
    private var reloadTask: Task<Void, Never>?
    private var reloadDue: ContinuousClock.Instant?
    private var reloadPreferences = false
    private var lastReload = ContinuousClock.now - .seconds(60)
    private var savedSignature: Int?

    func attach(_ app: AppModel) {
        guard app.serverURL == serverURL else { return }
        let client = app.client
        if let listener { app.realtime.removeListener(listener) }
        listener = app.realtime.listen { [weak self] event in
            switch event {
            case .changed(let entity, _, let changes) where entity == "thread":
                // A running agent appends events several times a second, and nothing
                // in the list shows them; its status changes bring the fresh row.
                let streaming = !changes.isEmpty && changes.allSatisfy { $0 == "events-appended" }
                self?.scheduleReload(client, refreshPreferences: false, within: streaming ? .seconds(30) : .milliseconds(400))
            case .connected:
                self?.scheduleReload(client, refreshPreferences: true)
            default:
                break
            }
        }
    }

    /// Change signals arrive in bursts while agents run: coalesce them, and
    /// reload at most every few seconds, since each reload is a sidebar fetch.
    private func scheduleReload(_ client: BBClient, refreshPreferences: Bool, within delay: Duration = .milliseconds(400)) {
        reloadPreferences = reloadPreferences || refreshPreferences
        let due = max(ContinuousClock.now + delay, lastReload + .seconds(3))
        reloadDue = min(reloadDue ?? due, due)
        guard reloadTask == nil else { return }
        reloadTask = Task {
            while let due = reloadDue {
                let wait = due - ContinuousClock.now
                if wait > .zero {
                    // Short naps, so a sooner request cuts a long wait short.
                    try? await Task.sleep(for: min(wait, .milliseconds(500)))
                    continue
                }
                reloadDue = nil
                lastReload = .now
                let refreshPreferences = reloadPreferences
                reloadPreferences = false
                await load(client, refreshPreferences: refreshPreferences)
            }
            reloadTask = nil
        }
    }

    /// Shows the last inbox immediately; the network load replaces it.
    func restore() {
        guard !loaded, let snapshot = DiskCache.load(InboxSnapshot.self, key: InboxSnapshot.cacheKey, serverURL: serverURL) else { return }
        threads = snapshot.threads
        projectNames = snapshot.projectNames
        loaded = true
    }

    func load(_ client: BBClient, refreshPreferences: Bool = true) async {
        guard client.baseURL == serverURL else { return }
        do {
            async let sidebar = client.sidebar()
            // Every assignment re-renders the inbox, so only on change.
            if preferences == nil || refreshPreferences, let prefs = try? await client.sidebarPreferences(), prefs != preferences {
                preferences = prefs
            }
            let bootstrap = try await sidebar
            guard serverURL == ServerScope.selectedURL else { return }
            if !Self.same(bootstrap, self.sidebar) { self.sidebar = bootstrap }
            let projects = bootstrap.projects + [bootstrap.personalProject]
            let names = Dictionary(projects.map { ($0.id, $0.name) }, uniquingKeysWith: { a, _ in a })
            if names != projectNames { projectNames = names }
            let all = projects.flatMap(\.threads).filter { $0.visibility != "hidden" && $0.archivedAt == nil }
            let ids = Set(all.map(\.id))
            // A child whose parent is not listed stands on its own, as in the sidebar.
            let top = all.filter { $0.parentThreadId.map { !ids.contains($0) } ?? true }
            if top != threads { threads = top }
            let grouped = Dictionary(grouping: all.filter { $0.parentThreadId.map(ids.contains) ?? false }) { $0.parentThreadId! }
                .mapValues(Self.sidebarSorted)
            if grouped != children { children = grouped }
            for thread in all { ThreadTitles.set(thread.id, thread.displayTitle) }
            if preferences?.organizationMode == "space" { await loadSpaces(client, force: refreshPreferences) }
            // Titles that mention archived threads: fetch those names too.
            await ThreadTitles.fetchUnknown(in: all.map(\.displayTitle), client: client)
            guard serverURL == ServerScope.selectedURL else { return }
            Spotlight.index(self.threads, projectNames: projectNames, serverURL: serverURL)
            error = nil
            let snapshot = InboxSnapshot(threads: self.threads, projectNames: projectNames)
            let signature = Self.encoded(snapshot)?.hashValue
            if signature == nil || signature != savedSignature {
                DiskCache.save(snapshot, as: InboxSnapshot.cacheKey, serverURL: serverURL)
                savedSignature = signature
            }
            StatusWidgets.reloadIfChanged(self.threads)
            PhoneRelay.shared.pushStatus(self.threads)
        } catch where BBClient.isCancellation(error) {
        } catch {
            self.error = BBClient.describe(error, server: client.baseURL)
        }
        loaded = true
    }

    private static func encoded(_ value: some Encodable) -> Data? {
        let encoder = JSONEncoder()
        encoder.outputFormatting = .sortedKeys
        return try? encoder.encode(value)
    }

    private static func same<T: Encodable>(_ a: T, _ b: T?) -> Bool {
        guard let b, let data = encoded(a) else { return false }
        return data == encoded(b)
    }

    // MARK: By space

    /// Home follows the web sidebar's By space while Studio answers with Spaces.
    var spaceMode: Bool { preferences?.organizationMode == "space" && !spaces.isEmpty }
    /// Hidden threads are Studio Sidebar's; BB's own Thread List has none.
    var supportsHiding: Bool { preferences?.hiddenThreads != nil }
    var hidden: Set<String> { Set(preferences?.hiddenThreads ?? []) }
    /// Threads whose sub-threads are folded away, shared with the web sidebar.
    var collapsed: Set<String> { Set(preferences?.collapsedThreads ?? []) }

    /// Spaces, leads and open items change rarely and cost several calls: at
    /// most every 10 seconds unless asked (pull to refresh, reconnect, an action).
    func loadSpaces(_ client: BBClient, force: Bool = false) async {
        guard force || ContinuousClock.now - lastSpaceLoad > .seconds(10) else {
            await loadLines(client)
            return
        }
        lastSpaceLoad = .now
        do {
            async let listed = client.studioSpaces()
            async let of = client.spaceOfThreads()
            // Items are a nicety: without them the lists are just empty.
            async let items = try? client.spaceOpenItems()
            let spaces = try await listed
            let spaceOf = try await of
            var leads: [String: SpaceLead] = [:]
            await withTaskGroup(of: (String, SpaceLead?).self) { group in
                for space in spaces { group.addTask { (space.id, try? await client.spaceLead(space.id)) } }
                for await (id, lead) in group { if let lead { leads[id] = lead } }
            }
            let open = await items ?? openItems
            guard client.baseURL == ServerScope.selectedURL else { return }
            if spaces != self.spaces { self.spaces = spaces }
            if spaceOf != self.spaceOf { self.spaceOf = spaceOf }
            if leads != self.leads { self.leads = leads }
            if open != openItems { openItems = open }
        } catch where BBClient.isCancellation(error) {
        } catch {
            // Studio missing or busy: keep the last Spaces; without any, Home shows By project's fallback.
        }
        await loadLines(client)
    }

    /// The shown threads' latest lines: leads first, then by recency, at most 60.
    /// Studio caches them briefly, so asking again within 10 seconds waits unless the threads changed.
    func loadLines(_ client: BBClient, force: Bool = false) async {
        guard spaceMode else { return }
        let sections = spaceSections
        let leadIds = sections.compactMap(\.lead?.id)
        let rest = (sections.flatMap { $0.threads + $0.hidden } + threads.filter { $0.pinnedAt != nil })
            .sorted { Self.recency($0) > Self.recency($1) }
            .map(\.id)
        var ids: [String] = []
        for id in leadIds + rest where !ids.contains(id) { ids.append(id) }
        ids = Array(ids.prefix(60))
        guard force || ids != lastLineIds || ContinuousClock.now - lastLinesLoad > .seconds(10) else { return }
        lastLineIds = ids
        lastLinesLoad = .now
        guard let fetched = try? await client.threadLines(ids), client.baseURL == ServerScope.selectedURL else { return }
        var next = lines
        for id in ids { next[id] = fetched[id] }
        if next != lines { lines = next }
    }

    private static func recency(_ thread: ThreadEntry) -> Double { max(thread.updatedAt, thread.latestAttentionAt ?? 0) }

    /// One Space's part of Home: its open Studio items, lead, pinned and other threads.
    struct SpaceSection: Identifiable {
        var space: StudioSpace
        var lead: ThreadEntry?
        var leadInfo: SpaceLead?
        var open: [SpaceOpenItem]
        /// Pinned threads in the Space, in pin order, below the lead.
        var pinned: [ThreadEntry]
        /// Threads that wait on the user first, then in the sidebar's order.
        var threads: [ThreadEntry]
        /// Hidden threads, shown on request.
        var hidden: [ThreadEntry]
        var needsYou: Bool
        var id: String { space.id }
    }

    var assignment: SpaceAssignment { SpaceAssignment(spaces: spaces, spaceOf: spaceOf) }

    func spaceId(of thread: ThreadEntry) -> String? { assignment.spaceId(of: thread, among: [:]) }

    /// Every Space in Studio's order. As in the web sidebar, a pinned thread sits
    /// in its own Space under the lead, and a Space's lead always shows, hidden or not.
    var spaceSections: [SpaceSection] {
        let assignment = assignment
        let hidden = hidden
        var bySpace: [String: [ThreadEntry]] = [:]
        for thread in threads {
            guard let id = assignment.spaceId(of: thread, among: [:]) else { continue }
            bySpace[id, default: []].append(thread)
        }
        return spaces.map { space in
            let held = bySpace[space.id] ?? []
            let leadId = leads[space.id]?.threadId
            let others = held.filter { $0.id != leadId }
            let rest = Self.sidebarSorted(others.filter { $0.pinnedAt == nil })
            let needs = { (thread: ThreadEntry) in thread.hasPendingInteraction == true }
            return SpaceSection(
                space: space, lead: held.first { $0.id == leadId }, leadInfo: leads[space.id], open: openItems[space.id] ?? [],
                pinned: Self.pinOrder(others.filter { $0.pinnedAt != nil }),
                threads: waitingFirst(rest.filter { !hidden.contains($0.id) }),
                hidden: rest.filter { hidden.contains($0.id) },
                needsYou: held.contains(where: needs))
        }
    }

    /// The sidebar's pin order: by sort key, then the newest pin first.
    static func pinOrder(_ list: [ThreadEntry]) -> [ThreadEntry] {
        list.sorted { ($0.pinSortKey ?? "", $1.pinnedAt ?? 0) < ($1.pinSortKey ?? "", $0.pinnedAt ?? 0) }
    }

    /// Threads that wait on the user, or have a sub-thread that does, come first:
    /// questions, then unread failures, then unread results. Each tier keeps its order.
    func waitingFirst(_ list: [ThreadEntry]) -> [ThreadEntry] {
        func rank(_ thread: ThreadEntry, depth: Int = 0) -> Int {
            let own = SpaceThreadRow.state(of: thread).waitRank
            guard depth < 8 else { return own }
            return ([own] + (children[thread.id] ?? []).map { rank($0, depth: depth + 1) }).min() ?? own
        }
        return list.enumerated()
            .map { (index: $0.offset, rank: rank($0.element), thread: $0.element) }
            .sorted { $0.rank != $1.rank ? $0.rank < $1.rank : $0.index < $1.index }
            .map(\.thread)
    }

    /// The Space Home shows: the chosen one if it still exists, else the web sidebar's, else the default.
    func shownSpace(_ chosen: String?) -> String {
        let valid = { (id: String?) -> String? in
            guard let id else { return nil }
            return id == "all" || self.spaces.contains { $0.id == id } ? id : nil
        }
        return valid(chosen) ?? valid(preferences?.currentSpace) ?? assignment.defaultSpaceId ?? "all"
    }

    func moveThread(_ client: BBClient, _ thread: ThreadEntry, to space: StudioSpace) async {
        spaceOf[thread.id] = space.id
        actions += 1
        do {
            try await client.moveThreads([thread.id], toSpace: space.id)
        } catch where BBClient.isCancellation(error) {
        } catch {
            self.error = BBClient.describe(error, server: client.baseURL)
        }
        await loadSpaces(client, force: true)
    }

    func setLead(_ client: BBClient, space: String, thread: String?) async {
        leads[space, default: SpaceLead(threadId: nil)].threadId = thread
        actions += 1
        do {
            leads[space] = try await client.setSpaceLead(space, threadId: thread)
        } catch where BBClient.isCancellation(error) {
        } catch {
            self.error = BBClient.describe(error, server: client.baseURL)
        }
        await loadSpaces(client, force: true)
    }

    /// Hides a thread from every section, or shows it again, through Studio Sidebar's synced preference.
    func setHidden(_ client: BBClient, _ threadId: String, _ hide: Bool) async {
        var ids = preferences?.hiddenThreads ?? []
        ids.removeAll { $0 == threadId }
        if hide { ids.append(threadId) }
        preferences?.hiddenThreads = ids
        actions += 1
        do {
            try await client.setSidebarPreference("hiddenThreads", .array(ids.map(JSONValue.string)))
        } catch where BBClient.isCancellation(error) {
        } catch {
            self.error = BBClient.describe(error, server: client.baseURL)
            await load(client, refreshPreferences: true)
        }
    }

    /// Folds a thread's sub-threads away, or shows them again, through Studio Sidebar's synced preference.
    func setCollapsed(_ client: BBClient, _ threadId: String, _ collapse: Bool) async {
        var ids = preferences?.collapsedThreads ?? []
        ids.removeAll { $0 == threadId }
        if collapse { ids.append(threadId) }
        preferences?.collapsedThreads = ids
        do {
            try await client.setSidebarPreference("collapsedThreads", .array(ids.map(JSONValue.string)))
        } catch where BBClient.isCancellation(error) {
        } catch {
            self.error = BBClient.describe(error, server: client.baseURL)
            await load(client, refreshPreferences: true)
        }
    }

    // MARK: Actions

    @Published var searchResults: ThreadSearchResults?
    @Published var searching = false
    /// Bumped after each swipe action, for haptics.
    @Published var actions = 0

    /// Applies a change locally right away, then runs it on the server and reloads.
    func perform(_ client: BBClient, _ id: String, local: (inout ThreadEntry) -> Void, remote: @escaping () async throws -> Void)
        async
    {
        if let index = threads.firstIndex(where: { $0.id == id }) { local(&threads[index]) }
        actions += 1
        do {
            try await remote()
        } catch where BBClient.isCancellation(error) {
        } catch {
            self.error = BBClient.describe(error, server: client.baseURL)
        }
        await load(client, refreshPreferences: false)
    }

    func archive(_ client: BBClient, _ thread: ThreadEntry) async {
        threads.removeAll { $0.id == thread.id }
        actions += 1
        do {
            try await client.archive(thread.id)
        } catch where BBClient.isCancellation(error) {
        } catch {
            self.error = BBClient.describe(error, server: client.baseURL)
        }
        await load(client, refreshPreferences: false)
    }

    func delete(_ client: BBClient, _ thread: ThreadEntry) async {
        threads.removeAll { $0.id == thread.id }
        actions += 1
        do {
            try await client.delete(thread.id)
        } catch where BBClient.isCancellation(error) {
        } catch {
            self.error = BBClient.describe(error, server: client.baseURL)
        }
        await load(client, refreshPreferences: false)
    }

    func search(_ client: BBClient, _ query: String) async {
        let trimmed = query.trimmingCharacters(in: .whitespaces)
        guard trimmed.filter({ !$0.isWhitespace }).count >= 2 else {
            searchResults = nil
            return
        }
        try? await Task.sleep(for: .milliseconds(300))
        guard !Task.isCancelled else { return }
        searching = true
        defer { searching = false }
        if let results = try? await client.search(trimmed), !Task.isCancelled { searchResults = results }
    }

    /// A titled group of the home list, in the web sidebar's order.
    struct Group: Identifiable {
        var id: String
        var title: String
        var threads: [ThreadEntry]
        var showsProject: Bool
        /// Hidden threads, shown on request.
        var hidden: [ThreadEntry] = []
    }

    /// Pinned first, then either one group per project (the sidebar's project
    /// mode, in the user's order) or custom sections, then everything else.
    var groups: [Group] {
        let pinned = Self.pinOrder(threads.filter { $0.pinnedAt != nil })
        let unpinned = threads.filter { $0.pinnedAt == nil }
        var groups = [Group(id: "pinned", title: "Pinned", threads: pinned, showsProject: true)]
        if preferences?.organizationMode == "project", let sidebar {
            var order = (preferences?.sectionOrder ?? []).compactMap { key in
                key.hasPrefix("project:") ? String(key.dropFirst("project:".count)) : nil
            }
            order += sidebar.projects.map(\.id).filter { !order.contains($0) }
            for id in order where id != sidebar.personalProject.id {
                guard let project = sidebar.projects.first(where: { $0.id == id }) else { continue }
                groups.append(Group(
                    id: "project:\(id)", title: project.name,
                    threads: Self.sidebarSorted(unpinned.filter { $0.projectId == id }), showsProject: false))
            }
            groups.append(Group(
                id: "threads", title: "Threads",
                threads: Self.sidebarSorted(unpinned.filter { $0.projectId == sidebar.personalProject.id }),
                showsProject: false))
        } else {
            let sections = sidebar?.sections ?? []
            for section in sections {
                groups.append(Group(
                    id: "section:\(section.id)", title: section.name,
                    threads: Self.sidebarSorted(unpinned.filter { $0.sectionId == section.id }), showsProject: true))
            }
            let sectionIds = Set(sections.map(\.id))
            groups.append(Group(
                id: "threads", title: "Threads",
                threads: Self.sidebarSorted(unpinned.filter { $0.sectionId.map { !sectionIds.contains($0) } ?? true }),
                showsProject: true))
        }
        // Hidden threads leave every section but Pinned, as in Studio Sidebar.
        let hidden = hidden
        if !hidden.isEmpty {
            for index in groups.indices where groups[index].id != "pinned" {
                groups[index].hidden = groups[index].threads.filter { hidden.contains($0.id) }
                groups[index].threads.removeAll { hidden.contains($0.id) }
            }
        }
        return groups.filter { !$0.threads.isEmpty || !$0.hidden.isEmpty }
    }

    /// The sidebar's order: running threads first, newest started first; then the
    /// rest by latest activity.
    static func sidebarSorted(_ list: [ThreadEntry]) -> [ThreadEntry] {
        list.sorted {
            if $0.isRunning != $1.isRunning { return $0.isRunning }
            if $0.isRunning { return $0.createdAt > $1.createdAt }
            let a = $0.latestAttentionAt ?? $0.createdAt
            let b = $1.latestAttentionAt ?? $1.createdAt
            return a != b ? a > b : $0.createdAt > $1.createdAt
        }
    }



}

struct InboxView: View {
    @EnvironmentObject private var app: AppModel
    @StateObject private var model = InboxModel()
    @State private var query = ""
    @State private var renaming: ThreadEntry?
    @State private var deleting: ThreadEntry?
    @State private var newTitle = ""
    /// Sections whose hidden threads show until Home closes, like the web's "N hidden · Show".
    @State private var revealed: Set<String> = []
    @State private var spaceSheet: SpaceSheet?
    @State private var leadSheet: StudioSpace?
    @State private var commandSpace: StudioSpace?
    @ObservedObject private var studio = StudioStore.shared
    /// The server's running plugins, comma-separated; remembered so plugin rows show offline.
    @AppStorage(ServerScope.key("runningPlugins")) private var runningPlugins = ""

    var body: some View {
        home
        .listStyle(.sidebar)
        .overlay {
            if !model.loaded { ProgressView() }
        }
        .navigationTitle(homeTitle)
        .navigationBarTitleDisplayMode(model.spaceMode ? .inline : .automatic)
        .searchable(text: $query, prompt: "Search threads and messages")
        .task(id: query) { await model.search(app.client, query) }
        .sensoryFeedback(.impact(weight: .light), trigger: model.actions)
        .alert("Rename thread", isPresented: Binding(get: { renaming != nil }, set: { if !$0 { renaming = nil } })) {
            TextField("Title", text: $newTitle)
            Button("Cancel", role: .cancel) {}
            Button("Rename") {
                guard let thread = renaming else { return }
                let title = newTitle.trimmingCharacters(in: .whitespacesAndNewlines)
                Task {
                    await model.perform(app.client, thread.id, local: { $0.title = title.isEmpty ? nil : title }) {
                        try await app.client.rename(thread.id, title: title.isEmpty ? nil : title)
                    }
                }
            }
        }
        .confirmationDialog(
            "Delete \u{201C}\(deleting?.displayTitle ?? "")\u{201D}? This can't be undone.",
            isPresented: Binding(get: { deleting != nil }, set: { if !$0 { deleting = nil } }),
            titleVisibility: .visible
        ) {
            Button("Delete thread", role: .destructive) {
                guard let thread = deleting else { return }
                Task { await model.delete(app.client, thread) }
            }
        }
        .refreshable { await model.load(app.client) }
        .toolbar {
            ToolbarItemGroup(placement: .topBarTrailing) {
                Button { app.startDictation() } label: { Image(systemName: "mic") }
                if let space = currentSpace {
                    Menu { spaceMenu(space) } label: { Image(systemName: "ellipsis.circle") }
                        .accessibilityLabel("\(space.name) options")
                }
                Menu {
                    Button { app.newThread(space: currentSpace?.id) } label: {
                        Label(currentSpace.map { "New Thread in \($0.name)" } ?? "New Thread", systemImage: "square.and.pencil")
                    }
                    // Like the web Space heading's +: a thread or any Studio item.
                    if let space = currentSpace, !studio.creatable.isEmpty {
                        Section {
                            ForEach(studio.creatable, id: \.id) { kind in
                                Button { createItem(kind, in: space) } label: {
                                    Label("New \(kind.label)", systemImage: StudioKind.of(kind.id).symbol)
                                }
                            }
                        }
                    }
                } label: {
                    Image(systemName: "square.and.pencil")
                } primaryAction: {
                    app.newThread(space: currentSpace?.id)
                }
                .accessibilityLabel("New Thread")
            }
        }
        .sheet(
            isPresented: Binding(get: { app.newThreadDraft != nil }, set: { if !$0 { app.newThreadDraft = nil } })
        ) {
            NewThreadView(text: app.newThreadDraft ?? "", spaceId: app.newThreadSpace)
        }
        .sheet(item: $spaceSheet) { sheet in
            SpaceSettingsSheet(space: sheet.space) { saved in
                if let saved, sheet.space == nil { app.homeSpace = saved.id }
                Task { await model.loadSpaces(app.client, force: true) }
            }
        }
        .sheet(item: $leadSheet) { space in
            SpaceLeadSheet(
                space: space, lead: model.leads[space.id],
                threads: model.spaceSections.first { $0.id == space.id }.map { ($0.lead.map { [$0] } ?? []) + $0.pinned + $0.threads + $0.hidden } ?? []
            ) { await model.loadSpaces(app.client, force: true) }
        }
        .sheet(item: $commandSpace) { space in
            NavigationStack {
                WebView(url: app.client.baseURL.appending(path: "plugins/studio/studio/command/\(space.id)"))
                    .ignoresSafeArea(edges: .bottom)
                    .navigationTitle("\(space.name) Command")
                    .navigationBarTitleDisplayMode(.inline)
                    .toolbar { Button("Done") { commandSpace = nil } }
            }
        }
        .task(id: model.spaceMode) {
            if model.spaceMode, !studio.loaded, studio.kindInfo.isEmpty { studio.restore() }
        }
        .task(id: app.serverURL) {
            if let running = try? await app.client.runningPlugins() { runningPlugins = running.sorted().joined(separator: ",") }
            await MutedThreads.shared.refresh()
        }
        .task(id: app.serverURL) {
            model.restore()
            model.attach(app)
            await model.load(app.client)
        }
    }

    /// Section expansion survives relaunches, like the sidebar's collapsed groups.
    @AppStorage(ServerScope.key("collapsedHomeGroups")) private var collapsedGroups = ""

    private func expanded(_ id: String) -> Binding<Bool> {
        Binding(
            get: { !collapsedGroups.split(separator: ",").contains(Substring(id)) },
            set: { open in
                var ids = Set(collapsedGroups.split(separator: ",").map(String.init))
                if open { ids.remove(id) } else { ids.insert(id) }
                collapsedGroups = ids.sorted().joined(separator: ",")
            })
    }

    private func collapsible<Content: View>(_ id: String, _ title: String, @ViewBuilder content: () -> Content)
        -> some View
    {
        Section(isExpanded: query.isEmpty ? expanded(id) : .constant(true)) { content() } header: { Text(title) }
    }

    @ViewBuilder
    private func threadSection(_ group: InboxModel.Group) -> some View {
        let filtered = query.isEmpty
            ? group.threads : group.threads.filter { $0.displayTitle.localizedCaseInsensitiveContains(query) }
        let hidden = query.isEmpty ? group.hidden : []
        if !filtered.isEmpty || !hidden.isEmpty {
            collapsible(group.id, group.title) {
                ForEach(filtered) { thread in
                    threadLink(thread, showsProject: group.showsProject, depth: 0)
                    ForEach(query.isEmpty ? shownChildren(of: thread) : []) { child in
                        threadLink(child, showsProject: false, depth: 1)
                    }
                }
                hiddenRows(group.id, hidden) { threadLink($0, showsProject: group.showsProject, depth: 0) }
            }
        }
    }

    /// "N hidden · Show", and the hidden threads once shown.
    @ViewBuilder
    private func hiddenRows<Row: View>(_ id: String, _ hidden: [ThreadEntry], row: @escaping (ThreadEntry) -> Row) -> some View {
        if !hidden.isEmpty {
            let open = revealed.contains(id)
            if open {
                ForEach(hidden) { thread in row(thread) }
            }
            Button {
                if open { revealed.remove(id) } else { revealed.insert(id) }
            } label: {
                Text(open ? "Showing \(hidden.count) hidden · Hide" : "\(hidden.count) hidden · Show")
                    .font(.footnote)
                    .foregroundStyle(.secondary)
            }
            .accessibilityIdentifier("hiddenThreads.\(id)")
        }
    }

    /// By space pages through All and each Space, in the switcher's order, with
    /// a horizontal swipe; a swipe that starts on a row still opens its actions.
    @ViewBuilder
    private var home: some View {
        if query.isEmpty, model.spaceMode {
            TabView(selection: Binding(get: { shownSpace }, set: { app.homeSpace = $0 })) {
                ForEach(["all"] + model.spaces.map(\.id), id: \.self) { id in
                    List {
                        homeTop
                        spaceHome(id)
                    }
                    .background(YieldsRowSwipesToPager())
                    .tag(id)
                }
            }
            .tabViewStyle(.page(indexDisplayMode: .never))
            .safeAreaBar(edge: .top) {
                SpaceSwitcher(spaces: model.spaceSections, shown: shownSpace) { id in
                    withAnimation { app.homeSpace = id }
                } add: {
                    spaceSheet = SpaceSheet(space: nil)
                }
            }
            .sensoryFeedback(.selection, trigger: shownSpace)
        } else {
            List {
                homeTop
                if let results = model.searchResults, !query.isEmpty {
                    searchSection("Matches", results.active.results)
                    searchSection("Archived", results.archived.results)
                    if results.active.total + results.archived.total == 0 {
                        ContentUnavailableView.search(text: query)
                    }
                } else {
                    ForEach(model.groups) { group in threadSection(group) }
                }
            }
        }
    }

    /// The connection banner, then Automations as a plain row under no header, like the sidebar's nav.
    @ViewBuilder
    private var homeTop: some View {
        if let error = model.error {
            Section {
                ConnectionBanner(message: error) { await model.load(app.client) }
            }
        }
        if query.isEmpty, runningPlugins.split(separator: ",").contains("automations") {
            Section {
                NavigationLink(value: Route.automations) { Label("Automations", systemImage: "clock.arrow.circlepath") }
            }
        }
    }

    // MARK: By space

    private var shownSpace: String { model.shownSpace(app.homeSpace) }

    /// The one Space Home shows; nil for All.
    private var currentSpace: StudioSpace? {
        guard model.spaceMode else { return nil }
        let id = shownSpace
        return model.spaces.first { $0.id == id }
    }

    private var homeTitle: String {
        guard model.spaceMode else { return "Home" }
        return currentSpace?.label ?? "All Spaces"
    }

    /// One Space's page, or every Space under All. As in the web sidebar there
    /// are no Lead, Studio or Threads headings: open items are chips on top,
    /// then the lead with a star, pinned threads with a pin, and the rest.
    @ViewBuilder
    private func spaceHome(_ id: String) -> some View {
        let sections = model.spaceSections
        if let section = sections.first(where: { $0.id == id }) {
            Section { spaceRows(section) }
        } else {
            ForEach(sections) { section in
                Section(isExpanded: expanded("space:\(section.id)")) {
                    spaceRows(section)
                } header: {
                    HStack(spacing: 6) {
                        Text(section.space.label)
                        if section.needsYou {
                            Circle().fill(.orange).frame(width: 6, height: 6).accessibilityLabel("Needs you")
                        }
                        Spacer()
                        // Borderless keeps the collapsible header from taking the tap.
                        Menu { spaceMenu(section.space) } label: {
                            Image(systemName: "ellipsis").frame(width: 32, height: 32).contentShape(Rectangle())
                        }
                        .buttonStyle(.borderless)
                        .accessibilityLabel("\(section.space.name) options")
                    }
                }
            }
        }
    }

    /// A Space's rows: open items, the lead, pins, then the rest, or a quiet empty line.
    @ViewBuilder
    private func spaceRows(_ section: InboxModel.SpaceSection) -> some View {
        if !section.open.isEmpty { openItemChips(section.open) }
        if let lead = section.lead {
            let heartbeat = section.leadInfo?.heartbeat
            spaceThreadLinks(lead, mark: .lead(heartbeat.map { "Space lead, heartbeat \(SpaceLead.cadenceLabel($0))" } ?? "Space lead"))
        }
        ForEach(section.pinned) { thread in spaceThreadLinks(thread, mark: .pinned) }
        ForEach(section.threads) { thread in spaceThreadLinks(thread) }
        hiddenRows(section.id, section.hidden) { spaceThreadLinks($0) }
        if section.lead == nil, section.pinned.isEmpty, section.threads.isEmpty, section.hidden.isEmpty, section.open.isEmpty {
            Label("Nothing here yet", systemImage: "bubble.left")
                .font(.footnote)
                .foregroundStyle(.tertiary)
        }
    }

    @ViewBuilder
    private func spaceThreadLinks(_ thread: ThreadEntry, mark: SpaceThreadRow.Mark? = nil) -> some View {
        spaceThreadLink(thread, mark: mark, depth: 0)
        ForEach(shownChildren(of: thread)) { child in
            spaceThreadLink(child, mark: nil, depth: 1)
        }
    }

    private func spaceThreadLink(_ thread: ThreadEntry, mark: SpaceThreadRow.Mark?, depth: Int) -> some View {
        NavigationLink(value: Route.thread(id: thread.id)) {
            SpaceThreadRow(
                thread: thread, line: model.lines[thread.id], mark: mark,
                hidden: model.hidden.contains(thread.id), collapsedChildren: collapsedChildren(of: thread))
                .padding(.leading, CGFloat(depth) * 18)
        }
        .swipeActions(edge: .leading) { leadingActions(thread) }
        .swipeActions(edge: .trailing) { trailingActions(thread) }
        .contextMenu { menu(thread) }
    }

    /// A Space's open Studio items as chips: tap opens, a long press closes.
    private func openItemChips(_ items: [SpaceOpenItem]) -> some View {
        FlowLayout(spacing: 6, maxItemWidth: 240) {
            ForEach(items) { item in
                Button {
                    if let route = Route(href: item.href) { app.push(route) }
                } label: {
                    SpaceItemChip(item: item)
                }
                .buttonStyle(.plain)
                .contextMenu {
                    Button { closeItem(item) } label: { Label("Close", systemImage: "xmark") }
                }
            }
        }
        .padding(.vertical, 2)
        .accessibilityIdentifier("spaceItemChips")
    }

    private func closeItem(_ item: SpaceOpenItem) {
        Task {
            for key in model.openItems.keys { model.openItems[key]?.removeAll { $0.id == item.id } }
            try? await app.client.closeStudioTab(pluginId: item.pluginId, id: item.itemId)
            await model.loadSpaces(app.client, force: true)
        }
    }

    /// A Space's actions, from its heading or the toolbar.
    @ViewBuilder
    private func spaceMenu(_ space: StudioSpace) -> some View {
        Button { app.newThread(space: space.id) } label: { Label("New Thread Here", systemImage: "square.and.pencil") }
        if !studio.creatable.isEmpty {
            Menu {
                ForEach(studio.creatable, id: \.id) { kind in
                    Button { createItem(kind, in: space) } label: { Label(kind.label, systemImage: StudioKind.of(kind.id).symbol) }
                }
            } label: { Label("New Item", systemImage: "plus.square.on.square") }
        }
        Button { app.openStudio(space: space.id) } label: { Label("Browse Items", systemImage: "square.stack") }
        Button { app.push(.spaceArchived(id: space.id)) } label: { Label("Archived Threads", systemImage: "archivebox") }
        Divider()
        Button { commandSpace = space } label: { Label("Command View", systemImage: "square.grid.2x2") }
        Button { leadSheet = space } label: { Label("Lead and Heartbeat…", systemImage: "star") }
        Button { spaceSheet = SpaceSheet(space: space) } label: { Label("Edit Space…", systemImage: "gearshape") }
    }

    private func createItem(_ kind: StudioKindInfo, in space: StudioSpace) {
        Task {
            do {
                let href = try await app.client.createInSpace(space.id, pluginId: kind.pluginId, kind: kind.id)
                if let route = Route(href: href) { app.push(route) }
                await model.loadSpaces(app.client, force: true)
            } catch {
                model.error = BBClient.describe(error, server: app.client.baseURL)
            }
        }
    }

    /// A thread's sub-threads, unless it's collapsed.
    private func shownChildren(of thread: ThreadEntry) -> [ThreadEntry] {
        model.collapsed.contains(thread.id) ? [] : model.children[thread.id] ?? []
    }

    /// How many sub-threads a collapsed thread folds away; 0 when it's open.
    private func collapsedChildren(of thread: ThreadEntry) -> Int {
        model.collapsed.contains(thread.id) ? model.children[thread.id]?.count ?? 0 : 0
    }

    private func threadLink(_ thread: ThreadEntry, showsProject: Bool, depth: Int) -> some View {
        NavigationLink(value: Route.thread(id: thread.id)) {
            ThreadRow(
                thread: thread, project: showsProject ? model.projectNames[thread.projectId] : nil,
                collapsedChildren: collapsedChildren(of: thread))
                .padding(.leading, CGFloat(depth) * 18)
        }
        .swipeActions(edge: .leading) { leadingActions(thread) }
        .swipeActions(edge: .trailing) { trailingActions(thread) }
        .contextMenu { menu(thread) }
    }

    @ViewBuilder
    private func searchSection(_ title: String, _ hits: [ThreadSearchResults.Hit]) -> some View {
        if !hits.isEmpty {
            Section(title) {
                ForEach(hits) { hit in
                    NavigationLink(value: Route.thread(id: hit.thread.id)) {
                        VStack(alignment: .leading, spacing: 4) {
                            ThreadRow(
                                thread: hit.thread, project: model.projectNames[hit.thread.projectId])
                            if let snippet = hit.snippet {
                                Text(snippet).font(.caption).foregroundStyle(.secondary).lineLimit(2).padding(.leading, 18)
                            }
                        }
                    }
                }
            }
        }
    }

    @ViewBuilder
    private func leadingActions(_ thread: ThreadEntry) -> some View {
        Button { toggleRead(thread) } label: {
            Label(thread.isUnread ? "Read" : "Unread", systemImage: thread.isUnread ? "envelope.open" : "envelope.badge")
        }
        .tint(.accentColor)
        Button { togglePin(thread) } label: {
            Label(thread.pinnedAt == nil ? "Pin" : "Unpin", systemImage: thread.pinnedAt == nil ? "pin" : "pin.slash")
        }
        .tint(.yellow)
    }

    @ViewBuilder
    private func trailingActions(_ thread: ThreadEntry) -> some View {
        Button { Task { await model.archive(app.client, thread) } } label: {
            Label("Archive", systemImage: "archivebox")
        }
        .tint(.indigo)
        Button { startRename(thread) } label: { Label("Rename", systemImage: "pencil") }
            .tint(.gray)
        Button { deleting = thread } label: { Label("Delete", systemImage: "trash") }
            .tint(.red)
    }

    @ViewBuilder
    private func menu(_ thread: ThreadEntry) -> some View {
        Button { startRename(thread) } label: { Label("Rename", systemImage: "pencil") }
        Button { togglePin(thread) } label: {
            Label(thread.pinnedAt == nil ? "Pin" : "Unpin", systemImage: thread.pinnedAt == nil ? "pin" : "pin.slash")
        }
        Button { toggleRead(thread) } label: {
            Label(
                thread.isUnread ? "Mark as read" : "Mark as unread",
                systemImage: thread.isUnread ? "envelope.open" : "envelope.badge")
        }
        if let children = model.children[thread.id], !children.isEmpty {
            let isCollapsed = model.collapsed.contains(thread.id)
            Button {
                Task { await model.setCollapsed(app.client, thread.id, !isCollapsed) }
            } label: {
                Label(
                    isCollapsed ? "Expand Sub-threads" : "Collapse \(children.count) Sub-thread\(children.count == 1 ? "" : "s")",
                    systemImage: isCollapsed ? "chevron.down" : "chevron.up")
            }
        }
        Button { app.startVoiceChat(threadId: thread.id) } label: { Label("Voice chat", systemImage: Symbols.voiceChat) }
        Button { UIPasteboard.general.string = thread.id } label: { Label("Copy Thread ID", systemImage: "number") }
        if model.spaces.count > 1, thread.parentThreadId == nil {
            let current = model.spaceId(of: thread)
            Menu {
                ForEach(model.spaces) { space in
                    Button {
                        Task { await model.moveThread(app.client, thread, to: space) }
                    } label: {
                        if space.id == current { Label(space.label, systemImage: "checkmark") } else { Text(space.label) }
                    }
                    .disabled(space.id == current)
                }
            } label: { Label("Move to Space", systemImage: "square.stack.3d.up") }
        }
        if model.spaceMode, let spaceId = model.spaceId(of: thread), thread.parentThreadId == nil {
            let isLead = model.leads[spaceId]?.threadId == thread.id
            Button {
                Task { await model.setLead(app.client, space: spaceId, thread: isLead ? nil : thread.id) }
            } label: {
                Label(isLead ? "Remove as Space Lead" : "Make Space Lead", systemImage: isLead ? "star.slash" : "star")
            }
        }
        if model.supportsHiding, thread.pinnedAt == nil {
            let isHidden = model.hidden.contains(thread.id)
            Button {
                Task { await model.setHidden(app.client, thread.id, !isHidden) }
            } label: {
                Label(isHidden ? "Unhide" : "Hide", systemImage: isHidden ? "eye" : "eye.slash")
            }
        }
        Divider()
        Button { Task { await model.archive(app.client, thread) } } label: {
            Label("Archive", systemImage: "archivebox")
        }
        Button(role: .destructive) { deleting = thread } label: { Label("Delete", systemImage: "trash") }
    }

    private func startRename(_ thread: ThreadEntry) {
        newTitle = thread.title ?? thread.displayTitle
        renaming = thread
    }

    private func togglePin(_ thread: ThreadEntry) {
        let pin = thread.pinnedAt == nil
        Task {
            await model.perform(app.client, thread.id, local: { $0.pinnedAt = pin ? Date().timeIntervalSince1970 * 1000 : nil }) {
                try await app.client.setPinned(thread.id, pin)
            }
        }
    }

    private func toggleRead(_ thread: ThreadEntry) {
        let read = thread.isUnread
        Task {
            await model.perform(
                app.client, thread.id,
                local: { $0.lastReadAt = read ? Date().timeIntervalSince1970 * 1000 : nil }
            ) {
                if read { try await app.client.markRead(thread.id) } else { try await app.client.markUnread(thread.id) }
            }
        }
    }
}

/// Says why BB is unreachable and what to do, with a retry.
struct ConnectionBanner: View {
    let message: String
    let retry: () async -> Void
    @State private var retrying = false

    var body: some View {
        VStack(alignment: .leading, spacing: 8) {
            Label(message, systemImage: "wifi.exclamationmark")
                .foregroundStyle(.orange)
                .font(.footnote.weight(.medium))
            if message.contains("Tailscale") {
                Text("Showing the last saved inbox. Turn on Tailscale, or check that the Mac is awake and BB is running.")
                    .font(.caption)
                    .foregroundStyle(.secondary)
                HStack {
                    Button("Open Tailscale") { UIApplication.shared.open(URL(string: "tailscale://")!) }
                    Spacer()
                    retryButton
                }
                .buttonStyle(.bordered)
                .controlSize(.small)
            } else {
                retryButton.buttonStyle(.bordered).controlSize(.small)
            }
        }
        .padding(.vertical, 4)
    }

    private var retryButton: some View {
        Button {
            retrying = true
            Task {
                await retry()
                retrying = false
            }
        } label: {
            if retrying { ProgressView() } else { Text("Retry") }
        }
    }
}

struct ThreadRow: View {
    let thread: ThreadEntry
    var project: String?
    /// Sub-threads folded away under this one.
    var collapsedChildren = 0
    @ObservedObject private var muted = MutedThreads.shared
    /// Written by the thread screen as the reader types; see `Drafts`.
    @AppStorage private var draft: Data?

    init(thread: ThreadEntry, project: String? = nil, collapsedChildren: Int = 0) {
        self.thread = thread
        self.project = project
        self.collapsedChildren = collapsedChildren
        _draft = AppStorage(ServerScope.key("draft.\(thread.id)"))
    }

    var body: some View {
        HStack(alignment: .top, spacing: 10) {
            StatusDot(thread: thread).padding(.top, 6)
            VStack(alignment: .leading, spacing: 2) {
                HStack(alignment: .firstTextBaseline, spacing: 6) {
                    Text(ThreadTitles.resolve(thread.displayTitle))
                        .font(.body.weight(thread.isUnread ? .semibold : .regular))
                        .lineLimit(2)
                }
                HStack(spacing: 4) {
                    if draft != nil {
                        Text("Draft").foregroundStyle(.red)
                        Text("·")
                    }
                    if let project {
                        Text(project)
                        Text("·")
                    }
                    Text(
                        Date(timeIntervalSince1970: (thread.latestAttentionAt ?? thread.updatedAt) / 1000),
                        format: .relative(presentation: .named, unitsStyle: .abbreviated))
                    if muted.ids.contains(thread.id) {
                        Image(systemName: "bell.slash").accessibilityLabel("Muted")
                    }
                    if collapsedChildren > 0 { CollapsedChildrenMark(count: collapsedChildren) }
                }
                .font(.caption)
                .foregroundStyle(.secondary)
                .lineLimit(1)
            }
        }
    }
}

struct StatusDot: View {
    let thread: ThreadEntry

    var body: some View {
        Circle()
            .fill(color)
            .frame(width: 8, height: 8)
            .opacity(thread.isUnread || thread.isRunning || thread.needsAttention ? 1 : 0)
    }

    private var color: Color {
        if thread.status == "error" { return .red }
        if thread.hasPendingInteraction == true { return .orange }
        if thread.isRunning { return .green }
        return .blue
    }
}
