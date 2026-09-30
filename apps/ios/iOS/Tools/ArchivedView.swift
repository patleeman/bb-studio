import SwiftUI

/// Archived threads, newest first, with swipe to restore.
struct ArchivedView: View {
    @EnvironmentObject private var app: AppModel
    @State private var threads: [ThreadEntry] = []
    @State private var loaded = false
    @State private var more = true
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
                ProgressView()
                    .frame(maxWidth: .infinity)
                    .task { await load(more: true) }
            }
        }
        .overlay {
            if !loaded {
                ProgressView()
            } else if shown.isEmpty, error == nil {
                ContentUnavailableView(query.isEmpty ? "Nothing archived" : "No matches", systemImage: "archivebox")
            }
        }
        .searchable(text: $query, prompt: "Search loaded threads")
        .navigationTitle("Archived")
        .refreshable { await load() }
        .task { if !loaded { await load() } }
        .sensoryFeedback(.success, trigger: done)
    }

    private var shown: [ThreadEntry] {
        query.isEmpty ? threads : threads.filter { $0.displayTitle.localizedCaseInsensitiveContains(query) }
    }

    private func load(more: Bool = false) async {
        do {
            let page = try await app.client.archivedThreads(limit: Self.page, offset: more ? threads.count : 0)
            if more {
                let seen = Set(threads.map(\.id))
                threads += page.filter { !seen.contains($0.id) }
            } else {
                threads = page
            }
            self.more = page.count == Self.page
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
            done += 1
        } catch {
            self.error = BBClient.describe(error, server: app.client.baseURL)
        }
    }
}
