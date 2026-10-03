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

    func perform(method: String, path: String, body: Data?, serverURL: URL) async throws -> (Int, Data) {
        await waitForActivation()
        guard WCSession.default.isReachable else {
            throw BBError(status: 0, message: "iPhone not reachable")
        }
        var message: [String: Any] = [WatchRelay.method: method, WatchRelay.path: path, "serverURL": serverURL.absoluteString]
        if let body { message[WatchRelay.body] = body }
        return try await withCheckedThrowingContinuation { continuation in
            WCSession.default.sendMessage(
                message,
                replyHandler: { reply in
                    if let origin = reply["serverURL"] as? String, let url = URL(string: origin) {
                        Task { @MainActor in Self.reconcileServer(url, requestedFrom: serverURL) }
                    }
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

    @MainActor
    static func reconcileServer(_ url: URL, requestedFrom origin: URL) {
        let model = WatchModel.shared
        guard model.client.baseURL == origin else { return }
        model.selectServer(url)
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

    func sessionReachabilityDidChange(_ session: WCSession) {
        guard session.isReachable else { return }
        Task { @MainActor in await WatchModel.shared.load() }
    }

    /// Saves the counts for the complication and redraws it if they changed.
    static func store(_ status: StatusSnapshot) {
        Task { @MainActor in
            guard let origin = status.serverURL, let url = URL(string: origin),
                status.updatedAt >= AppGroup.defaults.double(forKey: "statusOriginUpdatedAt") else { return }
            let changed = !status.sameCounts(StatusSnapshot.load())
            AppGroup.defaults.set(status.updatedAt, forKey: "statusOriginUpdatedAt")
            WatchModel.shared.selectServer(url)
            status.save()
            if changed { WidgetCenter.shared.reloadAllTimelines() }
        }
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

    @Published private(set) var client: BBClient
    @Published var threads: [ThreadEntry] = []
    @Published var bots: [(bot: Bot, thread: DirectThread)] = []
    @Published var error: String?
    @Published var loading = false
    private var loadGeneration = 0

    private init() {
        PhoneTransport.shared.activate()
        client = Self.makeClient(ServerScope.selectedURL)
    }

    private static func makeClient(_ serverURL: URL) -> BBClient {
        let client = BBClient(baseURL: serverURL)
        client.transport = { method, path, body in
            try await PhoneTransport.shared.perform(method: method, path: path, body: body, serverURL: serverURL)
        }
        return client
    }

    func selectServer(_ url: URL) {
        guard client.baseURL != url else { return }
        loadGeneration += 1
        AppGroup.defaults.set(url.absoluteString, forKey: "serverURL")
        client = Self.makeClient(url)
        threads = []; bots = []; error = nil; loading = false
        WidgetCenter.shared.reloadAllTimelines()
    }

    func load() async {
        let client = self.client
        loadGeneration += 1
        let generation = loadGeneration
        loading = true
        defer { if generation == loadGeneration { loading = false } }
        do {
            async let threadList = client.threads(limit: 60)
            async let teams = try? client.botTeams()
            let loadedThreads = try await threadList
                .filter { $0.parentThreadId == nil && $0.visibility != "hidden" }
                .sorted { a, b in
                    if a.needsAttention != b.needsAttention { return a.needsAttention }
                    if a.isRunning != b.isRunning { return a.isRunning }
                    return (a.latestAttentionAt ?? a.updatedAt) > (b.latestAttentionAt ?? b.updatedAt)
                }
            guard generation == loadGeneration, client.baseURL == self.client.baseURL else { return }
            threads = loadedThreads
            StatusSnapshot(ThreadSummary(threads), serverURL: client.baseURL).save()
            if let teams = await teams, generation == loadGeneration, client.baseURL == self.client.baseURL {
                bots = teams.bots.compactMap { bot in teams.directThreads[bot.id].map { (bot, $0) } }
            }
            guard generation == loadGeneration, client.baseURL == self.client.baseURL else { return }
            error = nil
        } catch {
            guard generation == loadGeneration, client.baseURL == self.client.baseURL else { return }
            self.error = error.localizedDescription
        }
    }
}
