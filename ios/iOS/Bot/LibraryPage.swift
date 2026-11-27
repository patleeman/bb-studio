import SwiftUI

/// Library as a full page (design 8e): every page, design, recording, drawing
/// and app the Bot made, newest first, filtered by kind. One line per item:
/// its title, its kind and when. An item opens pushed, in its own viewer.
struct LibraryPageView: View {
    let botId: String?
    @EnvironmentObject private var app: AppModel
    @State private var load = PageLoad<[BotLibraryItem]>()
    @State private var query = ""
    @State private var filter: LibraryPage.Filter = .all
    @State private var refreshed = 0
    @State private var making = false

    private var scope: String { "\(app.client.baseURL.absoluteString)|\(botId ?? "")" }

    var body: some View {
        List {
            BotPageChips(choices: LibraryPage.Filter.allCases.map { ($0, $0.title) }, selection: $filter)
            if load.value != nil, let error = load.error {
                PageLoadErrorRow(message: error, id: "libraryRowRetry") { load.retry() }
            }
            if let items = load.value {
                LibrarySections(sections: LibraryPage.sections(items, query: query, filter: filter), empty: items.isEmpty)
            }
        }
        .listStyle(.plain)
        .overlay { LibraryLoadState(load: load) }
        .navigationTitle("Library")
        .navigationBarTitleDisplayMode(.large)
        .shellSearchable(text: $query, prompt: "Search library")
        .toolbar { LibraryNewPageButton(making: making) { Task { await makePage() } } }
        .refreshable {
            await load.reload()
            refreshed += 1
        }
        .sensoryFeedback(.selection, trigger: filter)
        .sensoryFeedback(.impact(weight: .light), trigger: refreshed)
        .task(id: scope) { start() }
        .onChange(of: botId) { _, _ in
            query = ""
            filter = .all
        }
        .accessibilityIdentifier("library-page")
    }

    private func start() {
        #if DEBUG
        RenderCount.bump("library.open")
        #endif
        let (client, botId) = (app.client, botId)
        load.describe = { BBClient.describe($0, server: client.baseURL) }
        load.run(key: scope) { try await client.botLibrary(botId: botId) }
    }

    /// + New page: a blank page, opened pushed for writing.
    private func makePage() async {
        making = true
        defer { making = false }
        do {
            let page = try await app.client.createPage(title: "Untitled", markdown: "")
            Router.shared.push(.page(id: page.id))
        } catch {
            app.flash("The page wasn't made: " + BBClient.describe(error, server: app.client.baseURL))
        }
    }
}

private struct LibrarySections: View {
    let sections: [LibraryPage.Section]
    let empty: Bool

    var body: some View {
        if sections.isEmpty {
            ContentUnavailableView(empty ? "Nothing yet" : "Nothing matches", systemImage: "books.vertical",
                                   description: Text(empty ? "Pages, designs, recordings, drawings and apps the Bot makes show here." : ""))
                .listRowSeparator(.hidden)
        }
        ForEach(sections) { section in
            Section(section.title) {
                ForEach(section.items) { LibraryRow(item: $0) }
            }
        }
    }
}

private struct LibraryRow: View {
    let item: BotLibraryItem

    var body: some View {
        if let route = item.route {
            NavigationLink(value: route) { LibraryRowLabel(item: item) }
                .accessibilityIdentifier("library-row-\(item.itemId)")
        } else {
            LibraryRowLabel(item: item).opacity(0.6)
                .accessibilityHint("Opens in BB on your Mac")
                .accessibilityIdentifier("library-row-\(item.itemId)")
        }
    }
}

/// The kind's glyph, the title, and "Kind · when" under it.
private struct LibraryRowLabel: View {
    let item: BotLibraryItem

    var body: some View {
        let kind = StudioKind.of(item.studioKind)
        HStack(spacing: 12) {
            Image(systemName: kind.symbol)
                .font(.subheadline)
                .foregroundStyle(kind.tint)
                .frame(width: 34, height: 34)
                .background(kind.tint.opacity(0.12), in: .rect(cornerRadius: 8))
                .accessibilityHidden(true)
            VStack(alignment: .leading, spacing: 2) {
                Text(item.title).lineLimit(1)
                Text(LibraryPage.meta(item)).font(.footnote).foregroundStyle(.secondary).lineLimit(1)
            }
        }
        .frame(minHeight: 44)
        .accessibilityElement(children: .combine)
    }
}

/// + New page in Library's bar.
private struct LibraryNewPageButton: ToolbarContent {
    let making: Bool
    let make: () -> Void

    var body: some ToolbarContent {
        ToolbarItem(placement: .primaryAction) {
            Button(action: make) { Label("New page", systemImage: "plus") }
                .disabled(making)
                .accessibilityIdentifier("libraryNewPage")
        }
    }
}

private struct LibraryLoadState: View {
    let load: PageLoad<[BotLibraryItem]>

    var body: some View {
        if load.value == nil {
            if let error = load.error {
                PageLoadFailed(title: "The library didn't load", message: error, id: "libraryRetry") { load.retry() }
            } else {
                ProgressView().accessibilityIdentifier("libraryLoading")
            }
        }
    }
}
