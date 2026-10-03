import SwiftUI

// MARK: Opening a space

/// A space opens as its page, which Studio makes from the space template the first time.
struct SpaceRouteView: View {
    let id: String
    @EnvironmentObject private var app: AppModel
    private let operation = ServerOperation()
    private var client: BBClient { operation.client }
    @State private var pageId: String?
    @State private var error: String?
    @State private var noPage = false

    var body: some View {
        Group {
            if let pageId {
                PageView(pageId: pageId).id(pageId)
            } else if let error {
                ContentUnavailableView("Couldn't open the space", systemImage: "exclamationmark.triangle", description: Text(error))
            } else if noPage {
                ContentUnavailableView(
                    "No page for this space", systemImage: "doc.richtext",
                    description: Text("A space opens as a page. Turn on BB Pages to see it."))
            } else {
                ProgressView()
            }
        }
        .task {
            do {
                if case .page(let id)? = try await client.spacePage(id).flatMap(Route.init(href:)) {
                    pageId = id
                } else {
                    noPage = true
                }
            } catch {
                self.error = BBClient.describe(error, server: client.baseURL)
            }
        }
    }
}

// MARK: Widget data

/// What the widgets on space pages show. Every widget on a page asks; one
/// request serves them all for a moment, and Studio's changes refetch them.
@MainActor
final class SpaceWidgets: ObservableObject {
    static var shared = SpaceWidgets()
    private let serverURL = ServerScope.selectedURL

    @Published private(set) var views: [String: Studio.SpaceWidgetOutput] = [:]
    @Published private(set) var failed: Set<String> = []
    private var fetchedAt: [String: Date] = [:]
    private var inFlight: [String: Task<Void, Never>] = [:]
    private var listener: UUID?
    private weak var realtime: BBRealtime?
    private var reloadTask: Task<Void, Never>?

    func attach(_ app: AppModel) {
        let client = app.client
        guard realtime !== app.realtime else { return }
        if let listener { realtime?.removeListener(listener) }
        realtime = app.realtime
        listener = app.realtime.listen { [weak self] event in
            guard let self else { return }
            switch event {
            case .pluginSignal("studio", "studio-tabs", _): break
            case .pluginSignal(let pluginId, _, _) where StudioStore.addOns.contains(pluginId): scheduleReload(client)
            default: break
            }
        }
    }

    private func scheduleReload(_ client: BBClient) {
        reloadTask?.cancel()
        reloadTask = Task {
            try? await Task.sleep(for: .seconds(1))
            guard !Task.isCancelled else { return }
            for id in views.keys { await load(id, client: client, fresh: true) }
        }
    }

    func load(_ id: String, client: BBClient, fresh: Bool = false) async {
        guard client.baseURL == serverURL else { return }
        if let task = inFlight[id] { return await task.value }
        if !fresh, let at = fetchedAt[id], Date.now.timeIntervalSince(at) < 3 { return }
        let task = Task {
            do {
                views[id] = try await client.spaceWidget(id)
                failed.remove(id)
            } catch where BBClient.isCancellation(error) {
            } catch {
                views[id] = nil
                failed.insert(id)
            }
        }
        inFlight[id] = task
        fetchedAt[id] = .now
        await task.value
        inFlight[id] = nil
    }
}

// MARK: Widgets

/// One of Studio's widgets on a space's page: a live list or the Create tiles,
/// with buttons that change the space.
struct SpaceWidgetCard: View {
    let target: SpaceWidgetTarget
    var title: String?
    @EnvironmentObject private var app: AppModel
    private let operation = ServerOperation()
    private var client: BBClient { operation.client }
    @ObservedObject private var widgets = SpaceWidgets.shared
    @ObservedObject private var studio = StudioStore.shared
    @State private var sheet: SpaceWidgetSheet?
    @State private var busy: String?
    @State private var showingAll = false
    @State private var notice: String?

    private static let shownThreads = 6

    var body: some View {
        let view = widgets.views[target.spaceId]
        VStack(alignment: .leading, spacing: 0) {
            // The page heads each widget itself; a titled embed says what it is.
            if let title, !title.isEmpty {
                Text(title).font(.subheadline.weight(.semibold)).padding(.horizontal, 12).padding(.top, 10)
            }
            if let view {
                content(view).padding(.top, 4)
            } else if widgets.failed.contains(target.spaceId) {
                empty("Space unavailable.")
            } else {
                empty("Loading \(target.section.label.lowercased())…")
            }
            if let notice {
                Text(notice).font(.caption).foregroundStyle(.secondary).padding(.horizontal, 12).padding(.bottom, 8)
            }
        }
        .frame(maxWidth: .infinity, alignment: .leading)
        .background(.fill.tertiary, in: .rect(cornerRadius: 12))
        .accessibilityIdentifier("spaceWidget-\(target.section.rawValue)")
        .task(id: target.spaceId) {
            widgets.attach(app)
            // Threads change without a Studio signal; check now and then while it shows.
            while !Task.isCancelled {
                await widgets.load(target.spaceId, client: client)
                try? await Task.sleep(for: .seconds(30))
            }
        }
        .sheet(item: $sheet) { sheet in
            switch sheet {
            case .settings:
                SpaceSettingsSheet(space: studio.space(target.spaceId), spaceId: target.spaceId) { _ in refresh() }
            case .items:
                SpaceItemsSheet(spaceId: target.spaceId).onDisappear(perform: refresh)
            case .threads(let conversations):
                SpaceThreadsSheet(spaceId: target.spaceId, conversations: conversations).onDisappear(perform: refresh)
            case .projects:
                SpaceProjectsSheet(spaceId: target.spaceId).onDisappear(perform: refresh)
            }
        }
    }

    private func refresh() {
        Task { await widgets.load(target.spaceId, client: client, fresh: true) }
    }

    @ViewBuilder
    private func content(_ view: Studio.SpaceWidgetOutput) -> some View {
        switch target.section {
        case .actions: actions(view)
        case .recent: recent(view)
        case .threads: threads(view, conversations: false)
        case .channels: threads(view, conversations: true)
        case .projects: projects(view)
        }
    }

    // MARK: Sections

    private func actions(_ view: Studio.SpaceWidgetOutput) -> some View {
        VStack(alignment: .leading, spacing: 0) {
            LazyVGrid(columns: [GridItem(.adaptive(minimum: 130), spacing: 8)], spacing: 8) {
                tile("Thread", "square.and.pencil", key: "thread") { operation.complete(on: app) { app.newThread(text: view.threadPrompt ?? "") } }
                ForEach(Array((view.kinds ?? []).enumerated()), id: \.offset) { _, kind in
                    let key = "\(kind.pluginId ?? ""):\(kind.id ?? "")"
                    tile(kind.label ?? "Item", StudioKind.of(kind.id ?? "").symbol, key: key) {
                        Task { await make(kind, in: view) }
                    }
                }
            }
            .padding(.horizontal, 12)
            .padding(.vertical, 6)
            footer {
                footerButton("Add existing items", "plus") { sheet = .items }
                Spacer(minLength: 0)
                footerButton("Space settings", "gearshape") { sheet = .settings }
            }
        }
    }

    private func recent(_ view: Studio.SpaceWidgetOutput) -> some View {
        let items = view.recent ?? []
        let count = Int(view.itemCount ?? 0)
        return VStack(alignment: .leading, spacing: 0) {
            ForEach(Array(items.enumerated()), id: \.offset) { _, item in
                let kind = studio.items.first { $0.pluginId == item.pluginId && $0.itemId == item.id }.map { StudioKind.of($0.kind) }
                row(kind?.symbol ?? "doc", glyph: item.icon, item.title ?? "Untitled", item.kindLabel ?? "",
                    aside: item.updatedAt.map(relative)) {
                    open(item.href)
                }
            }
            if items.isEmpty { empty("Nothing here yet.") }
            footer {
                footerButton("Add items", "plus") { sheet = .items }
                if count > items.count {
                    footerButton("Show all \(count) in Studio", "arrow.up.right") { operation.complete(on: app) { app.openStudio(space: target.spaceId) } }
                }
            }
        }
    }

    private func threads(_ view: Studio.SpaceWidgetOutput, conversations: Bool) -> some View {
        let threads = (view.threads ?? []).filter { ($0.kind != .thread) == conversations }
        let shown = showingAll ? threads : Array(threads.prefix(Self.shownThreads))
        return VStack(alignment: .leading, spacing: 0) {
            ForEach(Array(shown.enumerated()), id: \.offset) { _, thread in
                row(symbol(thread), glyph: nil, thread.title ?? "Thread", place(thread, in: view),
                    aside: thread.updatedAt.map(relative)) {
                    if let id = thread.id { Task { await openThread(id, channel: thread.kind == .channel) } }
                }
            }
            if threads.isEmpty { empty(conversations ? "No channels or messages yet." : "No threads yet.") }
            footer {
                if conversations {
                    footerButton("Add channel or message", "plus") { sheet = .threads(conversations: true) }
                } else {
                    footerButton("New thread", "square.and.pencil") { operation.complete(on: app) { app.newThread(text: view.threadPrompt ?? "") } }
                    footerButton("Add threads", "plus") { sheet = .threads(conversations: false) }
                }
                if threads.count > Self.shownThreads {
                    footerButton(showingAll ? "Show fewer" : "Show all \(threads.count)", nil) { showingAll.toggle() }
                }
            }
        }
    }

    private func projects(_ view: Studio.SpaceWidgetOutput) -> some View {
        let projects = view.projects ?? []
        return VStack(alignment: .leading, spacing: 0) {
            ForEach(Array(projects.enumerated()), id: \.offset) { _, project in
                let items = Int(project.items ?? 0)
                let threads = Int(project.threads ?? 0)
                row("folder", glyph: nil, project.name ?? "Project",
                    "\(items == 1 ? "1 item" : "\(items) items") · \(threads == 1 ? "1 thread" : "\(threads) threads")",
                    aside: project.isDefault == true ? "Default" : nil) {
                    if let id = project.id { openProject(id) }
                }
            }
            if projects.isEmpty { empty("No projects yet.") }
            footer {
                footerButton("Add or remove projects", "plus") { sheet = .projects }
            }
        }
    }

    // MARK: Pieces

    private func tile(_ title: String, _ symbol: String, key: String, action: @escaping () -> Void) -> some View {
        Button(action: action) {
            HStack(spacing: 8) {
                if busy == key {
                    ProgressView().controlSize(.small)
                } else {
                    Image(systemName: symbol).foregroundStyle(.secondary)
                }
                Text(title).font(.subheadline).lineLimit(1)
                Spacer(minLength: 0)
            }
            .padding(.horizontal, 10)
            .frame(height: 40)
            .background(Color(.systemBackground), in: .rect(cornerRadius: 8))
        }
        .buttonStyle(.plain)
        .disabled(busy == key)
        .accessibilityIdentifier("spaceCreate")
    }

    private func row(
        _ symbol: String, glyph: String?, _ title: String, _ subtitle: String, aside: String?, action: @escaping () -> Void
    ) -> some View {
        Button(action: action) {
            HStack(spacing: 10) {
                Group {
                    if let glyph, !glyph.isEmpty { Text(glyph) } else { Image(systemName: symbol).foregroundStyle(.secondary) }
                }
                .frame(width: 28, height: 28)
                .background(Color(.systemBackground), in: .rect(cornerRadius: 6))
                VStack(alignment: .leading, spacing: 1) {
                    Text(title).font(.subheadline).lineLimit(1)
                    if !subtitle.isEmpty { Text(subtitle).font(.caption).foregroundStyle(.secondary).lineLimit(1) }
                }
                Spacer(minLength: 4)
                if let aside { Text(aside).font(.caption).foregroundStyle(.secondary).lineLimit(1) }
            }
            .padding(.horizontal, 12)
            .padding(.vertical, 5)
            .contentShape(.rect)
        }
        .buttonStyle(.plain)
    }

    private func empty(_ text: String) -> some View {
        Text(text).font(.caption).foregroundStyle(.secondary.opacity(0.8)).padding(.horizontal, 12).padding(.vertical, 8)
    }

    private func footer(@ViewBuilder _ content: () -> some View) -> some View {
        VStack(spacing: 0) {
            Divider()
            ScrollView(.horizontal, showsIndicators: false) {
                HStack(spacing: 4) { content() }.padding(.horizontal, 6).padding(.vertical, 4)
            }
        }
        .padding(.top, 4)
    }

    private func footerButton(_ title: String, _ symbol: String?, action: @escaping () -> Void) -> some View {
        Button(action: action) {
            HStack(spacing: 4) {
                if let symbol { Image(systemName: symbol) }
                Text(title)
            }
            .font(.caption)
            .foregroundStyle(.secondary)
            .padding(.horizontal, 6)
            .frame(minHeight: 30)
            .contentShape(.rect)
        }
        .buttonStyle(.plain)
    }

    private func symbol(_ thread: Studio.SpaceWidgetOutputThreadsItem) -> String {
        if thread.status == "active" || thread.status == "starting" { return "ellipsis.bubble" }
        switch thread.kind {
        case .channel: return "number"
        case .dm: return "person.crop.square"
        default: return "bubble.left"
        }
    }

    private func place(_ thread: Studio.SpaceWidgetOutputThreadsItem, in view: Studio.SpaceWidgetOutput) -> String {
        switch thread.kind {
        case .channel: return "Channel"
        case .dm: return "With \(thread.botName ?? "a bot")"
        default:
            guard let projectId = thread.projectId else { return "No project" }
            return view.projects?.first { $0.id == projectId }?.name ?? studio.projectNames[projectId] ?? "Project"
        }
    }

    private func relative(_ ms: Double) -> String {
        Date(timeIntervalSince1970: ms / 1000).formatted(.relative(presentation: .named, unitsStyle: .abbreviated))
    }

    // MARK: Actions

    /// An add-on's own dialog makes event kinds, like bots; BB web has it.
    private func make(_ kind: Studio.SpaceWidgetOutputKindsItem, in view: Studio.SpaceWidgetOutput) async {
        guard let pluginId = kind.pluginId, let id = kind.id else { return }
        let spaceId = target.spaceId.addingPercentEncoding(withAllowedCharacters: .urlPathAllowed) ?? target.spaceId
        if kind.event != nil {
            openWeb((pluginId == "bot-teams" || (pluginId == "studio" && id == "bot")) ? "/plugins/studio/bots/new/space/\(spaceId)" : "/plugins/studio/studio/space/\(spaceId)")
            return
        }
        busy = "\(pluginId):\(id)"
        defer { busy = nil }
        do {
            open(try await client.createInSpace(target.spaceId, pluginId: pluginId, kind: id))
            await widgets.load(target.spaceId, client: client, fresh: true)
        } catch {
            notice = "Couldn't make a \((kind.label ?? "item").lowercased()): \(BBClient.describe(error, server: client.baseURL))"
        }
    }

    private func open(_ href: String?) {
        guard let href else { return }
        if let route = Route(href: href) {
            operation.complete(on: app) { app.push(route) }
        } else {
            openWeb(href)
        }
    }

    private func openWeb(_ path: String) {
        guard client.baseURL == app.serverURL else { return }
        guard let url = URL(string: path, relativeTo: client.baseURL) else { return }
        UIApplication.shared.open(url)
    }

    /// A channel opens as its channel when Bot Teams knows it, and as a thread otherwise.
    private func openThread(_ id: String, channel: Bool) async {
        operation.complete(on: app) { app.push(.thread(id: id)) }
    }

    /// The phone has no project view; Studio shows what the project holds.
    private func openProject(_ id: String) {
        guard client.baseURL == app.serverURL else { return }
        UserDefaults.standard.set(id, forKey: ServerScope.key("studioProject", serverURL: client.baseURL))
        app.studioSpace = nil
        operation.complete(on: app) { app.openStudio(kind: nil) }
    }
}

enum SpaceWidgetSheet: Identifiable, Hashable {
    case settings, items, projects
    case threads(conversations: Bool)

    var id: String {
        switch self {
        case .settings: "settings"
        case .items: "items"
        case .projects: "projects"
        case .threads(let conversations): conversations ? "channels" : "threads"
        }
    }
}

// MARK: Settings

/// Which space the settings sheet edits; nil makes a new one.
struct SpaceSheet: Identifiable {
    var space: StudioSpace?
    var id: String { space?.id ?? "new" }
}

/// Makes a space, or renames, describes and deletes one, and puts back the
/// widgets its page lacks.
struct SpaceSettingsSheet: View {
    let space: StudioSpace?
    /// The space to load when the sheet opens before Studio's list has it.
    var spaceId: String?
    /// Called with the saved space, or nil when it was deleted.
    var done: (StudioSpace?) -> Void = { _ in }
    @EnvironmentObject private var app: AppModel
    private let operation = ServerOperation()
    private var client: BBClient { operation.client }
    @Environment(\.dismiss) private var dismiss
    @ObservedObject private var studio = StudioStore.shared
    @State private var loaded: StudioSpace?
    @State private var name = ""
    @State private var icon = ""
    @State private var description = ""
    @State private var defaultProjectId = ""
    @State private var busy = false
    @State private var error: String?
    @State private var message: String?
    @State private var confirmingDelete = false

    private var current: StudioSpace? { space ?? loaded }
    private var isNew: Bool { space == nil && spaceId == nil }

    /// The same choices as Studio's picker on the web.
    static let icons = [
        "🚀", "🎯", "📣", "💡", "🧪", "🛠️", "📚", "🗓️", "📊", "📈", "🧭", "🗺️", "🏗️", "🔥", "⭐", "🧠",
        "🤖", "💼", "💰", "📦", "🎨", "🎬", "🎵", "📷", "✈️", "🏠", "🌱", "🌍", "❤️", "🏆", "🧩", "🔒",
    ]

    var body: some View {
        NavigationStack {
            Form {
                Section {
                    TextField("Name", text: $name).accessibilityIdentifier("spaceName")
                    TextField("Description", text: $description, axis: .vertical).lineLimit(2...5)
                }
                Section("Icon") {
                    LazyVGrid(columns: Array(repeating: GridItem(.flexible(), spacing: 4), count: 8), spacing: 4) {
                        ForEach(Self.icons, id: \.self) { each in
                            Button { icon = each } label: {
                                Text(each).font(.title3).frame(maxWidth: .infinity, minHeight: 36)
                                    .background(icon == each ? Color.accentColor.opacity(0.2) : .clear, in: .rect(cornerRadius: 8))
                            }
                            .buttonStyle(.plain)
                            .accessibilityLabel(each)
                            .accessibilityAddTraits(icon == each ? .isSelected : [])
                        }
                    }
                    if !icon.isEmpty { Button("No Icon") { icon = "" } }
                }
                Section {
                    Picker("Default project", selection: $defaultProjectId) {
                        Text("None").tag("")
                        ForEach(projects, id: \.id) { Text($0.name).tag($0.id) }
                    }
                } footer: {
                    Text("New items and threads made in the space go to this project.")
                }
                if let current, !isNew {
                    if current.pageId != nil {
                        Section {
                            Button("Restore Missing Widgets") { Task { await restore(current) } }
                                .disabled(busy)
                        } footer: {
                            Text(message ?? "Puts back the widgets you removed from the space's page.")
                        }
                    }
                    Section {
                        Button("Delete Space", role: .destructive) { confirmingDelete = true }.disabled(busy)
                    } footer: {
                        Text("Its items, threads and projects stay where they are.")
                    }
                }
                if let error {
                    Section { Text(error).foregroundStyle(.red) }
                }
            }
            .navigationTitle(isNew ? "New Space" : "Space Settings")
            .navigationBarTitleDisplayMode(.inline)
            .toolbar {
                ToolbarItem(placement: .cancellationAction) { Button("Cancel") { operation.complete(on: app) { dismiss() } } }
                ToolbarItem(placement: .confirmationAction) {
                    Button(isNew ? "Create" : "Save") { Task { await save() } }
                        .disabled(busy || name.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty || (!isNew && current == nil))
                }
            }
            .confirmationDialog("Delete \u{201C}\(current?.name ?? "")\u{201D}?", isPresented: $confirmingDelete, titleVisibility: .visible) {
                Button("Delete Space", role: .destructive) { Task { await delete() } }
            } message: {
                Text("Its items, threads and projects stay where they are.")
            }
        }
        .task {
            if studio.projectNames.isEmpty { studio.restore() }
            if space == nil, let spaceId {
                if studio.space(spaceId) == nil { await studio.reloadSpaces(client) }
                loaded = studio.space(spaceId)
            }
            if let current = current {
                name = current.name
                icon = current.icon ?? ""
                description = current.description
                defaultProjectId = current.defaultProjectId ?? ""
            }
        }
    }

    private var projects: [(id: String, name: String)] {
        var names = studio.projectNames
        if !defaultProjectId.isEmpty, names[defaultProjectId] == nil { names[defaultProjectId] = "Project" }
        return names.map { ($0.key, $0.value) }.sorted { $0.name.localizedStandardCompare($1.name) == .orderedAscending }
    }

    private func save() async {
        busy = true
        defer { busy = false }
        let name = name.trimmingCharacters(in: .whitespacesAndNewlines)
        let icon = icon.trimmingCharacters(in: .whitespaces)
        let description = description.trimmingCharacters(in: .whitespacesAndNewlines)
        let project = defaultProjectId.isEmpty ? nil : defaultProjectId
        do {
            let saved: StudioSpace
            if let current, !isNew {
                saved = try await client.updateSpace(
                    current.id, name: name, icon: icon.isEmpty ? nil : icon, description: description, defaultProjectId: project)
            } else {
                saved = try await client.createSpace(
                    name: name, icon: icon.isEmpty ? nil : icon, description: description, defaultProjectId: project)
            }
            studio.saved(saved)
            await studio.load(client)
            operation.complete(on: app) { dismiss() }
            operation.complete(on: app) { done(saved) }
        } catch {
            self.error = BBClient.describe(error, server: client.baseURL)
        }
    }

    private func restore(_ space: StudioSpace) async {
        busy = true
        defer { busy = false }
        do {
            let added = try await client.restoreSpaceWidgets(space.id)
            message = added == 0 ? "The page has every widget." : "Added \(added) widget\(added == 1 ? "" : "s") to the page."
        } catch {
            self.error = BBClient.describe(error, server: client.baseURL)
        }
    }

    private func delete() async {
        guard let current else { return }
        busy = true
        defer { busy = false }
        do {
            try await studio.deleteSpace(current, client: client)
            guard client.baseURL == app.serverURL else { return }
            if app.studioSpace == current.id { app.studioSpace = nil }
            operation.complete(on: app) { dismiss() }
            operation.complete(on: app) { done(nil) }
        } catch {
            self.error = BBClient.describe(error, server: client.baseURL)
        }
    }
}

// MARK: Adding to a space

/// Studio items to add to the space or take out of it.
struct SpaceItemsSheet: View {
    let spaceId: String
    @EnvironmentObject private var app: AppModel
    private let operation = ServerOperation()
    private var client: BBClient { operation.client }
    @Environment(\.dismiss) private var dismiss
    @ObservedObject private var studio = StudioStore.shared
    @State private var query = ""
    @State private var error: String?

    var body: some View {
        NavigationStack {
            List {
                if let error { Text(error).foregroundStyle(.red) }
                ForEach(items) { item in
                    let held = item.spaces?.contains(spaceId) == true
                    let direct = studio.space(spaceId)?.itemKeys.contains(item.id) == true
                    Button { Task { await toggle(item) } } label: {
                        HStack {
                            StudioRow(item: item, project: nil)
                            Image(systemName: held ? "checkmark.circle.fill" : "circle")
                                .foregroundStyle(held ? Color.accentColor : .secondary)
                        }
                    }
                    .buttonStyle(.plain)
                    .disabled(held && !direct)
                }
            }
            .overlay {
                if items.isEmpty { ContentUnavailableView.search(text: query) }
            }
            .searchable(text: $query, prompt: "Search Studio")
            .navigationTitle("Add Items")
            .navigationBarTitleDisplayMode(.inline)
            .toolbar { ToolbarItem(placement: .confirmationAction) { Button("Done") { operation.complete(on: app) { dismiss() } } } }
        }
        .task {
            if studio.items.isEmpty { studio.restore() }
            await studio.load(client)
        }
    }

    /// Everything but archived items, spaces and the space's own page; ones in it first.
    private var items: [StudioItem] {
        let pageId = studio.space(spaceId)?.pageId
        let list = studio.items.filter { item in
            guard !item.archived, item.kind != "space", !(item.pluginId == "pages" && item.itemId == pageId) else { return false }
            return query.isEmpty || item.title.localizedCaseInsensitiveContains(query)
        }
        return list.filter { $0.spaces?.contains(spaceId) == true } + list.filter { $0.spaces?.contains(spaceId) != true }
    }

    private func toggle(_ item: StudioItem) async {
        if studio.space(spaceId) == nil { await studio.reloadSpaces(client) }
        guard let space = studio.space(spaceId) else { return }
        do {
            try await studio.toggle(space, on: item, client: client)
        } catch {
            self.error = BBClient.describe(error, server: client.baseURL)
        }
    }
}

/// Threads, or channels and direct messages, to add to the space or take out of it.
struct SpaceThreadsSheet: View {
    let spaceId: String
    let conversations: Bool
    @EnvironmentObject private var app: AppModel
    private let operation = ServerOperation()
    private var client: BBClient { operation.client }
    @Environment(\.dismiss) private var dismiss
    @ObservedObject private var studio = StudioStore.shared
    @State private var recent: [Studio.RecentThreadsOutputThreadsItem] = []
    @State private var loading = true
    @State private var error: String?

    private struct Choice: Identifiable {
        var id: String
        var title: String
        var subtitle: String
        var symbol: String
    }

    var body: some View {
        NavigationStack {
            List {
                if let error { Text(error).foregroundStyle(.red) }
                ForEach(choices) { choice in
                    let held = studio.space(spaceId)?.threadIds.contains(choice.id) == true
                    Button { Task { await toggle(choice.id, held: held) } } label: {
                        HStack(spacing: 12) {
                            Image(systemName: choice.symbol).foregroundStyle(.secondary).frame(width: 24)
                            VStack(alignment: .leading, spacing: 2) {
                                Text(choice.title).lineLimit(1)
                                Text(choice.subtitle).font(.caption).foregroundStyle(.secondary)
                            }
                            Spacer()
                            Image(systemName: held ? "checkmark.circle.fill" : "circle")
                                .foregroundStyle(held ? Color.accentColor : .secondary)
                        }
                        .contentShape(.rect)
                    }
                    .buttonStyle(.plain)
                }
            }
            .overlay {
                if loading {
                    ProgressView()
                } else if choices.isEmpty {
                    ContentUnavailableView(conversations ? "No channels or messages" : "No open threads", systemImage: "bubble.left")
                }
            }
            .navigationTitle(conversations ? "Add Channels and Messages" : "Add Threads")
            .navigationBarTitleDisplayMode(.inline)
            .toolbar { ToolbarItem(placement: .confirmationAction) { Button("Done") { operation.complete(on: app) { dismiss() } } } }
        }
        .task {
            if studio.space(spaceId) == nil { await studio.reloadSpaces(client) }
            do {
                recent = try await client.recentSpaceThreads()
            } catch {
                self.error = BBClient.describe(error, server: client.baseURL)
            }
            loading = false
        }
    }

    /// The ones added to the space first, then the rest of the open ones.
    private var choices: [Choice] {
        let held = Set(studio.space(spaceId)?.threadIds ?? [])
        let widget = (SpaceWidgets.shared.views[spaceId]?.threads ?? []).filter { held.contains($0.id ?? "") }
        var seen: Set<String> = []
        var result: [Choice] = []
        func add(_ id: String?, _ title: String?, _ kind: String?, _ botName: String?) {
            guard let id, !seen.contains(id), (kind != "thread") == conversations else { return }
            seen.insert(id)
            let symbol = kind == "channel" ? "number" : kind == "dm" ? "person.crop.square" : "bubble.left"
            let subtitle = kind == "channel" ? "Channel" : kind == "dm" ? "With \(botName ?? "a bot")" : "Thread"
            result.append(Choice(id: id, title: title ?? "Thread", subtitle: subtitle, symbol: symbol))
        }
        for thread in widget { add(thread.id, thread.title, thread.kind.map(Self.name), thread.botName) }
        for thread in recent { add(thread.id, thread.title, thread.kind.map(Self.name), thread.botName) }
        return result.filter { held.contains($0.id) } + result.filter { !held.contains($0.id) }
    }

    private static func name(_ kind: Studio.SpaceWidgetOutputThreadsItemKind) -> String {
        switch kind {
        case .thread: "thread"
        case .channel: "channel"
        case .dm: "dm"
        case .unknown(let value): value
        }
    }

    private static func name(_ kind: Studio.RecentThreadsOutputThreadsItemKind) -> String {
        switch kind {
        case .thread: "thread"
        case .channel: "channel"
        case .dm: "dm"
        case .unknown(let value): value
        }
    }

    private func toggle(_ id: String, held: Bool) async {
        let ref = (pluginId: StudioSpace.threadRef, id: id)
        do {
            studio.saved(try await client.spaceMembers(spaceId, add: held ? [] : [ref], remove: held ? [ref] : []))
        } catch {
            self.error = BBClient.describe(error, server: client.baseURL)
        }
    }
}

/// BB projects whose items and threads all belong to the space.
struct SpaceProjectsSheet: View {
    let spaceId: String
    @EnvironmentObject private var app: AppModel
    private let operation = ServerOperation()
    private var client: BBClient { operation.client }
    @Environment(\.dismiss) private var dismiss
    @ObservedObject private var studio = StudioStore.shared
    @State private var error: String?

    var body: some View {
        NavigationStack {
            List {
                if let error { Text(error).foregroundStyle(.red) }
                Section {
                    ForEach(projects, id: \.id) { project in
                        let held = studio.space(spaceId)?.projectIds.contains(project.id) == true
                        Button { Task { await toggle(project.id, held: held) } } label: {
                            HStack {
                                Label(project.name, systemImage: "folder")
                                Spacer()
                                Image(systemName: held ? "checkmark.circle.fill" : "circle")
                                    .foregroundStyle(held ? Color.accentColor : .secondary)
                            }
                            .contentShape(.rect)
                        }
                        .buttonStyle(.plain)
                    }
                } footer: {
                    Text("Everything in a project, its items and threads, belongs to the space.")
                }
            }
            .overlay {
                if projects.isEmpty { ContentUnavailableView("No projects", systemImage: "folder") }
            }
            .navigationTitle("Projects")
            .navigationBarTitleDisplayMode(.inline)
            .toolbar { ToolbarItem(placement: .confirmationAction) { Button("Done") { operation.complete(on: app) { dismiss() } } } }
        }
        .task {
            if studio.space(spaceId) == nil { await studio.reloadSpaces(client) }
            if studio.projectNames.isEmpty { await studio.load(client) }
        }
    }

    private var projects: [(id: String, name: String)] {
        studio.projectNames.map { ($0.key, $0.value) }.sorted { $0.name.localizedStandardCompare($1.name) == .orderedAscending }
    }

    private func toggle(_ id: String, held: Bool) async {
        let ref = (pluginId: StudioSpace.projectRef, id: id)
        do {
            studio.saved(try await client.spaceMembers(spaceId, add: held ? [] : [ref], remove: held ? [ref] : []))
        } catch {
            self.error = BBClient.describe(error, server: client.baseURL)
        }
    }
}

// MARK: A thread's spaces

/// The spaces a thread or channel is in, for its menu.
@MainActor
final class ThreadSpacesModel: ObservableObject {
    @Published private(set) var held: ThreadSpaces?
    @Published private(set) var all: [StudioSpace] = []

    func load(_ threadId: String, client: BBClient) async {
        held = try? await client.spacesForThread(threadId)
        all = held == nil ? [] : (try? await client.studioSpaces()) ?? []
    }

    var others: [StudioSpace] { all.filter { space in held?.spaces.contains { $0.id == space.id } != true } }
    var removable: [StudioSpace] { (held?.spaces ?? []).filter { held?.inherited.contains($0.id) != true } }
    var available: Bool { held.map { !$0.spaces.isEmpty || !all.isEmpty } ?? false }

    func change(_ space: StudioSpace, add: Bool, threadId: String, client: BBClient) async throws {
        let ref = (pluginId: StudioSpace.threadRef, id: threadId)
        try await client.spaceMembers(space.id, add: add ? [ref] : [], remove: add ? [] : [ref])
        await load(threadId, client: client)
    }
}

/// A submenu that opens the thread's spaces, adds it to another, or takes it out of one.
struct ThreadSpacesMenu: View {
    @ObservedObject var model: ThreadSpacesModel
    let threadId: String
    var failed: (String) -> Void
    @EnvironmentObject private var app: AppModel
    private let operation = ServerOperation()
    private var client: BBClient { operation.client }

    var body: some View {
        if model.available, let held = model.held {
            Menu {
                if !held.spaces.isEmpty {
                    Section("In spaces") {
                        ForEach(held.spaces) { space in
                            Button { operation.complete(on: app) { app.push(.space(id: space.id)) } } label: {
                                Label(held.inherited.contains(space.id) ? "\(name(space)) · Project" : name(space), systemImage: "arrow.up.right")
                            }
                        }
                    }
                }
                if !model.others.isEmpty {
                    Section("Add to space") {
                        ForEach(model.others) { space in
                            Button { change(space, add: true) } label: { Label(name(space), systemImage: "plus") }
                        }
                    }
                }
                if !model.removable.isEmpty {
                    Section {
                        ForEach(model.removable) { space in
                            Button { change(space, add: false) } label: { Label("Remove from \(space.name)", systemImage: "xmark") }
                        }
                    }
                }
            } label: {
                Label(held.spaces.isEmpty ? "Add to Space" : "Spaces: \(held.spaces.map(\.name).joined(separator: ", "))",
                    systemImage: "square.stack.3d.up")
            }
        }
    }

    private func name(_ space: StudioSpace) -> String {
        space.emoji.map { "\($0) \(space.name)" } ?? space.name
    }

    private func change(_ space: StudioSpace, add: Bool) {
        Task {
            do {
                try await model.change(space, add: add, threadId: threadId, client: client)
            } catch {
                failed(BBClient.describe(error, server: client.baseURL))
            }
        }
    }
}
