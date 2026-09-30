import Foundation

/// Threads whose notifications the mobile plugin holds back from BB Studio.
/// BB itself has no per-thread mute, so the relay keeps the list.
@MainActor
final class MutedThreads: ObservableObject {
    static let shared = MutedThreads()

    private struct List: Decodable { var threadIds: [String] }

    @Published private(set) var ids: Set<String> = Set(UserDefaults.standard.stringArray(forKey: "mutedThreads") ?? [])

    private var client: BBClient { AppModel.shared.client }

    func refresh() async {
        guard let list: List = try? await client.rpc("mobile", "mute_list", [:]) else { return }
        update(list.threadIds)
    }

    func set(_ threadId: String, muted: Bool) async throws {
        let list: List = try await client.rpc(
            "mobile", "mute_set", ["threadId": .string(threadId), "muted": .bool(muted)])
        update(list.threadIds)
    }

    private func update(_ threadIds: [String]) {
        ids = Set(threadIds)
        UserDefaults.standard.set(threadIds, forKey: "mutedThreads")
    }
}
