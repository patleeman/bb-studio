import Foundation
import Observation

@Observable @MainActor
public final class WorkStore {
    public let spaceId: String
    public private(set) var tree: OfficeSpaceTree?
    public private(set) var isLoading = false
    public private(set) var error: String?
    @ObservationIgnored private let fetch: () async throws -> OfficeSpaceTree
    @ObservationIgnored private var revision = 0
    @ObservationIgnored private var liveThreads: [String: OfficeThread] = [:]

    public var folders: [OfficeFolder] {
        (tree?.folders ?? []).map { folder in
            var folder = folder
            folder.threads = folder.threads?.map { thread in
                guard let live = liveThreads[thread.id], live.updatedAt >= thread.updatedAt else { return thread }
                var updated = thread
                updated.title = live.title
                updated.state = live.state
                updated.updatedAt = live.updatedAt
                return updated
            }
            return folder
        }
    }

    public init(spaceId: String, client: BBClient) {
        self.spaceId = spaceId
        self.fetch = { try await client.officeSpaceTree(spaceId) }
    }
    public init(spaceId: String, fetch: @escaping () async throws -> OfficeSpaceTree) {
        self.spaceId = spaceId
        self.fetch = fetch
    }

    /// Overlay existing thread-list state without introducing unfiled or bot-owned threads.
    public func mergeLiveThreads(_ threads: [OfficeThread]) {
        liveThreads = Dictionary(threads.map { ($0.id, $0) }, uniquingKeysWith: { a, b in a.updatedAt > b.updatedAt ? a : b })
    }

    public func mergeThreadList(_ threads: [ThreadEntry]) {
        mergeLiveThreads(threads.filter { $0.archivedAt == nil }.map {
            OfficeThread(id: $0.id, title: $0.displayTitle,
                         state: $0.runtime?.displayStatus ?? $0.status,
                         updatedAt: $0.updatedAt, authorBotId: nil)
        })
    }

    public func load() async { await refresh() }
    public func refresh() async {
        revision += 1
        let mine = revision
        isLoading = true
        defer { if revision == mine { isLoading = false } }
        do {
            let result = try await fetch()
            try Task.checkCancellation()
            guard revision == mine else { return }
            guard result.space.id == spaceId else { throw BBError(status: 0, message: "The server returned another Space's work.") }
            tree = result
            error = nil
        } catch {
            guard revision == mine, !BBClient.isCancellation(error) else { return }
            self.error = BBClient.describe(error)
        }
    }
}
