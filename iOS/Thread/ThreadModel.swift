import Foundation

@MainActor
final class ThreadModel: ObservableObject {
    let threadId: String
    @Published var thread: ThreadEntry?
    @Published var rows: [TimelineRow] = []
    /// False until the first page arrives from the cache or the server.
    @Published var loaded = false
    @Published var hasOlder = false
    @Published var error: String?
    @Published var sending = false
    @Published var interactions: [PendingInteraction] = []
    @Published var shelf = Shelf()
    @Published var queued: [QueuedMessage] = []
    /// Bumped on each successful send or answer, for haptics.
    @Published var confirmations = 0

    /// What BB shows above the composer: todos, goal, plan mode, background work, model fallback.
    struct Shelf: Equatable {
        var thinking: String?
        var todos: [Todos.Item] = []
        var goal: Goal?
        var planPrompt: String?
        var isPlanning = false
        var background: [BackgroundWork] = []
        var fallback: ModelFallback?
        var context: ContextUsage?

        init() {}

        init(_ page: TimelinePage) {
            thinking = page.activeThinking?.text
            todos = page.pendingTodos?.items ?? []
            goal = page.goal?.status == "complete" ? nil : page.goal
            isPlanning = page.activePromptMode?.mode == "plan"
            planPrompt = page.activePromptMode?.prompt
            background = (page.activeWorkflows ?? []) + (page.activeBackgroundCommands ?? [])
            fallback = page.modelFallback
            context = page.contextWindowUsage
            #if DEBUG
            if ProcessInfo.processInfo.arguments.contains("-qaShelfDemo") { self = .demo }
            #endif
        }

        #if DEBUG
        /// Every card at once, for checking the layout.
        static var demo: Shelf {
            var shelf = Shelf()
            shelf.todos = [
                .init(id: "1", text: "Read the sidebar code", status: "completed"),
                .init(id: "2", text: "Mirror the sidebar sections on Home", status: "in_progress"),
                .init(id: "3", text: "Sort threads by latest activity", status: "pending"),
                .init(id: "4", text: "Update the README", status: "pending"),
            ]
            shelf.goal = Goal(objective: "Make threads feel high quality on iPhone", status: "active", tokenBudget: 2_000_000, tokensUsed: 640_000)
            shelf.isPlanning = true
            shelf.background = [BackgroundWork(id: "b", taskType: "local_bash", workflowName: nil, description: "Run the test suite", status: "pending")]
            shelf.fallback = ModelFallback(sourceSeq: 1, originalModel: "claude-opus-5-5", fallbackModel: "claude-sonnet-5", message: nil)
            return shelf
        }
        #endif
    }

    private var olderCursor: TimelineCursor?
    private var loadingOlder = false
    private var listener: UUID?
    private var refreshTask: Task<Void, Never>?
    private var refreshAgain = false
    private weak var app: AppModel?

    init(threadId: String) {
        self.threadId = threadId
    }

    func attach(_ app: AppModel) {
        self.app = app
        app.realtime.subscribeThread(threadId)
        listener = app.realtime.listen { [weak self] event in
            guard let self else { return }
            switch event {
            case .changed(let entity, let id, _) where entity == "thread" && id == self.threadId:
                self.scheduleRefresh()
            case .connected:
                self.scheduleRefresh()
            default:
                break
            }
        }
    }

    func detach() {
        guard let app else { return }
        app.realtime.unsubscribeThread(threadId)
        if let listener { app.realtime.removeListener(listener) }
    }

    private var client: BBClient? { app?.client }

    private struct Snapshot: Codable {
        var thread: ThreadEntry?
        var rows: [TimelineRow]
    }

    private func cache() {
        DiskCache.save(Snapshot(thread: thread, rows: Array(rows.suffix(200))), as: "thread-\(threadId)")
    }

    func load() async {
        guard let client else { return }
        if rows.isEmpty, let snapshot = DiskCache.load(Snapshot.self, key: "thread-\(threadId)") {
            thread = snapshot.thread
            rows = snapshot.rows
            loaded = true
        }
        do {
            async let thread = client.thread(threadId)
            let page = try await client.timeline(threadId)
            rows = page.rows
            loaded = true
            shelf = Shelf(page)
            olderCursor = page.timelinePage?.olderCursor
            hasOlder = page.timelinePage?.hasOlderRows ?? false
            self.thread = try await thread
            error = nil
            cache()
            await loadInteractions()
            try? await client.markRead(threadId)
            await ThreadTitles.fetchUnknown(in: rows.compactMap(\.text), client: client)
        } catch where BBClient.isCancellation(error) {
        } catch {
            self.error = BBClient.describe(error, server: client.baseURL)
            loaded = true
        }
    }

    /// Streaming output arrives as a burst of change signals; refetch the latest window at most every ~300ms.
    private func scheduleRefresh() {
        refreshAgain = true
        guard refreshTask == nil else { return }
        refreshTask = Task {
            while refreshAgain {
                refreshAgain = false
                try? await Task.sleep(for: .milliseconds(300))
                await refreshLatest()
            }
            refreshTask = nil
        }
    }

    /// Replaces the newest window and keeps any older pages already loaded above it.
    func refreshLatest() async {
        guard let client else { return }
        do {
            async let thread = client.thread(threadId)
            let page = try await client.timeline(threadId)
            shelf = Shelf(page)
            if let first = page.rows.first, let index = rows.firstIndex(where: { $0.id == first.id }) {
                rows = Array(rows[..<index]) + page.rows
            } else {
                rows = page.rows
                olderCursor = page.timelinePage?.olderCursor
                hasOlder = page.timelinePage?.hasOlderRows ?? false
            }
            self.thread = try await thread
            error = nil
            cache()
            await loadInteractions()
            try? await client.markRead(threadId)
        } catch where BBClient.isCancellation(error) {
        } catch {
            self.error = BBClient.describe(error, server: client.baseURL)
        }
    }

    /// `GET /threads/:id` has no pending-interaction flag, so ask every time.
    func loadInteractions() async {
        guard let client else { return }
        async let queue = client.queuedMessages(threadId)
        interactions = (try? await client.interactions(threadId))?.filter { $0.status == "pending" } ?? interactions
        queued = (try? await queue) ?? queued
    }

    /// Runs a shelf action (drop a queued message, clear the goal, …) and refreshes.
    func perform(_ action: @escaping (BBClient, String) async throws -> Void) async {
        guard let client else { return }
        do {
            try await action(client, threadId)
            confirmations += 1
        } catch where BBClient.isCancellation(error) {
        } catch {
            self.error = BBClient.describe(error, server: client.baseURL)
        }
        await refreshLatest()
    }

    func resolve(_ interaction: PendingInteraction, _ resolution: JSONValue) async -> Bool {
        guard let client else { return false }
        do {
            try await client.resolve(interaction, resolution)
            interactions.removeAll { $0.id == interaction.id }
            confirmations += 1
            await refreshLatest()
            return true
        } catch {
            self.error = BBClient.describe(error, server: client.baseURL)
            await loadInteractions()
            return false
        }
    }

    /// Whether rows were added.
    @discardableResult
    func loadOlder() async -> Bool {
        guard let client, let cursor = olderCursor, !loadingOlder else { return false }
        loadingOlder = true
        defer { loadingOlder = false }
        do {
            let page = try await client.timeline(threadId, before: cursor)
            let known = Set(rows.map(\.id))
            rows = page.rows.filter { !known.contains($0.id) } + rows
            olderCursor = page.timelinePage?.olderCursor
            hasOlder = page.timelinePage?.hasOlderRows ?? false
            Task { await ThreadTitles.fetchUnknown(in: page.rows.compactMap(\.text), client: client) }
            return true
        } catch where BBClient.isCancellation(error) {
        } catch {
            self.error = error.localizedDescription
        }
        return false
    }

    func send(_ text: String, attachments: [PendingAttachment] = []) async -> Bool {
        guard let client else { return false }
        sending = true
        defer { sending = false }
        do {
            if attachments.isEmpty {
                try await client.send(threadId, text: text)
            } else {
                let projectId: String
                if let known = thread?.projectId { projectId = known } else { projectId = try await client.thread(threadId).projectId }
                let inputs = try await PendingAttachment.upload(attachments, projectId: projectId, client: client)
                try await client.send(threadId, text: text, attachments: inputs)
            }
            confirmations += 1
            await refreshLatest()
            return true
        } catch {
            self.error = BBClient.describe(error, server: client.baseURL)
            return false
        }
    }

    func stop() async {
        try? await client?.stop(threadId)
    }

    /// The newest assistant reply, for voice chat and the watch.
    var lastAssistantText: String? {
        rows.last(where: { $0.isConversation && $0.role == "assistant" })?.text
    }
}

/// Timeline rows grouped for a phone: messages stand alone, runs of tool calls
/// and reasoning collapse into one expandable "activity" item.
enum TimelineItem: Identifiable {
    case message(TimelineRow)
    case activity([TimelineRow])

    var id: String {
        switch self {
        case .message(let row): row.id
        case .activity(let rows): "activity:\(rows.first?.id ?? "")"
        }
    }

    static func group(_ rows: [TimelineRow]) -> [TimelineItem] {
        var items: [TimelineItem] = []
        var pending: [TimelineRow] = []
        func flush() {
            if !pending.isEmpty { items.append(.activity(pending)) }
            pending = []
        }
        for row in rows {
            if row.isConversation, !(row.text ?? "").isEmpty || row.hasAttachments {
                flush()
                items.append(.message(row))
            } else if row.kind == "work" || row.kind == "system" {
                pending.append(row)
            }
        }
        flush()
        return items
    }
}
