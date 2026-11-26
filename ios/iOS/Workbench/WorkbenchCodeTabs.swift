import SwiftUI

/// A file tab: the file in the conversation's workspace (or the one Studio
/// names), or on the conversation's host by its absolute path.
struct WorkbenchFileTab: View {
    let path: String
    let environmentId: String?
    let threadId: String
    @EnvironmentObject private var app: AppModel
    @State private var resolved: String??

    var body: some View {
        Group {
            if let resolved {
                WorkspaceFileView(environmentId: resolved, path: path, threadId: threadId)
            } else {
                ProgressView().frame(maxWidth: .infinity, maxHeight: .infinity)
            }
        }
        .task(id: threadId) {
            if let environmentId { resolved = .some(environmentId); return }
            resolved = .some(try? await app.client.thread(threadId).environmentId)
        }
    }
}

/// A diff tab, as on the desktop: one file's uncommitted changes, or every
/// changed file with its hunks under its name. Pull to refresh.
struct WorkbenchDiffTab: View {
    let path: String?
    let threadId: String
    @EnvironmentObject private var app: AppModel
    @State private var diff: WorkbenchDiff?
    @State private var error: String?
    @State private var showingFile = false

    var body: some View {
        VStack(spacing: 0) {
            WorkbenchTabHeader {
                Label(title, systemImage: "plusminus")
            } actions: {
                if path != nil, diff?.environmentId != nil {
                    Button { showingFile.toggle() } label: {
                        Label(showingFile ? "Show diff" : "View file", systemImage: showingFile ? "plusminus" : "doc.text")
                    }
                    .accessibilityIdentifier("diffTabViewFile")
                }
            }
            if showingFile, let path, let environmentId = diff?.environmentId {
                WorkspaceFileView(environmentId: environmentId, path: path, threadId: threadId)
                    .environment(\.inWorkbench, false)
            } else {
                list
            }
        }
        .task(id: threadId) { await load() }
    }

    private var title: String {
        if let path { return URL(fileURLWithPath: path).lastPathComponent }
        guard let diff else { return "Changes" }
        return "\(diff.files.count) changed · +\(diff.added) −\(diff.removed)"
    }

    private var list: some View {
        ScrollView {
            LazyVStack(alignment: .leading, spacing: 16) {
                if let error {
                    Text(error).font(.footnote).foregroundStyle(.red)
                } else if let diff {
                    let files = path.map { diff.files(matching: $0) } ?? diff.files
                    if files.isEmpty {
                        ContentUnavailableView("No uncommitted changes", systemImage: "checkmark.seal",
                                               description: Text(path.map { "\(URL(fileURLWithPath: $0).lastPathComponent) matches the last commit." } ?? ""))
                    }
                    ForEach(files) { file in
                        DiffFileSection(file: file, titled: path == nil)
                    }
                } else {
                    ProgressView().frame(maxWidth: .infinity).padding(.top, 40)
                }
            }
            .padding(16)
        }
        .refreshable { await load() }
        .accessibilityIdentifier("diffTab")
    }

    private func load() async {
        do {
            guard let environmentId = try await app.client.thread(threadId).environmentId else {
                error = "This conversation has no workspace."
                return
            }
            async let status = app.client.workspaceStatus(environmentId)
            async let diffs = app.client.uncommittedDiffs(environmentId)
            async let root = try? app.client.environmentRoot(environmentId)
            diff = WorkbenchDiff(environmentId: environmentId, root: await root,
                                 changes: try await status?.changes ?? [], diffs: try await diffs)
            error = nil
        } catch where BBClient.isCancellation(error) {
        } catch {
            self.error = BBClient.describe(error, server: app.client.baseURL)
        }
    }
}

private struct DiffFileSection: View {
    let file: WorkbenchDiff.File
    let titled: Bool

    var body: some View {
        VStack(alignment: .leading, spacing: 6) {
            if titled {
                HStack(spacing: 8) {
                    Text(file.path).font(.subheadline.monospaced()).lineLimit(1).truncationMode(.head)
                    Spacer(minLength: 4)
                    if file.added > 0 { Text("+\(file.added)").foregroundStyle(.green) }
                    if file.removed > 0 { Text("−\(file.removed)").foregroundStyle(.red) }
                }
                .font(.caption.monospacedDigit())
            }
            if let text = file.diff, !text.isEmpty {
                DiffView(diff: text, maxLines: 3000)
            } else {
                Text(file.status.hasPrefix("?") ? "A new file, not yet tracked by git." : "No text diff for this file.")
                    .font(.footnote).foregroundStyle(.secondary)
            }
        }
    }
}

/// The conversation's uncommitted changes, each with its diff, and how a tab's path finds its file.
struct WorkbenchDiff: Equatable {
    struct File: Identifiable, Equatable {
        var path: String
        var status: String
        var added: Int
        var removed: Int
        var diff: String?
        var id: String { path }
    }

    var environmentId: String
    var files: [File]
    var root: String?

    init(environmentId: String, root: String?, changes: [WorkspaceStatus.Change], diffs: [String: String]) {
        self.environmentId = environmentId
        self.root = root
        files = changes.map { File(path: $0.path, status: $0.status, added: $0.insertions ?? 0, removed: $0.deletions ?? 0, diff: diffs[$0.path]) }
        // A diff git lists without a status line (a rename's new side) still shows.
        let listed = Set(files.map(\.path))
        files += diffs.keys.filter { !listed.contains($0) }.sorted().map { File(path: $0, status: "M", added: 0, removed: 0, diff: diffs[$0]) }
    }

    var added: Int { files.reduce(0) { $0 + $1.added } }
    var removed: Int { files.reduce(0) { $0 + $1.removed } }

    /// The tab's file: its path relative to the workspace, or absolute under the workspace's root.
    func files(matching path: String) -> [File] {
        var relative = path
        if let root, path.hasPrefix("/") {
            let prefix = root.hasSuffix("/") ? root : root + "/"
            if path.hasPrefix(prefix) { relative = String(path.dropFirst(prefix.count)) }
        }
        while relative.hasPrefix("./") { relative.removeFirst(2) }
        return files.filter { $0.path == relative }
    }
}
