import Foundation

/// "Needs you" and "running" as the widgets count them: top-level threads only.
public struct ThreadSummary: Sendable {
    public var needsYou: [ThreadEntry]
    public var running: [ThreadEntry]

    public init(_ threads: [ThreadEntry]) {
        let top = threads.filter { $0.parentThreadId == nil && $0.visibility != "hidden" }
        let newest = { (a: ThreadEntry, b: ThreadEntry) in (a.latestAttentionAt ?? 0) > (b.latestAttentionAt ?? 0) }
        needsYou = top.filter(\.needsYou).sorted(by: newest)
        running = top.filter { $0.isRunning && !$0.needsYou }.sorted(by: newest)
    }

    /// The thread that needs you, else the most recent running one.
    public var headline: ThreadEntry? { needsYou.first ?? running.first }
    public var isClear: Bool { needsYou.isEmpty && running.isEmpty }
}

extension ThreadEntry {
    /// Waiting on an answer, or failed and not yet looked at.
    public var needsYou: Bool { hasPendingInteraction == true || (status == "error" && isUnread) }
}

/// The inbox as last loaded, shared with the widgets through the app group.
public struct InboxSnapshot: Codable, Sendable {
    public var threads: [ThreadEntry]
    public var projectNames: [String: String]

    public static let cacheKey = "inbox"

    public init(threads: [ThreadEntry], projectNames: [String: String]) {
        self.threads = threads
        self.projectNames = projectNames
    }
}

/// The counts the watch complication shows. The phone sends it over
/// WatchConnectivity; the watch keeps it in its app group.
public struct StatusSnapshot: Codable, Equatable, Sendable {
    public var serverURL: String?
    public var needsYou: Int
    public var running: Int
    public var headline: String?
    public var headlineThreadId: String?
    public var updatedAt: Double

    public static let key = "statusSnapshot"

    public init(_ summary: ThreadSummary, now: Date = .now, serverURL: URL = ServerScope.selectedURL) {
        self.serverURL = serverURL.absoluteString
        needsYou = summary.needsYou.count
        running = summary.running.count
        headline = summary.headline?.displayTitle
        headlineThreadId = summary.headline?.id
        updatedAt = now.timeIntervalSince1970
    }

    public var dictionary: [String: Any] {
        (try? JSONSerialization.jsonObject(with: JSONEncoder().encode(self))) as? [String: Any] ?? [:]
    }

    public init?(dictionary: [String: Any]) {
        guard let data = try? JSONSerialization.data(withJSONObject: dictionary),
            let value = try? JSONDecoder().decode(Self.self, from: data)
        else { return nil }
        self = value
    }

    public static func load() -> StatusSnapshot? {
        AppGroup.defaults.data(forKey: ServerScope.key(key)).flatMap { try? JSONDecoder().decode(Self.self, from: $0) }
    }

    public func save() {
        guard let serverURL, let origin = URL(string: serverURL) else { return }
        AppGroup.defaults.set(try? JSONEncoder().encode(self), forKey: ServerScope.key(Self.key, serverURL: origin))
    }

    /// Same content, ignoring the timestamp.
    public func sameCounts(_ other: StatusSnapshot?) -> Bool {
        guard let other else { return false }
        return serverURL == other.serverURL && needsYou == other.needsYou && running == other.running && headlineThreadId == other.headlineThreadId
    }
}
