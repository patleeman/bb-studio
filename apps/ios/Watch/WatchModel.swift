import Foundation
import WatchConnectivity
import WidgetKit

/// Exactly one of a reply, deadline or cancellation resumes the caller.
final class WatchTransportWait<Value>: @unchecked Sendable {
    private let lock = NSLock()
    private var continuation: CheckedContinuation<Value, Error>?
    private var result: Result<Value, Error>?
    private var timer: Task<Void, Never>?
    private let onFinish: @Sendable () -> Void

    init(onFinish: @escaping @Sendable () -> Void = {}) { self.onFinish = onFinish }

    var isFinished: Bool { lock.lock(); defer { lock.unlock() }; return result != nil }

    func value(timeout: Duration, message: String, cancellationMessage: String? = nil, start: (WatchTransportWait<Value>) -> Void) async throws -> Value {
        try await withTaskCancellationHandler {
            try await withCheckedThrowingContinuation { continuation in
                lock.lock()
                if let result { lock.unlock(); continuation.resume(with: result); return }
                self.continuation = continuation
                timer = Task { [weak self] in
                    do { try await Task.sleep(for: timeout) } catch { return }
                    self?.finish(.failure(BBError(status: 0, message: message)))
                }
                lock.unlock()
                if !isFinished { start(self) }
            }
        } onCancel: {
            self.finish(.failure(cancellationMessage.map { BBError(status: 0, message: $0) as Error } ?? CancellationError()))
        }
    }

    @discardableResult
    func finish(_ result: Result<Value, Error>) -> Bool {
        lock.lock()
        guard self.result == nil else { lock.unlock(); return false }
        self.result = result
        let continuation = self.continuation
        let timer = self.timer
        self.continuation = nil; self.timer = nil
        lock.unlock()
        timer?.cancel()
        onFinish()
        continuation?.resume(with: result)
        return true
    }
}

/// Sends each request to the phone, which performs it over the tailnet.
final class PhoneTransport: NSObject, WCSessionDelegate, @unchecked Sendable {
    static let shared = PhoneTransport()

    private var activation: [UUID: WatchTransportWait<Void>] = [:]
    private let lock = NSLock()

    func activate() {
        WCSession.default.delegate = self
        WCSession.default.activate()
    }

    func perform(method: String, path: String, body: Data?, serverURL: URL, selection: UUID) async throws -> (Int, Data) {
        try await waitForActivation()
        guard WCSession.default.isReachable else {
            throw BBError(status: 0, message: "iPhone not reachable")
        }
        var message: [String: Any] = [WatchRelay.method: method, WatchRelay.path: path, "serverURL": serverURL.absoluteString]
        if let body { message[WatchRelay.body] = body }
        let timeoutMessage = method == "GET"
            ? "iPhone did not respond. Open BB Studio on your phone, then retry."
            : "The result is unknown because iPhone did not respond. Check your phone or thread before resending."
        return try await WatchTransportWait<(Int, Data)>().value(timeout: .seconds(15), message: timeoutMessage,
            cancellationMessage: method == "GET" ? nil : "The request was cancelled, but its result is unknown. Check your phone or thread before resending.") { wait in
            WCSession.default.sendMessage(
                message,
                replyHandler: { reply in
                    let status = reply[WatchRelay.status] as? Int ?? 0
                    let result: Result<(Int, Data), Error>
                    if let error = reply[WatchRelay.error] as? String {
                        result = .failure(BBError(status: status, message: error))
                    } else {
                        let data = (reply[WatchRelay.body] as? Data).map(WatchRelay.unpack) ?? Data()
                        result = .success((status, data))
                    }
                    if wait.finish(result), let origin = reply["serverURL"] as? String, let url = URL(string: origin) {
                        Task { @MainActor in Self.reconcileServer(url, requestedFrom: serverURL, selection: selection) }
                    }
                },
                errorHandler: { wait.finish(.failure($0)) })
        }
    }

    @MainActor
    static func reconcileServer(_ url: URL, requestedFrom origin: URL, selection: UUID) {
        let model = WatchModel.shared
        guard model.client.baseURL == origin, model.serverSelection == selection else { return }
        model.selectServer(url)
    }

    private func waitForActivation() async throws {
        if WCSession.default.activationState == .activated { return }
        let id = UUID()
        let wait = WatchTransportWait<Void> { [weak self] in
            guard let self else { return }
            self.lock.lock(); self.activation.removeValue(forKey: id); self.lock.unlock()
        }
        try await wait.value(timeout: .seconds(10), message: "Could not connect to iPhone. Open BB Studio on your phone, then retry.") { wait in
            lock.lock()
            if WCSession.default.activationState == .activated {
                lock.unlock()
                wait.finish(.success(()))
            } else {
                activation[id] = wait
                lock.unlock()
                // Cancellation can win just before registration.
                if wait.isFinished { lock.lock(); activation.removeValue(forKey: id); lock.unlock() }
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
        activation = [:]
        lock.unlock()
        waiting.values.forEach { wait in
            if let error { wait.finish(.failure(error)) }
            else if state == .activated { wait.finish(.success(())) }
            else { wait.finish(.failure(BBError(status: 0, message: "Could not connect to iPhone. Retry when your phone is available."))) }
        }
    }
}

@MainActor
final class WatchModel: ObservableObject {
    static let shared = WatchModel()

    @Published private(set) var client: BBClient
    @Published var threads: [ThreadEntry] = []
    /// The Chief of Staff: the Personal Space's lead, pinned above the list.
    @Published var chiefId: String?
    @Published var error: String?
    @Published var loading = false
    private var loadGeneration = 0
    @Published private(set) var serverSelection: UUID

    private init() {
        PhoneTransport.shared.activate()
        let selection = UUID()
        serverSelection = selection
        client = Self.makeClient(ServerScope.selectedURL, selection: selection)
    }

    private static func makeClient(_ serverURL: URL, selection: UUID) -> BBClient {
        let client = BBClient(baseURL: serverURL)
        client.transport = { method, path, body in
            try await PhoneTransport.shared.perform(method: method, path: path, body: body, serverURL: serverURL, selection: selection)
        }
        return client
    }

    func selectServer(_ url: URL) {
        guard client.baseURL != url else { return }
        loadGeneration += 1
        serverSelection = UUID()
        AppGroup.defaults.set(url.absoluteString, forKey: "serverURL")
        client = Self.makeClient(url, selection: serverSelection)
        threads = []; chiefId = nil; error = nil; loading = false
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
            let loadedThreads = try await threadList
                .filter { $0.parentThreadId == nil && $0.visibility != "hidden" }
                .sorted { a, b in
                    if a.needsAttention != b.needsAttention { return a.needsAttention }
                    if a.isRunning != b.isRunning { return a.isRunning }
                    return (a.latestAttentionAt ?? a.updatedAt) > (b.latestAttentionAt ?? b.updatedAt)
                }
            guard generation == loadGeneration, client.baseURL == self.client.baseURL else { return }
            threads = loadedThreads
            if let chief = try? await client.chiefOfStaffThreadId(), generation == loadGeneration {
                chiefId = chief
            }
            StatusSnapshot(ThreadSummary(threads), serverURL: client.baseURL).save()
            guard generation == loadGeneration, client.baseURL == self.client.baseURL else { return }
            error = nil
        } catch {
            guard !BBClient.isCancellation(error) else { return }
            guard generation == loadGeneration, client.baseURL == self.client.baseURL else { return }
            self.error = error.localizedDescription
        }
    }
}
