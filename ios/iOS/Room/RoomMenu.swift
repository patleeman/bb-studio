import SwiftUI

struct RoomPlaceSheet: View {
    static let sliver: CGFloat = 12

    let place: RoomPlace
    let bot: BotSpace
    @ObservedObject var store: BotSpacesStore
    let mainThreadId: String
    var open: (BotShellItem) -> Void
    var startedConversation: (String) -> Void
    var closeToRoom: () -> Void
    var theme: String = ""
    var chooseTheme: (String) -> Void = { _ in }
    var path: Binding<[Route]>? = nil
    var back: (() -> Void)? = nil
    /// The open conversation.
    var shown: String? = nil
    var settings: (() -> Void)? = nil
    var switchBot: ((String, String?) -> Void)? = nil
    @State private var ownPath: [Route] = []
    @EnvironmentObject private var app: AppModel
    @Environment(\.look) private var look

    var body: some View {
        NavigationStack(path: path ?? $ownPath) {
            Group {
                if let back {
                    content
                        .environment(\.spreadInline, true)
                        .toolbar(.hidden, for: .navigationBar)
                        .safeAreaInset(edge: .top, spacing: 0) { RoomSpreadHeader(title: place.title, back: back) }
                        .containerBackground(.clear, for: .navigation)
                } else {
                    content
                }
            }
                .navigationDestination(for: Route.self) { route in
                    if case .roomPlace(let raw) = route, let place = RoomPlace(rawValue: raw) {
                        content(for: place)
                    } else {
                        RouteDestination(route: route)
                    }
                }
        }
        .tint(look.accent)
        .accessibilityElement(children: .contain)
        .accessibilityIdentifier("RoomSheet-\(place.rawValue)")
    }

    @ViewBuilder private var content: some View { content(for: place) }

    @ViewBuilder private func content(for place: RoomPlace) -> some View {
        switch place {
        case .strands:
            StrandsOverviewView(botId: bot.id) { open(.conversation($0)) }
        case .memory:
            MemoryPageView(botId: bot.id, open: open)
        case .library:
            LibraryPageView(botId: bot.id, open: open, tiles: true)
        case .schedules:
            BotAutomationsSheet(botId: bot.id, botName: bot.name, embedded: true, allAutomations: true).id(bot.id)
        case .theme:
            RoomThemePicker(bot: bot, current: theme, choose: chooseTheme)
        case .archive:
            ArchivePageView(botId: bot.id, open: open, refresh: { Task { await store.refresh() } })
        case .conversations:
            RoomConversations(bot: bot, store: store, mainThreadId: mainThreadId, open: open,
                              started: startedConversation, closeToRoom: closeToRoom,
                              shown: shown ?? mainThreadId, settings: settings,
                              placeView: { AnyView(content(for: $0)) }, switchBot: switchBot,
                              pushPlace: { place in (path ?? $ownPath).wrappedValue.append(.roomPlace(place.rawValue)) })
        }
    }
}

struct RoomConversations: View {
    let bot: BotSpace
    @ObservedObject var store: BotSpacesStore
    let mainThreadId: String
    var open: (BotShellItem) -> Void
    var started: (String) -> Void
    var closeToRoom: () -> Void
    var shown: String? = nil
    var settings: (() -> Void)? = nil
    var placeView: ((RoomPlace) -> AnyView)? = nil
    /// Another Bot from the header's menu (the home's list); with a conversation, that Bot opens on it.
    var switchBot: ((String, String?) -> Void)? = nil
    /// Pushes a Bot place on the list's stack (as a route, so links inside it push too).
    var pushPlace: ((RoomPlace) -> Void)? = nil
    @EnvironmentObject private var app: AppModel
    @State private var starting = false
    @State private var removed: Set<String> = []
    /// Conversations whose workers the user opened or closed; others open while one runs or needs you.
    @State private var toggled: [String: Bool] = [:]
    @State private var openFolds: Set<String> = []
    @State private var deleting: BotConversation?
    /// Searches the one list: the Bot's conversations and workers, and the project threads.
    @State private var query = ""
    @StateObject private var projects = RoomProjects()
    /// Projects starts closed; each project too.
    @State private var projectsOpen = false
    @State private var openProjects: Set<String> = []
    /// Quick Open: Studio items that match the search.
    @State private var studioMatches: [Studio.SearchAllOutputItem] = []
    @Environment(\.look) private var look

    private var view: BotThreadsView? { store.view(for: bot.id) }
    private var searching: Bool { !query.trimmingCharacters(in: .whitespaces).isEmpty }

    var body: some View {
        let all = BotShell.lines(view).filter { !removed.contains($0.threadId) }
        let lines = searching ? all.filter { $0.title.localizedCaseInsensitiveContains(query) } : all
        let nests = BotWorkerNests.make(conversations: all.map(\.threadId), workers: view?.workers ?? [])
        List {
            Section {
                RoomListHeader(bot: bot, view: view, refresh: { await store.refresh() }, switchBot: switchBot.map { pick in { pick($0, nil) } },
                               openPlace: pushPlace)
            }
                .listRowBackground(Color.clear)
            Section {
                searchField
            }
            .listRowBackground(Color.clear)
            .listRowInsets(EdgeInsets(top: 0, leading: 4, bottom: 0, trailing: 4))
            // Home (round 5): needs you first, then what runs, then the rest.
            if searching {
                Section {
                    ForEach(lines) { line in conversationRow(line, nest: nil) }
                }
            } else {
                let groups = HomeGroups.make(lines)
                ForEach(groups) { group in
                    Section {
                        ForEach(group.lines) { line in conversationRow(line, nest: nests.nests[line.threadId]) }
                    } header: {
                        HomeSectionHeader(group: group)
                    }
                }
            }
            if searching {
                quickOpenSections
                let workers = (view?.workers ?? []).filter { $0.title.localizedCaseInsensitiveContains(query) }
                if !workers.isEmpty {
                    Section("Workers") {
                        ForEach(workers, id: \.threadId) { worker in
                            workerRow(worker, depth: 0)
                        }
                    }
                }
            } else if let other = nests.other, !other.nodes.isEmpty {
                Section("Other workers") {
                    workerLines(other, parent: "other")
                }
            }
            projectsSection
        }
        .safeAreaInset(edge: .bottom, spacing: 0) { homeComposer }
        .task(id: query) { await searchStudio() }
        .listStyle(.insetGrouped)
        .scrollContentBackground(.hidden)
        .refreshable {
            await store.refresh()
            if projects.loaded { await loadProjects() }
        }
        .task(id: projectsOpen || searching) {
            if (projectsOpen || searching) && !projects.loaded { await loadProjects() }
        }
        .modifier(PageChrome(title: "Home") {
            if let settings {
                Button(action: settings) { Image(systemName: "gearshape") }
                    .accessibilityLabel("Settings")
                    .accessibilityIdentifier("roomSettings")
            }
        })
        .onChange(of: view?.conversations.map(\.threadId)) { _, ids in
            removed.formIntersection(ids ?? [])
        }
        .alert(ConversationFinish.deleteTitle(deleting?.title ?? ""),
               isPresented: Binding(get: { deleting != nil }, set: { if !$0 { deleting = nil } }), presenting: deleting) { conversation in
            Button("Cancel", role: .cancel) {}
            Button("Delete", role: .destructive) { remove(conversation.threadId, delete: true) }
                .accessibilityIdentifier("confirmDelete")
        } message: { _ in
            Text(ConversationFinish.deleteMessage)
        }
        .sheet(isPresented: $starting) {
            NewThreadView(botId: bot.id) { id, botId in
                Task {
                    // Another Bot's list loads first, so its room opens on the new conversation.
                    if let botId, botId != bot.id { store.watch(botId, fetch: false) }
                    await store.refresh()
                    guard let botId else { return open(.worker(id)) }
                    guard botId != bot.id, let switchBot else { return started(id) }
                    RoomHome.remember(id, botId: botId)
                    switchBot(botId, id)
                }
            }
        }
    }

    /// Home's composer (round 5): the one way to start a conversation. It opens
    /// the new conversation's composer with its Bot, project and model line.
    private var homeComposer: some View {
        Button { starting = true } label: {
            HStack(spacing: 10) {
                Image(systemName: "plus").font(.body.weight(.semibold)).foregroundStyle(look.accent)
                Text("Start something with \(bot.name)").foregroundStyle(.secondary)
                Spacer(minLength: 0)
                Image(systemName: "mic").foregroundStyle(.secondary)
            }
            .padding(.horizontal, 16)
            .frame(minHeight: 50)
            .background(.fill.tertiary, in: .capsule)
            .contentShape(.capsule)
        }
        .buttonStyle(.plain)
        .padding(.horizontal, 12)
        .padding(.vertical, 8)
        .background(.bar)
        .accessibilityLabel("Start something with \(bot.name)")
        .accessibilityIdentifier("roomNewConversation")
    }

    /// Quick Open's other results: places and Studio items that match.
    @ViewBuilder private var quickOpenSections: some View {
        let trimmed = query.trimmingCharacters(in: .whitespaces)
        let places = (RoomPlace.homeList + [.archive]).filter { $0.title.localizedCaseInsensitiveContains(trimmed) }
        let archivedThreads = "Archived threads".localizedCaseInsensitiveContains(trimmed)
        if (!places.isEmpty && pushPlace != nil) || archivedThreads {
            Section("Places") {
                if let pushPlace {
                    ForEach(places) { place in
                        Button { pushPlace(place) } label: { Label(place.title, systemImage: place.symbol) }
                            .accessibilityIdentifier("quickOpenPlace-\(place.rawValue)")
                    }
                }
                if archivedThreads {
                    // BB's own archived threads (Bot conversations are in Archive).
                    Button {
                        closeToRoom()
                        Router.shared.detailPath = [.archived]
                    } label: { Label("Archived threads", systemImage: "archivebox") }
                        .accessibilityIdentifier("quickOpenArchivedThreads")
                }
            }
        }
        let items = studioMatches.compactMap { item -> (Studio.SearchAllOutputItem, Route)? in
            guard item.kind != "thread", let href = item.href, let route = Route(href: href) else { return nil }
            return (item, route)
        }
        if !items.isEmpty {
            Section("Studio") {
                ForEach(items.indices, id: \.self) { index in
                    let (item, route) = items[index]
                    Button {
                        closeToRoom()
                        Router.shared.detailPath = [route]
                    } label: {
                        VStack(alignment: .leading, spacing: 2) {
                            Text(item.title ?? "Untitled").lineLimit(1)
                            if let text = item.snippet?.text, !text.isEmpty {
                                Text(text).font(.footnote).foregroundStyle(.secondary).lineLimit(1)
                            }
                        }
                        .frame(minHeight: 44, alignment: .leading)
                    }
                    .tint(.primary)
                    .accessibilityIdentifier("quickOpenItem-\(index)")
                }
            }
        }
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

    /// In the list, not the navigation bar: the folded Duo's sheet has no bar to hold one.
    private var searchField: some View {
        HStack(spacing: 6) {
            Image(systemName: "magnifyingglass").foregroundStyle(.secondary)
            TextField("Search conversations, Studio and places", text: $query)
                .textInputAutocapitalization(.never)
                .autocorrectionDisabled()
                .submitLabel(.search)
                .accessibilityIdentifier("roomSearch")
            if searching {
                Button { query = "" } label: { Image(systemName: "xmark.circle.fill").foregroundStyle(.secondary) }
                    .buttonStyle(.borderless)
                    .accessibilityLabel("Clear search")
                    .accessibilityIdentifier("roomSearchClear")
            }
        }
        .padding(.horizontal, 10)
        .frame(minHeight: 36)
        .background(.fill.tertiary, in: .rect(cornerRadius: 10, style: .continuous))
    }

    private func loadProjects() async {
        await projects.load(client: app.client, bots: store.spaces?.bots ?? [bot])
    }


    @ViewBuilder private func conversationRow(_ line: BotConversationLine, nest: BotWorkerNest?) -> some View {
        HStack(spacing: 8) {
            Button {
                open(.conversation(line.threadId))
            } label: {
                HStack {
                    BotConversationRow(line: line)
                    if line.threadId == (shown ?? mainThreadId) {
                        Text("You're here").font(.footnote).foregroundStyle(look.success)
                    }
                }
                .contentShape(.rect)
            }
            .buttonStyle(.borderless)
            .tint(.primary)
            .accessibilityIdentifier("roomConversation-\(line.threadId)")
            if let nest {
                nestToggle(nest, key: line.threadId)
            }
        }
        .swipeActions(edge: .trailing, allowsFullSwipe: false) { removeActions(line.threadId, swipe: true) }
        .contextMenu { removeActions(line.threadId, swipe: false) }
        if let nest, nestOpen(nest, key: line.threadId) {
            workerLines(nest, parent: line.threadId)
        }
    }

    /// BB's threads that belong to no Bot, by project, under the Bot's own: closed until opened, each project too.
    @ViewBuilder private var projectsSection: some View {
        let groups = projects.groups(query: searching ? query : "")
        Section {
            if !searching {
                Button {
                    withAnimation(.snappy) { projectsOpen.toggle() }
                } label: {
                    HStack(spacing: 8) {
                        Label("Projects", systemImage: "folder")
                        Spacer(minLength: 4)
                        if projects.loading { ProgressView().controlSize(.small) }
                        Image(systemName: projectsOpen ? "chevron.down" : "chevron.right")
                            .font(.footnote.weight(.semibold)).foregroundStyle(.secondary)
                    }
                    .frame(minHeight: 36)
                    .contentShape(.rect)
                }
                .buttonStyle(.borderless)
                .tint(.primary)
                .accessibilityLabel(projectsOpen ? "Projects, open" : "Projects")
                .accessibilityIdentifier("roomProjects")
            }
            if projectsOpen || searching {
                if let error = projects.error {
                    Text(error).font(.footnote).foregroundStyle(.secondary)
                } else if projects.loaded && groups.isEmpty {
                    Text(searching ? "No project threads match" : "No threads outside the Bots")
                        .font(.footnote).foregroundStyle(.secondary)
                }
                ForEach(groups) { group in
                    if searching {
                        ForEach(group.lines) { line in projectThread(line, project: group.name) }
                    } else {
                        projectHeader(group)
                        if openProjects.contains(group.id) {
                            ForEach(group.lines) { line in projectThread(line, project: nil) }
                        }
                    }
                }
            }
        } header: {
            if searching { Text("Projects") }
        }
    }

    private func projectHeader(_ group: ProjectThreads.Group) -> some View {
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
            .frame(minHeight: 36)
            .contentShape(.rect)
        }
        .buttonStyle(.borderless)
        .tint(.primary)
        .accessibilityLabel("\(group.name), \(group.count) \(group.count == 1 ? "thread" : "threads")")
        .accessibilityIdentifier("roomProject-\(group.id)")
    }

    private func projectThread(_ line: ProjectThreads.Line, project: String?) -> some View {
        Button { open(.worker(line.thread.id)) } label: {
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
            .frame(minHeight: 36)
            .contentShape(.rect)
        }
        .buttonStyle(.borderless)
        .tint(.primary)
        .accessibilityIdentifier("projectThread-\(line.thread.id)")
    }


    @ViewBuilder private func removeActions(_ threadId: String, swipe: Bool) -> some View {
        if let conversation = view?.conversations.first(where: { $0.threadId == threadId }), ConversationFinish.canRemove(conversation) {
            Button { remove(threadId, delete: false) } label: { Label("Archive", systemImage: "archivebox") }
                .tint(.indigo)
                .accessibilityIdentifier("roomConversationArchive-\(threadId)")
            Button(role: swipe ? nil : .destructive) { deleting = conversation } label: { Label("Delete", systemImage: "trash") }
                .tint(.red)
                .accessibilityIdentifier("roomConversationDelete-\(threadId)")
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

    private func nestOpen(_ nest: BotWorkerNest, key: String) -> Bool {
        toggled[key] ?? (nest.running > 0 || nest.needsYou > 0)
    }

    /// The toggle on a conversation's row: a chevron and the count, a spinner while one runs, amber while one needs you.
    private func nestToggle(_ nest: BotWorkerNest, key: String) -> some View {
        let isOpen = nestOpen(nest, key: key)
        return Button {
            withAnimation(.snappy) { toggled[key] = !isOpen }
        } label: {
            HStack(spacing: 4) {
                Image(systemName: isOpen ? "chevron.down" : "chevron.right").font(.caption2.weight(.semibold))
                if nest.needsYou > 0 {
                    Circle().fill(look.needsYou).frame(width: 6, height: 6)
                    Text("\(nest.needsYou)")
                }
                if nest.running > 0 {
                    ProgressView().controlSize(.mini)
                    Text("\(nest.running)")
                }
                if nest.needsYou == 0 && nest.running == 0 { Text("\(nest.total)") }
            }
            .font(.caption.monospacedDigit())
            .foregroundStyle(nest.needsYou > 0 ? AnyShapeStyle(look.needsYou) : AnyShapeStyle(.secondary))
            .padding(.horizontal, 7).frame(minHeight: 26)
            .overlay(Capsule().strokeBorder(nest.needsYou > 0 ? AnyShapeStyle(look.needsYou.opacity(0.5)) : AnyShapeStyle(.separator), lineWidth: 0.5))
            .frame(minWidth: 44, minHeight: 44)
            .contentShape(.rect)
        }
        .buttonStyle(.borderless)
        .accessibilityLabel(nest.label)
        .accessibilityValue(isOpen ? "Shown" : "Hidden")
        .accessibilityIdentifier("roomNestToggle-\(key)")
    }

    @ViewBuilder private func workerLines(_ nest: BotWorkerNest, parent: String) -> some View {
        ForEach(BotWorkerNests.lines(nest.nodes, parent: parent, openFolds: openFolds)) { line in
            switch line {
            case .worker(let worker, let depth):
                workerRow(worker, depth: depth)
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
                    .padding(.leading, 20 + CGFloat(depth) * 16)
                    .contentShape(.rect)
                }
                .tint(.primary)
                .accessibilityIdentifier("roomFold-\(key)")
            }
        }
    }

    private func workerRow(_ worker: BotWorker, depth: Int) -> some View {
        Button { open(.worker(worker.threadId)) } label: {
            HStack(spacing: 8) {
                BotWorkerGlyph(status: worker.status).frame(width: 16)
                if let logo = ProviderLogo(worker.providerId) {
                    logo.frame(width: 13, height: 13).accessibilityHidden(true)
                }
                Text(worker.title.isEmpty ? "Worker" : worker.title).lineLimit(1)
                Spacer(minLength: 8)
                Text(BotShell.shortAge(worker.updatedAt)).font(.footnote).monospacedDigit().foregroundStyle(.secondary)
            }
            .font(.subheadline)
            .padding(.leading, 20 + CGFloat(depth) * 16)
            .contentShape(.rect)
        }
        .tint(.primary)
        .accessibilityIdentifier("roomWorker-\(worker.threadId)")
    }
}

/// The one list's Projects: BB's thread list and which threads are the Bots', loaded when Projects opens or a search starts.
@MainActor
final class RoomProjects: ObservableObject {
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

/// Home's three groups (round 5): Needs you, Running, Earlier; empty ones left out.
struct HomeGroups: Identifiable, Equatable {
    enum Kind: String { case needsYou, running, earlier }
    var kind: Kind
    var lines: [BotConversationLine]
    var id: String { kind.rawValue }

    static func make(_ lines: [BotConversationLine]) -> [HomeGroups] {
        [HomeGroups(kind: .needsYou, lines: lines.filter { $0.tone == .needsYou }),
         HomeGroups(kind: .running, lines: lines.filter { $0.tone == .running }),
         HomeGroups(kind: .earlier, lines: lines.filter { $0.tone == .quiet })].filter { !$0.lines.isEmpty }
    }
}

/// A Home group's header: its mark and its name (shape and word, not colour alone).
struct HomeSectionHeader: View {
    let group: HomeGroups
    @Environment(\.look) private var look

    var body: some View {
        HStack(spacing: 6) {
            switch group.kind {
            case .needsYou: Circle().fill(look.needsYou).frame(width: 7, height: 7).accessibilityHidden(true)
            case .running: ProgressView().controlSize(.mini).accessibilityHidden(true)
            case .earlier: EmptyView()
            }
            Text(group.kind == .needsYou ? "Needs you" : group.kind == .running ? "Running" : "Earlier")
        }
        .accessibilityElement(children: .combine)
        .accessibilityAddTraits(.isHeader)
        .accessibilityIdentifier("homeSection-\(group.kind.rawValue)")
    }
}
