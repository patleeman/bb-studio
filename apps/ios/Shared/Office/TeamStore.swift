import Foundation
import Observation

@Observable @MainActor
public final class TeamStore {
    public let spaceId: String
    public private(set) var bots: [OfficeTeamBot] = []
    public private(set) var conversations: [OfficeConversation] = []
    public private(set) var isLoading = false
    public private(set) var error: String?
    @ObservationIgnored private let fetch: () async throws -> ([OfficeTeamBot], [OfficeConversation])
    @ObservationIgnored private var revision = 0

    public init(spaceId: String, client: BBClient) {
        self.spaceId = spaceId
        self.fetch = {
            async let bots = client.officeTeam(spaceId)
            async let conversations = client.officeTalk(spaceId)
            return try await (bots, conversations)
        }
    }
    public init(spaceId: String, fetch: @escaping () async throws -> ([OfficeTeamBot], [OfficeConversation])) {
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
            let (bots, conversations) = try await fetch()
            try Task.checkCancellation()
            guard revision == mine else { return }
            self.bots = bots
            self.conversations = conversations
            error = nil
        } catch {
            guard revision == mine, !BBClient.isCancellation(error) else { return }
            self.error = BBClient.describe(error)
        }
    }
}
