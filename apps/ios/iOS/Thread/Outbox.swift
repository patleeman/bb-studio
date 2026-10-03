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
        /// Optional only while decoding entries written before server scoping.
        var serverURL: URL?
        var createdAt = Date()
        /// Set when a send failed in a way that might have reached BB.
        var failure: String?
    }

    @Published private(set) var messages: [Message] = []

    private let currentClient: @MainActor () -> BBClient
    private let persist: ([Message]) -> Void
    private var flushing: Task<Void, Never>?
    private var retry: Task<Void, Never>?

    init(messages: [Message]? = nil,
         currentClient: @escaping @MainActor () -> BBClient = { AppModel.shared.client },
         persist: @escaping ([Message]) -> Void = { DiskCache.save($0, as: "outbox") }) {
        self.currentClient = currentClient
        self.persist = persist
        self.messages = (messages ?? DiskCache.load([Message].self, key: "outbox") ?? []).map {
            var message = $0
            if message.serverURL == nil {
                message.failure = "This older message has no saved server. Select its original BB server, then tap Try again to send it there."
            }
            return message
        }
        save()
    }

    func messages(for threadId: String) -> [Message] {
        messages.filter { $0.threadId == threadId && ($0.serverURL == nil || $0.serverURL == currentClient().baseURL) }
    }

    func add(threadId: String, text: String, mentions: [Mention], serverURL: URL? = nil) {
        messages.append(Message(threadId: threadId, text: text, mentions: mentions, serverURL: serverURL ?? currentClient().baseURL))
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
        if messages[index].serverURL == nil { messages[index].serverURL = currentClient().baseURL }
        messages[index].failure = nil
        save()
        flush()
    }

    func flush() {
        let client = currentClient()
        guard flushing == nil, messages.contains(where: { $0.failure == nil && $0.serverURL == client.baseURL }) else { return }
        flushing = Task {
            await send(using: client)
            flushing = nil
            if currentClient().baseURL != client.baseURL { flush() }
        }
    }

    func send(using client: BBClient) async {
        while currentClient().baseURL == client.baseURL,
              let message = messages.first(where: { $0.failure == nil && $0.serverURL == client.baseURL }) {
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
        persist(messages)
    }
}
