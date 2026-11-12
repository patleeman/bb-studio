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

/// What the widgets and the watch count as needing you: the Bot's attention
/// (`bot_attention`: its chat asked something or has replies you haven't
/// read), or, from a Studio without it, every BB thread waiting on an answer.
public struct NeedsYouCount: Codable, Equatable, Sendable {
    public var count: Int
    /// The Bot's reason ("Asked you a question", "2 things for you"); nil when it needs nothing, or on the fallback.
    public var reason: String?
    /// From the Bot; false for the BB-wide fallback.
    public var fromBot: Bool

    public init(count: Int, reason: String?, fromBot: Bool) {
        self.count = count
        self.reason = reason
        self.fromBot = fromBot
    }

    /// The Bot's attention; nil attention is nothing to do.
    public static func bot(count: Int?, reason: String?) -> NeedsYouCount {
        let count = max(0, count ?? 0)
        let reason = reason?.trimmingCharacters(in: .whitespacesAndNewlines)
        return NeedsYouCount(count: count, reason: count > 0 && reason?.isEmpty == false ? reason : nil, fromBot: true)
    }

    /// An older Studio: the threads waiting on you across BB.
    public static func fallback(_ summary: ThreadSummary) -> NeedsYouCount {
        NeedsYouCount(count: summary.needsYou.count, reason: nil, fromBot: false)
    }
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
    /// The Bot's attention count, or BB-wide pending questions from an older Studio.
    public var needsYou: Int
    public var running: Int
    /// Why the Bot needs you ("Asked you a question"); older phones leave it out.
    public var reason: String?
    public var headline: String?
    public var headlineThreadId: String?
    public var updatedAt: Double

    public static let key = "statusSnapshot"

    /// `needs` is what needs you (`NeedsYouCount`); nil counts BB's threads waiting on you.
    public init(_ summary: ThreadSummary, needs: NeedsYouCount? = nil, now: Date = .now, serverURL: URL = ServerScope.selectedURL) {
        let needs = needs ?? .fallback(summary)
        self.serverURL = serverURL.absoluteString
        needsYou = needs.count
        running = summary.running.count
        reason = needs.reason
        // The Bot's reason leads; otherwise the thread waiting on you, else the newest running one.
        let thread = needs.fromBot ? summary.running.first : summary.headline
        headline = needs.reason ?? thread?.displayTitle
        headlineThreadId = needs.reason == nil ? thread?.id : nil
        updatedAt = now.timeIntervalSince1970
    }

    /// The complication's line: the Bot's reason, else counts.
    public var label: String {
        if needsYou > 0, let reason { return running > 0 ? "\(reason) · \(running) running" : reason }
        switch (needsYou, running) {
        case (0, 0): return "All clear"
        case (0, _): return "\(running) running"
        case (_, 0): return "\(needsYou) need\(needsYou == 1 ? "s" : "") you"
        default: return "\(needsYou) need you · \(running) running"
        }
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
        return serverURL == other.serverURL && needsYou == other.needsYou && running == other.running && reason == other.reason
            && headlineThreadId == other.headlineThreadId
    }
}
