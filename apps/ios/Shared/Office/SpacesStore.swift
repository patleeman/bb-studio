import Foundation
import Observation

@Observable @MainActor
public final class SpacesStore {
    public private(set) var spaces: [OfficeSpace] = []
    public private(set) var currentSpaceId: String?
    public private(set) var isLoading = false
    public private(set) var error: String?
    public var currentSpace: OfficeSpace? { spaces.first { $0.id == currentSpaceId } }
    @ObservationIgnored private let fetch: () async throws -> [OfficeSpace]
    @ObservationIgnored private let defaults: UserDefaults
    @ObservationIgnored private var revision = 0
    public static let currentSpaceKey = "office.currentSpaceId"

    public init(client: BBClient, defaults: UserDefaults = AppGroup.defaults) {
        self.defaults = defaults
        self.fetch = { try await client.officeSpaces() }
        currentSpaceId = defaults.string(forKey: Self.currentSpaceKey)
    }

    public init(defaults: UserDefaults, fetch: @escaping () async throws -> [OfficeSpace]) {
        self.defaults = defaults
        self.fetch = fetch
        currentSpaceId = defaults.string(forKey: Self.currentSpaceKey)
    }

    public func select(_ id: String) {
        guard spaces.contains(where: { $0.id == id }) else { return }
        currentSpaceId = id
        defaults.set(id, forKey: Self.currentSpaceKey)
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
            spaces = result
            if !result.contains(where: { $0.id == currentSpaceId }) {
                currentSpaceId = result.first(where: \.isDefault)?.id ?? result.first?.id
                defaults.set(currentSpaceId, forKey: Self.currentSpaceKey)
            }
            error = nil
        } catch {
            guard revision == mine, !BBClient.isCancellation(error) else { return }
            self.error = BBClient.describe(error)
        }
    }
}
