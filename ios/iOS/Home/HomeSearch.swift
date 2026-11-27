import SwiftUI

/// The Search tab: conversations, workers, the Bot's places, Studio's items
/// and project threads, from the native search field. A conversation or a
/// place opens in its own tab; anything else pushes here.
struct HomeSearchView: View {
    let bot: BotSpace
    @ObservedObject var store: BotSpacesStore
    @ObservedObject private var router = Router.shared
    @EnvironmentObject private var app: AppModel
    @State private var query = ""
    @StateObject private var projects = HomeProjects()
    @State private var studio: [Studio.SearchAllOutputItem] = []

    private var trimmed: String { query.trimmingCharacters(in: .whitespaces) }

    var body: some View {
        List {
            if !trimmed.isEmpty {
                HomeSearchResults(bot: bot, view: store.view(for: bot.id), query: query, studio: studio,
                                  projects: projects.groups(query: query), open: router.open(item:))
            }
        }
        .listStyle(.insetGrouped)
        .scrollContentBackground(.hidden)
        .overlay {
            if trimmed.isEmpty {
                ContentUnavailableView("Search", systemImage: "magnifyingglass",
                                       description: Text("Conversations, workers, Memory, Library and Studio's items."))
            }
        }
        .navigationTitle("Search")
        .navigationBarTitleDisplayMode(.large)
        .searchable(text: $query, prompt: "Conversations, Memory and Library")
        .task(id: trimmed) { await searchStudio() }
        .task(id: trimmed.isEmpty) {
            if !trimmed.isEmpty && !projects.loaded { await projects.load(client: app.client, bots: store.spaces?.bots ?? [bot]) }
        }
        .accessibilityIdentifier("search")
    }

    private func searchStudio() async {
        guard trimmed.count >= 2 else {
            if !studio.isEmpty { studio = [] }
            return
        }
        try? await Task.sleep(for: .milliseconds(300))
        guard !Task.isCancelled, let found = try? await app.client.studioSearchAll(trimmed), !Task.isCancelled else { return }
        studio = Array(found.prefix(12))
    }
}

/// What a search finds: conversations, workers, places, Studio's items and project threads.
struct HomeSearchResults: View {
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
                    Button { router.show(page) } label: { Label(page.title, systemImage: page.symbol) }
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
                    Button { router.searchPath = [route] } label: {
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
                        HomeProjectThread(line: line, project: group.name) { router.searchPath = [.thread(id: line.thread.id)] }
                    }
                }
            }
        }
    }
}
