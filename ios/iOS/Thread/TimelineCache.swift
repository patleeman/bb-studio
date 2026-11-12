import Foundation

/// A thread's newest rows on the phone, so its chat (the Bot's too) draws at
/// once on open while the server's page is on the way. One small JSON file per
/// thread in the app group's cache, scoped to the server.
enum TimelineCache {
    struct Snapshot: Codable {
        var thread: ThreadEntry?
        var rows: [TimelineRow]
    }

    /// The last this many messages, with the work between them.
    static let messages = 50
    /// Tool output past this is cut: it shows only in an expanded step, and
    /// the server's page replaces it.
    static let outputLimit = 2_000

    static func key(_ threadId: String) -> String { "thread-\(threadId)" }

    /// The newest `messages` messages and everything after the first of them.
    static func trim(_ rows: [TimelineRow], messages: Int = messages) -> [TimelineRow] {
        var seen = 0
        var start = rows.startIndex
        for index in rows.indices.reversed() where rows[index].isConversation {
            seen += 1
            start = index
            if seen == messages { break }
        }
        if seen < messages { start = rows.startIndex }
        return rows[start...].map { row in
            guard let output = row.output, output.count > outputLimit else { return row }
            var copy = row
            copy.output = String(output.prefix(outputLimit))
            return copy
        }
    }

    /// Nil when there's none, or the file can't be read (an older shape, cut short).
    static func load(_ threadId: String, serverURL: URL) -> Snapshot? {
        DiskCache.load(Snapshot.self, key: key(threadId), serverURL: serverURL)
    }

    /// Encodes and writes off the main thread, one write at a time, so a
    /// streaming reply's updates land in order.
    static func save(_ threadId: String, thread: ThreadEntry?, rows: [TimelineRow], serverURL: URL) {
        let snapshot = Snapshot(thread: thread, rows: rows)
        let key = key(threadId)
        queue.async { DiskCache.save(Snapshot(thread: snapshot.thread, rows: trim(snapshot.rows)), as: key, serverURL: serverURL) }
    }

    /// Waits for the writes queued so far (for tests).
    static func flush() { queue.sync {} }

    private static let queue = DispatchQueue(label: "nyc.plee.bbgo.timeline-cache", qos: .utility)
}

/// Putting the server's rows over the ones on screen without redrawing what
/// didn't change: rows are matched by id, and the array is only replaced when
/// something in it did.
enum TimelineMerge {
    /// The newest page over `current`. When the page starts on a row already
    /// here, the rows above it stay (they're the older history it continues);
    /// otherwise there's a gap, and the page replaces everything.
    static func merge(_ current: [TimelineRow], page: [TimelineRow]) -> (rows: [TimelineRow], contiguous: Bool) {
        guard let first = page.first, let index = current.firstIndex(where: { $0.id == first.id }) else {
            return (page, current.isEmpty || page.isEmpty)
        }
        return (Array(current[..<index]) + page, true)
    }

    /// Messages sent from here that the server's rows don't show yet. Each new
    /// message of the user's (one that wasn't there when it was sent, and that
    /// hasn't confirmed another already) accounts for the oldest pending one,
    /// whatever BB made of its text. `claimed` keeps the rows that did.
    static func unconfirmed(_ pending: [PendingSend], in rows: [TimelineRow], claimed: inout Set<String>) -> [PendingSend] {
        var remaining = pending
        for row in rows where !remaining.isEmpty && row.isConversation && row.isUser
            && (row.initiator == nil || row.initiator == "user") && !claimed.contains(row.id)
        {
            guard let index = remaining.firstIndex(where: { !$0.before.contains(row.id) }) else { continue }
            claimed.insert(row.id)
            remaining.remove(at: index)
        }
        return remaining
    }
}

/// A message on its way: shown at the end of the chat until the server's row
/// for it comes in.
struct PendingSend: Equatable {
    var row: TimelineRow
    /// The user's messages already there when it was sent.
    var before: Set<String>

    init(text: String, rows: [TimelineRow], now: Date = .now) {
        let id = "pending:\(UUID().uuidString)"
        row = TimelineRow(id: id, kind: "conversation", role: "user", text: text, createdAt: now.timeIntervalSince1970 * 1000)
        before = Set(rows.lazy.filter { $0.isConversation && $0.isUser }.map(\.id))
    }
}
