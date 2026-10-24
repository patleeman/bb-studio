import Foundation
import Combine

/// Only requests known not to have arrived retry automatically. Uncertain sends
/// retain their stable client ID and require review, including after a restart.
@MainActor
final class Outbox: ObservableObject {
    static let shared: Outbox = {
        #if DEBUG
        // `-qaOutboxUnreadable`: the file holds something it can't read, for screenshots of the save error.
        if ProcessInfo.processInfo.arguments.contains("-qaOutboxUnreadable") {
            let file = FileManager.default.temporaryDirectory.appending(path: "qa-outbox/messages.json")
            try? FileManager.default.createDirectory(at: file.deletingLastPathComponent(), withIntermediateDirectories: true)
            try? Data("not json".utf8).write(to: file)
            return Outbox(store: Store(file: file, legacy: file))
        }
        #endif
        return Outbox()
    }()

    struct Message: Codable, Identifiable, Hashable {
        /// The client ID survives migration, restarts and every retry.
        var id = UUID()
        var threadId: String
        var text: String
        var mentions: [Mention]
        /// Optional only while decoding entries written before server scoping.
        var serverURL: URL?
        var createdAt = Date()
        var failure: String?
        /// Written before contacting BB, so a crash cannot silently retry a send.
        var attemptedAt: Date?
        /// Written before removing an accepted entry. Cleanup may safely retry.
        var delivered: Bool?
    }

    /// This file is authoritative even when empty; never re-import the cache.
    struct Store {
        var file: URL = (FileManager.default.containerURL(forSecurityApplicationGroupIdentifier: AppGroup.id)
            ?? FileManager.default.urls(for: .applicationSupportDirectory, in: .userDomainMask)[0])
            .appending(path: "Outbox/messages.json")
        var legacy: URL = AppGroup.containerURL.appending(path: "Cache/outbox.json")

        func load() throws -> [Message] {
            let files = FileManager.default
            if files.fileExists(atPath: file.path) {
                return try JSONDecoder().decode([Message].self, from: Data(contentsOf: file))
            }
            let messages = files.fileExists(atPath: legacy.path)
                ? try JSONDecoder().decode([Message].self, from: Data(contentsOf: legacy)) : []
            try save(messages)
            return messages
        }

        func save(_ messages: [Message]) throws {
            let data = try JSONEncoder().encode(messages)
            try FileManager.default.createDirectory(at: file.deletingLastPathComponent(), withIntermediateDirectories: true)
            try data.write(to: file, options: .atomic)
        }
    }

    @Published private(set) var messages: [Message] = []
    @Published private(set) var storageError: String?

    private let currentClient: @MainActor () -> BBClient
    private let persist: ([Message]) throws -> Void
    private let load: () throws -> [Message]
    private var loaded = false
    private var flushing: Task<Void, Never>?
    private var retryTask: Task<Void, Never>?
    private var sending = false
    /// Covers an acknowledgement whose disk write failed in this process.
    private var deliveredIDs: Set<UUID> = []

    init(messages: [Message]? = nil,
         currentClient: @escaping @MainActor () -> BBClient = { AppModel.shared.client },
         persist: (([Message]) throws -> Void)? = nil, store: Store = Store()) {
        self.currentClient = currentClient
        self.persist = persist ?? { try store.save($0) }
        self.load = { try store.load() }
        do {
            self.messages = Self.restore(try messages ?? store.load())
            loaded = true
        } catch { report(error) }
    }

    private static func restore(_ messages: [Message]) -> [Message] {
        var seen: Set<UUID> = []
        return messages.filter { seen.insert($0.id).inserted }.map {
            var message = $0
            if message.serverURL == nil {
                message.failure = "This older message has no saved server. Select its original BB server, then tap Try again to send it there."
            } else if message.delivered != true, message.attemptedAt != nil || message.failure != nil {
                // Older uncertain entries predate the attempt checkpoint.
                if message.attemptedAt == nil { message.attemptedAt = message.createdAt }
                message.failure = "An earlier send may have reached BB. Try again checks recent messages before resending."
            }
            return message
        }
    }

    func messages(for threadId: String) -> [Message] {
        messages.filter { $0.threadId == threadId && ($0.serverURL == nil || $0.serverURL == currentClient().baseURL) }
    }

    @discardableResult
    func add(threadId: String, text: String, mentions: [Mention], serverURL: URL? = nil) -> Bool {
        guard commit(messages + [Message(threadId: threadId, text: text, mentions: mentions,
                                         serverURL: serverURL ?? currentClient().baseURL)]) else { return false }
        scheduleRetry()
        return true
    }

    func remove(_ id: UUID) {
        _ = commit(messages.filter { $0.id != id })
    }

    func retry(_ id: UUID) {
        guard let index = messages.firstIndex(where: { $0.id == id }) else { return }
        var next = messages
        if next[index].serverURL == nil { next[index].serverURL = currentClient().baseURL }
        next[index].failure = nil
        guard commit(next) else { return }
        flush()
    }

    /// A failed read must be retried before any write can replace unknown data.
    func retryStorage() {
        do {
            if !loaded {
                messages = Self.restore(try load())
                loaded = true
            }
            if commit(Self.restore(messages).filter { $0.delivered != true && !deliveredIDs.contains($0.id) }) { flush() }
        } catch { report(error) }
    }

    func flush() {
        let client = currentClient()
        guard flushing == nil, storageError == nil,
              messages.contains(where: { $0.failure == nil && $0.serverURL == client.baseURL }) else { return }
        flushing = Task {
            await send(using: client)
            flushing = nil
            if currentClient().baseURL != client.baseURL { flush() }
        }
    }

    func send(using client: BBClient) async {
        guard !sending, loaded, storageError == nil else { return }
        sending = true
        defer { sending = false }
        while storageError == nil, currentClient().baseURL == client.baseURL,
              let message = messages.first(where: { $0.failure == nil && $0.serverURL == client.baseURL }) {
            do {
                if message.delivered != true, !deliveredIDs.contains(message.id) {
                    // No server idempotency key exists. Check a previous uncertain
                    // attempt against both recent history and BB's pending queue.
                    let accepted = try await alreadyAccepted(message, client: client)
                    guard currentClient().baseURL == client.baseURL else { return }
                    guard messages.contains(where: { $0.id == message.id }) else { continue }
                    if !accepted {
                        var next = messages
                        guard let index = next.firstIndex(where: { $0.id == message.id }) else { continue }
                        if next[index].attemptedAt == nil { next[index].attemptedAt = Date() }
                        guard commit(next) else { return }
                        try await client.send(message.threadId, text: message.text, mentions: message.mentions)
                    }
                    deliveredIDs.insert(message.id)
                    // Record acceptance before a separate cleanup write. Either
                    // snapshot is safe to reopen if cleanup or termination wins.
                    let acknowledged = messages.map { entry -> Message in
                        var entry = entry
                        if entry.id == message.id { entry.delivered = true }
                        return entry
                    }
                    guard commit(acknowledged) else { return }
                }
                guard commit(messages.filter { $0.id != message.id }) else { return }
                deliveredIDs.remove(message.id)
            } catch where BBClient.neverArrived(error) && message.attemptedAt == nil {
                var next = messages
                if let index = next.firstIndex(where: { $0.id == message.id }) {
                    next[index].attemptedAt = nil
                }
                guard commit(next) else { return }
                scheduleRetry()
                return
            } catch {
                var next = messages
                guard let index = next.firstIndex(where: { $0.id == message.id }) else { continue }
                next[index].failure = BBClient.describe(error, server: client.baseURL)
                guard commit(next) else { return }
            }
        }
    }

    private func alreadyAccepted(_ message: Message, client: BBClient) async throws -> Bool {
        guard let attemptedAt = message.attemptedAt else { return false }
        let cutoff = attemptedAt.timeIntervalSince1970 * 1000 - 1000
        async let timeline = client.timeline(message.threadId)
        async let queue = client.queuedMessages(message.threadId)
        let (page, queued) = try await (timeline, queue)
        return page.rows.contains {
            $0.isUser && $0.text == message.text && ($0.createdAt ?? 0) >= cutoff
        } || queued.contains {
            $0.content.compactMap(\.text).joined(separator: "\n") == message.text && ($0.createdAt ?? 0) >= cutoff
        }
    }

    private func scheduleRetry() {
        guard retryTask == nil else { return }
        retryTask = Task { [weak self] in
            try? await Task.sleep(for: .seconds(15))
            guard let self, !Task.isCancelled else { return }
            self.retryTask = nil
            self.flush()
        }
    }

    private func commit(_ next: [Message]) -> Bool {
        guard loaded else { return false }
        do {
            let next = next.map { entry -> Message in
                var entry = entry
                if deliveredIDs.contains(entry.id) { entry.delivered = true }
                return entry
            }
            try persist(next)
            messages = next
            storageError = nil
            return true
        } catch {
            report(error)
            return false
        }
    }

    private func report(_ error: Error) {
        storageError = "Couldn't save queued messages: \(error.localizedDescription). Keep this app open and retry saving."
    }
}
