import SwiftUI
import UIKit

/// One Studio artifact: the file shown the way its type reads best, with its
/// versions, and the web viewer's actions.
struct ArtifactView: View {
    @EnvironmentObject private var app: AppModel
    private let operation = ServerOperation()
    private var client: BBClient { operation.client }
    @Environment(\.dismiss) private var dismiss
    let id: String
    @State private var chatting = false
    @State private var showingRelated = false
    @State private var artifact: Artifact?
    @State private var versions: [ArtifactVersion] = []
    /// nil for the newest.
    @State private var versionId: String?
    @State private var text: String?
    @State private var truncated = false
    @State private var textVersion: String?
    @State private var textError: String?
    @State private var textAttempt = 0
    @State private var imageAttempt = 0
    @State private var webAttempt = 0
    @State private var webError: String?
    @State private var webErrorVersion: String?
    @State private var error: String?
    @State private var source = false
    @State private var renaming = false
    @State private var newTitle = ""
    @State private var confirmingDelete = false
    @State private var sharing: SharedFile?
    @State private var working = false
    @State private var notice: String?
    @State private var listener: UUID?

    /// Past this the text view gets slow; Share has the rest.
    private static let maxCharacters = 200_000

    private var version: ArtifactVersion? {
        versionId.flatMap { id in versions.first { $0.id == id } } ?? artifact?.version
    }

    var body: some View {
        Group {
            if let artifact, let version {
                content(artifact, version)
            } else if let error {
                ContentUnavailableView {
                    Label("Couldn't open the artifact", systemImage: "exclamationmark.triangle")
                } description: {
                    Text(error)
                } actions: {
                    Button("Retry") {
                        self.error = nil
                        Task { await load() }
                    }
                    .buttonStyle(.borderedProminent)
                }
            } else {
                ProgressView()
            }
        }
        .overlay(alignment: .bottom) {
            if let notice {
                Text(notice)
                    .font(.subheadline.weight(.medium))
                    .padding(.horizontal, 14)
                    .padding(.vertical, 8)
                    .background(.regularMaterial, in: .capsule)
                    .padding(.bottom, 12)
                    .transition(.move(edge: .bottom).combined(with: .opacity))
            }
        }
        .animation(.snappy, value: notice)
        .navigationTitle(artifact?.displayTitle ?? "Artifact")
        .navigationBarTitleDisplayMode(.inline)
        .toolbar { toolbar }
        .toolbar { Button { showingRelated = true } label: { Label("Related", systemImage: "link") } }
        .sheet(isPresented: $showingRelated) { RelatedView(pluginId: "artifacts", itemId: id) }
        .studioChat(
            isPresented: $chatting, pluginId: "artifacts", itemId: id, title: artifact?.displayTitle ?? "Artifact",
            projectId: artifact?.projectId)
        .task(id: "\(version?.id ?? ""):\(textAttempt)") { await loadText() }
        .task {
            listener = app.realtime.listen { event in
                guard case .pluginSignal(let pluginId, _, let payload) = event, pluginId == "artifacts" else { return }
                if let changed = payload["id"]?.stringValue, changed != id { return }
                Task { await load() }
            }
            await load()
        }
        .onDisappear { if let listener { app.realtime.removeListener(listener) } }
        .alert("Rename", isPresented: $renaming) {
            TextField("Title", text: $newTitle)
            Button("Cancel", role: .cancel) {}
            Button("Rename") { Task { await rename() } }
        }
        .confirmationDialog(
            "Delete \u{201C}\(artifact?.displayTitle ?? "")\u{201D}?", isPresented: $confirmingDelete, titleVisibility: .visible
        ) {
            Button("Delete", role: .destructive) { Task { await delete() } }
        } message: {
            Text("Every version goes. This can't be undone.")
        }
        .sheet(item: $sharing) { file in
            ActivitySheet(items: [file.url]).ignoresSafeArea()
        }
    }

    // MARK: Content

    @ViewBuilder
    private func content(_ artifact: Artifact, _ version: ArtifactVersion) -> some View {
        let url = client.artifactContentURL(artifact.id, versionId: version.id)
        switch version.type {
        case "image":
            AsyncImage(url: url) { phase in
                if let image = phase.image {
                    ScrollView([.horizontal, .vertical]) {
                        image.resizable().scaledToFit().frame(maxWidth: 900)
                            .accessibilityElement(children: .ignore)
                            .accessibilityAddTraits(.isImage)
                            .accessibilityLabel(version.name)
                            .accessibilityIdentifier("artifactPreviewImage")
                            .padding()
                    }
                    .accessibilityElement(children: .ignore)
                    .accessibilityAddTraits(.isImage)
                    .accessibilityLabel(version.name)
                    .accessibilityIdentifier("artifactPreviewImage")
                } else if phase.error != nil {
                    previewFailure("Couldn't load the image", symbol: "photo", message: "Try again, or share the file to open it in another app.") {
                        imageAttempt += 1
                    }
                } else {
                    ProgressView()
                }
            }
            .id("\(version.id):\(imageAttempt)")
            .safeAreaInset(edge: .top) { header(artifact, version) }
        case "html", "pdf":
            // Served with a sandboxing CSP, so the page can't reach BB.
            if webErrorVersion == version.id, let webError {
                previewFailure("Couldn't load the preview", symbol: version.symbol, message: webError) {
                    self.webError = nil
                    webErrorVersion = nil
                    webAttempt += 1
                }
            } else {
                ArtifactWebPreview(url: url) { message in
                    guard self.version?.id == version.id else { return }
                    webError = message
                    webErrorVersion = version.id
                }
                .ignoresSafeArea(edges: .bottom)
                .id("\(url.absoluteString):\(webAttempt)")
            }
        case "markdown", "code", "text":
            if textVersion != version.id {
                ProgressView()
            } else if let textError {
                previewFailure("Couldn't load the text", symbol: "doc.text", message: textError) {
                    textVersion = nil
                    self.textError = nil
                    textAttempt += 1
                }
            } else if let text {
                let shown = String(text.prefix(Self.maxCharacters))
                let more = truncated || text.count > shown.count
                if version.type == "markdown", !source {
                    ScrollView {
                        VStack(alignment: .leading, spacing: 14) {
                            header(artifact, version)
                            MarkdownText(WorkspaceFileView.unwrap(shown)).textSelection(.enabled)
                            if more { continues }
                        }
                        .padding()
                        .frame(maxWidth: 760, alignment: .leading)
                        .frame(maxWidth: .infinity)
                    }
                } else {
                    ScrollView([.vertical, .horizontal]) {
                        VStack(alignment: .leading, spacing: 14) {
                            Text(shown).font(.caption.monospaced()).textSelection(.enabled).fixedSize()
                            if more { continues }
                        }
                        .padding()
                    }
                }
            } else {
                binary(version)
            }
        default:
            binary(version)
        }
    }

    private func header(_ artifact: Artifact, _ version: ArtifactVersion) -> some View {
        VStack(alignment: .leading, spacing: 4) {
            if !artifact.description.isEmpty {
                Text(artifact.description).font(.subheadline)
            }
            Text(facts(version)).font(.caption).foregroundStyle(.secondary)
        }
        .frame(maxWidth: .infinity, alignment: .leading)
        .padding(.horizontal, version.type == "image" ? 16 : 0)
        .padding(.vertical, version.type == "image" ? 8 : 0)
        .background(version.type == "image" ? AnyShapeStyle(.bar) : AnyShapeStyle(.clear))
    }

    private var continues: some View {
        Label("It continues. Share the file to see the rest.", systemImage: "ellipsis")
            .font(.footnote)
            .foregroundStyle(.secondary)
    }

    private func previewFailure(_ title: String, symbol: String, message: String, retry: @escaping () -> Void) -> some View {
        ContentUnavailableView {
            Label(title, systemImage: symbol)
        } description: {
            Text(message)
        } actions: {
            Button("Retry", action: retry).buttonStyle(.borderedProminent)
            Button("Share File") { Task { await share() } }.buttonStyle(.bordered)
        }
    }

    private func binary(_ version: ArtifactVersion) -> some View {
        ContentUnavailableView {
            Label(version.name, systemImage: version.symbol)
        } description: {
            Text(facts(version))
        } actions: {
            Button("Share File") { Task { await share() } }.buttonStyle(.bordered)
        }
    }

    private func facts(_ version: ArtifactVersion) -> String {
        var parts = [version.typeLabel, version.name, ByteCountFormatter.string(fromByteCount: Int64(version.size), countStyle: .file)]
        if versions.count > 1 { parts.append("v\(version.number) of \(versions.count)") }
        if let project = artifact?.projectId.flatMap({ StudioStore.shared.projectNames[$0] }) { parts.append(project) }
        return parts.joined(separator: " · ")
    }

    // MARK: Toolbar

    @ToolbarContentBuilder
    private var toolbar: some ToolbarContent {
        ToolbarItemGroup(placement: .topBarTrailing) {
            if version?.type == "markdown", textVersion == version?.id, text != nil {
                Button { source.toggle() } label: {
                    Image(systemName: source ? "doc.richtext" : "chevron.left.forwardslash.chevron.right")
                }
                .accessibilityLabel(source ? "Show rendered" : "Show source")
            }
            if working {
                ProgressView()
            } else if artifact != nil {
                Button { Task { await share() } } label: { Image(systemName: "square.and.arrow.up") }
                    .accessibilityLabel("Share")
            }
            if let artifact { menu(artifact) }
        }
    }

    private func menu(_ artifact: Artifact) -> some View {
        Menu {
            Button {
                operation.complete(on: app) { app.newThread(text: "[\(artifact.displayTitle.replacingOccurrences(of: "[", with: "").replacingOccurrences(of: "]", with: ""))](\(artifact.href)) ") }
            } label: { Label("New Thread with This", systemImage: "square.and.pencil") }
            StudioChatMenuButton(isPresented: $chatting)
            if let text, version?.isText == true, textVersion == version?.id {
                Button {
                    UIPasteboard.general.string = text
                    flash("Copied")
                } label: { Label("Copy Text", systemImage: "doc.on.doc") }
            }
            if versions.count > 1 {
                Picker(selection: Binding(get: { version?.id ?? "" }, set: { versionId = $0 == artifact.version.id ? nil : $0 })) {
                    ForEach(versions) { version in
                        Text("v\(version.number) · \(Date(timeIntervalSince1970: version.createdAt / 1000).formatted(.relative(presentation: .named)))")
                            .tag(version.id)
                    }
                } label: { Label("Versions", systemImage: "clock.arrow.circlepath") }
                .pickerStyle(.menu)
            }
            if let thread = artifact.sourceThreadId {
                Button { operation.complete(on: app) { app.push(.thread(id: thread)) } } label: { Label("Open Source Thread", systemImage: "bubble.left.and.bubble.right") }
            }
            if ["markdown", "text"].contains(artifact.version.type) {
                Button { Task { await saveAsPage() } } label: { Label("Save as Page", systemImage: "doc.badge.plus") }
            }
            Section {
                Button {
                    newTitle = artifact.title
                    renaming = true
                } label: { Label("Rename", systemImage: "pencil") }
                Menu {
                    ForEach(projectChoices, id: \.id) { choice in
                        Button { Task { await move(choice.id) } } label: {
                            if choice.id == artifact.projectId { Label(choice.name, systemImage: "checkmark") } else { Text(choice.name) }
                        }
                    }
                } label: { Label("Move to Project", systemImage: "folder") }
                Button(role: .destructive) { confirmingDelete = true } label: { Label("Delete", systemImage: "trash") }
            }
        } label: {
            Image(systemName: "ellipsis.circle")
        }
        .accessibilityLabel("More")
    }

    private var projectChoices: [(id: String?, name: String)] {
        [(nil, "No Project")] + StudioStore.shared.projectNames
            .sorted { $0.value.localizedStandardCompare($1.value) == .orderedAscending }
            .map { ($0.key, $0.value) }
    }

    // MARK: Actions

    private func load() async {
        do {
            let result = try await client.artifact(id)
            guard let found = result.artifact else {
                error = "It was deleted."
                artifact = nil
                return
            }
            artifact = found
            versions = result.versions.sorted { $0.number > $1.number }
            if let versionId, !versions.contains(where: { $0.id == versionId }) { self.versionId = nil }
            error = nil
        } catch where BBClient.isCancellation(error) {
        } catch {
            if artifact == nil { self.error = BBClient.describe(error, server: client.baseURL) }
        }
    }

    private func loadText() async {
        guard let artifact, let version, version.isText, textVersion != version.id else { return }
        text = nil
        textVersion = nil
        truncated = false
        textError = nil
        do {
            let result = try await client.artifactText(artifact.id, versionId: version.id)
            guard !Task.isCancelled, self.version?.id == version.id else { return }
            text = result.text
            truncated = result.truncated
            textError = result.text == nil ? "The preview content is unavailable. Try again, or share the file." : nil
            textVersion = version.id
        } catch where BBClient.isCancellation(error) {
        } catch {
            guard !Task.isCancelled, self.version?.id == version.id else { return }
            text = nil
            textError = BBClient.describe(error, server: client.baseURL)
            textVersion = version.id
        }
    }

    /// Downloads the version under its own name, then offers the share sheet.
    private func share() async {
        guard let artifact, let version else { return }
        working = true
        defer { working = false }
        do {
            let url = client.artifactContentURL(artifact.id, versionId: version.id, download: true)
            let (data, response) = try await URLSession.shared.data(from: url)
            guard (response as? HTTPURLResponse)?.statusCode == 200 else { throw BBError(status: 0, message: "The server didn't send the file.") }
            let folder = FileManager.default.temporaryDirectory.appending(path: "artifacts/\(ServerScope.namespace(client.baseURL))/\(version.id)", directoryHint: .isDirectory)
            try FileManager.default.createDirectory(at: folder, withIntermediateDirectories: true)
            let name = version.name.replacingOccurrences(of: "/", with: "-")
            let file = folder.appending(path: name.isEmpty ? "artifact" : name)
            try data.write(to: file, options: .atomic)
            sharing = SharedFile(url: file)
        } catch {
            flash(BBClient.describe(error, server: client.baseURL))
        }
    }

    private func rename() async {
        let title = newTitle.trimmingCharacters(in: .whitespacesAndNewlines)
        guard !title.isEmpty, title != artifact?.title else { return }
        do {
            try await client.renameArtifact(id, title: title)
            artifact?.title = title
        } catch {
            flash(BBClient.describe(error, server: client.baseURL))
        }
    }

    private func move(_ projectId: String?) async {
        guard projectId != artifact?.projectId else { return }
        do {
            try await client.moveArtifact(id, projectId: projectId)
            artifact?.projectId = projectId
            flash(projectId.flatMap { StudioStore.shared.projectNames[$0] }.map { "Moved to \($0)" } ?? "Moved out of its project")
        } catch {
            flash(BBClient.describe(error, server: client.baseURL))
        }
    }

    private func saveAsPage() async {
        do {
            let href = try await client.saveArtifactAsPage(id)
            if let route = Route(href: href) { operation.complete(on: app) { app.push(route) } } else { flash("Saved as a page") }
        } catch {
            flash(BBClient.describe(error, server: client.baseURL))
        }
    }

    private func delete() async {
        do {
            try await client.deleteArtifact(id)
            guard client.baseURL == app.serverURL else { return }
            StudioStore.shared.removed(pluginId: "artifacts", id: id)
            operation.complete(on: app) { dismiss() }
        } catch {
            flash(BBClient.describe(error, server: client.baseURL))
        }
    }

    private func flash(_ message: String) {
        notice = message
        Task {
            try? await Task.sleep(for: .seconds(2.5))
            if notice == message { notice = nil }
        }
    }
}

/// A downloaded file waiting for the share sheet.
struct SharedFile: Identifiable {
    let url: URL
    var id: URL { url }
}

/// The system share sheet, for files ShareLink can't be handed up front.
struct ActivitySheet: UIViewControllerRepresentable {
    let items: [Any]

    func makeUIViewController(context: Context) -> UIActivityViewController {
        UIActivityViewController(activityItems: items, applicationActivities: nil)
    }

    func updateUIViewController(_ controller: UIActivityViewController, context: Context) {}
}

/// `::artifact{id="art_…"}` in a reply: the artifact's title and type, opening the viewer.
struct ArtifactCard: View {
    @EnvironmentObject private var app: AppModel
    private let operation = ServerOperation()
    private var client: BBClient { operation.client }
    let id: String
    @State private var artifact: Artifact?
    @State private var missing = false

    /// Replies re-render often; each card looks its artifact up once.
    @MainActor private static var cache: [String: Artifact] = [:]

    var body: some View {
        NavigationLink(value: Route.artifact(id: id)) {
            HStack(spacing: 12) {
                thumbnail
                    .frame(width: 44, height: 44)
                    .background(Color.teal.opacity(0.12), in: .rect(cornerRadius: 10))
                    .clipShape(.rect(cornerRadius: 10))
                VStack(alignment: .leading, spacing: 2) {
                    Text(artifact?.displayTitle ?? (missing ? "Deleted artifact" : "Artifact"))
                        .font(.subheadline.weight(.semibold))
                        .foregroundStyle(missing ? .secondary : .primary)
                        .lineLimit(2)
                    if let version = artifact?.version {
                        Text([version.typeLabel, ByteCountFormatter.string(fromByteCount: Int64(version.size), countStyle: .file)]
                            .joined(separator: " · "))
                            .font(.caption)
                            .foregroundStyle(.secondary)
                    }
                }
                Spacer(minLength: 0)
                Image(systemName: "chevron.right").font(.caption.weight(.semibold)).foregroundStyle(.tertiary)
            }
            .padding(10)
            .frame(maxWidth: 420, alignment: .leading)
            .background(.fill.quaternary, in: .rect(cornerRadius: 14))
            .contentShape(.rect(cornerRadius: 14))
        }
        .buttonStyle(.plain)
        .disabled(missing)
        .accessibilityIdentifier("artifactCard")
        .task(id: id) {
            let cacheKey = ServerScope.key(id, serverURL: client.baseURL)
            if let cached = Self.cache[cacheKey] { artifact = cached }
            guard let result = try? await client.artifact(id) else { return }
            if let found = result.artifact {
                Self.cache[cacheKey] = found
                artifact = found
            } else {
                missing = true
            }
        }
    }

    @ViewBuilder
    private var thumbnail: some View {
        if let artifact, artifact.version.type == "image" {
            AsyncImage(url: client.artifactContentURL(artifact.id, versionId: artifact.version.id)) { image in
                image.resizable().scaledToFill()
            } placeholder: {
                Image(systemName: "photo").foregroundStyle(.teal)
            }
        } else {
            Image(systemName: artifact?.version.symbol ?? "doc").font(.body.weight(.medium)).foregroundStyle(.teal)
        }
    }
}
