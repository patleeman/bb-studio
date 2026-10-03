import Foundation
import Observation

@Observable @MainActor
public final class HomeStore {
    public let spaceId: String
    public private(set) var home: OfficeHome?
    public private(set) var isLoading = false
    public private(set) var error: String?
    public var needsYou: [OfficeInboxEvent] { home?.needsYou ?? [] }
    public var working: [OfficeWorkingTask] { home?.working ?? [] }
    public var reports: [OfficeInboxEvent] { home?.reports ?? [] }
    public var recent: [OfficeItem] { home?.recent ?? [] }
    @ObservationIgnored private let fetch: () async throws -> OfficeHome
    @ObservationIgnored private var revision = 0

    public init(spaceId: String, client: BBClient) {
        self.spaceId = spaceId
        self.fetch = { try await client.officeHome(spaceId) }
    }
    public init(spaceId: String, fetch: @escaping () async throws -> OfficeHome) {
        self.spaceId = spaceId
        self.fetch = fetch
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
            home = result
            error = nil
        } catch {
            guard revision == mine, !BBClient.isCancellation(error) else { return }
            self.error = BBClient.describe(error)
        }
    }
}
