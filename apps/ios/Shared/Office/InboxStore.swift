import Foundation
import Observation

@Observable @MainActor
public final class InboxStore {
    public enum Mutation: Sendable {
        case act(actionId: String, text: String?)
        case done
        case read
    }
    public private(set) var isLoading = false
    public private(set) var error: String?
    public private(set) var nextCursor: String?
    public private(set) var pendingKeys: Set<String> = []
    private var baseEvents: [OfficeInboxEvent] = []
    private var baseCounts = OfficeInboxCounts(bySpace: [:])
    private var pending: [String: Mutation] = [:]
    @ObservationIgnored private var serverURL: URL?
    @ObservationIgnored private let fetch: (String?) async throws -> OfficeInboxPage
    @ObservationIgnored private let fetchCounts: () async throws -> OfficeInboxCounts
    @ObservationIgnored private let mutate: ([String], Mutation) async throws -> Void
    @ObservationIgnored private var revision = 0
    @ObservationIgnored private var refreshRequested = false
    @ObservationIgnored private var realtime: BBRealtime?
    @ObservationIgnored private var listener: UUID?
    @ObservationIgnored private var observer: NSObjectProtocol?
    @ObservationIgnored private var notificationCenter: NotificationCenter?
    /// Post after a push has passed server identity validation.
    public static let didReceivePush = Notification.Name("office.inbox.push")

    public var events: [OfficeInboxEvent] {
        baseEvents.map { original in
            var event = original
            guard let operation = pending[event.key] else { return event }
            event.isPending = true
            switch operation {
            case .read: event.readAt = event.readAt ?? Date().timeIntervalSince1970 * 1000
            case .done, .act: event.doneAt = Date().timeIntervalSince1970 * 1000
            }
            return event
        }
    }
    public var counts: OfficeInboxCounts {
        var result = baseCounts
        for event in baseEvents {
            guard let operation = pending[event.key], event.doneAt == nil,
                  var count = result.bySpace[event.spaceId] else { continue }
            switch operation {
            case .read:
                if event.type == .report, event.readAt == nil { count.unreadReports = max(0, count.unreadReports - 1) }
            case .act, .done:
                if event.type == .request { count.requests = max(0, count.requests - 1) }
                if event.type == .report, event.readAt == nil { count.unreadReports = max(0, count.unreadReports - 1) }
            }
            result.bySpace[event.spaceId] = count
        }
        return result
    }

    public init(client: BBClient) {
        serverURL = client.baseURL
        fetch = { try await client.officeInbox(cursor: $0) }
        fetchCounts = { try await client.officeInboxCounts() }
        mutate = { keys, operation in
            switch operation {
            case .act(let actionId, let text):
                for key in keys { try await client.officeInboxAct(key: key, actionId: actionId, text: text) }
            case .done: try await client.officeInboxDone(keys: keys)
            case .read: try await client.officeInboxRead(keys: keys)
            }
        }
    }
    public init(fetch: @escaping (String?) async throws -> OfficeInboxPage,
                counts: @escaping () async throws -> OfficeInboxCounts,
                mutate: @escaping ([String], Mutation) async throws -> Void) {
        self.fetch = fetch
        self.fetchCounts = counts
        self.mutate = mutate
    }

    public func load() async { await refresh() }
    public func refresh() async { await fetchPage(append: false) }
    public func loadMore() async {
        guard nextCursor != nil, !isLoading else { return }
        await fetchPage(append: true)
    }
    private func fetchPage(append: Bool) async {
        // A source may publish before its action returns. Preserve the optimistic
        // state until all actions settle, then fetch one authoritative snapshot.
        guard pending.isEmpty else { refreshRequested = true; return }
        refreshRequested = false
        revision += 1
        let mine = revision
        let cursor = append ? nextCursor : nil
        isLoading = true
        defer { if revision == mine { isLoading = false } }
        do {
            async let page = fetch(cursor)
            async let counts = fetchCounts()
            let (result, countResult) = try await (page, counts)
            try Task.checkCancellation()
            guard revision == mine else { return }
            if append {
                let incoming = Set(result.events.map(\.key))
                baseEvents = baseEvents.filter { !incoming.contains($0.key) } + result.events
            } else { baseEvents = result.events }
            baseCounts = countResult
            nextCursor = result.nextCursor
            error = nil
        } catch {
            guard revision == mine, !BBClient.isCancellation(error) else { return }
            self.error = BBClient.describe(error)
        }
    }

    @discardableResult public func act(key: String, actionId: String, text: String? = nil) async -> Bool {
        await apply(keys: [key], operation: .act(actionId: actionId, text: text))
    }
    @discardableResult public func done(keys: [String]) async -> Bool { await apply(keys: keys, operation: .done) }
    @discardableResult public func read(keys: [String]) async -> Bool { await apply(keys: keys, operation: .read) }

    private func apply(keys: [String], operation: Mutation) async -> Bool {
        let keys = Array(Set(keys)).sorted()
        guard !keys.isEmpty, keys.allSatisfy({ key in !pendingKeys.contains(key) && baseEvents.contains(where: { $0.key == key }) }) else { return false }
        revision += 1 // Any older refresh must not replace this transaction's base.
        isLoading = false
        for key in keys { pending[key] = operation; pendingKeys.insert(key) }
        do {
            try await mutate(keys, operation)
            // Commit only these keys; other simultaneous actions retain their overlays.
            for event in baseEvents where keys.contains(event.key) && event.doneAt == nil {
                guard var count = baseCounts.bySpace[event.spaceId] else { continue }
                switch operation {
                case .read:
                    if event.type == .report, event.readAt == nil { count.unreadReports = max(0, count.unreadReports - 1) }
                case .act, .done:
                    if event.type == .request { count.requests = max(0, count.requests - 1) }
                    if event.type == .report, event.readAt == nil { count.unreadReports = max(0, count.unreadReports - 1) }
                }
                baseCounts.bySpace[event.spaceId] = count
            }
            switch operation {
            case .read:
                for index in baseEvents.indices where keys.contains(baseEvents[index].key) {
                    baseEvents[index].readAt = baseEvents[index].readAt ?? Date().timeIntervalSince1970 * 1000
                }
            case .act, .done: baseEvents.removeAll { keys.contains($0.key) }
            }
            for key in keys { pending[key] = nil; pendingKeys.remove(key) }
            error = nil
            if pending.isEmpty { await refresh() }
            return true
        } catch {
            for key in keys { pending[key] = nil; pendingKeys.remove(key) }
            let message = BBClient.describe(error)
            if pending.isEmpty && refreshRequested { await refresh() }
            self.error = message
            return false
        }
    }

    /// The owner starts/stops the shared socket. This store only owns its listener.
    public func startObserving(_ realtime: BBRealtime, center: NotificationCenter = .default) {
        stopObserving()
        notificationCenter = center
        self.realtime = realtime
        realtime.subscribeThreadList()
        listener = realtime.listen { [weak self] event in
            Task { @MainActor [weak self] in await self?.receiveRealtime(event) }
        }
        observer = center.addObserver(forName: Self.didReceivePush, object: nil, queue: .main) { [weak self] notification in
            let origin = notification.object as? String
            Task { @MainActor [weak self] in
                guard let self, self.serverURL == nil || origin == self.serverURL?.absoluteString else { return }
                await self.refresh()
            }
        }
    }
    /// Kept separate from the socket subscription so source routing is testable.
    func receiveRealtime(_ event: RealtimeEvent) async {
        switch event {
        case .connected, .changed: await refresh()
        case .pluginSignal(let pluginId, _, _):
            guard ["studio", "pages", "bot-teams", "feed", "studio-tasks"].contains(pluginId) else { return }
            await refresh()
        }
    }

    public func stopObserving() {
        if let listener { realtime?.removeListener(listener) }
        if let observer { notificationCenter?.removeObserver(observer) }
        listener = nil
        observer = nil
        realtime = nil
        notificationCenter = nil
    }
}
