import SwiftUI

/// Home (8a): the root page, the desktop's sidebar on one screen. The Bot,
/// its pages (Memory, Library), then its conversations with their workers
/// nested under them, BB's other threads by project, and Archive. Search
/// finds conversations, workers, Studio's items and the places. Everything
/// opens pushed over it.
struct HomeView: View {
    let bot: BotSpace
    @ObservedObject var store: BotSpacesStore
    /// Narrow (the flat Duo's Home column, 9e): a plain list, the Bot on one small row.
    var column = false
    @ObservedObject private var router = Router.shared
    @EnvironmentObject private var app: AppModel
    @State private var query = ""
    @FocusState private var searchFocused: Bool
    @State private var removed: Set<String> = []
    @State private var deleting: BotConversation?
    @StateObject private var projects = HomeProjects()
    @State private var projectsOpen = false
    @State private var studioMatches: [Studio.SearchAllOutputItem] = []
    @Environment(\.look) private var look

    private var view: BotThreadsView? { store.view(for: bot.id) }
    private var searching: Bool { !query.trimmingCharacters(in: .whitespaces).isEmpty }

    var body: some View {
        List {
            Section {
                ShellSearchField(text: $query, prompt: "Search conversations, Memory and Library", id: "homeSearch", focused: $searchFocused)
            }
            .listRowBackground(Color.clear)
            .listRowInsets(EdgeInsets(top: 0, leading: 4, bottom: 0, trailing: 4))
            if searching {
                HomeSearchResults(bot: bot, view: view, query: query, studio: studioMatches, projects: projects.groups(query: query),
                                  open: open)
            } else {
                Section { HomeBotHeader(bot: bot, view: view, compact: column, refresh: { await store.refresh() }) }
                    .listRowBackground(Color.clear)
                Section { places }
                conversations
                HomeProjectsSection(projects: projects, open: $projectsOpen, openThread: { router.path = [.thread(id: $0)] })
                Section {
                    row("Archive", "archivebox", id: "homeArchive") { router.path = [.place(.archive)] }
                }
            }
        }
        .modifier(HomeListStyle(column: column))
        .scrollContentBackground(.hidden)
        .environment(\.defaultMinListRowHeight, 44)
        .refreshable {
            await store.refresh()
            if projects.loaded { await loadProjects() }
        }
        .task(id: query) { await searchStudio() }
        .task(id: projectsOpen || searching) {
            if (projectsOpen || searching) && !projects.loaded { await loadProjects() }
        }
        .onChange(of: router.searchRequests) { _, _ in searchFocused = true }
        .onChange(of: view?.conversations.map(\.threadId)) { _, ids in removed.formIntersection(ids ?? []) }
        .alert(ConversationFinish.deleteTitle(deleting?.title ?? ""),
               isPresented: Binding(get: { deleting != nil }, set: { if !$0 { deleting = nil } }), presenting: deleting) { conversation in
            Button("Cancel", role: .cancel) {}
            Button("Delete", role: .destructive) { remove(conversation.threadId, delete: true) }
                .accessibilityIdentifier("confirmDelete")
        } message: { _ in
            Text(ConversationFinish.deleteMessage)
        }
        .accessibilityIdentifier("home")
    }

    private var places: some View {
        Group {
            row("Memory", BotPage.memory.symbol, id: "homeMemory") { router.path = [.place(.memory)] }
            row("Library", BotPage.library.symbol, id: "homeLibrary") { router.path = [.place(.library)] }
        }
    }

    @ViewBuilder private var conversations: some View {
        let lines = BotShell.lines(view).filter { !removed.contains($0.threadId) }
        let nests = BotWorkerNests.make(conversations: lines.map(\.threadId), workers: view?.workers ?? [])
        Section {
            ForEach(lines) { line in
                HomeConversationRow(line: line, nest: nests.nests[line.threadId], current: line.threadId == router.conversation,
                                    open: open)
                    .swipeActions(edge: .trailing, allowsFullSwipe: false) { removeActions(line.threadId, swipe: true) }
                    .contextMenu { removeActions(line.threadId, swipe: false) }
            }
            if let other = nests.other, !other.nodes.isEmpty {
                HomeWorkerLines(nest: other, parent: "other", open: open)
            }
        } header: {
            Text("Conversations").accessibilityIdentifier("homeConversations")
        }
    }

    private func row(_ title: String, _ symbol: String, id: String, action: @escaping () -> Void) -> some View {
        Button(action: action) {
            HStack(spacing: 12) {
                Image(systemName: symbol)
                    .font(.subheadline.weight(.medium))
                    .foregroundStyle(look.accent)
                    .frame(width: 30, height: 30)
                    .background(look.accent.opacity(0.14), in: .rect(cornerRadius: 7))
                Text(title)
                Spacer(minLength: 4)
                Image(systemName: "chevron.right").font(.footnote.weight(.semibold)).foregroundStyle(.tertiary)
            }
            .contentShape(.rect)
        }
        .tint(.primary)
        .accessibilityIdentifier(id)
    }

    private func open(_ item: BotShellItem) {
        searchFocused = false
        router.open(item: item)
    }

    @ViewBuilder private func removeActions(_ threadId: String, swipe: Bool) -> some View {
        if let conversation = view?.conversations.first(where: { $0.threadId == threadId }), ConversationFinish.canRemove(conversation) {
            Button { remove(threadId, delete: false) } label: { Label("Archive", systemImage: "archivebox") }
                .tint(.indigo)
                .accessibilityIdentifier("homeArchive-\(threadId)")
            Button(role: swipe ? nil : .destructive) { deleting = conversation } label: { Label("Delete", systemImage: "trash") }
                .tint(.red)
                .accessibilityIdentifier("homeDelete-\(threadId)")
        }
    }

    private func remove(_ threadId: String, delete: Bool) {
        withAnimation(.snappy) { _ = removed.insert(threadId) }
        let client = app.client
        Task {
            do {
                if delete {
                    try await client.delete(threadId, withChildren: true)
                } else {
                    try await client.finishConversation(threadId: threadId)
                }
                await store.refresh()
            } catch {
                withAnimation(.snappy) { _ = removed.remove(threadId) }
                app.flash((delete ? "It didn't delete: " : "It didn't archive: ") + BBClient.describe(error, server: client.baseURL))
            }
        }
    }

    private func loadProjects() async {
        await projects.load(client: app.client, bots: store.spaces?.bots ?? [bot])
    }

    private func searchStudio() async {
        let trimmed = query.trimmingCharacters(in: .whitespaces)
        guard trimmed.count >= 2 else {
            if !studioMatches.isEmpty { studioMatches = [] }
            return
        }
        try? await Task.sleep(for: .milliseconds(300))
        guard !Task.isCancelled, let found = try? await app.client.studioSearchAll(trimmed), !Task.isCancelled else { return }
        studioMatches = Array(found.prefix(12))
    }
}

/// Home is an inset list on its own page and a plain one as the open Duo's
/// column. There a plain list's rows get no trailing margin (its stack is
/// handed the window's trailing inset, a screen away, and the column
/// ignores it): times and chevrons would touch the divider.
private struct HomeListStyle: ViewModifier {
    let column: Bool

    func body(content: Content) -> some View {
        if column {
            content.listStyle(.plain).safeAreaPadding(.trailing, 12)
        } else {
            content.listStyle(.insetGrouped)
        }
    }
}

/// Search, as Home's first row (9d: not a bar button).

/// The Bot (8a): its still, its name (a menu: switch Bot, Schedules, Theme,
/// Settings) and the one status line.
struct HomeBotHeader: View {
    let bot: BotSpace
    let view: BotThreadsView?
    /// The flat Duo's narrow column: a small still, and the controls only in the name's menu.
    var compact = false
    var refresh: () async -> Void
    @ObservedObject private var spaces = BotSpacesStore.shared
    @ObservedObject private var router = Router.shared

    var body: some View {
        HStack(spacing: 12) {
            PresenceView(bot: bot, state: bot.presenceState(live: view),
                         workers: view?.workers.filter { $0.status == .running }.count ?? bot.activity.workers,
                         size: compact ? 30 : 44, stillOnly: true)
            VStack(alignment: .leading, spacing: 1) {
                Menu { menu } label: {
                    HStack(spacing: 4) {
                        Text(bot.name).font(compact ? .headline : .title3.weight(.semibold)).lineLimit(1)
                        Image(systemName: "chevron.down").font(.footnote.weight(.semibold)).foregroundStyle(.secondary)
                    }
                    .foregroundStyle(.primary)
                    .frame(minHeight: 32)
                    .contentShape(.rect)
                }
                .menuOrder(.fixed)
                .tint(.primary)
                .accessibilityLabel("\(bot.name), Bot menu")
                .accessibilityIdentifier("botSwitcher")
                Text(Self.status(view, paused: bot.paused ? bot.state : nil))
                    .font(compact ? .footnote : .subheadline).foregroundStyle(.secondary).lineLimit(1)
                    .accessibilityIdentifier("homeBotStatus")
            }
            Spacer(minLength: 0)
            if !compact { BotControlsMenu(bot: bot, view: view, refresh: refresh) }
        }
        .accessibilityElement(children: .contain)
        .accessibilityIdentifier("homeBot")
    }

    @ViewBuilder private var menu: some View {
        let bots = spaces.spaces?.bots ?? []
        if bots.count > 1 {
            Picker("Bot", selection: Binding(get: { bot.id }, set: { id in
                if id != bot.id { router.show(id, store: spaces) }
            })) {
                ForEach(bots) { each in Text(each.name).tag(each.id).accessibilityIdentifier("botSwitch-\(each.id)") }
            }
            .pickerStyle(.inline)
        }
        Section {
            Button { router.path = [.place(.automations)] } label: { Label("Schedules", systemImage: BotPage.automations.symbol) }
                .accessibilityIdentifier("homeSchedules")
            Button { router.path = [.theme] } label: { Label("Theme", systemImage: "paintpalette") }
                .accessibilityIdentifier("homeTheme")
            Button { router.path = [.settings] } label: { Label("Settings", systemImage: "gearshape") }
                .accessibilityIdentifier("homeSettings")
        }
    }

    /// "2 running", "Paused", or "Idle": the only status line.
    static func status(_ view: BotThreadsView?, paused: String? = nil) -> String {
        if let paused { return paused == "stopped" ? "Stopped" : "Paused" }
        let running = (view?.workers.filter { $0.status == .running }.count ?? 0) + (view?.conversations.filter(\.running).count ?? 0)
        return running > 0 ? "\(running) running" : "Idle"
    }
}

/// A conversation (8a): its title and time, one line of preview, its
/// workers on a thin guide line under it. Running adds a glyph before the time.
struct HomeConversationRow: View {
    let line: BotConversationLine
    let nest: BotWorkerNest?
    let current: Bool
    let open: (BotShellItem) -> Void

    var body: some View {
        Button { open(.conversation(line.threadId)) } label: {
            VStack(alignment: .leading, spacing: 2) {
                HStack(alignment: .firstTextBaseline, spacing: 8) {
                    Text(line.title).font(.body.weight(.semibold)).lineLimit(1).layoutPriority(1)
                    Spacer(minLength: 4)
                    HomeRowStatus(running: line.running, age: BotShell.shortAge(line.updatedAt))
                }
                if !line.text.isEmpty {
                    Text(line.text).font(.subheadline).foregroundStyle(.secondary).lineLimit(1)
                }
            }
            .padding(.vertical, 2)
            .contentShape(.rect)
        }
        .tint(.primary)
        .listRowBackground(current ? Rectangle().fill(.fill.secondary) : nil)
        .accessibilityAddTraits(current ? .isSelected : [])
        .accessibilityIdentifier("homeConversation-\(line.threadId)")
        if let nest { HomeWorkerLines(nest: nest, parent: line.threadId, open: open) }
    }
}

/// A conversation's workers under it, on a guide line: running and new ones,
/// then "N done" folded.
struct HomeWorkerLines: View {
    let nest: BotWorkerNest
    let parent: String
    let open: (BotShellItem) -> Void
    @State private var openFolds: Set<String> = []

    var body: some View {
        ForEach(BotWorkerNests.lines(nest.nodes, parent: parent, openFolds: openFolds)) { line in
            switch line {
            case .worker(let worker, let depth):
                HomeWorkerRow(worker: worker, depth: depth, open: open)
            case .fold(let key, let count, let depth):
                Button {
                    withAnimation(.snappy) { if openFolds.contains(key) { openFolds.remove(key) } else { openFolds.insert(key) } }
                } label: {
                    HStack(spacing: 6) {
                        Image(systemName: openFolds.contains(key) ? "chevron.down" : "chevron.right").font(.caption2.weight(.semibold))
                        Text("\(count) done")
                        Spacer()
                    }
                    .font(.subheadline).foregroundStyle(.secondary)
                    .padding(.leading, HomeWorkerRow.indent(depth))
                    .contentShape(.rect)
                }
                .tint(.primary)
                .accessibilityIdentifier("homeFold-\(key)")
            }
        }
    }
}

struct HomeWorkerRow: View {
    let worker: BotWorker
    let depth: Int
    let open: (BotShellItem) -> Void

    static func indent(_ depth: Int) -> CGFloat { 14 + CGFloat(depth) * 16 }

    var body: some View {
        Button { open(.worker(worker.threadId)) } label: {
            HStack(spacing: 10) {
                BotWorkerGlyph(status: worker.status).frame(width: 16)
                Text(worker.title.isEmpty ? "Worker" : worker.title).lineLimit(1)
                Spacer(minLength: 8)
                Text(worker.status == .done ? "Done" : BotShell.shortAge(worker.updatedAt))
                    .font(.footnote).monospacedDigit().foregroundStyle(.secondary)
            }
            .font(.subheadline)
            .padding(.leading, Self.indent(depth))
            .overlay(alignment: .leading) {
                Rectangle().fill(.separator).frame(width: 1).padding(.leading, Self.indent(depth) - 12).padding(.vertical, -6)
            }
            .contentShape(.rect)
        }
        .tint(.primary)
        .accessibilityIdentifier("homeWorker-\(worker.threadId)")
    }
}

/// A worker's state, by shape and word: a spinner while it runs, a pause
/// while it waits on an answer, ✓ done, ✕ failed.
struct BotWorkerGlyph: View {
    let status: BotWorker.Status
    @Environment(\.look) private var look

    var body: some View {
        switch status {
        case .running:
            RunningGlyph().accessibilityLabel("Running")
        case .needsYou:
            Image(systemName: "pause.circle").font(.footnote).foregroundStyle(.secondary).accessibilityLabel("Waiting")
        case .failed:
            Image(systemName: "xmark.circle.fill").foregroundStyle(look.error).accessibilityLabel("Failed")
        case .done, .other:
            Image(systemName: "checkmark").font(.footnote.weight(.semibold)).foregroundStyle(look.success).accessibilityLabel("Done")
        }
    }
}

/// What a search finds: conversations, workers, places, Studio's items and project threads.
private struct HomeSearchResults: View {
    let bot: BotSpace
    let view: BotThreadsView?
    let query: String
    let studio: [Studio.SearchAllOutputItem]
    let projects: [ProjectThreads.Group]
    let open: (BotShellItem) -> Void
    @ObservedObject private var router = Router.shared

    var body: some View {
        let trimmed = query.trimmingCharacters(in: .whitespaces)
        let lines = BotShell.lines(view).filter { $0.title.localizedCaseInsensitiveContains(trimmed) }
        let workers = (view?.workers ?? []).filter { $0.title.localizedCaseInsensitiveContains(trimmed) }
        let places = [BotPage.memory, .library, .automations, .archive].filter { $0.title.localizedCaseInsensitiveContains(trimmed) }
        if !lines.isEmpty {
            Section("Conversations") {
                ForEach(lines) { HomeConversationRow(line: $0, nest: nil, current: false, open: open) }
            }
        }
        if !workers.isEmpty {
            Section("Workers") {
                ForEach(workers, id: \.threadId) { HomeWorkerRow(worker: $0, depth: 0, open: open) }
            }
        }
        if !places.isEmpty {
            Section("Places") {
                ForEach(places) { page in
                    Button { router.path = [.place(page)] } label: { Label(page.title, systemImage: page.symbol) }
                        .accessibilityIdentifier("homePlace-\(page.rawValue)")
                }
            }
        }
        let items = studio.compactMap { item -> (Studio.SearchAllOutputItem, Route)? in
            guard item.kind != "thread", let href = item.href, let route = Route(href: href) else { return nil }
            return (item, route)
        }
        if !items.isEmpty {
            Section("Studio") {
                ForEach(items.indices, id: \.self) { index in
                    let (item, route) = items[index]
                    Button { router.path = [route] } label: {
                        VStack(alignment: .leading, spacing: 2) {
                            Text(item.title ?? "Untitled").lineLimit(1)
                            if let text = item.snippet?.text, !text.isEmpty {
                                Text(text).font(.footnote).foregroundStyle(.secondary).lineLimit(1)
                            }
                        }
                    }
                    .tint(.primary)
                    .accessibilityIdentifier("homeStudioItem-\(index)")
                }
            }
        }
        if !projects.isEmpty {
            Section("Projects") {
                ForEach(projects) { group in
                    ForEach(group.lines) { line in
                        HomeProjectThread(line: line, project: group.name) { router.path = [.thread(id: line.thread.id)] }
                    }
                }
            }
        }
    }
}

/// BB's threads that belong to no Bot, by project: closed until opened, each project too.
private struct HomeProjectsSection: View {
    @ObservedObject var projects: HomeProjects
    @Binding var open: Bool
    let openThread: (String) -> Void
    @State private var openProjects: Set<String> = []

    var body: some View {
        Section {
            Button { withAnimation(.snappy) { open.toggle() } } label: {
                HStack(spacing: 8) {
                    Label("Projects", systemImage: "folder")
                    Spacer(minLength: 4)
                    if projects.loading { ProgressView().controlSize(.small) }
                    Image(systemName: open ? "chevron.down" : "chevron.right").font(.footnote.weight(.semibold)).foregroundStyle(.secondary)
                }
                .contentShape(.rect)
            }
            .tint(.primary)
            .accessibilityLabel(open ? "Projects, open" : "Projects")
            .accessibilityIdentifier("homeProjects")
            if open {
                let groups = projects.groups(query: "")
                if let error = projects.error {
                    Text(error).font(.footnote).foregroundStyle(.secondary)
                } else if projects.loaded && groups.isEmpty {
                    Text("No threads outside the Bots").font(.footnote).foregroundStyle(.secondary)
                }
                ForEach(groups) { group in
                    Button {
                        withAnimation(.snappy) {
                            if openProjects.contains(group.id) { openProjects.remove(group.id) } else { openProjects.insert(group.id) }
                        }
                    } label: {
                        HStack(spacing: 6) {
                            Image(systemName: openProjects.contains(group.id) ? "chevron.down" : "chevron.right")
                                .font(.caption2.weight(.semibold)).foregroundStyle(.secondary).frame(width: 14)
                            Text(group.name).font(.subheadline.weight(.semibold)).lineLimit(1)
                            Spacer(minLength: 4)
                            Text("\(group.count)").font(.footnote).monospacedDigit().foregroundStyle(.secondary)
                        }
                        .padding(.leading, 8)
                        .contentShape(.rect)
                    }
                    .tint(.primary)
                    .accessibilityIdentifier("homeProject-\(group.id)")
                    if openProjects.contains(group.id) {
                        ForEach(group.lines) { line in HomeProjectThread(line: line, project: nil) { openThread(line.thread.id) } }
                    }
                }
            }
        }
    }
}

private struct HomeProjectThread: View {
    let line: ProjectThreads.Line
    let project: String?
    let open: () -> Void
    @Environment(\.look) private var look

    var body: some View {
        Button(action: open) {
            HStack(spacing: 8) {
                if line.thread.isUnread { Circle().fill(look.accent).frame(width: 7, height: 7) }
                VStack(alignment: .leading, spacing: 1) {
                    Text(line.thread.displayTitle).font(.subheadline).lineLimit(1)
                    if let project { Text(project).font(.caption).foregroundStyle(.secondary).lineLimit(1) }
                }
                Spacer(minLength: 6)
                Text(BotShell.shortAge(line.thread.updatedAt)).font(.footnote).monospacedDigit().foregroundStyle(.secondary)
            }
            .padding(.leading, 30 + CGFloat(line.depth) * 16)
            .contentShape(.rect)
        }
        .tint(.primary)
        .accessibilityIdentifier("projectThread-\(line.thread.id)")
    }
}

/// Home's Projects: BB's thread list and which threads are the Bots', loaded when Projects opens or a search starts.
@MainActor
final class HomeProjects: ObservableObject {
    @Published private(set) var sidebar: SidebarBootstrap?
    @Published private(set) var botThreads: Set<String> = []
    @Published private(set) var loading = false
    @Published private(set) var error: String?
    var loaded: Bool { sidebar != nil }

    func groups(query: String) -> [ProjectThreads.Group] {
        guard let sidebar else { return [] }
        return ProjectThreads.groups(sidebar, botThreads: botThreads, query: query)
    }

    func load(client: BBClient, bots: [BotSpace]) async {
        guard !loading else { return }
        loading = true
        defer { loading = false }
        async let owned = client.botThreadIds(bots: bots)
        do {
            let next = try await client.sidebar()
            botThreads = await owned
            sidebar = next
            error = nil
        } catch {
            _ = await owned
            if sidebar == nil { self.error = BBClient.describe(error, server: client.baseURL) }
        }
    }
}

/// Something running for as long as it takes (a worker, the Bot's turn,
/// background work): the design's ◌, still. A spinner here would animate for
/// hours, keeping the render server busy and the phone warm, and the app
/// never idle.
/// A row's trailing status: a glyph while it runs, then the time. Never a
/// word that could wrap: the title has the room (Patrick, round 7 Duo).
struct HomeRowStatus: View {
    let running: Bool
    let age: String

    var body: some View {
        HStack(spacing: 4) {
            if running { RunningGlyph() }
            Text(age).monospacedDigit()
        }
        .font(.footnote)
        .foregroundStyle(.secondary)
        .lineLimit(1)
        .fixedSize()
        .accessibilityElement(children: .ignore)
        .accessibilityLabel(running ? "Working, \(age)" : age)
    }
}

struct RunningGlyph: View {
    var body: some View {
        Image(systemName: "circle.dotted")
            .font(.footnote.weight(.semibold))
            .foregroundStyle(.secondary)
    }
}
