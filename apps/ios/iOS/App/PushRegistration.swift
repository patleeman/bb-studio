import Foundation

/// BB deduplicates push subscriptions by token, but APNs can change a token.
/// Keep the returned row ID so a later token can replace this install's row.
actor PushRegistration {
    static let shared = PushRegistration()

    private struct State: Codable {
        var currentId: String?
        var pendingRemoval: [String] = []
    }

    private let defaults: UserDefaults
    private let key = "pushSubscriptionsByServer"
    private var lastRegistration: Task<Void, Never>?

    init(defaults: UserDefaults = AppGroup.defaults) {
        self.defaults = defaults
    }

    static func allowed(arguments: [String], environment: [String: String]) -> Bool {
        if arguments.contains("-skipPushPrompt") || arguments.contains("-qaPageDemo") || arguments.contains("-qaShelfDemo") {
            return false
        }
        if environment.keys.contains(where: { $0.hasPrefix("BBGO_QA_") || $0.hasPrefix("TEST_RUNNER_BBGO_QA_") }) {
            return false
        }
        return environment["XCTestConfigurationFilePath"] == nil && environment["XCTestBundlePath"] == nil
    }

    func register(apnsToken: String, label: String, client: BBClient) async throws {
        let previous = lastRegistration
        let work = Task {
            await previous?.value
            try await performRegistration(apnsToken: apnsToken, label: label, client: client)
        }
        lastRegistration = Task { _ = try? await work.value }
        try await work.value
    }

    private func performRegistration(apnsToken: String, label: String, client: BBClient) async throws {
        let server = client.baseURL.absoluteString
        var states = (defaults.data(forKey: key)).flatMap { try? JSONDecoder().decode([String: State].self, from: $0) } ?? [:]
        var state = states[server] ?? State()

        // Add first so a failed request never removes the working subscription.
        let id = try await client.registerPush(apnsToken: apnsToken, label: label)
        if let old = state.currentId, old != id, !state.pendingRemoval.contains(old) {
            state.pendingRemoval.append(old)
        }
        state.currentId = id
        state.pendingRemoval.removeAll { $0 == id }
        states[server] = state
        save(states)

        for staleId in state.pendingRemoval {
            do {
                try await client.removePushSubscription(staleId)
                state.pendingRemoval.removeAll { $0 == staleId }
                states[server] = state
                save(states)
            } catch {
                // Retry on the next successful registration.
            }
        }
    }

    private func save(_ states: [String: State]) {
        if let data = try? JSONEncoder().encode(states) { defaults.set(data, forKey: key) }
    }
}
