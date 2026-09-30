import Foundation

public enum RealtimeEvent: Sendable {
    /// `{type:"changed", entity, id, changes}` — refetch what changed.
    case changed(entity: String, id: String?, changes: [String])
    /// `{type:"plugin-signal", pluginId, channel, payload}` from `bb.realtime.publish`.
    case pluginSignal(pluginId: String, channel: String, payload: JSONValue)
    /// The socket (re)connected; state may have been missed while it was down.
    case connected
}

/// BB's `/ws` hub. It only says *what* changed; the app refetches over HTTP.
/// Subscriptions are replayed after every reconnect.
@MainActor
public final class BBRealtime {
    private let client: BBClient
    private var task: URLSessionWebSocketTask?
    private var subscriptions: [String: JSONValue] = [:]
    private var listeners: [UUID: (RealtimeEvent) -> Void] = [:]
    private var retryDelay: TimeInterval = 1
    private var pingTimer: Timer?
    private var running = false

    public init(client: BBClient) {
        self.client = client
    }

    public func start() {
        guard !running else { return }
        running = true
        connect()
    }

    public func stop() {
        running = false
        pingTimer?.invalidate()
        task?.cancel(with: .goingAway, reason: nil)
        task = nil
    }

    @discardableResult
    public func listen(_ handler: @escaping (RealtimeEvent) -> Void) -> UUID {
        let id = UUID()
        listeners[id] = handler
        return id
    }

    public func removeListener(_ id: UUID) {
        listeners[id] = nil
    }

    public func subscribeThreadList() { subscribe(key: "thread-list", target: ["kind": "thread-list"]) }

    public func subscribeThread(_ threadId: String) {
        subscribe(key: "thread:\(threadId)", target: ["kind": "thread-detail", "threadId": .string(threadId)])
    }

    public func unsubscribeThread(_ threadId: String) {
        guard let target = subscriptions.removeValue(forKey: "thread:\(threadId)") else { return }
        write(["type": "unsubscribe", "target": target])
    }

    private func subscribe(key: String, target: JSONValue) {
        subscriptions[key] = target
        write(["type": "subscribe", "target": target])
    }

    private func connect() {
        guard running else { return }
        let task = URLSession.shared.webSocketTask(with: client.webSocketURL)
        self.task = task
        task.resume()
        for target in subscriptions.values { write(["type": "subscribe", "target": target]) }
        receive(on: task)
        pingTimer?.invalidate()
        pingTimer = Timer.scheduledTimer(withTimeInterval: 25, repeats: true) { [weak self] _ in
            Task { @MainActor in self?.write(["type": "ping"]) }
        }
        emit(.connected)
    }

    private func receive(on task: URLSessionWebSocketTask) {
        task.receive { [weak self] result in
            Task { @MainActor in
                guard let self, self.task === task else { return }
                switch result {
                case .success(let message):
                    self.retryDelay = 1
                    self.handle(message)
                    self.receive(on: task)
                case .failure:
                    self.scheduleReconnect()
                }
            }
        }
    }

    private func scheduleReconnect() {
        task = nil
        pingTimer?.invalidate()
        guard running else { return }
        let delay = retryDelay
        retryDelay = min(retryDelay * 2, 30)
        Task { @MainActor in
            try? await Task.sleep(for: .seconds(delay))
            self.connect()
        }
    }

    private func handle(_ message: URLSessionWebSocketTask.Message) {
        let data: Data?
        switch message {
        case .string(let text): data = text.data(using: .utf8)
        case .data(let bytes): data = bytes
        @unknown default: data = nil
        }
        guard let data, let json = try? JSONDecoder().decode(JSONValue.self, from: data) else { return }
        switch json["type"]?.stringValue {
        case "changed":
            let changes = json["changes"]?.arrayValue?.compactMap(\.stringValue) ?? []
            emit(.changed(entity: json["entity"]?.stringValue ?? "", id: json["id"]?.stringValue, changes: changes))
        case "plugin-signal":
            emit(
                .pluginSignal(
                    pluginId: json["pluginId"]?.stringValue ?? "", channel: json["channel"]?.stringValue ?? "",
                    payload: json["payload"] ?? .null))
        default:
            break
        }
    }

    private func emit(_ event: RealtimeEvent) {
        for listener in listeners.values { listener(event) }
    }

    private func write(_ value: JSONValue) {
        guard let task, let data = try? JSONEncoder().encode(value), let text = String(data: data, encoding: .utf8)
        else { return }
        task.send(.string(text)) { _ in }
    }
}
