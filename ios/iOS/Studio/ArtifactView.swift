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
        page
        .task(id: "\(version?.id ?? ""):\(textAttempt)") { await loadText() }
        .task {
            listener = app.realtime.listen { event in
                // Studio sends it on its `artifacts` channel.
                guard case .pluginSignal("studio", "artifacts", let payload) = event else { return }
                if let changed = (payload["artifactId"] ?? payload["id"])?.stringValue, changed != id { return }
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

    /// The artifact, its notice, title, toolbars and chat: apart from `body`, so that type-checks quickly.
    private var page: some View {
        Group {
            if let artifact, let version {
                content(artifact, version)
            } else if let error {
                ContentUnavailableView {
                    Label("Couldn't open the app", systemImage: "exclamationmark.triangle")
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
        .screenToolbar(artifact?.displayTitle ?? "App", actions: artifact.map(actions) ?? [])
        .sheet(isPresented: $showingRelated) { RelatedView(pluginId: "artifacts", itemId: id) }
        .studioChat(
            isPresented: $chatting, pluginId: "artifacts", itemId: id, title: artifact?.displayTitle ?? "Artifact",
            projectId: artifact?.projectId)
    }

    // MARK: Content

    @ViewBuilder
    private func content(_ artifact: Artifact, _ version: ArtifactVersion) -> some View {
        let url = client.artifactContentURL(artifact.id, versionId: version.id)
        switch version.type {
        case "image":
            AsyncImage(url: url) { phase in
                if let image = phase.image {
                    // Pinch to zoom, drag to pan, double-tap for 2.5×.
                    Zoomable(maximum: 8) {
                        image.resizable().scaledToFit()
                            .padding()
                            .frame(maxWidth: .infinity, maxHeight: .infinity)
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
        case "html", "pdf", "audio", "video":
            if webErrorVersion == version.id, let webError {
                previewFailure("Couldn't load the preview", symbol: version.symbol, message: webError) {
                    self.webError = nil
                    webErrorVersion = nil
                    webAttempt += 1
                }
            } else {
                let failure: (String) -> Void = { message in
                    guard self.version?.id == version.id else { return }
                    webError = message
                    webErrorVersion = version.id
                }
                Group {
                    if version.type == "pdf" {
                        ArtifactPDFPreview(url: url, onFailure: failure)
                    } else {
                        // HTML is served with a sandboxing CSP, so it can't reach BB.
                        // WebKit plays audio and video with its own controls.
                        ArtifactWebPreview(url: url, onFailure: failure)
                    }
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

    // MARK: Actions

    /// Share and the source toggle first; the rest under ⋯ (the Duo: the rail and its More).
    private func actions(_ artifact: Artifact) -> [ScreenAction] {
        var list = [ScreenAction(id: "share", title: "Share", systemImage: "square.and.arrow.up", disabled: working,
                                 run: { Task { await share() } })]
        if version?.type == "markdown", textVersion == version?.id, text != nil {
            list.append(ScreenAction(id: "source", title: source ? "Show Rendered" : "Show Source",
                                     systemImage: source ? "doc.richtext" : "chevron.left.forwardslash.chevron.right", run: { source.toggle() }))
        }
        let label = artifact.displayTitle.replacingOccurrences(of: "[", with: "").replacingOccurrences(of: "]", with: "")
        list.append(ScreenAction(id: "newThread", title: "New Thread with This", systemImage: "square.and.pencil", run: {
            operation.complete(on: app) { app.open(.compose("[\(label)](\(artifact.href)) ")) }
        }))
        if StudioStore.shared.plugins.contains("studio") {
            list.append(ScreenAction(id: "chat", title: "Chat About This", systemImage: "bubble.left.and.text.bubble.right", run: { chatting = true }))
        }
        list.append(ScreenAction(id: "related", title: "Related", systemImage: "link", run: { showingRelated = true }))
        if let text, version?.isText == true, textVersion == version?.id {
            list.append(ScreenAction(id: "copy", title: "Copy Text", systemImage: "doc.on.doc", run: {
                UIPasteboard.general.string = text
                flash("Copied")
            }))
        }
        if versions.count > 1 {
            list.append(ScreenAction(id: "versions", title: "Versions", systemImage: "clock.arrow.circlepath", children: versions.map { choice in
                ScreenAction(id: "version-\(choice.id)",
                             title: "v\(choice.number) · \(Date(timeIntervalSince1970: choice.createdAt / 1000).formatted(.relative(presentation: .named)))",
                             systemImage: "clock", checked: choice.id == version?.id,
                             run: { versionId = choice.id == artifact.version.id ? nil : choice.id })
            }))
        }
        if let thread = artifact.sourceThreadId {
            list.append(ScreenAction(id: "sourceThread", title: "Open Source Thread", systemImage: Symbols.thread, run: {
                operation.complete(on: app) { app.push(.thread(id: thread)) }
            }))
        }
        if ["markdown", "text"].contains(artifact.version.type) {
            list.append(ScreenAction(id: "saveAsPage", title: "Save as Page", systemImage: "doc.badge.plus", run: { Task { await saveAsPage() } }))
        }
        list.append(ScreenAction(id: "rename", title: "Rename", systemImage: "pencil", run: {
            newTitle = artifact.title
            renaming = true
        }))
        list.append(ScreenAction(id: "move", title: "Move to Project", systemImage: "folder", children: projectChoices.map { choice in
            ScreenAction(id: "project-\(choice.id ?? "none")", title: choice.name, systemImage: "folder", checked: choice.id == artifact.projectId,
                         run: { Task { await move(choice.id) } })
        }))
        list.append(ScreenAction(id: "delete", title: "Delete", systemImage: "trash", role: .destructive, run: { confirmingDelete = true }))
        return list
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

/// `::artifact{id="art_…"}` in a reply: the artifact's title and type, opening
/// the viewer, with files the phone can show previewed under them.
struct ArtifactCard: View {
    @EnvironmentObject private var app: AppModel
    private let operation = ServerOperation()
    private var client: BBClient { operation.client }
    let id: String
    @State private var artifact: Artifact?
    @State private var text: String?
    @State private var missing = false

    /// Text past this is left to the viewer.
    static let textLimit = 20_000

    private final class CachedArtifact {
        let artifact: Artifact
        let text: String?
        init(artifact: Artifact, text: String?) {
            self.artifact = artifact
            self.text = text
        }
    }

    /// Replies re-render often; a card starts from what the last one showed.
    @MainActor private static let cache: NSCache<NSString, CachedArtifact> = {
        let cache = NSCache<NSString, CachedArtifact>()
        cache.countLimit = 100
        return cache
    }()

    var body: some View {
        StudioCardChrome(
            route: .artifact(id: id),
            title: artifact?.displayTitle ?? (missing ? "Deleted app" : "App"),
            detail: artifact.map { [$0.version.typeLabel, ByteCountFormatter.string(fromByteCount: Int64($0.version.size), countStyle: .file)]
                .joined(separator: " · ") },
            missing: missing,
            hasPreview: hasPreview,
            identifier: "artifactCard"
        ) {
            thumbnail
                .frame(width: 44, height: 44)
                .background(Color.teal.opacity(0.12), in: .rect(cornerRadius: 10))
                .clipShape(.rect(cornerRadius: 10))
        } preview: {
            preview
        }
        .task(id: id) {
            let cacheKey = ServerScope.key(id, serverURL: client.baseURL) as NSString
            if let cached = Self.cache.object(forKey: cacheKey) {
                artifact = cached.artifact
                text = cached.text
            }
            guard let result = try? await client.artifact(id) else { return }
            guard let found = result.artifact else {
                Self.cache.removeObject(forKey: cacheKey)
                missing = true
                return
            }
            artifact = found
            if found.version.isText, let read = try? await client.artifactText(found.id, versionId: found.version.id).text {
                text = String(read.prefix(Self.textLimit))
            }
            Self.cache.setObject(CachedArtifact(artifact: found, text: text), forKey: cacheKey)
        }
    }

    private var hasPreview: Bool {
        guard let version = artifact?.version, !missing else { return false }
        return ["image", "html", "pdf"].contains(version.type) || (version.isText && text != nil)
    }

    @ViewBuilder
    private var preview: some View {
        if let artifact {
            let url = client.artifactContentURL(artifact.id, versionId: artifact.version.id)
            switch artifact.version.type {
            case "image":
                NavigationLink(value: Route.artifact(id: artifact.id)) {
                    DownsampledRemoteImage(url: url, pixels: 960, contentMode: .fit) {
                        ProgressView()
                    }
                    .frame(maxWidth: .infinity, maxHeight: 240)
                    .padding(8)
                }
                .buttonStyle(.plain)
                .accessibilityLabel("Open \(artifact.displayTitle)")
            case "html":
                // Served with a sandboxing CSP, so it can't reach BB.
                ArtifactWebPreview(url: url, onFailure: { _ in }).frame(height: ReplyPreview.maxHeight)
            case "pdf":
                ArtifactPDFPreview(url: url, onFailure: { _ in }).frame(height: ReplyPreview.maxHeight)
            default:
                if let text {
                    let body = Group {
                        if artifact.version.type == "markdown" {
                            MarkdownText(text)
                        } else {
                            Text(text).font(.caption.monospaced())
                        }
                    }
                    .textSelection(.enabled)
                    .padding(12)
                    .frame(maxWidth: .infinity, alignment: .leading)
                    ViewThatFits(in: .vertical) {
                        body
                        ScrollView { body }
                    }
                    .frame(maxHeight: ReplyPreview.maxHeight)
                }
            }
        }
    }

    @ViewBuilder
    private var thumbnail: some View {
        if let artifact, artifact.version.type == "image" {
            DownsampledRemoteImage(url: client.artifactContentURL(artifact.id, versionId: artifact.version.id), pixels: 180, contentMode: .fill) {
                Image(systemName: "photo").foregroundStyle(.teal)
            }
        } else {
            Image(systemName: artifact?.version.symbol ?? "doc").font(.body.weight(.medium)).foregroundStyle(.teal)
        }
    }
}

/// A remote image backed by `AttachmentImages` (shared deduplicated download,
/// 200 MB disk URLCache, cost-limited memory NSCache, and `CGImageSource` downsampling).
struct DownsampledRemoteImage<Placeholder: View>: View {
    let url: URL?
    let pixels: Int
    var contentMode: ContentMode = .fill
    @ViewBuilder let placeholder: () -> Placeholder
    @State private var image: UIImage?

    init(url: URL?, pixels: Int, contentMode: ContentMode = .fill, @ViewBuilder placeholder: @escaping () -> Placeholder) {
        self.url = url
        self.pixels = pixels
        self.contentMode = contentMode
        self.placeholder = placeholder
        _image = State(initialValue: url.flatMap { AttachmentImages.shared.cached($0, pixels: pixels) })
    }

    var body: some View {
        Group {
            if let image {
                Image(uiImage: image).resizable().aspectRatio(contentMode: contentMode)
            } else {
                placeholder()
            }
        }
        .task(id: url) {
            guard let url else {
                image = nil
                return
            }
            if let hit = AttachmentImages.shared.cached(url, pixels: pixels) {
                image = hit
                return
            }
            image = nil
            if let loaded = await AttachmentImages.shared.image(url, pixels: pixels) {
                image = loaded
            }
        }
    }
}
