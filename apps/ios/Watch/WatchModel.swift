import Foundation
import WatchConnectivity
import WidgetKit

/// Sends each request to the phone, which performs it over the tailnet.
final class PhoneTransport: NSObject, WCSessionDelegate, @unchecked Sendable {
    static let shared = PhoneTransport()

    private var activation: [CheckedContinuation<Void, Never>] = []
    private let lock = NSLock()

    func activate() {
        WCSession.default.delegate = self
        WCSession.default.activate()
    }

    func perform(method: String, path: String, body: Data?) async throws -> (Int, Data) {
        await waitForActivation()
        guard WCSession.default.isReachable else {
            throw BBError(status: 0, message: "iPhone not reachable")
        }
        var message: [String: Any] = [WatchRelay.method: method, WatchRelay.path: path]
        if let body { message[WatchRelay.body] = body }
        return try await withCheckedThrowingContinuation { continuation in
            WCSession.default.sendMessage(
                message,
                replyHandler: { reply in
                    let status = reply[WatchRelay.status] as? Int ?? 0
                    if let error = reply[WatchRelay.error] as? String {
                        continuation.resume(throwing: BBError(status: status, message: error))
                    } else {
                        let data = (reply[WatchRelay.body] as? Data).map(WatchRelay.unpack) ?? Data()
                        continuation.resume(returning: (status, data))
                    }
                },
                errorHandler: { continuation.resume(throwing: $0) })
        }
    }

    private func waitForActivation() async {
        if WCSession.default.activationState == .activated { return }
        await withCheckedContinuation { continuation in
            lock.lock()
            if WCSession.default.activationState == .activated {
                lock.unlock()
                continuation.resume()
            } else {
                activation.append(continuation)
                lock.unlock()
            }
        }
    }

    func session(_ session: WCSession, didReceiveUserInfo userInfo: [String: Any] = [:]) {
        StatusSnapshot(dictionary: userInfo).map(Self.store)
    }

    func session(_ session: WCSession, didReceiveApplicationContext applicationContext: [String: Any]) {
        StatusSnapshot(dictionary: applicationContext).map(Self.store)
    }

    /// Saves the counts for the complication and redraws it if they changed.
    static func store(_ status: StatusSnapshot) {
        let changed = !status.sameCounts(StatusSnapshot.load())
        status.save()
        if changed { WidgetCenter.shared.reloadAllTimelines() }
    }

    func session(_ session: WCSession, activationDidCompleteWith state: WCSessionActivationState, error: Error?) {
        if let status = StatusSnapshot(dictionary: session.receivedApplicationContext) { Self.store(status) }
        lock.lock()
        let waiting = activation
        activation = []
        lock.unlock()
        waiting.forEach { $0.resume() }
    }
}

@MainActor
final class WatchModel: ObservableObject {
    static let shared = WatchModel()

    let client: BBClient
    @Published var threads: [ThreadEntry] = []
    @Published var bots: [(bot: Bot, thread: DirectThread)] = []
    @Published var error: String?
    @Published var loading = false

    private init() {
        PhoneTransport.shared.activate()
        client = BBClient()
        client.transport = { method, path, body in
            try await PhoneTransport.shared.perform(method: method, path: path, body: body)
        }
    }

    func load() async {
        loading = true
        defer { loading = false }
        do {
            async let threadList = client.threads(limit: 60)
            async let teams = try? client.botTeams()
            threads = try await threadList
                .filter { $0.parentThreadId == nil && $0.visibility != "hidden" }
                .sorted { a, b in
                    if a.needsAttention != b.needsAttention { return a.needsAttention }
                    if a.isRunning != b.isRunning { return a.isRunning }
                    return (a.latestAttentionAt ?? a.updatedAt) > (b.latestAttentionAt ?? b.updatedAt)
                }
            PhoneTransport.store(StatusSnapshot(ThreadSummary(threads)))
            if let teams = await teams {
                bots = teams.bots.compactMap { bot in teams.directThreads[bot.id].map { (bot, $0) } }
            }
            error = nil
        } catch {
            self.error = error.localizedDescription
        }
    }
}
