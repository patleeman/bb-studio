import SwiftUI

/// Archived threads, newest first, with swipe to restore; with `spaceId`, only that Space's.
struct ArchivedView: View {
    var spaceId: String?
    @EnvironmentObject private var app: AppModel
    /// Which Space each thread is in, for `spaceId`.
    @State private var assignment: SpaceAssignment?
    @State private var threads: [ThreadEntry] = []
    @State private var loaded = false
    @State private var more = true
    /// Archived threads read from BB so far: the next page's offset.
    @State private var fetched = 0
    @State private var error: String?
    @State private var query = ""
    @State private var done = 0

    private static let page = 50

    var body: some View {
        List {
            if let error {
                Section { ConnectionBanner(message: error) { await load() } }
            }
            ForEach(shown) { thread in
                NavigationLink(value: Route.thread(id: thread.id)) {
                    VStack(alignment: .leading, spacing: 2) {
                        ThreadRow(thread: thread, project: thread.projectName)
                        if let archived = thread.archivedAt {
                            Text("Archived \(Date(timeIntervalSince1970: archived / 1000), format: .relative(presentation: .named))")
                                .font(.caption2)
                                .foregroundStyle(.tertiary)
                                .padding(.leading, 18)
                        }
                    }
                }
                .swipeActions(edge: .trailing) {
                    Button { Task { await unarchive(thread) } } label: {
                        Label("Unarchive", systemImage: "tray.and.arrow.up")
                    }
                    .tint(.blue)
                }
                .contextMenu {
                    Button { Task { await unarchive(thread) } } label: {
                        Label("Unarchive", systemImage: "tray.and.arrow.up")
                    }
                }
            }
            if more, loaded, query.isEmpty {
                // Keyed by the offset, so a spinner still on screen after a page asks for the next.
                ProgressView()
                    .frame(maxWidth: .infinity)
                    .task(id: fetched) { await load(more: true) }
            }
        }
        .overlay {
            if !loaded {
                ProgressView()
            } else if shown.isEmpty, error == nil, !(more && query.isEmpty) {
                ContentUnavailableView(query.isEmpty ? "Nothing archived" : "No matches", systemImage: "archivebox")
            }
        }
        .searchable(text: $query, prompt: "Search loaded threads")
        .navigationTitle(spaceId == nil ? "Archived" : "Archived in \(spaceName)")
        .refreshable { await load() }
        .task { if !loaded { await load() } }
        .sensoryFeedback(.success, trigger: done)
    }

    private var spaceName: String {
        assignment?.spaces.first { $0.id == spaceId }?.name ?? "Space"
    }

    private var shown: [ThreadEntry] {
        let list = Self.inSpace(threads, spaceId, assignment)
        return query.isEmpty ? list : list.filter { $0.displayTitle.localizedCaseInsensitiveContains(query) }
    }

    static func inSpace(_ threads: [ThreadEntry], _ spaceId: String?, _ assignment: SpaceAssignment?) -> [ThreadEntry] {
        guard let spaceId, let assignment else { return threads }
        let byId = Dictionary(threads.map { ($0.id, $0) }, uniquingKeysWith: { a, _ in a })
        return threads.filter { assignment.spaceId(of: $0, among: byId) == spaceId }
    }

    struct Pages: Equatable {
        var threads: [ThreadEntry]
        var offset: Int
        var more: Bool
    }

    /// Reads pages from `offset` until one adds a row `shown` keeps, or BB has no more.
    /// A Space's threads are filtered here, so a page can add nothing to show; stopping
    /// there would leave the spinner row, whose task already ran, spinning for good.
    static func fetch(
        after existing: [ThreadEntry], offset: Int, pageSize: Int, shown: ([ThreadEntry]) -> Int,
        page: (_ offset: Int) async throws -> [ThreadEntry]
    ) async throws -> Pages {
        var result = Pages(threads: existing, offset: offset, more: true)
        let before = shown(existing)
        repeat {
            let next = try await page(result.offset)
            result.offset += next.count
            let seen = Set(result.threads.map(\.id))
            result.threads += next.filter { !seen.contains($0.id) }
            result.more = next.count == pageSize
        } while result.more && shown(result.threads) == before
        return result
    }

    private func load(more: Bool = false) async {
        do {
            if spaceId != nil, !more || assignment == nil {
                async let spaces = app.client.studioSpaces()
                async let spaceOf = app.client.spaceOfThreads()
                assignment = try await SpaceAssignment(spaces: spaces, spaceOf: spaceOf)
            }
            let client = app.client
            let (spaceId, assignment) = (spaceId, assignment)
            let pages = try await Self.fetch(
                after: more ? threads : [], offset: more ? fetched : 0, pageSize: Self.page,
                shown: { Self.inSpace($0, spaceId, assignment).count }
            ) { try await client.archivedThreads(limit: Self.page, offset: $0) }
            threads = pages.threads
            fetched = pages.offset
            self.more = pages.more
            error = nil
        } catch where BBClient.isCancellation(error) {
        } catch {
            self.error = BBClient.describe(error, server: app.client.baseURL)
            self.more = false
        }
        loaded = true
    }

    private func unarchive(_ thread: ThreadEntry) async {
        do {
            try await app.client.unarchive(thread.id)
            threads.removeAll { $0.id == thread.id }
            fetched = max(0, fetched - 1)
            done += 1
        } catch {
            self.error = BBClient.describe(error, server: app.client.baseURL)
        }
    }
}
