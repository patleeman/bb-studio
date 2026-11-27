import Foundation
import UIKit

@MainActor
final class ThreadModel: ObservableObject {
    let serverURL = ServerScope.selectedURL
    let threadId: String
    /// Observed only by the transcript container so streaming `rows` updates
    /// don't re-evaluate the whole `ThreadView.body` (toolbar, sheets, dialogs).
    @Observable @MainActor final class RowsBox {
        var version = 0
    }
    let rowsBox = RowsBox()

    @Published var thread: ThreadEntry?
    var rows: [TimelineRow] = [] {
        didSet {
            chainMemo = nil
            rowIdsMemo = nil
            itemsMemo = nil
            rowsBox.version &+= 1
            if !pendingSends.isEmpty { confirmPending() }
        }
    }
    /// Messages sent from here that the server hasn't shown yet, drawn after the rows.
    private(set) var pendingSends: [PendingSend] = [] {
        didSet {
            chainMemo = nil
            itemsMemo = nil
            rowsBox.version &+= 1
        }
    }
    /// Rows that stood for a pending send already.
    private var claimedRows = Set<String>()
    /// False until the first page arrives from the cache or the server.
    @Published var loaded = false
    /// The rows on screen are the cached ones, until the server's arrive.
    @Published private(set) var showsCache = false
    /// Bumped when the server's first page replaces rows drawn from the cache.
    @Published private(set) var replacedCache = 0
    @Published var hasOlder = false {
        didSet { if hasOlder != oldValue { chainMemo = nil } }
    }
    /// Loading every earlier page, for find in thread.
    @Published var loadingAll = false
    @Published var error: String?
    @Published var sending = false
    @Published private(set) var stopping = false
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
    struct Shelf: Equatable, Hashable {
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
            // A fresh seq each launch: a Dismiss from an earlier run is remembered by seq.
            shelf.fallback = ModelFallback(sourceSeq: Double(Int(Date().timeIntervalSince1970)), originalModel: "claude-opus-5-5", fallbackModel: "claude-sonnet-5", message: nil)
            return shelf
        }
        #endif
    }

    private var olderCursor: TimelineCursor?
    private var loadingOlder = false

    // MARK: The Bot's handoff chain

    /// The Bot's threads before this one, oldest first (`bot_chain`). Set by
    /// the Bot tab; once this thread's start is in, its earlier threads load
    /// above it as the reader scrolls up.
    @Published var chainBefore: [String] = [] {
        didSet { if chainBefore != oldValue { earlierPages = []; earlierCursor = nil; chainMemo = nil } }
    }
    /// Earlier threads' loaded rows, oldest first; the first may be partly loaded.
    @Published private(set) var earlierPages: [BotChain.Page] = [] {
        didSet {
            chainMemo = nil
            rowsBox.version &+= 1
        }
    }
    /// The cursor into `earlierPages.first`'s older rows, nil once its start is in.
    private var earlierCursor: TimelineCursor?

    /// Whether an earlier thread of the chain still has rows to load.
    var hasEarlier: Bool {
        guard !chainBefore.isEmpty else { return false }
        guard let first = earlierPages.first else { return true }
        return earlierCursor != nil || chainBefore.first != first.threadId
    }

    /// More to load above: this thread's older pages, then its earlier threads.
    var canLoadOlder: Bool { hasOlder || hasEarlier }

    /// The whole chain as one conversation, handoff requests left out, and
    /// messages on their way at the end. Worked out once per change: the view
    /// asks on every redraw (each keystroke in the composer).
    var chainRows: [TimelineRow] {
        if let chainMemo { return chainMemo }
        let merged = chainBefore.isEmpty ? rows
            : BotChain.merge(earlierPages + [BotChain.Page(threadId: threadId, rows: rows, continuation: !hasOlder)])
        let shown = pendingSends.isEmpty ? merged : merged + pendingSends.map(\.row)
        chainMemo = shown
        return shown
    }
    private var chainMemo: [TimelineRow]?

    /// This thread's rows and the messages on their way.
    var shownRows: [TimelineRow] { pendingSends.isEmpty ? rows : rows + pendingSends.map(\.row) }

    /// The ids of this thread's own rows (not the chain's earlier threads'),
    /// once per change. The view asks on every redraw, and building it there
    /// for a long Bot chat was where a 10 s hang spent its time.
    var rowIds: Set<String> {
        if let rowIdsMemo { return rowIdsMemo }
        let ids = Set(rows.map(\.id))
        rowIdsMemo = ids
        return ids
    }
    private var rowIdsMemo: Set<String>?

    /// `shownRows` grouped into the timeline's items, once per change.
    var shownItems: [TimelineItem] {
        if let itemsMemo { return itemsMemo }
        let items = TimelineItem.group(shownRows, skipQuietThoughts: true)
        itemsMemo = items
        return items
    }
    private var itemsMemo: [TimelineItem]?

    private func confirmPending() {
        let left = TimelineMerge.unconfirmed(pendingSends, in: rows, claimed: &claimedRows)
        if left.count != pendingSends.count { pendingSends = left }
        if pendingSends.isEmpty { claimedRows = [] }
    }

    /// Loads the next page up the chain: the rest of the earliest loaded
    /// thread, else the newest page of the thread before it.
    private func loadEarlier(_ client: BBClient) async -> OlderPage {
        loadingOlder = true
        defer { loadingOlder = false }
        // A handoff can change the chain (and empty `earlierPages`) while a page is in flight.
        let chain = chainBefore
        do {
            if let first = earlierPages.first, let cursor = earlierCursor {
                let page = try await client.timeline(first.threadId, before: cursor)
                guard chainBefore == chain, earlierPages.first?.threadId == first.threadId else { return .nothing }
                let known = Set(first.rows.map(\.id))
                let added = page.rows.filter { !known.contains($0.id) }
                earlierCursor = page.timelinePage?.hasOlderRows == true ? page.timelinePage?.olderCursor : nil
                let index = chainBefore.firstIndex(of: first.threadId) ?? 0
                earlierPages[0] = BotChain.Page(threadId: first.threadId, rows: added + first.rows,
                                                continuation: index > 0 && earlierCursor == nil)
                return added.isEmpty ? .nothing : .added
            }
            let next = (earlierPages.first.flatMap { chainBefore.firstIndex(of: $0.threadId) } ?? chainBefore.count) - 1
            guard chainBefore.indices.contains(next) else { return .nothing }
            let page = try await client.timeline(chainBefore[next])
            guard chainBefore == chain else { return .nothing }
            earlierCursor = page.timelinePage?.hasOlderRows == true ? page.timelinePage?.olderCursor : nil
            earlierPages.insert(BotChain.Page(threadId: chainBefore[next], rows: page.rows, continuation: next > 0 && earlierCursor == nil), at: 0)
            // Another thread of the chain is in, even an empty one: the chain moved on.
            return .added
        } catch where BBClient.isCancellation(error) {
        } catch {
            self.error = BBClient.describe(error, server: client.baseURL)
        }
        return .failed
    }
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
        #if DEBUG
        if BurstDemo.enabled, threadId == BurstDemo.threadId { BurstDemo.prepare(serverURL: serverURL) }
        #endif
        // The cached rows are there for the view's first frame.
        if let snapshot = TimelineCache.load(threadId, serverURL: serverURL), !snapshot.rows.isEmpty {
            showsCache = true
            thread = snapshot.thread
            rows = snapshot.rows
            loaded = true
        }
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
        var client = app.client
        #if DEBUG
        if BotDemo.served != nil, threadId == BotDemo.threadId {
            client = BotDemo.Server.shared.client(serverURL)
            BotDemo.Server.shared.observe(self) { [weak self] in self?.scheduleRefresh(nil) }
        }
        if BurstDemo.enabled, threadId == BurstDemo.threadId {
            client = BurstDemo.Server.shared.client(serverURL)
            BurstDemo.Server.shared.changed = { [weak self] in self?.scheduleRefresh($0) }
            BurstDemo.run(self)
        }
        #endif
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
        // Attached again after a detach: catch up on what came while it wasn't listening.
        if loaded { scheduleRefresh(nil) }
        if backgroundObserver == nil {
            backgroundObserver = NotificationCenter.default.addObserver(
                forName: UIApplication.didEnterBackgroundNotification, object: nil, queue: .main
            ) { [weak self] _ in
                MainActor.assumeIsolated { self?.flushCacheIfPending() }
            }
        }
    }

    func detach() {
        if let backgroundObserver {
            NotificationCenter.default.removeObserver(backgroundObserver)
            self.backgroundObserver = nil
        }
        cacheFlushTask?.cancel()
        cacheFlushTask = nil
        #if DEBUG
        if BotDemo.served != nil { BotDemo.Server.shared.unobserve(self) }
        #endif
        guard let client = boundClient else { return }
        if loaded { cache(force: true) }
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

    private var lastMarkedRead = ContinuousClock.now - .seconds(60)
    /// Rows arrived since the last mark.
    private var readPending = false
    private var lastCachedAt = ContinuousClock.now - .seconds(60)
    private var cachePending = false
    private var cacheFlushTask: Task<Void, Never>?
    private var backgroundObserver: NSObjectProtocol?

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

    /// Flushes a throttled `TimelineCache` write when the app backgrounds.
    func flushCacheIfPending() {
        guard cachePending, loaded else { return }
        cache(force: true)
    }

    /// After each load and update; encoded and written off the main thread.
    /// Streaming ticks arrive up to ~6 times/sec; throttle intermediate writes
    /// to every 2 s with a trailing flush, and always flush on load, turn end,
    /// backgrounding, or detach.
    private func cache(force: Bool = false) {
        let elapsed = ContinuousClock.now - lastCachedAt
        guard force || elapsed >= .seconds(2) else {
            cachePending = true
            if cacheFlushTask == nil {
                let remaining = .seconds(2) - elapsed
                cacheFlushTask = Task { [weak self] in
                    try? await Task.sleep(for: remaining)
                    guard !Task.isCancelled, let self else { return }
                    self.cacheFlushTask = nil
                    self.flushCacheIfPending()
                }
            }
            return
        }
        cacheFlushTask?.cancel()
        cacheFlushTask = nil
        lastCachedAt = .now
        cachePending = false
        TimelineCache.save(threadId, thread: thread, rows: rows, serverURL: serverURL)
    }

    #if DEBUG
    private(set) var qaLoadCount = 0
    #endif

    func load() async {
        #if DEBUG
        qaLoadCount += 1
        #endif
        #if DEBUG
        if BotDemo.served == nil, let demo = BotDemo.current, threadId == BotDemo.threadId {
            thread = demo.thread
            rows = demo.rows
            interactions = demo.interactions
            // `-qaShelfDemo`: every lasting state and the model fallback, for the chips and notice lines.
            if ProcessInfo.processInfo.arguments.contains("-qaShelfDemo") { shelf = .demo }
            loaded = true
            return
        }
        if BotDemo.served == nil, let wide = BotDemo.wideThread(threadId) {
            thread = wide.thread
            rows = wide.rows
            loaded = true
            return
        }
        #endif
        guard let client else { return }
        do {
            async let thread = client.thread(threadId)
            async let interactionsTask: Void = loadInteractions()
            async let planReviewTask: Void = loadPlanReview()
            let page = try await inTimelineOrder { [self] in
                let page = try await client.timeline(threadId)
                // Drawn as soon as the rows are in, while the thread's details may still be on the way.
                defer { loaded = true }
                // Over the cached rows by id: the ones above the page stay, and
                // nothing redraws when nothing changed.
                let (merged, contiguous) = TimelineMerge.merge(rows, page: page.rows)
                if merged != rows { rows = merged }
                if !contiguous { replacedCache += 1 }
                let next = Shelf(page)
                if shelf != next { shelf = next }
                olderCursor = page.timelinePage?.olderCursor
                hasOlder = page.timelinePage?.hasOlderRows ?? false
                maxSeq = page.maxSeq
                windowStart = page.rows.first?.id
                return page
            }
            let fresh = try await thread
            loaded = true
            if showsCache { showsCache = false }
            ChatPerf.serverRowsLanded(rows: rows.count)
            unreadFrom = Self.firstUnread(in: page.rows, thread: fresh)
            self.thread = fresh
            error = nil
            cache(force: true)
            let rowTexts = rows.compactMap(\.text)
            async let markReadTask: Void = { _ = try? await client.markRead(self.threadId) }()
            async let clearNotifTask: Void = NotificationActions.clear(threadIds: [threadId], client: client)
            async let titlesTask: Void = ThreadTitles.fetchUnknown(in: rowTexts, client: client)
            _ = await (interactionsTask, planReviewTask, markReadTask, clearNotifTask, titlesTask)
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
        #if DEBUG
        if BotDemo.served == nil, BotDemo.current != nil, threadId == BotDemo.threadId || BotDemo.wideThread(threadId) != nil { return }
        BurstDemo.signalCount += 1
        #endif
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
            if let thread = try await thread, thread != self.thread { self.thread = thread }
            if error != nil { error = nil }
            if touched("interactions-changed", "queue-changed", "status-changed") { await loadInteractions() }
            if grew, !Task.isCancelled {
                cache(force: self.thread?.isRunning == false)
                await markRead(client)
            } else if cachePending, self.thread?.isRunning == false, !Task.isCancelled {
                cache(force: true)
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
        let next = Shelf(page)
        if shelf != next { shelf = next }
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
        if let first = page.rows.first, rows.lastIndex(where: { $0.id == first.id }) != nil {
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
        let start = windowStart.flatMap { id in rows.lastIndex { $0.id == id } } ?? rows.startIndex
        var window = Array(rows[start...])
        if let order = delta.rowOrder {
            // Almost all delta ids live in the current window (~50 rows); only build the full map on a miss.
            var known = Dictionary<String, TimelineRow>(minimumCapacity: window.count + delta.upsertRows.count)
            for row in window { known[row.id] = row }
            for row in delta.upsertRows { known[row.id] = row }
            var prefixKnown: [String: TimelineRow]?
            var ordered: [TimelineRow] = []
            ordered.reserveCapacity(order.count)
            for id in order {
                if let row = known[id] {
                    ordered.append(row)
                } else {
                    if prefixKnown == nil {
                        var map = Dictionary<String, TimelineRow>(minimumCapacity: start)
                        for row in rows[..<start] { map[row.id] = row }
                        prefixKnown = map
                    }
                    guard let row = prefixKnown?[id] else { return nil }
                    ordered.append(row)
                }
            }
            window = ordered
        } else {
            for row in delta.upsertRows {
                if let index = window.lastIndex(where: { $0.id == row.id }) { window[index] = row } else { window.append(row) }
            }
        }
        // It has to start on a row already here, to know where the older pages end.
        guard let first = window.first, rows.lastIndex(where: { $0.id == first.id }) != nil else { return nil }
        return window
    }

    /// Swaps in the newest page and keeps the older pages above it. Whether anything changed.
    private func replaceLatest(with window: [TimelineRow]) -> Bool {
        guard let first = window.first, let index = rows.lastIndex(where: { $0.id == first.id }) else { return false }
        windowStart = first.id
        // Compare only the replaced tail, and preserve unchanged TimelineRow instances
        // so their String buffers stay pointer-equal during downstream transcript diffs.
        let tailCount = rows.count - index
        let common = min(tailCount, window.count)
        var changedIndices: [Int] = []
        for offset in 0..<common where rows[index + offset] != window[offset] {
            changedIndices.append(offset)
        }
        guard !changedIndices.isEmpty || tailCount != window.count else { return false }
        var updated = rows
        for offset in changedIndices {
            updated[index + offset] = window[offset]
        }
        if window.count > tailCount {
            updated.append(contentsOf: window[tailCount...])
        } else if window.count < tailCount {
            updated.removeLast(tailCount - window.count)
        }
        rows = updated
        return true
    }

    /// `GET /threads/:id` has no pending-interaction flag, so ask every time.
    func loadInteractions() async {
        guard let client else { return }
        async let queue = client.queuedMessages(threadId)
        let pending = (try? await client.interactions(threadId))?.filter { $0.status == "pending" } ?? interactions
        if pending != interactions { interactions = pending }
        let waiting = (try? await queue) ?? queued
        if waiting != queued { queued = waiting }
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

    /// Whether rows were added, nothing new came, the load failed, or another is in flight.
    @discardableResult
    func loadOlder() async -> OlderPage {
        if loadingOlder { return .busy }
        if !hasOlder, hasEarlier, let client { return await loadEarlier(client) }
        guard let client, olderCursor != nil else { return .nothing }
        loadingOlder = true
        defer { loadingOlder = false }
        do {
            // In timeline order, so a full refresh can't swap the rows under the cursor mid-fetch.
            let page = try await inTimelineOrder { [self] () async throws -> (TimelinePage, Int)? in
                guard var cursor = olderCursor else { return nil }
                let known = Set(rows.map(\.id))
                // Rows kept from the cache can sit above the server's first page:
                // page past them rather than stop on a page with nothing new.
                for _ in 0..<20 {
                    let page = try await client.timeline(threadId, before: cursor)
                    let added = page.rows.filter { !known.contains($0.id) }
                    olderCursor = page.timelinePage?.olderCursor
                    hasOlder = page.timelinePage?.hasOlderRows ?? false
                    if !added.isEmpty { rows = added + rows }
                    guard added.isEmpty, hasOlder, let next = olderCursor, next != cursor else { return (page, added.count) }
                    cursor = next
                }
                return nil
            }
            guard let (page, added) = page else { return .nothing }
            Task { await ThreadTitles.fetchUnknown(in: page.rows.compactMap(\.text), client: client) }
            return added > 0 ? .added : .nothing
        } catch where BBClient.isCancellation(error) {
        } catch {
            self.error = error.localizedDescription
        }
        return .failed
    }

    /// The whole thread, so find in thread sees every message.
    func loadAll() async {
        guard hasOlder, !loadingAll else { return }
        loadingAll = true
        defer { loadingAll = false }
        while hasOlder, !Task.isCancelled {
            switch await loadOlder() {
            case .added: continue
            // Another load is in flight; wait for it rather than give up.
            case .busy: try? await Task.sleep(for: .milliseconds(200))
            // A page with nothing new would come back the same again.
            case .nothing, .failed: return
            }
        }
    }

    /// `agentNote`, when set, goes along unseen by the user.
    func send(_ text: String, mentions: [Mention] = [], attachments: [PendingAttachment] = [], agentNote: String? = nil) async -> Bool {
        guard let client else { return false }
        sending = true
        defer { sending = false }
        // Shown at once, until the server's row for it comes in.
        let pending = text.isEmpty ? nil : PendingSend(text: text, rows: rows)
        if let pending { pendingSends.append(pending) }
        func drop() { if let pending { pendingSends.removeAll { $0.row.id == pending.row.id } } }
        do {
            if attachments.isEmpty {
                // Queued behind a running turn: the shelf shows it, not the chat.
                if try await client.send(threadId, text: text, attachments: [], mentions: mentions, agentNote: agentNote).delivery == "queued" { drop() }
            } else {
                let projectId: String
                if let known = thread?.projectId { projectId = known } else { projectId = try await client.thread(threadId).projectId }
                let inputs = try await PendingAttachment.upload(attachments, projectId: projectId, client: client)
                if try await client.send(threadId, text: text, attachments: inputs, mentions: mentions, agentNote: agentNote).delivery == "queued" { drop() }
            }
            confirmations += 1
            await refreshLatest()
            return true
        } catch where BBClient.neverArrived(error) && attachments.isEmpty {
            // The outbox shows it from here.
            drop()
            let queued = Outbox.shared.add(threadId: threadId, text: text, mentions: mentions, serverURL: client.baseURL)
            if !queued { self.error = Outbox.shared.storageError }
            return queued
        } catch {
            drop()
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


    func stop() async {
        guard !stopping, let client else { return }
        stopping = true
        defer { stopping = false }
        do {
            try await client.stop(threadId)
        } catch {
            let message = BBClient.describe(error, server: client.baseURL)
            await refreshLatest()
            self.error = message
        }
    }
}

/// Timeline rows grouped for a phone: messages stand alone, runs of tool calls
/// and reasoning collapse into one expandable "activity" item. Provider
/// deprecation notices are left out (a new Codex fork opens with one).
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

    static func group(_ rows: [TimelineRow], skipQuietThoughts: Bool = false) -> [TimelineItem] {
        var items: [TimelineItem] = []
        items.reserveCapacity(rows.count)
        var pending: [TimelineRow] = []
        func flush() {
            if !pending.isEmpty { items.append(.activity(pending)) }
            pending = []
        }
        for row in rows {
            if skipQuietThoughts, row.isQuietThought { continue }
            if row.isConversation, !(row.text ?? "").isEmpty || row.hasAttachments {
                flush()
                items.append(.message(row))
            } else if row.isDeprecationNotice {
                continue
            } else if row.kind == "work" || row.kind == "system" {
                pending.append(row)
            }
        }
        flush()
        return items
    }
}

/// What loading a page above the timeline did.
enum OlderPage: Equatable {
    case added, nothing, failed, busy

    /// How long the top-of-timeline loader waits before the next page, or nil
    /// to stop until the reader leaves the top and comes back. A page with
    /// nothing new stops it; failures back off from 2s up to a minute.
    func retryDelay(failures: inout Int) -> Duration? {
        switch self {
        case .added:
            failures = 0
            return .milliseconds(500)
        case .busy:
            return .milliseconds(500)
        case .nothing:
            return nil
        case .failed:
            failures += 1
            return .seconds(min(60, 2 << min(failures - 1, 5)))
        }
    }
}
