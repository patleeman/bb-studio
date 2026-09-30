import SwiftUI

@MainActor
final class PageModel: ObservableObject {
    let pageId: String
    @Published var markdown: String?
    @Published var error: String?
    @Published var missing = false

    private var listener: UUID?
    private weak var realtime: BBRealtime?
    private var reloadTask: Task<Void, Never>?

    init(pageId: String) {
        self.pageId = pageId
        markdown = DiskCache.load(String.self, key: cacheKey)
    }

    private var cacheKey: String { "page-\(pageId)" }

    func attach(_ app: AppModel) {
        detach()
        realtime = app.realtime
        listener = app.realtime.listen { [weak self] event in
            guard let self, case .pluginSignal(let pluginId, _, let payload) = event, pluginId == "pages" else { return }
            switch payload["type"]?.stringValue {
            case "page" where payload["pageId"]?.stringValue == pageId:
                scheduleReload(app.client)
            case "deleted":
                if payload["pageIds"]?.arrayValue?.contains(.string(pageId)) == true { missing = true }
            default:
                break
            }
        }
    }

    func detach() {
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
        if pageId == "qa-demo", ProcessInfo.processInfo.arguments.contains("-qaPageDemo") {
            markdown = Self.demo
            return
        }
        do {
            let markdown = try await client.pageMarkdown(pageId)
            if self.markdown != markdown { self.markdown = markdown }
            error = nil
            missing = false
            DiskCache.save(markdown, as: cacheKey)
        } catch where BBClient.isCancellation(error) {
        } catch let failure as BBError where failure.message.localizedCaseInsensitiveContains("not found") {
            missing = true
        } catch {
            self.error = BBClient.describe(error, server: client.baseURL)
        }
    }
}

extension PageModel {
    /// Every block kind, for UI tests (`-qaPageDemo`, `bbgo://page/qa-demo`).
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

/// One page, rendered natively from its Markdown. Read-only.
struct PageView: View {
    @EnvironmentObject private var app: AppModel
    @ObservedObject private var store = PagesStore.shared
    @StateObject private var model: PageModel
    @State private var showingWeb = false
    @State private var copied = false

    init(pageId: String) {
        _model = StateObject(wrappedValue: PageModel(pageId: pageId))
    }

    private var meta: PageMeta? { store.page(model.pageId) }
    private var gone: Bool { model.missing || store.deleted.contains(model.pageId) }

    var body: some View {
        Group {
            if gone {
                ContentUnavailableView(
                    "Page deleted", systemImage: "doc.questionmark",
                    description: Text("This page no longer exists."))
            } else {
                content
            }
        }
        .environment(\.openURL, OpenURLAction { url in
            guard url.scheme == "bbgo", let id = url.pathComponents.dropFirst().first else { return .systemAction }
            switch url.host() {
            case "page": app.path.append(.page(id: id))
            case "thread": app.path.append(.thread(id: id))
            default: return .systemAction
            }
            return .handled
        })
        .navigationTitle(meta?.displayTitle ?? "Page")
        .navigationBarTitleDisplayMode(.inline)
        .toolbar {
            ToolbarItem(placement: .topBarTrailing) {
                Menu {
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
            await model.load(app.client)
        }
        .onDisappear { model.detach() }
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
