import SwiftUI

/// A thread's workspace: uncommitted changes with their diffs, and the files.
struct FilesView: View {
    @EnvironmentObject private var app: AppModel
    let environmentId: String
    @Environment(\.dismiss) private var dismiss
    @State private var tab = Tab.changes
    @State private var status: WorkspaceStatus?
    @State private var diffs: [String: String] = [:]
    @State private var children: [String: [WorkspacePath]] = [:]
    @State private var all: [WorkspacePath] = []
    @State private var truncated = false
    @State private var loaded = false
    @State private var error: String?
    @State private var query = ""

    enum Tab: Hashable { case changes, files }

    enum Destination: Hashable {
        case directory(String)
        case file(String)
        case change(WorkspaceStatus.Change)
    }

    var body: some View {
        NavigationStack {
            List {
                if let error {
                    Text(error).font(.footnote).foregroundStyle(.red)
                }
                if !query.isEmpty {
                    let matches = all.filter { !$0.isDirectory && $0.path.localizedCaseInsensitiveContains(query) }.prefix(200)
                    ForEach(matches) { entry in
                        NavigationLink(value: Destination.file(entry.path)) {
                            PathRow(entry: entry, detail: entry.parent)
                        }
                    }
                } else if tab == .changes {
                    changes
                } else {
                    directory("")
                }
            }
            .overlay {
                if !loaded { ProgressView() }
            }
            .safeAreaInset(edge: .top) {
                if query.isEmpty {
                    Picker("Show", selection: $tab) {
                        Text("Changes").tag(Tab.changes)
                        Text("Files").tag(Tab.files)
                    }
                    .pickerStyle(.segmented)
                    .padding(.horizontal)
                    .padding(.bottom, 6)
                }
            }
            .searchable(text: $query, prompt: "Find a file")
            .navigationTitle(status?.branch ?? "Files")
            .navigationBarTitleDisplayMode(.inline)
            .toolbar { Button("Done") { dismiss() } }
            .navigationDestination(for: Destination.self) { destination in
                switch destination {
                case .directory(let path):
                    List { directory(path) }
                        .navigationTitle(URL(fileURLWithPath: path).lastPathComponent)
                        .navigationBarTitleDisplayMode(.inline)
                case .file(let path):
                    WorkspaceFileView(environmentId: environmentId, path: path)
                case .change(let change):
                    ChangeDiffView(change: change, diff: diffs[change.path])
                }
            }
            .refreshable { await load() }
            .task { await load() }
        }
    }

    @ViewBuilder private var changes: some View {
        if let status {
            if status.changes.isEmpty {
                ContentUnavailableView("No uncommitted changes", systemImage: "checkmark.seal",
                    description: Text(status.branch.map { "On \($0)" } ?? ""))
            } else {
                let added = status.changes.reduce(0) { $0 + ($1.insertions ?? 0) }
                let removed = status.changes.reduce(0) { $0 + ($1.deletions ?? 0) }
                Section {
                    ForEach(status.changes) { change in
                        NavigationLink(value: Destination.change(change)) { ChangeRow(change: change) }
                    }
                } header: {
                    Text("\(status.changes.count) changed · +\(added) −\(removed)")
                }
            }
        } else if loaded {
            ContentUnavailableView("Not a git workspace", systemImage: "folder", description: Text("Browse its files instead."))
        }
    }

    @ViewBuilder
    private func directory(_ path: String) -> some View {
        let entries = children[path] ?? []
        ForEach(entries) { entry in
            NavigationLink(value: entry.isDirectory ? Destination.directory(entry.path) : Destination.file(entry.path)) {
                PathRow(entry: entry, change: status?.changes.first { $0.path == entry.path }?.status)
            }
        }
        if path.isEmpty, truncated {
            Text("Large workspace: some files aren't listed. Search finds them by name.")
                .font(.footnote).foregroundStyle(.secondary)
        }
    }

    private func load() async {
        do {
            async let status = app.client.workspaceStatus(environmentId)
            async let paths = app.client.workspacePaths(environmentId)
            let listing = try await paths
            all = listing.paths
            truncated = listing.truncated
            children = Dictionary(grouping: listing.paths, by: \.parent).mapValues {
                $0.sorted { ($0.isDirectory ? 0 : 1, $0.name.localizedLowercase) < ($1.isDirectory ? 0 : 1, $1.name.localizedLowercase) }
            }
            self.status = try? await status
            if self.status?.changes.isEmpty == false {
                diffs = (try? await app.client.uncommittedDiffs(environmentId)) ?? [:]
            } else if self.status == nil {
                tab = .files
            }
            error = nil
        } catch where BBClient.isCancellation(error) {
        } catch {
            self.error = BBClient.describe(error, server: app.client.baseURL)
        }
        loaded = true
    }
}

private struct PathRow: View {
    let entry: WorkspacePath
    var detail: String?
    var change: String?

    var body: some View {
        HStack(spacing: 10) {
            Image(systemName: entry.isDirectory ? "folder.fill" : FileIcon.name(entry.name))
                .foregroundStyle(entry.isDirectory ? Color.accentColor : .secondary)
                .frame(width: 22)
            VStack(alignment: .leading, spacing: 1) {
                Text(entry.name).lineLimit(1)
                if let detail, !detail.isEmpty {
                    Text(detail).font(.caption).foregroundStyle(.secondary).lineLimit(1).truncationMode(.head)
                }
            }
            Spacer(minLength: 0)
            if let change { ChangeBadge(status: change) }
        }
    }
}

private struct ChangeRow: View {
    let change: WorkspaceStatus.Change

    var body: some View {
        HStack(spacing: 10) {
            ChangeBadge(status: change.status)
            VStack(alignment: .leading, spacing: 1) {
                Text(URL(fileURLWithPath: change.path).lastPathComponent).lineLimit(1)
                let folder = (change.path as NSString).deletingLastPathComponent
                if !folder.isEmpty {
                    Text(folder).font(.caption).foregroundStyle(.secondary).lineLimit(1).truncationMode(.head)
                }
            }
            Spacer(minLength: 0)
            HStack(spacing: 4) {
                if let added = change.insertions, added > 0 { Text("+\(added)").foregroundStyle(.green) }
                if let removed = change.deletions, removed > 0 { Text("−\(removed)").foregroundStyle(.red) }
            }
            .font(.caption.monospacedDigit())
        }
    }
}

struct ChangeBadge: View {
    /// Git's letter; untracked comes as `?` or `??`.
    private let status: String

    init(status: String) {
        self.status = status.hasPrefix("?") ? "?" : String(status.prefix(1))
    }

    var body: some View {
        Text(status == "?" ? "U" : status)
            .font(.caption2.weight(.bold).monospaced())
            .frame(width: 18, height: 18)
            .background(color.opacity(0.18), in: .rect(cornerRadius: 4))
            .foregroundStyle(color)
            .accessibilityLabel(label)
    }

    private var color: Color {
        switch status {
        case "A", "?": .green
        case "D": .red
        case "R", "C": .purple
        default: .orange
        }
    }

    private var label: String {
        switch status {
        case "A": "Added"
        case "?": "Untracked"
        case "D": "Deleted"
        case "R": "Renamed"
        default: "Modified"
        }
    }
}

private struct ChangeDiffView: View {
    let change: WorkspaceStatus.Change
    let diff: String?

    var body: some View {
        ScrollView {
            VStack(alignment: .leading, spacing: 12) {
                if let diff, !diff.isEmpty {
                    DiffView(diff: diff, maxLines: 3000)
                } else {
                    Text(change.status.hasPrefix("?") ? "A new file, not yet tracked by git." : "No text diff for this file.")
                        .foregroundStyle(.secondary)
                }
                if change.status != "D" {
                    NavigationLink(value: FilesView.Destination.file(change.path)) {
                        Label("View file", systemImage: "doc.text")
                    }
                }
            }
            .padding()
        }
        .navigationTitle(URL(fileURLWithPath: change.path).lastPathComponent)
        .navigationBarTitleDisplayMode(.inline)
    }
}

/// One file: images shown, Markdown rendered or raw, anything else as text.
struct WorkspaceFileView: View {
    @EnvironmentObject private var app: AppModel
    let environmentId: String
    let path: String
    /// Lets a path outside the workspace, like `/tmp/shot.png`, open from the host.
    var threadId: String?
    @State private var file: WorkspaceFile?
    @State private var error: String?
    @State private var raw = false

    /// Past this the text view gets slow; the rest is left out.
    private static let maxCharacters = 200_000

    var body: some View {
        Group {
            if let file {
                content(file)
            } else if let error {
                ContentUnavailableView("Couldn't open the file", systemImage: "exclamationmark.triangle", description: Text(error))
            } else {
                ProgressView()
            }
        }
        .navigationTitle(URL(fileURLWithPath: path).lastPathComponent)
        .navigationBarTitleDisplayMode(.inline)
        .toolbar {
            if isMarkdown, file?.text != nil {
                Button { raw.toggle() } label: {
                    Image(systemName: raw ? "doc.richtext" : "chevron.left.forwardslash.chevron.right")
                }
                .accessibilityLabel(raw ? "Show rendered" : "Show source")
            }
            if let text = file?.text {
                ShareLink(item: text)
            }
        }
        .task {
            do {
                let path = await relativePath()
                if path.hasPrefix("/"), let threadId {
                    file = try await app.client.hostFile(threadId: threadId, path: path)
                } else {
                    file = try await app.client.workspaceFile(environmentId, path: path)
                }
            } catch {
                self.error = BBClient.describe(error, server: app.client.baseURL)
            }
        }
    }

    /// Absolute paths inside the workspace become relative; the server reads
    /// every path from the workspace root. Paths outside it stay absolute.
    private func relativePath() async -> String {
        guard path.hasPrefix("/"), let root = try? await app.client.environmentRoot(environmentId) else { return path }
        let prefix = root.hasSuffix("/") ? root : root + "/"
        return path.hasPrefix(prefix) ? String(path.dropFirst(prefix.count)) : path
    }

    /// Joins hard-wrapped source lines into paragraphs, the way Markdown
    /// reads them; message text keeps its line breaks, so the renderer does too.
    static func unwrap(_ markdown: String) -> String {
        var out: [String] = []
        var fenced = false
        var joinable = false
        for line in markdown.components(separatedBy: "\n") {
            let trimmed = line.trimmingCharacters(in: .whitespaces)
            if trimmed.hasPrefix("```") || trimmed.hasPrefix("~~~") {
                fenced.toggle()
                out.append(line)
                joinable = false
                continue
            }
            let startsBlock = fenced || trimmed.isEmpty || line.hasPrefix("    ") || line.hasPrefix("\t")
                || ["#", ">", "|", "<", "- ", "* ", "+ "].contains { trimmed.hasPrefix($0) }
                || trimmed.range(of: #"^\d+[.)] "#, options: .regularExpression) != nil
            if joinable, !startsBlock, let last = out.last {
                out[out.count - 1] = last + " " + trimmed
            } else {
                out.append(line)
            }
            joinable = !fenced && !trimmed.isEmpty && !trimmed.hasPrefix("#") && !trimmed.hasPrefix("|")
                && !line.hasSuffix("  ") && !line.hasSuffix("\\")
        }
        return out.joined(separator: "\n")
    }

    private var isMarkdown: Bool { path.lowercased().hasSuffix(".md") || path.lowercased().hasSuffix(".markdown") }

    @ViewBuilder
    private func content(_ file: WorkspaceFile) -> some View {
        if file.mimeType?.hasPrefix("image/") == true, let data = file.data, let image = UIImage(data: data) {
            // Fit the screen, never wider than the image itself.
            ScrollView {
                Image(uiImage: image).resizable().scaledToFit()
                    .frame(maxWidth: min(image.size.width, 800))
                    .padding()
                    .frame(maxWidth: .infinity)
            }
        } else if let text = file.text {
            let shown = String(text.prefix(Self.maxCharacters))
            if isMarkdown, !raw {
                ScrollView {
                    MarkdownText(Self.unwrap(shown)).textSelection(.enabled).padding()
                        .frame(maxWidth: 760, alignment: .leading)
                        .frame(maxWidth: .infinity)
                }
            } else {
                ScrollView([.vertical, .horizontal]) {
                    Text(shown + (text.count > shown.count ? "\n\n… file continues" : ""))
                        .font(.caption.monospaced())
                        .textSelection(.enabled)
                        .fixedSize()
                        .padding()
                }
            }
        } else {
            ContentUnavailableView("Binary file", systemImage: "doc",
                description: Text(file.sizeBytes.map { ByteCountFormatter.string(fromByteCount: Int64($0), countStyle: .file) } ?? ""))
        }
    }
}

enum FileIcon {
    static func name(_ file: String) -> String {
        switch URL(fileURLWithPath: file).pathExtension.lowercased() {
        case "swift", "ts", "tsx", "js", "jsx", "py", "go", "rs", "rb", "java", "kt", "c", "h", "cpp", "m", "sh":
            "chevron.left.forwardslash.chevron.right"
        case "md", "markdown", "txt": "doc.text"
        case "json", "yml", "yaml", "toml", "plist", "xml": "curlybraces"
        case "png", "jpg", "jpeg", "gif", "webp", "heic", "svg": "photo"
        case "pdf": "doc.richtext"
        default: "doc"
        }
    }
}
