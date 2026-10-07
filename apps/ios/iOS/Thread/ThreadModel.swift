import Foundation

@MainActor
final class ThreadModel: ObservableObject {
    let serverURL = ServerScope.selectedURL
    let threadId: String
    @Published var thread: ThreadEntry?
    @Published var rows: [TimelineRow] = []
    /// False until the first page arrives from the cache or the server.
    @Published var loaded = false
    @Published var hasOlder = false
    /// Loading every earlier page, for find in thread.
    @Published var loadingAll = false
    @Published var error: String?
    @Published var sending = false
    @Published var interactions: [PendingInteraction] = []
    @Published var shelf = Shelf()
    @Published var queued: [QueuedMessage] = []
    /// A plan the agent is waiting on you to review in Plannotator.
    @Published var planReview: PlanReview?
    /// Bumped on each successful send or answer, for haptics.
    @Published var confirmations = 0
    /// The first row that arrived since the reader last looked, for the "New" divider.
    @Published var unreadFrom: String?

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
    /// Bumped when a refresh loop is abandoned, so it doesn't clear its successor's slot.
    private var refreshRun = 0
    /// Change kinds waiting for the next refresh; nil refreshes everything.
    private var pending: Set<String>? = []
    /// What the newest page was built from: its `maxSeq`, for asking only for what
    /// changed since, and its first row, where that page starts in `rows`.
    private var maxSeq: Int?
    private var windowStart: String?
    private var boundClient: BBClient?
    private weak var realtime: BBRealtime?

    /// `client` is for tests; the app binds one in `attach`.
    init(threadId: String, client: BBClient? = nil) {
        self.threadId = threadId
        boundClient = client
    }

    /// The last timeline fetch in line. Fetches run one at a time, so a slow,
    /// older page can't land on top of a newer one, and each delta asks from the
    /// `maxSeq` the previous one left.
    private var timelineTail: Task<Void, Never>?

    private func inTimelineOrder<T>(_ work: @escaping @MainActor () async throws -> T) async throws -> T {
        let previous = timelineTail
        let task = Task { @MainActor in
            await previous?.value
            return try await work()
        }
        timelineTail = Task { _ = try? await task.value }
        return try await withTaskCancellationHandler { try await task.value } onCancel: { task.cancel() }
    }

    func attach(_ app: AppModel) {
        guard app.serverURL == serverURL else { return }
        let client = app.client
        boundClient = client
        realtime = app.realtime
        app.realtime.subscribeThread(threadId)
        listener = app.realtime.listen { [weak self] event in
            guard let self else { return }
            switch event {
            case .changed(let entity, let id, let changes) where entity == "thread" && id == self.threadId:
                self.scheduleRefresh(changes.isEmpty ? nil : Set(changes))
            case .connected:
                self.scheduleRefresh(nil)
            case .pluginSignal(let pluginId, _, _) where pluginId == "plannotator":
                Task { await self.loadPlanReview() }
            default:
                break
            }
        }
    }

    func detach() {
        guard let client = boundClient else { return }
        if loaded { cache() }
        if readPending {
            Task { await markRead(client, force: true) }
        }
        // A refresh still running would mark rows read that nobody saw.
        refreshRun += 1
        refreshTask?.cancel()
        refreshTask = nil
        pending = []
        realtime?.unsubscribeThread(threadId)
        if let listener { realtime?.removeListener(listener) }
    }

    private var client: BBClient? { boundClient }

    private struct Snapshot: Codable {
        var thread: ThreadEntry?
        var rows: [TimelineRow]
    }

    private var lastCached = ContinuousClock.now - .seconds(60)
    private var lastMarkedRead = ContinuousClock.now - .seconds(60)
    /// Rows arrived since the last mark.
    private var readPending = false

    /// Each mark comes back as a read-state change that every open list refetches
    /// on, so while a turn streams, mark at most every 5 seconds and once on leaving.
    private func markRead(_ client: BBClient, force: Bool = false) async {
        guard force || ContinuousClock.now - lastMarkedRead > .seconds(5) else {
            readPending = true
            return
        }
        lastMarkedRead = .now
        readPending = false
        try? await client.markRead(threadId)
    }

    /// A streaming turn grows the rows several times a second: write at most every
    /// 10 seconds, and once more on the way out.
    private func cache(force: Bool = true) {
        guard force || ContinuousClock.now - lastCached > .seconds(10) else { return }
        lastCached = .now
        DiskCache.save(Snapshot(thread: thread, rows: Array(rows.suffix(200))), as: "thread-\(threadId)", serverURL: serverURL)
    }

    func load() async {
        guard let client else { return }
        if rows.isEmpty, let snapshot = DiskCache.load(Snapshot.self, key: "thread-\(threadId)", serverURL: serverURL) {
            thread = snapshot.thread
            rows = snapshot.rows
            loaded = true
        }
        do {
            async let thread = client.thread(threadId)
            let page = try await inTimelineOrder { [self] in
                let page = try await client.timeline(threadId)
                rows = page.rows
                shelf = Shelf(page)
                olderCursor = page.timelinePage?.olderCursor
                hasOlder = page.timelinePage?.hasOlderRows ?? false
                maxSeq = page.maxSeq
                windowStart = page.rows.first?.id
                return page
            }
            let fresh = try await thread
            loaded = true
            unreadFrom = Self.firstUnread(in: page.rows, thread: fresh)
            self.thread = fresh
            error = nil
            cache()
            await loadInteractions()
            await loadPlanReview()
            try? await client.markRead(threadId)
            await NotificationActions.clear(threadIds: [threadId], client: client)
            await ThreadTitles.fetchUnknown(in: rows.compactMap(\.text), client: client)
        } catch where BBClient.isCancellation(error) {
        } catch {
            self.error = BBClient.describe(error, server: client.baseURL)
            loaded = true
        }
    }

    /// BB web's rule: after the last read, the first row the reader didn't write.
    private static func firstUnread(in rows: [TimelineRow], thread: ThreadEntry) -> String? {
        guard let lastRead = thread.lastReadAt, thread.isUnread else { return nil }
        return rows.first { ($0.startedAt ?? $0.createdAt ?? 0) > lastRead && !$0.isUser }?.id
    }

    /// Streaming output arrives as a burst of change signals; coalesce them into
    /// at most one refresh every ~150ms.
    func scheduleRefresh(_ changes: Set<String>?) {
        if let changes, let known = pending { pending = known.union(changes) } else { pending = nil }
        guard refreshTask == nil else { return }
        let run = refreshRun
        refreshTask = Task {
            while !Task.isCancelled, pending?.isEmpty != true {
                try? await Task.sleep(for: .milliseconds(150))
                if Task.isCancelled { break }
                let changes = pending
                pending = []
                await refresh(changes)
            }
            if run == refreshRun { refreshTask = nil }
        }
    }

    /// Refetches everything the next turn could have touched.
    func refreshLatest() async {
        await refresh(nil)
    }

    /// Fetches only what `changes` could have touched. Marking the thread read
    /// comes back as `read-state-changed`, which on its own needs nothing.
    private func refresh(_ changes: Set<String>?) async {
        guard let client else { return }
        func touched(_ kinds: String...) -> Bool { changes.map { !$0.isDisjoint(with: kinds) } ?? true }
        let rewritten = changes?.contains("history-rewritten") == true
        do {
            let wantsThread = touched("status-changed", "title-changed", "archived-changed", "pin-state-changed")
            async let thread = wantsThread ? client.thread(threadId) : nil
            var grew = false
            if touched("events-appended", "history-rewritten", "status-changed") {
                grew = try await inTimelineOrder { [self] in try await refreshTimeline(client, rewritten: rewritten) }
            }
            if let thread = try await thread { self.thread = thread }
            error = nil
            if touched("interactions-changed", "queue-changed", "status-changed") { await loadInteractions() }
            if grew, !Task.isCancelled {
                cache(force: false)
                await markRead(client)
            }
        } catch where BBClient.isCancellation(error) {
        } catch {
            self.error = BBClient.describe(error, server: client.baseURL)
        }
    }

    /// Updates the newest page, as a delta when BB still has the last one. Whether rows changed.
    private func refreshTimeline(_ client: BBClient, rewritten: Bool = false) async throws -> Bool {
        if rewritten { maxSeq = nil }
        let page = try await client.timeline(threadId, after: maxSeq)
        shelf = Shelf(page)
        if let delta = page.delta {
            guard let window = applying(delta) else {
                // Rows out of step with BB's; start over from a full page.
                maxSeq = nil
                return try await refreshTimeline(client)
            }
            maxSeq = page.maxSeq
            return replaceLatest(with: window)
        }
        maxSeq = page.maxSeq
        if let first = page.rows.first, rows.contains(where: { $0.id == first.id }) {
            return replaceLatest(with: page.rows)
        }
        rows = page.rows
        windowStart = page.rows.first?.id
        olderCursor = page.timelinePage?.olderCursor
        hasOlder = page.timelinePage?.hasOlderRows ?? false
        return true
    }

    /// The newest page with `delta` applied, or nil when a row it names is missing.
    private func applying(_ delta: TimelinePage.Delta) -> [TimelineRow]? {
        let start = windowStart.flatMap { id in rows.firstIndex { $0.id == id } } ?? rows.startIndex
        var window = Array(rows[start...])
        if let order = delta.rowOrder {
            var known = Dictionary(rows.map { ($0.id, $0) }, uniquingKeysWith: { $1 })
            for row in delta.upsertRows { known[row.id] = row }
            window = order.compactMap { known[$0] }
            guard window.count == order.count else { return nil }
        } else {
            for row in delta.upsertRows {
                if let index = window.firstIndex(where: { $0.id == row.id }) { window[index] = row } else { window.append(row) }
            }
        }
        // It has to start on a row already here, to know where the older pages end.
        guard let first = window.first, rows.contains(where: { $0.id == first.id }) else { return nil }
        return window
    }

    /// Swaps in the newest page and keeps the older pages above it. Whether anything changed.
    private func replaceLatest(with window: [TimelineRow]) -> Bool {
        guard let first = window.first, let index = rows.firstIndex(where: { $0.id == first.id }) else { return false }
        windowStart = first.id
        let updated = Array(rows[..<index]) + window
        guard updated != rows else { return false }
        rows = updated
        return true
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
            try await client.settle(interaction, resolution)
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

    func cancel(_ interaction: PendingInteraction) async {
        guard let client else { return }
        do {
            try await client.cancel(interaction)
            interactions.removeAll { $0.id == interaction.id }
        } catch {
            self.error = BBClient.describe(error, server: client.baseURL)
        }
        await loadInteractions()
    }

    /// Whether rows were added.
    @discardableResult
    func loadOlder() async -> Bool {
        guard let client, olderCursor != nil, !loadingOlder else { return false }
        loadingOlder = true
        defer { loadingOlder = false }
        do {
            // In timeline order, so a full refresh can't swap the rows under the cursor mid-fetch.
            let page = try await inTimelineOrder { [self] () async throws -> TimelinePage? in
                guard let cursor = olderCursor else { return nil }
                let page = try await client.timeline(threadId, before: cursor)
                let known = Set(rows.map(\.id))
                rows = page.rows.filter { !known.contains($0.id) } + rows
                olderCursor = page.timelinePage?.olderCursor
                hasOlder = page.timelinePage?.hasOlderRows ?? false
                return page
            }
            guard let page else { return false }
            Task { await ThreadTitles.fetchUnknown(in: page.rows.compactMap(\.text), client: client) }
            return true
        } catch where BBClient.isCancellation(error) {
        } catch {
            self.error = error.localizedDescription
        }
        return false
    }

    /// The whole thread, so find in thread sees every message.
    func loadAll() async {
        guard hasOlder, !loadingAll else { return }
        loadingAll = true
        defer { loadingAll = false }
        while hasOlder, !Task.isCancelled {
            if await !loadOlder() {
                // Another load is in flight; wait for it rather than give up.
                guard loadingOlder else { return }
                try? await Task.sleep(for: .milliseconds(200))
            }
        }
    }

    func send(_ text: String, mentions: [Mention] = [], attachments: [PendingAttachment] = []) async -> Bool {
        guard let client else { return false }
        sending = true
        defer { sending = false }
        do {
            if attachments.isEmpty {
                try await client.send(threadId, text: text, mentions: mentions)
            } else {
                let projectId: String
                if let known = thread?.projectId { projectId = known } else { projectId = try await client.thread(threadId).projectId }
                let inputs = try await PendingAttachment.upload(attachments, projectId: projectId, client: client)
                try await client.send(threadId, text: text, attachments: inputs, mentions: mentions)
            }
            confirmations += 1
            await refreshLatest()
            return true
        } catch where BBClient.neverArrived(error) && attachments.isEmpty {
            Outbox.shared.add(threadId: threadId, text: text, mentions: mentions, serverURL: client.baseURL)
            return true
        } catch {
            self.error = BBClient.describe(error, server: client.baseURL)
            return false
        }
    }

    func loadPlanReview() async {
        guard let client,
              (UserDefaults.standard.string(forKey: ServerScope.key("runningPlugins", serverURL: serverURL)) ?? "").split(separator: ",").contains("plannotator")
        else { return }
        if let review = try? await client.activePlanReview(threadId) {
            planReview = review
        } else {
            planReview = nil
        }
    }

    /// Holds the message in the queue until it's sent from the queue.
    func saveDraft(_ text: String, mentions: [Mention]) async -> Bool {
        guard let client else { return false }
        do {
            try await client.saveDraft(threadId, text: text, mentions: mentions)
            confirmations += 1
            await loadInteractions()
            return true
        } catch {
            self.error = BBClient.describe(error, server: client.baseURL)
            return false
        }
    }

    /// Queues the message on the server to go at `date`.
    func send(_ text: String, mentions: [Mention], at date: Date) async -> Bool {
        guard let client else { return false }
        sending = true
        defer { sending = false }
        do {
            _ = try await client.send(threadId, text: text, mentions: mentions, at: date)
            confirmations += 1
            await loadInteractions()
            return true
        } catch {
            self.error = BBClient.describe(error, server: client.baseURL)
            return false
        }
    }

    /// Runs a thread action that changes the timeline, then refreshes.
    @discardableResult
    func run(_ action: (BBClient) async throws -> Void) async -> Bool {
        guard let client else { return false }
        do {
            try await action(client)
            confirmations += 1
            await refreshLatest()
            return true
        } catch {
            self.error = BBClient.describe(error, server: client.baseURL)
            return false
        }
    }

    func fork() async -> String? {
        guard let client else { return nil }
        do {
            return try await client.fork(threadId)
        } catch {
            self.error = BBClient.describe(error, server: client.baseURL)
            return nil
        }
    }

    /// Opens a side chat about `text` and returns its thread.
    func sideChat(about text: String) async -> String? {
        guard let client else { return nil }
        do {
            return try await client.sideChat(from: threadId, about: text)
        } catch {
            self.error = BBClient.describe(error, server: client.baseURL)
            return nil
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

    var rows: [TimelineRow] {
        switch self {
        case .message(let row): [row]
        case .activity(let rows): rows
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
