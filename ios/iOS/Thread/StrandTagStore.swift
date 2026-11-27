import SwiftUI

/// Each open conversation's strand tags (`strands.tags`), for the small tag in
/// a reply's footer. Polled while the conversation shows: every 30 s as on the
/// desktop, longer while the phone is idle, held in the background.
@MainActor @Observable
final class StrandTagStore {
    static let shared = StrandTagStore()

    private(set) var tags: [String: StrandTags] = [:]
    private var client: BBClient { AppModel.shared.client }

    /// Polls one conversation; the caller's task ends it. A server without strands answers once and stops it.
    func poll(_ threadId: String) async {
        while !Task.isCancelled {
            let base = client.baseURL
            do {
                let next = try await client.strandsTags(threadId: threadId)
                if base == client.baseURL, tags[threadId] != next { tags[threadId] = next }
            } catch where BBClient.isUnknownRPC(error) {
                return
            } catch {}
            await EnergyGate.shared.pollWait(.seconds(30))
        }
    }
}
