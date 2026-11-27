import SwiftUI

/// Where a page's comments are read and written: Studio, or the offline demo.
@MainActor
protocol PageCommentBackend {
    func threads(_ pageId: String) async throws -> [PageCommentThread]
    func blocks(_ pageId: String) async throws -> [PageTextBlock]
    func create(_ pageId: String, block: String, quote: String?, text: String) async throws
    func reply(_ pageId: String, thread: String, text: String) async throws
    func resolve(_ pageId: String, thread: String, resolved: Bool) async throws
}

/// One page: its Markdown with block ids, its own metadata (archived pages
/// too, which the tree leaves out), and its comments. Reloads when Studio
/// says the page changed.
@MainActor
final class PageModel: ObservableObject {
    let serverURL = ServerScope.selectedURL
    let pageId: String
    /// Studio's editable Markdown: each top-level block after its `<!-- ^id -->` line.
    @Published var markdown: String?
    @Published var meta: PageMeta?
    @Published var error: String?
    @Published var missing = false
    /// Nil until loaded, or when the server's Pages has no comment API.
    @Published var comments: [PageCommentThread]?

    let backend: PageCommentBackend
    private let demo: Bool
    private var listener: UUID?
    private weak var realtime: BBRealtime?
    private var reloadTask: Task<Void, Never>?

    init(pageId: String, backend: PageCommentBackend? = nil) {
        self.pageId = pageId
        demo = PageDemo.on(pageId)
        self.backend = backend ?? (demo ? PageDemo.Comments.shared : StudioPageComments())
        markdown = demo ? PageDemo.markdown : DiskCache.load(String.self, key: cacheKey, serverURL: serverURL)
        if demo { meta = PageDemo.meta }
    }

    private var cacheKey: String { "page-blocks-\(pageId)" }

    var blocks: [PageBlock] { PageDocument.parse(markdown ?? "") }
    /// The page as plain Markdown, without block ids: what Copy and Export give.
    var plainMarkdown: String? { markdown.map(PageEditorModel.plain) }
    var isEmpty: Bool { plainMarkdown?.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty == true }
    var openComments: Int { comments?.filter { !$0.resolved }.count ?? 0 }

    /// Open threads anchored in `block` (or in a block inside it).
    func openThreads(in block: PageBlock) -> [PageCommentThread] {
        (comments ?? []).filter { !$0.resolved && block.contains($0.blockId) }
    }

    /// Threads in the order their blocks come in the page, as the desktop's panel sorts them; unanchored last.
    var orderedThreads: [PageCommentThread] {
        let blocks = self.blocks
        func position(_ thread: PageCommentThread) -> Int {
            blocks.firstIndex { $0.contains(thread.blockId) } ?? Int.max
        }
        return (comments ?? []).enumerated()
            .sorted { (position($0.element), $0.offset) < (position($1.element), $1.offset) }
            .map(\.element)
    }

    /// The page block a thread's anchor is in.
    func block(of thread: PageCommentThread) -> PageBlock? {
        blocks.first { $0.contains(thread.blockId) }
    }

    // MARK: Loading

    func attach(_ app: AppModel) {
        guard app.serverURL == serverURL, !demo else { return }
        let client = app.client
        detach()
        realtime = app.realtime
        listener = app.realtime.listen { [weak self] event in
            guard let self, case .pluginSignal("studio", "pages", let payload) = event else { return }
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

    /// Writes the cache off the main thread; tests wait on it (`sync {}`) before reading the cache.
    static let cacheQueue = DispatchQueue(label: "nyc.plee.bbgo.page-cache", qos: .utility)

    func load(_ client: BBClient) async {
        if demo {
            await loadComments()
            return
        }
        guard client.baseURL == serverURL else { return }
        do {
            async let markdownTask = client.editablePageMarkdown(pageId)
            async let metaTask = try? client.page(pageId)
            async let commentsTask: Void = loadComments()
            let markdown = try await markdownTask
            if self.markdown != markdown { self.markdown = markdown }
            if let meta = await metaTask, meta != self.meta { self.meta = meta }
            error = nil
            missing = false
            let key = cacheKey
            let serverURL = self.serverURL
            Self.cacheQueue.async { DiskCache.save(markdown, as: key, serverURL: serverURL) }
            await commentsTask
        } catch where BBClient.isCancellation(error) {
        } catch let failure as BBError where failure.message.localizedCaseInsensitiveContains("not found") {
            missing = true
        } catch {
            self.error = BBClient.describe(error, server: client.baseURL)
        }
    }

    func loadComments() async {
        do {
            let threads = try await backend.threads(pageId)
            if comments != threads { comments = threads }
        } catch where BBClient.isCancellation(error) {
        } catch {
            comments = nil
        }
    }
}

/// Comments through Studio's `pages.comment*` RPCs.
@MainActor
struct StudioPageComments: PageCommentBackend {
    private var client: BBClient { AppModel.shared.client }

    func threads(_ pageId: String) async throws -> [PageCommentThread] { try await client.pageComments(pageId) }
    func blocks(_ pageId: String) async throws -> [PageTextBlock] { try await client.pageCommentBlocks(pageId) }
    func create(_ pageId: String, block: String, quote: String?, text: String) async throws {
        try await client.commentOnPage(pageId, block: block, quote: quote, text: text)
    }
    func reply(_ pageId: String, thread: String, text: String) async throws {
        try await client.replyToPageComment(pageId, thread: thread, text: text)
    }
    func resolve(_ pageId: String, thread: String, resolved: Bool) async throws {
        try await client.resolvePageComment(pageId, thread: thread, resolved: resolved)
    }
}
