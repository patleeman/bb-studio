import Foundation

// MARK: Usage (account-pool plugin)

/// A pooled Claude or Codex account and how much of its limits it has used.
/// Utilization is 0…1.
public struct PoolAccount: Decodable, Identifiable, Hashable, Sendable {
    public struct Window: Decodable, Hashable, Sendable {
        public var slot: String?
        public var windowMinutes: Double?
        public var utilization: Double?
        public var resetAt: Double?
    }

    public struct Family: Decodable, Hashable, Sendable {
        public var utilization: Double?
        public var resetAt: Double?
    }

    public var id: String
    /// `claude` or `codex`.
    public var provider: String
    public var label: String?
    public var enabled: Bool
    /// `ready`, `held`, `exhausted`, `disabled` or `error`.
    public var status: String
    public var subscriptionType: String?
    public var fiveHourUtilization: Double?
    public var fiveHourResetAt: Double?
    public var sevenDayUtilization: Double?
    public var sevenDayResetAt: Double?
    public var familyWeekly: [String: Family?]?
    public var limitWindows: [Window]?
    public var inFlight: Int?
    public var heldUntil: Double?
    public var error: String?

    /// Every limit worth a gauge, most pressing first as the server orders them.
    public var gauges: [(label: String, used: Double, resetAt: Double?)] {
        var gauges: [(String, Double, Double?)] = []
        if let used = fiveHourUtilization { gauges.append(("5-hour", used, fiveHourResetAt)) }
        if let used = sevenDayUtilization { gauges.append(("Weekly", used, sevenDayResetAt)) }
        for (family, window) in (familyWeekly ?? [:]).sorted(by: { $0.key < $1.key }) {
            if let window, let used = window.utilization {
                gauges.append(("Weekly · \(family.capitalized)", used, window.resetAt))
            }
        }
        for window in limitWindows ?? [] {
            guard let used = window.utilization, let minutes = window.windowMinutes else { continue }
            gauges.append((Self.windowName(minutes), used, window.resetAt))
        }
        return gauges
    }

    private static func windowName(_ minutes: Double) -> String {
        switch minutes {
        case 10080: "Weekly"
        case 300: "5-hour"
        case 1440: "Daily"
        default: minutes >= 60 ? "\(Int(minutes / 60))-hour" : "\(Int(minutes))-minute"
        }
    }
}

// MARK: Host settings (keep-awake and concurrency-limit plugins)

public struct KeepAwakeConfig: Codable, Hashable, Sendable {
    public var enabled: Bool
    /// `{"mode":"all"}` or `{"mode":"selected","hostIds":[…]}`; sent back as it came.
    public var selection: JSONValue
}

public struct ConcurrencyConfig: Decodable, Hashable, Sendable {
    public struct Host: Decodable, Hashable, Sendable, Identifiable {
        public var id: String
        public var name: String
        public var status: String?
        public var effectiveLimit: Int?
        public var automaticLimit: Int?
    }

    public struct Override: Codable, Hashable, Sendable {
        public var hostId: String
        public var limit: Int
    }

    public var globalLimit: Int?
    public var hostOverrides: [Override]
    public var hosts: [Host]
}

extension BBClient {
    public func poolAccounts() async throws -> [PoolAccount] {
        try await rpc("account-pool", "account.list")
    }

    public func keepAwake() async throws -> KeepAwakeConfig {
        try await rpc("keep-awake", "getConfiguration")
    }

    public func setKeepAwake(_ config: KeepAwakeConfig) async throws -> KeepAwakeConfig {
        try await rpc("keep-awake", "setConfiguration", ["enabled": .bool(config.enabled), "selection": config.selection])
    }

    public func concurrency() async throws -> ConcurrencyConfig {
        try await rpc("concurrency-limit", "getConfiguration")
    }

    /// Nil lets each host pick from its core count. Host overrides are kept.
    public func setConcurrency(globalLimit: Int?, keeping config: ConcurrencyConfig) async throws -> ConcurrencyConfig {
        let overrides = config.hostOverrides.map { JSONValue.object(["hostId": .string($0.hostId), "limit": .number(Double($0.limit))]) }
        return try await rpc(
            "concurrency-limit", "setConfiguration",
            ["globalLimit": globalLimit.map { .number(Double($0)) } ?? .null, "hostOverrides": .array(overrides)])
    }

    /// Forks the thread into a hidden side chat seeded with `anchor`, so a
    /// question about one message doesn't derail the main thread.
    public func sideChat(from threadId: String, about anchor: String) async throws -> String {
        struct Result: Decodable { var threadId: String }
        let result: Result = try await rpc(
            "side-chat", "createSideChat", ["sourceThreadId": .string(threadId), "anchorText": .string(String(anchor.prefix(4000)))])
        return result.threadId
    }

    /// Every queued message on every thread: scheduled sends, retries, and
    /// messages waiting on a busy thread or an offline host.
    public func allQueuedMessages() async throws -> [QueuedMessage] {
        try await get("/api/v1/queued-messages")
    }

    /// Queues the message to go at `date` rather than now.
    public func send(_ threadId: String, text: String, mentions: [Mention] = [], at date: Date) async throws -> SendResult {
        try await post(
            "/api/v1/threads/\(threadId)/send",
            [
                "input": .array([["type": "text", "text": .string(text), "mentions": .array(Mention.ranges(in: text, mentions))]]),
                "mode": "queue-if-active",
                "sendAt": .number((date.timeIntervalSince1970 * 1000).rounded()),
            ])
    }
}
