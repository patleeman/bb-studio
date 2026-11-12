import Foundation

/// The last few hundred keyboard and window events, for the next crash.
///
/// A crash runs no code, so what survives it is what was already on disk.
/// The events are kept in memory, at most `cap` lines, and written to
/// `breadcrumbs.txt` about once a second while they change and on every
/// scene phase change. The app marks the session `active` while it is in
/// front and `background` once it isn't; a launch that finds `active`
/// follows a session that didn't end cleanly, and keeps that file as the
/// last crash's breadcrumbs, shared from Settings ▸ Diagnostics.
///
/// Always on, unlike the scroll log. Geometry, states and ids only, never
/// what a message says: ids go through `ScrollLog.id`, and callers pass
/// numbers and fixed words.
@MainActor
final class Breadcrumbs {
    static let shared = Breadcrumbs(directory: URL.applicationSupportDirectory.appending(path: "Breadcrumbs"))

    static let cap = 200
    let directory: URL
    var file: URL { directory.appending(path: "breadcrumbs.txt") }
    var lastCrash: URL { directory.appending(path: "last-crash-breadcrumbs.txt") }
    private var marker: URL { directory.appending(path: "session") }

    private(set) var lines: [String] = []
    private let started = Date()
    private var flushPending = false
    /// Waits before a write: `flush` runs at most this often while events come in.
    var flushDelay: Duration = .seconds(1)

    init(directory: URL) {
        self.directory = directory
    }

    /// One event: `what` is fixed words and numbers, never text from a row.
    func record(_ what: String) {
        let stamp = String(format: "%.3f", Date().timeIntervalSince(started))
        lines.append(stamp + " " + what)
        if lines.count > Self.cap { lines.removeFirst(lines.count - Self.cap) }
        scheduleFlush()
    }

    /// The first responder changed: `who` is a fixed name or an id.
    func focus(_ who: String, _ change: String) {
        record("focus \(ScrollLog.id(who)) \(change)")
    }

    /// At launch: keeps the last session's file if it didn't end cleanly,
    /// then starts this one. Returns whether it kept one.
    @discardableResult func launch() -> Bool {
        let manager = FileManager.default
        try? manager.createDirectory(at: directory, withIntermediateDirectories: true)
        let previous = (try? String(contentsOf: marker, encoding: .utf8)) ?? ""
        var kept = false
        if previous == "active", manager.fileExists(atPath: file.path) {
            try? manager.removeItem(at: lastCrash)
            kept = (try? manager.copyItem(at: file, to: lastCrash)) != nil
        }
        mark("active")
        record("launch" + (kept ? " after an unclean exit" : ""))
        flush()
        return kept
    }

    /// The scene came to the front (`active`) or left it (`background`).
    func scene(_ phase: String) {
        record("scene " + phase)
        flush()
        mark(phase == "background" ? "background" : "active")
    }

    /// Writes the lines now.
    func flush() {
        flushPending = false
        try? FileManager.default.createDirectory(at: directory, withIntermediateDirectories: true)
        try? Data((lines.joined(separator: "\n") + "\n").utf8).write(to: file, options: .atomic)
    }

    func clearLastCrash() {
        try? FileManager.default.removeItem(at: lastCrash)
    }

    var hasLastCrash: Bool { FileManager.default.fileExists(atPath: lastCrash.path) }

    private func mark(_ state: String) {
        try? Data(state.utf8).write(to: marker, options: .atomic)
    }

    private func scheduleFlush() {
        guard !flushPending else { return }
        flushPending = true
        let delay = flushDelay
        Task { @MainActor [weak self] in
            try? await Task.sleep(for: delay)
            guard let self, flushPending else { return }
            flush()
        }
    }
}
