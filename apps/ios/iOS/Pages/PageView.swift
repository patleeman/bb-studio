import SwiftUI

@MainActor
final class PageModel: ObservableObject {
    let serverURL = ServerScope.selectedURL
    let pageId: String
    @Published var markdown: String?
    @Published var error: String?
    @Published var missing = false
    /// Nil until loaded, or when the server's Pages has no comment API.
    @Published var comments: [PageCommentThread]?

    private var listener: UUID?
    private weak var realtime: BBRealtime?
    private var reloadTask: Task<Void, Never>?

    init(pageId: String) {
        self.pageId = pageId
        markdown = DiskCache.load(String.self, key: cacheKey, serverURL: serverURL)
    }

    private var cacheKey: String { "page-\(pageId)" }

    func attach(_ app: AppModel) {
        guard app.serverURL == serverURL else { return }
        let client = app.client
        detach()
        realtime = app.realtime
        listener = app.realtime.listen { [weak self] event in
            guard let self, case .pluginSignal(let pluginId, _, let payload) = event, pluginId == "pages" else { return }
            switch payload["type"]?.stringValue {
            case "page" where payload["pageId"]?.stringValue == pageId:
                scheduleReload(client)
            case "deleted":
                if payload["pageIds"]?.arrayValue?.contains(.string(pageId)) == true { missing = true }
            default:
                break
            }
        }
    }

    func detach() {
        reloadTask?.cancel()
        reloadTask = nil
        if let listener { realtime?.removeListener(listener) }
        listener = nil
    }

    private func scheduleReload(_ client: BBClient) {
        reloadTask?.cancel()
        reloadTask = Task {
            try? await Task.sleep(for: .milliseconds(600))
            guard !Task.isCancelled else { return }
            await load(client)
        }
    }

    func load(_ client: BBClient) async {
        guard client.baseURL == serverURL else { return }
        if pageId == "qa-demo", ProcessInfo.processInfo.arguments.contains("-qaPageDemo") {
            markdown = Self.demo
            return
        }
        do {
            let markdown = try await client.pageMarkdown(pageId)
            if self.markdown != markdown { self.markdown = markdown }
            error = nil
            missing = false
            DiskCache.save(markdown, as: cacheKey, serverURL: serverURL)
            await loadComments(client)
        } catch where BBClient.isCancellation(error) {
        } catch let failure as BBError where failure.message.localizedCaseInsensitiveContains("not found") {
            missing = true
        } catch {
            self.error = BBClient.describe(error, server: client.baseURL)
        }
    }

    func loadComments(_ client: BBClient) async {
        do {
            let threads = try await client.pageComments(pageId)
            if comments != threads { comments = threads }
        } catch where BBClient.isCancellation(error) {
        } catch {
            comments = nil
        }
    }

    var openComments: Int { comments?.filter { !$0.resolved }.count ?? 0 }
}

extension PageModel {
    /// Every block kind, for UI tests (`-qaPageDemo`, `bbstudio://page/qa-demo`).
    static let demo = #"""
    # Launch plan

    Owner: @[Home](thread:thr_demo) · due @[2026-10-01](date:2026-10-01)

    > [!NOTE]
    > Callouts render as a bold label and a quote.

    ```stats
    [{"label":"ARR","value":"$1.2M","delta":"+8%","trend":"up"},{"label":"Churn","value":"2.1%","delta":"-0.4%","trend":"down"},{"label":"Seats","value":"340"}]
    ```

    ## Tasks

    - [x] Write the brief
    - [ ] Record the demo
    - [ ] Ship **v1**

    | Stage | Owner | Status |
    |---|---|---|
    | Design | Ana | Done |
    | Build | Sam | In progress |

    | Today | After |
    |---|---|
    | Pages collection (Studio Pages) | Becomes the **Library**, the only collection page |
    | Recordings table (Studio Talk) | Removed as a collection page; filters and bulk actions move to the Library. |
    | Drawings gallery (Studio Draw) | Removed as a collection page. Drawings appear in the Library with thumbnails. |
    | Each item's own view | Stays with the plugin that owns it: the page editor, the recording view, the canvas. |

    ```chart
    {"type":"bar","title":"Signups","x":"label","series":["Signups"],"data":[{"label":"Mon","Signups":12},{"label":"Tue","Signups":19},{"label":"Wed","Signups":8},{"label":"Thu","Signups":24}]}
    ```

    ```embed
    {"kind":"bookmark","target":"https://example.com","title":"Example link"}
    ```

    ```swift
    print("hello")
    ```
    """#
}

/// One page, rendered natively from its Markdown. The text is read-only; comments aren't.
struct PageView: View {
    @EnvironmentObject private var app: AppModel
    @ObservedObject private var store = PagesStore.shared
    @StateObject private var model: PageModel
    @State private var showingWeb = false
    @State private var copied = false
    @State private var chats: [PageChat] = []
    @State private var renaming = false
    @State private var newTitle = ""
    @State private var showingHistory = false
    @State private var confirmingArchive = false
    @State private var notice: String?
    @State private var showingComments = false
    @State private var showingEditor = false
    @State private var showingActivity = false
    @State private var showingRelated = false
    @State private var openedEmptyEditor = false

    init(pageId: String) {
        _model = StateObject(wrappedValue: PageModel(pageId: pageId))
    }

    private var meta: PageMeta? { store.page(model.pageId) }
    private var hasLocalDraft: Bool { PageDraftStore().exists(server: model.serverURL, page: model.pageId) }
    private var gone: Bool { model.missing || store.deleted.contains(model.pageId) }

    var body: some View {
        Group {
            if gone {
                VStack {
                    ContentUnavailableView(
                        "Page deleted", systemImage: "doc.questionmark",
                        description: Text("This page no longer exists."))
                }
            } else {
                content
            }
        }
        .environment(\.openURL, OpenURLAction { url in
            guard AppLink.handles(url), let id = url.pathComponents.dropFirst().first else { return .systemAction }
            switch url.host() {
            case "page": app.push(.page(id: id))
            case "thread": app.push(.thread(id: id))
            default: return .systemAction
            }
            return .handled
        })
        .navigationTitle(meta?.displayTitle ?? "Page")
        .navigationBarTitleDisplayMode(.inline)
        .safeAreaInset(edge: .top) {
            if hasLocalDraft {
                Button("Resume draft on this phone") { showingEditor = true }
                    .font(.subheadline).frame(maxWidth: .infinity).padding(10).background(.bar)
            }
        }
        .toolbar {
            if !gone || hasLocalDraft {
                ToolbarItem(placement: .topBarTrailing) {
                    Button { showingEditor = true } label: { Image(systemName: "square.and.pencil") }
                        .accessibilityLabel("Edit page")
                }
            }
            if model.comments != nil, !gone {
                ToolbarItem(placement: .topBarTrailing) {
                    Button { showingComments = true } label: {
                        HStack(spacing: 3) {
                            Image(systemName: "text.bubble")
                            if model.openComments > 0 { Text("\(model.openComments)").font(.subheadline.monospacedDigit()) }
                        }
                    }
                    .accessibilityLabel("Comments")
                    .accessibilityValue(model.openComments > 0 ? "\(model.openComments) open" : "")
                }
            }
            ToolbarItem(placement: .topBarTrailing) {
                Menu {
                    if !chats.isEmpty {
                        Menu {
                            ForEach(chats, id: \.threadId) { chat in
                                Button { app.push(.thread(id: chat.threadId)) } label: {
                                    Text(Date(timeIntervalSince1970: chat.createdAt / 1000), format: .dateTime.month().day().hour().minute())
                                }
                            }
                        } label: {
                            Label("Chats (\(chats.count))", systemImage: "bubble.left.and.bubble.right")
                        }
                    }
                    Section {
                        Button { showingActivity = true } label: { Label("Activity", systemImage: "clock") }
                        Button { showingRelated = true } label: { Label("Related", systemImage: "link") }
                        Button {
                            newTitle = meta?.title ?? ""
                            renaming = true
                        } label: { Label("Rename", systemImage: "pencil") }
                        Button { showingHistory = true } label: { Label("Version History", systemImage: "clock.arrow.circlepath") }
                        Button { confirmingArchive = true } label: { Label("Archive", systemImage: "archivebox") }
                    }
                    Button { showingWeb = true } label: { Label("Open in BB web", systemImage: "safari") }
                    Button {
                        UIPasteboard.general.string = model.markdown
                        copied.toggle()
                    } label: {
                        Label("Copy Markdown", systemImage: "doc.on.doc")
                    }
                    .disabled(model.markdown == nil)
                    ShareLink(item: app.client.webURL(forPage: model.pageId).absoluteURL) {
                        Label("Share link", systemImage: "square.and.arrow.up")
                    }
                } label: {
                    Image(systemName: "ellipsis")
                }
                .accessibilityLabel("More")
            }
        }
        .sensoryFeedback(.success, trigger: copied)
        .safeAreaInset(edge: .bottom) {
            if !gone || PageDraftStore().exists(server: model.serverURL, page: model.pageId, kind: "work") { PageWorkBar(page: meta, pageId: model.pageId, notice: $notice) { await loadChats() } }
        }
        .overlay(alignment: .top) {
            if let notice {
                Text(notice).font(.footnote).padding(.horizontal, 12).padding(.vertical, 6)
                    .background(.regularMaterial, in: .capsule).padding(.top, 4)
                    .onTapGesture { self.notice = nil }
                    .task { try? await Task.sleep(for: .seconds(4)); self.notice = nil }
            }
        }
        .alert("Rename page", isPresented: $renaming) {
            TextField("Title", text: $newTitle)
            Button("Cancel", role: .cancel) {}
            Button("Rename") { Task { await perform { try await $0.updatePage(model.pageId, title: newTitle) } } }
        }
        .confirmationDialog("Archive this page?", isPresented: $confirmingArchive, titleVisibility: .visible) {
            Button("Archive") { Task { await perform { try await $0.updatePage(model.pageId, archived: true) } } }
        } message: {
            Text("It leaves the page list. Restore it from BB web.")
        }
        .sheet(isPresented: $showingHistory) { PageHistorySheet(pageId: model.pageId) }
        .sheet(isPresented: $showingEditor) {
            PageEditor(pageId: model.pageId) { await model.load(app.client) }
        }
        .sheet(isPresented: $showingActivity) { PageActivity(pageId: model.pageId, refresh: meta?.refresh) }
        .sheet(isPresented: $showingRelated) { RelatedView(pluginId: "pages", itemId: model.pageId) }
        .sheet(isPresented: $showingComments) { PageCommentsSheet(model: model) }
        .sheet(isPresented: $showingWeb) {
            NavigationStack {
                WebView(url: app.client.webURL(forPage: model.pageId))
                    .ignoresSafeArea(edges: .bottom)
                    .toolbar { Button("Done") { showingWeb = false } }
            }
        }
        .task(id: app.serverURL) {
            store.restore()
            store.attach(app)
            model.attach(app)
            if store.page(model.pageId) == nil { Task { await store.load(app.client) } }
            Task { await loadChats() }
            await model.load(app.client)
        }
        .onDisappear { model.detach() }
        .onChange(of: model.markdown) { _, markdown in
            if markdown?.isEmpty == true && !openedEmptyEditor {
                openedEmptyEditor = true
                showingEditor = true
            }
        }
    }

    private func loadChats() async {
        chats = ((try? await app.client.pageChats(model.pageId)) ?? []).sorted { $0.createdAt > $1.createdAt }
    }

    private func perform(_ action: (BBClient) async throws -> Void) async {
        do {
            try await action(app.client)
            await store.load(app.client)
        } catch {
            notice = BBClient.describe(error, server: app.client.baseURL)
        }
    }

    private var content: some View {
        ScrollView {
            VStack(alignment: .leading, spacing: 16) {
                if let error = model.error {
                    PagesErrorRow(message: error) { await model.load(app.client) }
                }
                header
                if let markdown = model.markdown {
                    if markdown.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty {
                        Text("This page is empty.").foregroundStyle(.secondary)
                    } else {
                        PageMarkdown(source: markdown)
                            .textSelection(.enabled)
                    }
                } else if model.error == nil {
                    ProgressView().frame(maxWidth: .infinity).padding(.top, 40)
                }
                children
            }
            .padding(.horizontal, 20)
            .padding(.vertical, 12)
            .frame(maxWidth: 720, alignment: .leading)
            .frame(maxWidth: .infinity)
        }
        .refreshable {
            async let tree: Void = store.load(app.client)
            await model.load(app.client)
            await tree
        }
    }

    private var header: some View {
        VStack(alignment: .leading, spacing: 6) {
            if let emoji = meta?.emoji { Text(emoji).font(.system(size: 44)) }
            Text(meta?.displayTitle ?? " ")
                .font(.largeTitle.bold())
                .foregroundStyle(meta?.title?.isEmpty == false ? .primary : .secondary)
            if let updatedAt = meta?.updatedAt {
                HStack(spacing: 4) {
                    if let meta {
                        Text(meta.projectId.map { store.projectNames[$0] ?? "Project" } ?? "Global")
                        Text("·")
                    }
                    Text("Edited")
                    Text(
                        Date(timeIntervalSince1970: updatedAt / 1000),
                        format: .relative(presentation: .named, unitsStyle: .wide))
                }
                .font(.caption)
                .foregroundStyle(.secondary)
            }
            if let refresh = meta?.refresh {
                Label("Keep updated · \(refresh.cron)", systemImage: "arrow.triangle.2.circlepath")
                    .font(.caption).foregroundStyle(.secondary)
            }
        }
    }

    @ViewBuilder
    private var children: some View {
        let pages = store.children(of: model.pageId)
        if !pages.isEmpty {
            VStack(alignment: .leading, spacing: 0) {
                Text("Pages").font(.headline).padding(.bottom, 6)
                ForEach(pages) { page in
                    NavigationLink(value: Route.page(id: page.id)) {
                        HStack {
                            PageRow(page: page)
                            Spacer()
                            Image(systemName: "chevron.right").font(.caption.weight(.semibold)).foregroundStyle(.tertiary)
                        }
                        .padding(.vertical, 8)
                        .contentShape(.rect)
                    }
                    .buttonStyle(.plain)
                    Divider()
                }
            }
            .padding(.top, 12)
        }
    }
}
