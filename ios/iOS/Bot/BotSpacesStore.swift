import Foundation

@MainActor
final class BotSpacesStore: ObservableObject {
    static var shared = BotSpacesStore()

    let serverURL: URL
    @Published private(set) var support: BotSpacesSupport
    @Published private(set) var spaces: BotSpaces?
    @Published private(set) var views: [String: BotThreadsView] = [:]
    @Published private(set) var error: String?
    /// The Bot the shell shows; "Talk to Bot" and the Live Activity follow it.
    var shownBotId: String?

    var coalesceDelay: Duration = .milliseconds(300)
    var retryDelays: [Duration] = SpacesLaunch.retries

    private(set) var watched: Set<String> = []
    private var client: BBClient?
    private weak var realtime: BBRealtime?
    private var listener: UUID?
    private var restored = false

    private var spacesDirty = false
    private var dirtyViews: Set<String> = []
    private var flushTask: Task<Void, Never>?
    private var spacesGeneration = 0
    private var viewGeneration: [String: Int] = [:]
    private var retryTask: Task<Void, Never>?
    private(set) var retries = 0

    init(serverURL: URL = ServerScope.selectedURL) {
        self.serverURL = serverURL
        support = BotSpacesSupport.stored(serverURL: serverURL)
    }

    var useSpaces: Bool { support == .available }

    func attach(client: BBClient, realtime: BBRealtime?) {
        guard client.baseURL == serverURL else { return }
        self.client = client
        restore()
        guard let realtime, realtime !== self.realtime else { return }
        if let listener { self.realtime?.removeListener(listener) }
        self.realtime = realtime
        listener = realtime.listen { [weak self] event in self?.handle(event) }
    }

    func restore() {
        guard !restored else { return }
        restored = true
        guard let cached = BotSpacesCache.loadSpaces(serverURL: serverURL) else { return }
        spaces = cached
        if let botId = cached.current?.id { watch(botId, fetch: false) }
    }

    func view(for botId: String) -> BotThreadsView? { views[botId] }

    /// Whether a thread is one of the Bots' conversations or workers: nil while
    /// nothing is loaded to tell.
    func knows(threadId: String) -> Bool? {
        guard spaces != nil || !views.isEmpty else { return nil }
        if spaces?.bots.contains(where: { $0.mainThreadId == threadId }) == true { return true }
        if views.values.contains(where: { view in
            view.conversations.contains { $0.threadId == threadId } || view.workers.contains { $0.threadId == threadId }
        }) { return true }
        return views.isEmpty ? nil : false
    }

    func watch(_ botId: String, fetch: Bool = true) {
        let added = watched.insert(botId).inserted
        if views[botId] == nil, let cached = BotSpacesCache.loadView(botId, serverURL: serverURL) {
            views[botId] = cached
        }
        if fetch, added || views[botId] == nil { schedule(views: [botId]) }
    }

    func unwatch(_ botId: String) {
        watched.remove(botId)
        dirtyViews.remove(botId)
    }

    func handle(_ event: RealtimeEvent) {
        switch event {
        case .connected:
            schedule(spaces: true, views: watched)
        case .pluginSignal:
            guard support != .unavailable, let signal = Studio.BotThreadsChangedEvent(signal: event),
                let botId = signal.botId
            else { return }
            schedule(spaces: true, views: watched.contains(botId) ? [botId] : [])
        default:
            break
        }
    }

    func askIfUnknown() {
        guard support == .unknown, client != nil else { return }
        retryTask?.cancel()
        retryTask = nil
        schedule(spaces: true)
    }

    func refresh() async {
        flushTask?.cancel()
        flushTask = nil
        spacesDirty = true
        dirtyViews.formUnion(watched)
        await flush()
    }

    private func schedule(spaces: Bool = false, views: Set<String> = []) {
        spacesDirty = spacesDirty || spaces
        dirtyViews.formUnion(views)
        guard flushTask == nil, spacesDirty || !dirtyViews.isEmpty else { return }
        flushTask = Task { [weak self] in
            guard let delay = self?.coalesceDelay else { return }
            try? await Task.sleep(for: delay)
            guard !Task.isCancelled, let self else { return }
            while spacesDirty || !dirtyViews.isEmpty {
                await flush()
                if Task.isCancelled { return }
            }
            flushTask = nil
        }
    }

    private func flush() async {
        guard let client, client.baseURL == serverURL else {
            spacesDirty = false
            dirtyViews = []
            return
        }
        let wantsSpaces = spacesDirty || support != .available
        spacesDirty = false
        if wantsSpaces {
            await loadSpaces(client)
        }
        guard support == .available else {
            dirtyViews = []
            return
        }
        let botIds = dirtyViews.intersection(watched)
        dirtyViews = []
        await withTaskGroup(of: Void.self) { group in
            for botId in botIds {
                group.addTask { await self.loadView(botId, client) }
            }
        }
    }

    private func loadView(_ botId: String, _ client: BBClient) async {
        viewGeneration[botId, default: 0] += 1
        let generation = viewGeneration[botId]
        do {
            let view = try await client.botThreadsView(botId: botId)
            guard generation == viewGeneration[botId], watched.contains(botId) else { return }
            views[botId] = view
            BotSpacesCache.saveView(view, botId: botId, serverURL: serverURL)
        } catch where BBClient.isCancellation(error) {
        } catch {
            guard generation == viewGeneration[botId] else { return }
            self.error = BBClient.describe(error, plugin: "Studio", server: serverURL)
        }
    }

    private func loadSpaces(_ client: BBClient) async {
        spacesGeneration += 1
        let generation = spacesGeneration
        do {
            let loaded = try await client.botSpaces()
            guard generation == spacesGeneration else { return }
            stopRetrying()
            setSupport(.available)
            spaces = loaded
            error = nil
            BotSpacesCache.saveSpaces(loaded, serverURL: serverURL)
            if let botId = loaded.current?.id, !watched.contains(botId) {
                watched.insert(botId)
                if views[botId] == nil, let cached = BotSpacesCache.loadView(botId, serverURL: serverURL) {
                    views[botId] = cached
                }
                dirtyViews.insert(botId)
            }
        } catch where BBClient.isUnknownRPC(error) {
            guard generation == spacesGeneration else { return }
            stopRetrying()
            setSupport(.unavailable)
            let botIds = Array(views.keys)
            spaces = nil
            views = [:]
            BotSpacesCache.clear(botIds: botIds, serverURL: serverURL)
        } catch where BBClient.isCancellation(error) {
        } catch {
            guard generation == spacesGeneration else { return }
            self.error = BBClient.describe(error, plugin: "Studio", server: serverURL)
            if support == .unknown { retryLater() }
        }
    }

    private func retryLater() {
        guard retryTask == nil else { return }
        let delay = SpacesLaunch.retryDelay(retries, delays: retryDelays)
        retries += 1
        retryTask = Task { [weak self] in
            try? await Task.sleep(for: delay)
            guard !Task.isCancelled, let self else { return }
            retryTask = nil
            guard support == .unknown else { return }
            schedule(spaces: true)
        }
    }

    private func stopRetrying() {
        retryTask?.cancel()
        retryTask = nil
        retries = 0
    }

    private func setSupport(_ value: BotSpacesSupport) {
        guard support != value else { return }
        support = value
        BotSpacesSupport.store(value, serverURL: serverURL)
    }
}

#if DEBUG
extension BotSpacesStore {
    func seedForDemo(_ spaces: BotSpaces, views: [String: BotThreadsView]) {
        restored = true
        stopRetrying()
        support = .available
        self.spaces = spaces
        self.views = views
        if let botId = spaces.current?.id { watched.insert(botId) }
    }

    func seedUnknownForDemo() {
        restored = true
        support = .unknown
        spaces = nil
        views = [:]
    }

    func seedUnavailableForDemo() {
        restored = true
        stopRetrying()
        support = .unavailable
    }
}
#endif
