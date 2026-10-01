import SwiftUI

@MainActor
final class InboxModel: ObservableObject {
    /// Top-level threads, for the widgets, Spotlight and the watch.
    @Published var threads: [ThreadEntry] = []
    @Published var children: [String: [ThreadEntry]] = [:]
    @Published var sidebar: SidebarBootstrap?
    @Published var preferences: SidebarPreferences?
    @Published var botTeams: BotTeamsList?
    @Published var projectNames: [String: String] = [:]
    @Published var error: String?
    @Published var loaded = false

    private var listener: UUID?
    private var reloadTask: Task<Void, Never>?
    private var reloadDue: ContinuousClock.Instant?
    private var reloadBots = false
    private var lastReload = ContinuousClock.now - .seconds(60)
    private var savedSignature: Int?

    func attach(_ app: AppModel) {
        if let listener { app.realtime.removeListener(listener) }
        listener = app.realtime.listen { [weak self] event in
            switch event {
            case .changed(let entity, _, let changes) where entity == "thread":
                // A running agent appends events several times a second, and nothing
                // in the list shows them; its status changes bring the fresh row.
                let streaming = !changes.isEmpty && changes.allSatisfy { $0 == "events-appended" }
                self?.scheduleReload(app.client, bots: false, within: streaming ? .seconds(30) : .milliseconds(400))
            case .pluginSignal(let pluginId, _, _) where pluginId == "bot-teams":
                self?.scheduleReload(app.client, bots: true)
            case .connected:
                self?.scheduleReload(app.client, bots: true)
            default:
                break
            }
        }
    }

    /// Change signals arrive in bursts while agents run: coalesce them, and
    /// reload at most every few seconds, since each reload is a sidebar fetch.
    private func scheduleReload(_ client: BBClient, bots: Bool, within delay: Duration = .milliseconds(400)) {
        reloadBots = reloadBots || bots
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
                let bots = reloadBots
                reloadBots = false
                await load(client, bots: bots)
            }
            reloadTask = nil
        }
    }

    /// Shows the last inbox immediately; the network load replaces it.
    func restore() {
        guard !loaded, let snapshot = DiskCache.load(InboxSnapshot.self, key: InboxSnapshot.cacheKey) else { return }
        threads = snapshot.threads
        botTeams = snapshot.botTeams
        projectNames = snapshot.projectNames
        loaded = true
    }

    func load(_ client: BBClient, bots: Bool = true) async {
        do {
            async let sidebar = client.sidebar()
            // Every assignment re-renders the inbox, so only on change.
            if bots, let teams = try? await client.botTeams(), !Self.same(teams, botTeams) { botTeams = teams }
            if preferences == nil || bots, let prefs = try? await client.sidebarPreferences(), prefs != preferences {
                preferences = prefs
            }
            let bootstrap = try await sidebar
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
            // Titles that mention archived threads: fetch those names too.
            await ThreadTitles.fetchUnknown(in: all.map(\.displayTitle), client: client)
            LiveItems.sync(all)
            Spotlight.index(self.threads, projectNames: projectNames)
            error = nil
            let snapshot = InboxSnapshot(threads: self.threads, botTeams: botTeams, projectNames: projectNames)
            let signature = Self.encoded(snapshot)?.hashValue
            if signature == nil || signature != savedSignature {
                DiskCache.save(snapshot, as: InboxSnapshot.cacheKey)
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
        await load(client, bots: false)
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
        await load(client, bots: false)
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
        await load(client, bots: false)
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
    }

    /// Pinned first, then either one group per project (the sidebar's project
    /// mode, in the user's order) or custom sections, then everything else.
    var groups: [Group] {
        let pinned = threads.filter { $0.pinnedAt != nil }
            .sorted { ($0.pinSortKey ?? "", $1.pinnedAt ?? 0) < ($1.pinSortKey ?? "", $0.pinnedAt ?? 0) }
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
        return groups.filter { !$0.threads.isEmpty }
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

    var directMessages: [(bot: Bot, threadId: String, info: DirectThreadInfo?)] {
        botTeams?.directMessages ?? []
    }

    var channels: [Room] {
        (botTeams?.rooms ?? []).filter { $0.archived != true }.sorted { ($0.updatedAt ?? 0) > ($1.updatedAt ?? 0) }
    }
}

struct InboxView: View {
    @EnvironmentObject private var app: AppModel
    @StateObject private var model = InboxModel()
    @State private var query = ""
    @State private var renaming: ThreadEntry?
    @State private var renamingRoom: Room?
    @State private var creatingChannel = false
    /// A direct message's thread id.
    @State private var renamingDirect: String?
    @State private var deleting: ThreadEntry?
    @State private var newTitle = ""
    /// The server's running plugins, comma-separated; remembered so plugin rows show offline.
    @AppStorage("runningPlugins") private var runningPlugins = ""

    var body: some View {
        List {
            if let error = model.error {
                Section {
                    ConnectionBanner(message: error) { await model.load(app.client) }
                }
            }
            if let results = model.searchResults, !query.isEmpty {
                searchSection("Matches", results.active.results)
                searchSection("Archived", results.archived.results)
                if results.active.total + results.archived.total == 0 {
                    ContentUnavailableView.search(text: query)
                }
            } else {
                // Plain rows under no header, like the sidebar's nav.
                if query.isEmpty, runningPlugins.split(separator: ",").contains("automations") {
                    Section {
                        NavigationLink(value: Route.automations) { Label("Automations", systemImage: "clock.arrow.circlepath") }
                    }
                }
                if query.isEmpty, model.botTeams != nil {
                    collapsible("channels", "Channels") {
                        ForEach(model.channels) { room in
                            NavigationLink(value: Route.room(room)) {
                                ChannelRow(room: room,
                                           attention: model.botTeams?.attentionCounts?[room.id] ?? 0,
                                           approvals: model.botTeams?.approvalCounts?[room.id] ?? 0)
                            }
                            .contextMenu {
                                Button {
                                    newTitle = room.name
                                    renamingRoom = room
                                } label: { Label("Rename", systemImage: "pencil") }
                            }
                        }
                        Button { creatingChannel = true } label: {
                            Label("New Channel", systemImage: "plus")
                        }
                        .foregroundStyle(.secondary)
                    }
                }
                if query.isEmpty, !model.directMessages.isEmpty {
                    collapsible("direct", "Direct messages") {
                        ForEach(model.directMessages, id: \.threadId) { dm in
                            NavigationLink(value: Route.thread(id: dm.threadId)) {
                                BotRow(bot: dm.bot, title: dm.info?.title, unread: dm.info?.unread == true,
                                    working: model.botTeams?.directThreads[dm.bot.id]?.status == "active")
                            }
                            .contextMenu {
                                Button {
                                    newTitle = dm.info?.title ?? ""
                                    renamingDirect = dm.threadId
                                } label: { Label("Rename", systemImage: "pencil") }
                            }
                        }
                    }
                }
                ForEach(model.groups) { group in threadSection(group) }
            }
        }
        .listStyle(.sidebar)
        .overlay {
            if !model.loaded { ProgressView() }
        }
        .navigationTitle("Home")
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
        .sheet(isPresented: $creatingChannel) {
            NewChannelSheet { room in
                Task { await model.load(app.client) }
                app.push(.room(room))
            }
        }
        .alert("Rename channel", isPresented: Binding(get: { renamingRoom != nil }, set: { if !$0 { renamingRoom = nil } })) {
            TextField("Name", text: $newTitle)
            Button("Cancel", role: .cancel) {}
            Button("Rename") {
                guard let room = renamingRoom else { return }
                let name = newTitle.trimmingCharacters(in: .whitespacesAndNewlines)
                guard !name.isEmpty, name != room.name else { return }
                Task {
                    do {
                        try await app.client.renameRoom(room.id, name: name)
                        await model.load(app.client)
                    } catch {
                        model.error = BBClient.describe(error, server: app.client.baseURL)
                    }
                }
            }
        }
        .alert("Rename conversation", isPresented: Binding(get: { renamingDirect != nil }, set: { if !$0 { renamingDirect = nil } })) {
            TextField("Title", text: $newTitle)
            Button("Cancel", role: .cancel) {}
            Button("Rename") {
                guard let id = renamingDirect else { return }
                let title = newTitle.trimmingCharacters(in: .whitespacesAndNewlines)
                Task {
                    do {
                        try await app.client.rename(id, title: title.isEmpty ? nil : title)
                        await model.load(app.client)
                    } catch {
                        model.error = BBClient.describe(error, server: app.client.baseURL)
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
                Menu {
                    Button { app.newThread() } label: { Label("New Thread", systemImage: "square.and.pencil") }
                    if model.botTeams != nil {
                        Button { creatingChannel = true } label: { Label("New Channel", systemImage: "number") }
                    }
                } label: {
                    Image(systemName: "square.and.pencil")
                } primaryAction: {
                    app.newThread()
                }
                .accessibilityLabel("New Thread")
            }
        }
        .sheet(
            isPresented: Binding(get: { app.newThreadDraft != nil }, set: { if !$0 { app.newThreadDraft = nil } })
        ) {
            NewThreadView(text: app.newThreadDraft ?? "")
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
    @AppStorage("collapsedHomeGroups") private var collapsedGroups = ""

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
        if !filtered.isEmpty {
            collapsible(group.id, group.title) {
                ForEach(filtered) { thread in
                    threadLink(thread, showsProject: group.showsProject, depth: 0)
                    ForEach(query.isEmpty ? model.children[thread.id] ?? [] : []) { child in
                        threadLink(child, showsProject: false, depth: 1)
                    }
                }
            }
        }
    }

    private func threadLink(_ thread: ThreadEntry, showsProject: Bool, depth: Int) -> some View {
        NavigationLink(value: Route.thread(id: thread.id)) {
            ThreadRow(thread: thread, project: showsProject ? model.projectNames[thread.projectId] : nil)
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
                            ThreadRow(thread: hit.thread, project: model.projectNames[hit.thread.projectId])
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
        Button { app.startVoiceChat(threadId: thread.id) } label: { Label("Voice chat", systemImage: "waveform") }
        Button { UIPasteboard.general.string = thread.id } label: { Label("Copy Thread ID", systemImage: "number") }
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
    @ObservedObject private var muted = MutedThreads.shared
    /// Written by the thread screen as the reader types; see `Drafts`.
    @AppStorage private var draft: Data?

    init(thread: ThreadEntry, project: String? = nil) {
        self.thread = thread
        self.project = project
        _draft = AppStorage("draft.\(thread.id)")
    }

    var body: some View {
        HStack(alignment: .top, spacing: 10) {
            StatusDot(thread: thread).padding(.top, 6)
            VStack(alignment: .leading, spacing: 2) {
                Text(ThreadTitles.resolve(thread.displayTitle))
                    .font(.body.weight(thread.isUnread ? .semibold : .regular))
                    .lineLimit(2)
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

struct BotRow: View {
    let bot: Bot
    var title: String?
    var unread = false
    var working = false

    var body: some View {
        HStack(spacing: 10) {
            Text(bot.avatar ?? "🤖").font(.title3)
            VStack(alignment: .leading, spacing: 2) {
                Text(title.flatMap { $0 == "Direct message" ? nil : $0 } ?? bot.name)
                    .font(.body.weight(unread ? .semibold : .regular))
                    .lineLimit(1)
                if title != nil, title != "Direct message" {
                    Text(bot.name).font(.caption).foregroundStyle(.secondary).lineLimit(1)
                }
            }
            Spacer()
            if working {
                ProgressView().controlSize(.small)
            } else if unread {
                Circle().fill(Color.accentColor).frame(width: 8, height: 8)
            }
        }
    }
}

struct ChannelRow: View {
    let room: Room
    var attention = 0
    var approvals = 0

    var body: some View {
        let unread = (room.updatedAt ?? 0) > (room.lastReadAt ?? .infinity)
        HStack {
            Label(room.name, systemImage: "number")
                .font(.body.weight(unread ? .semibold : .regular))
            Spacer()
            if approvals > 0 {
                Label("\(approvals)", systemImage: "hand.raised.fill")
                    .font(.caption.weight(.semibold))
                    .foregroundStyle(.orange)
                    .accessibilityLabel("\(approvals) waiting for approval")
            }
            if attention > 0 {
                Label("\(attention)", systemImage: "bell.fill")
                    .font(.caption.weight(.semibold))
                    .foregroundStyle(.red)
                    .accessibilityLabel("\(attention) need attention")
            }
            if unread { Circle().fill(Color.accentColor).frame(width: 8, height: 8) }
        }
    }
}
