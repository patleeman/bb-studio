import Foundation

/// Messages written while BB was unreachable wait here on disk and go out, in
/// order, once it's back. BB sends have no idempotency key, so only failures
/// where the request can't have arrived are retried by themselves; anything
/// else waits for the reader to retry or delete it.
@MainActor
final class Outbox: ObservableObject {
    static let shared = Outbox()

    struct Message: Codable, Identifiable, Hashable {
        var id = UUID()
        var threadId: String
        var text: String
        var mentions: [Mention]
        var createdAt = Date()
        /// Set when a send failed in a way that might have reached BB.
        var failure: String?
    }

    @Published private(set) var messages: [Message] = []

    private var client: BBClient { AppModel.shared.client }
    private var flushing: Task<Void, Never>?
    private var retry: Task<Void, Never>?

    private init() {
        messages = DiskCache.load([Message].self, key: "outbox") ?? []
    }

    func messages(for threadId: String) -> [Message] {
        messages.filter { $0.threadId == threadId }
    }

    func add(threadId: String, text: String, mentions: [Mention]) {
        messages.append(Message(threadId: threadId, text: text, mentions: mentions))
        save()
        scheduleRetry()
    }

    func remove(_ id: UUID) {
        messages.removeAll { $0.id == id }
        save()
    }

    /// Clears a failure so the message goes out with the next flush.
    func retry(_ id: UUID) {
        guard let index = messages.firstIndex(where: { $0.id == id }) else { return }
        messages[index].failure = nil
        save()
        flush()
    }

    func flush() {
        guard flushing == nil, messages.contains(where: { $0.failure == nil }) else { return }
        flushing = Task {
            await send()
            flushing = nil
        }
    }

    private func send() async {
        while let message = messages.first(where: { $0.failure == nil }) {
            do {
                try await client.send(message.threadId, text: message.text, mentions: message.mentions)
                remove(message.id)
            } catch where BBClient.neverArrived(error) {
                scheduleRetry()
                return
            } catch {
                guard let index = messages.firstIndex(where: { $0.id == message.id }) else { continue }
                messages[index].failure = BBClient.describe(error, server: client.baseURL)
                save()
            }
        }
    }

    /// Realtime reconnecting flushes too; this covers a connection that comes back quietly.
    private func scheduleRetry() {
        guard retry == nil else { return }
        retry = Task {
            try? await Task.sleep(for: .seconds(15))
            retry = nil
            flush()
        }
    }

    private func save() {
        DiskCache.save(messages, as: "outbox")
    }
}
