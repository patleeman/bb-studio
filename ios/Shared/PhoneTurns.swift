import Foundation

/// Turns the user started from this phone: the thread and when the message
/// went. The Bot Live Activity shows only while one of these runs
/// (`BotActivityAttributes.ContentState.make`). Kept per server in the app
/// group; an entry goes after `window`, or once its turn is seen finished.
public enum PhoneTurns {
    /// How long an entry lasts at most.
    public static let window: TimeInterval = 30 * 60
    /// How long after sending a turn counts as started before BB says it runs.
    public static let grace: TimeInterval = 20
    /// Posted after a send is recorded (the object is the thread id), so the
    /// Live Activity can start at once.
    public static let recorded = Notification.Name("PhoneTurns.recorded")

    static func key(_ serverURL: URL) -> String { ServerScope.key("phoneTurns", serverURL: serverURL) }

    public static func record(_ threadId: String, serverURL: URL, at date: Date = .now,
                              defaults: UserDefaults = AppGroup.defaults) {
        var stored = load(serverURL, defaults: defaults, now: date)
        stored[threadId] = date
        save(stored, serverURL, defaults: defaults)
        NotificationCenter.default.post(name: recorded, object: threadId)
    }

    /// Thread id → when it was sent, without expired entries.
    public static func active(serverURL: URL, now: Date = .now, defaults: UserDefaults = AppGroup.defaults) -> [String: Date] {
        load(serverURL, defaults: defaults, now: now)
    }

    public static func clear(_ threadIds: some Sequence<String>, serverURL: URL, defaults: UserDefaults = AppGroup.defaults) {
        var stored = load(serverURL, defaults: defaults, now: .now)
        var changed = false
        for id in threadIds where stored.removeValue(forKey: id) != nil { changed = true }
        if changed { save(stored, serverURL, defaults: defaults) }
    }

    private static func load(_ serverURL: URL, defaults: UserDefaults, now: Date) -> [String: Date] {
        let raw = defaults.dictionary(forKey: key(serverURL)) as? [String: Double] ?? [:]
        return raw.compactMapValues { seconds in
            let date = Date(timeIntervalSince1970: seconds)
            return now.timeIntervalSince(date) < window ? date : nil
        }
    }

    private static func save(_ turns: [String: Date], _ serverURL: URL, defaults: UserDefaults) {
        if turns.isEmpty {
            defaults.removeObject(forKey: key(serverURL))
        } else {
            defaults.set(turns.mapValues(\.timeIntervalSince1970), forKey: key(serverURL))
        }
    }
}
