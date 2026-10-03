import Foundation
import Observation

@Observable @MainActor
public final class TabsStore {
    public let spaceId: String
    public private(set) var essentials: [OfficeTab] = []
    public private(set) var pinned: [OfficeTab] = []
    public private(set) var today: [OfficeTab] = []
    public private(set) var folders: [OfficeTabFolder] = []
    public private(set) var isLoading = false
    public private(set) var error: String?
    private var threads: [String: ThreadEntry] = [:]
    @ObservationIgnored private let client: BBClient
    @ObservationIgnored private var revision = 0
    @ObservationIgnored private var realtime: BBRealtime?
    @ObservationIgnored private var listener: UUID?

    public init(spaceId: String, client: BBClient) {
        self.spaceId = spaceId
        self.client = client
    }

    public func refresh() async {
        revision += 1
        let mine = revision
        isLoading = true
        defer { if mine == revision { isLoading = false } }
        do {
            async let tabs = client.officeTabs(spaceId)
            async let sidebar = client.sidebar()
            var (result, list) = try await (tabs, sidebar)
            let entries = (list.projects + [list.personalProject]).flatMap(\.threads)
            if !result.seeded {
                try await client.officeTabsSeed(spaceId, pinnedThreadIds: entries.filter { $0.pinnedAt != nil && $0.archivedAt == nil }.map(\.id))
                result = try await client.officeTabs(spaceId)
            }
            var titles = Dictionary(entries.map { ($0.id, $0) }, uniquingKeysWith: { first, _ in first })
            for id in Set((result.essentials + result.pinned + result.today).compactMap(\.threadId)) where titles[id] == nil {
                // A tab can refer to an archived thread absent from the sidebar.
                titles[id] = try? await client.thread(id)
            }
            try Task.checkCancellation()
            guard mine == revision else { return }
            threads = titles
            essentials = result.essentials
            pinned = result.pinned
            today = result.today
            folders = result.folders
            error = nil
        } catch {
            guard mine == revision, !BBClient.isCancellation(error) else { return }
            self.error = BBClient.describe(error)
        }
    }

    public func title(for tab: OfficeTab) -> String {
        if let id = tab.threadId, let thread = threads[id] {
            return [thread.title, thread.titleFallback].compactMap { $0 }.first { !$0.isEmpty } ?? "Untitled"
        }
        return tab.title.flatMap { $0.isEmpty ? nil : $0 } ?? "Untitled"
    }
    public func open(ref: String) async {
        await perform { _ = try await self.client.officeTabOpen(self.spaceId, ref: ref) }
    }
    public func open(href: String) async {
        await perform { _ = try await self.client.officeTabOpen(self.spaceId, href: href) }
    }
    public func move(_ ref: String, to zone: OfficeTabZone, folderId: String? = nil) async {
        await perform { try await self.client.officeTabMove(self.spaceId, ref: ref, zone: zone, folderId: folderId) }
    }
    public func archive(_ ref: String) async { await move(ref, to: .archived) }
    public func clearToday() async {
        let refs = today.map(\.ref)
        await perform {
            for ref in refs { try await self.client.officeTabMove(self.spaceId, ref: ref, zone: .archived) }
        }
    }
    public func createFolder(name: String) async {
        await perform { _ = try await self.client.officeTabFolderCreate(self.spaceId, name: name) }
    }
    public func renameFolder(_ id: String, to name: String) async {
        await perform { _ = try await self.client.officeTabFolderUpdate(id, name: name) }
    }
    public func setFolderOpen(_ id: String, _ open: Bool) async {
        await perform { _ = try await self.client.officeTabFolderUpdate(id, open: open) }
    }
    public func deleteFolder(_ id: String) async {
        await perform { try await self.client.officeTabFolderDelete(id) }
    }
    public func archived(query: String? = nil) async throws -> [OfficeTab] {
        try await client.officeTabsArchived(spaceId, query: query)
    }
    public func search(_ query: String) async throws -> [OfficeTab] {
        async let remote = client.officeSearch(spaceId, query: query)
        let list = try await client.sidebar()
        let entries = (list.projects + [list.personalProject]).flatMap(\.threads)
        for thread in entries { threads[thread.id] = thread }
        let open = essentials + pinned + today
        let openRefs = Set(open.map(\.ref))
        let matching = open.filter { query.isEmpty || title(for: $0).localizedCaseInsensitiveContains(query) }
        let threadMatches = entries.compactMap { thread -> OfficeTab? in
            let ref = "thread:\(thread.id)"
            guard !openRefs.contains(ref), query.isEmpty || thread.displayTitle.localizedCaseInsensitiveContains(query) else { return nil }
            return OfficeTab(ref: ref, kind: .thread, title: thread.displayTitle, zone: .archived, openedAt: thread.updatedAt)
        }
        var seen: Set<String> = []
        return (matching + threadMatches + (try await remote)).filter { seen.insert($0.ref).inserted }
    }
    private func perform(_ operation: () async throws -> Void) async {
        do {
            try await operation()
            await refresh()
        } catch {
            let message = BBClient.describe(error)
            await refresh() // Partial bulk operations must be reflected too.
            if !BBClient.isCancellation(error) { self.error = message }
        }
    }
    public func startObserving(_ realtime: BBRealtime) {
        stopObserving()
        self.realtime = realtime
        realtime.subscribeThreadList()
        listener = realtime.listen { [weak self] event in
            Task { @MainActor [weak self] in await self?.receiveRealtime(event) }
        }
    }
    func receiveRealtime(_ event: RealtimeEvent) async {
        switch event {
        case .connected, .changed: await refresh()
        case .pluginSignal(let pluginId, _, _):
            if ["studio", "pages", "bot-teams", "studio-tasks"].contains(pluginId) { await refresh() }
        }
    }
    public func stopObserving() {
        if let listener { realtime?.removeListener(listener) }
        listener = nil
        realtime = nil
    }
}
