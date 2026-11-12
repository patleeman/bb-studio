#if DEBUG
import QuartzCore
import SwiftUI
import UIKit

/// `-qaBurstDemo`: typing in a long, busy thread while a burst of events
/// lands, for measuring the composer's latency (docs/typing-lag.md).
///
/// `-openURL bbstudio://thread/thr_burstdemo1` opens a thread served from a
/// local fake server: `-qaBurstTurns <n>` turns (60) of tool calls with large
/// Markdown table output and replies with tables, all loaded as after
/// scrolling up. Then a typist types a key every 110ms: 4 seconds of quiet,
/// then 20 background-task notifications, each followed by a streamed reply
/// and a tool call (about 7 change signals a second), then 4 seconds of quiet.
/// It prints `[burst]` lines with keystroke-to-frame latency and dropped
/// frames per phase, and the main thread's time per change signal.
enum BurstDemo {
    static let threadId = "thr_burstdemo1"
    static let enabled = ProcessInfo.processInfo.arguments.contains("-qaBurstDemo")
    private static let quiet = ProcessInfo.processInfo.arguments.contains("-qaBurstQuiet")

    private static var turns: Int {
        let arguments = ProcessInfo.processInfo.arguments
        return arguments.firstIndex(of: "-qaBurstTurns").flatMap { arguments.indices.contains($0 + 1) ? Int(arguments[$0 + 1]) : nil } ?? 60
    }

    /// Each run starts from the server's rows and, unless `-qaBurstQuiet`
    /// without `-qaBurstClearDraft`, an empty composer.
    @MainActor static func prepare(serverURL: URL) {
        DiskCache.remove(TimelineCache.key(threadId), serverURL: serverURL)
        if !quiet || ProcessInfo.processInfo.arguments.contains("-qaBurstClearDraft") {
            Drafts.save(threadId, text: "", mentions: [], serverURL: serverURL)
        }
    }

    /// The composer's text view, for the typist.
    @MainActor static weak var field: UITextView?

    // MARK: Rows

    private static let now = Date().timeIntervalSince1970 * 1000

    static func table(rows: Int, seed: Int) -> String {
        var lines = ["| Region | Owner | Requests | p95 (ms) | Status |", "| --- | --- | ---: | ---: | --- |"]
        for index in 0..<rows {
            lines.append("| region-\(seed)-\(index) | team **\(index % 7)** | \((seed * 31 + index * 17) % 9_000) | \((seed + index * 13) % 900) | `\(index % 3 == 0 ? "ok" : "degraded")` |")
        }
        return lines.joined(separator: "\n")
    }

    private static func reply(_ turn: Int, words: Int = .max) -> String {
        let full = """
        ## Turn \(turn) summary

        I checked the **numbers** for this batch and compared them with `last-week.csv`. Most regions are fine; a few are degraded.

        \(table(rows: 14, seed: turn))

        - Degraded regions keep their p95 under 900ms.
        - Next I'll re-run the check against [the dashboard](https://example.com/\(turn)).

        \(turn % 3 == 0 ? "::next{reply=\"👍 Looks good|🔁 Try again\" do=\"📄 Write this up as a page\"}" : "")
        """
        guard words != .max else { return full }
        return String(full.prefix(words))
    }

    private static func encode(_ object: [String: Any?]) -> [String: Any] { object.compactMapValues { $0 } }

    private static func rowsJSON(turn: Int, at: Double) -> [[String: Any]] {
        [
            encode(["id": "u\(turn)", "kind": "conversation", "role": "user", "initiator": "user",
                    "text": "Turn \(turn): check the numbers for batch \(turn) and tell me what changed.", "createdAt": at]),
            encode(["id": "c\(turn)", "kind": "work", "workKind": "command", "status": "completed", "title": "Ran a command",
                    "command": "bb-report --batch \(turn) --format markdown", "output": table(rows: 40, seed: turn + 1000), "createdAt": at + 1_000]),
            encode(["id": "t\(turn)", "kind": "work", "workKind": "tool", "toolName": "Read", "status": "completed", "title": "Read last-week.csv",
                    "output": table(rows: 30, seed: turn + 2000), "createdAt": at + 2_000]),
            encode(["id": "a\(turn)", "kind": "conversation", "role": "assistant", "text": reply(turn), "createdAt": at + 3_000]),
        ]
    }

    // MARK: Server

    /// The thread as BB would serve it, with the burst written into it.
    final class Server: @unchecked Sendable {
        static let shared = Server()
        private let lock = NSLock()
        private var rows: [[String: Any]]
        private var running = false
        private var seq = 0
        /// Called on the main actor for each change, as BB's realtime would.
        @MainActor var changed: ((Set<String>) -> Void)?
        /// Timeline fetches served, for the report.
        private(set) var timelineFetches = 0

        static let pageSize = 60

        init() {
            let start = BurstDemo.now - Double(BurstDemo.turns) * 60_000
            rows = (0..<BurstDemo.turns).flatMap { BurstDemo.rowsJSON(turn: $0, at: start + Double($0) * 60_000) }
            seq = rows.count
        }

        func client(_ baseURL: URL) -> BBClient {
            let client = BBClient(baseURL: baseURL)
            client.transport = { [self] method, path, _ in
                try? await Task.sleep(for: .milliseconds(30))
                return respond(method, path)
            }
            return client
        }

        private func respond(_ method: String, _ path: String) -> (Int, Data) {
            let base = "/api/v1/threads/\(BurstDemo.threadId)"
            if method == "GET", path == base { return (200, threadJSON()) }
            if method == "GET", path.hasPrefix(base + "/timeline") { return (200, page(path)) }
            if method == "GET", path == base + "/interactions" || path == base + "/queued-messages" { return (200, Data("[]".utf8)) }
            if method == "POST", path == base + "/read" { return (200, Data("{}".utf8)) }
            return (404, Data(#"{"error":{"message":"Not in the demo"}}"#.utf8))
        }

        private func threadJSON() -> Data {
            lock.withLock {
                Data(#"{"id":"\#(BurstDemo.threadId)","projectId":"proj_burst","title":"Busy thread","status":"\#(running ? "active" : "idle")","createdAt":1,"updatedAt":\#(BurstDemo.now)}"#.utf8)
            }
        }

        private func page(_ path: String) -> Data {
            lock.withLock {
                timelineFetches += 1
                let components = URLComponents(string: path)
                let before = components?.queryItems?.first { $0.name == "beforeAnchorSeq" }?.value.flatMap(Int.init)
                let end = min(before ?? rows.count, rows.count)
                let start = max(0, end - Self.pageSize)
                var page: [String: Any] = ["rows": Array(rows[start..<end]), "maxSeq": seq,
                                           "timelinePage": ["hasOlderRows": start > 0] as [String: Any]]
                if start > 0 { page["timelinePage"] = ["hasOlderRows": true, "olderCursor": ["anchorSeq": start, "anchorId": rows[start]["id"] as! String]] }
                return (try? JSONSerialization.data(withJSONObject: page)) ?? Data()
            }
        }

        private func upsert(_ row: [String: Any]) {
            lock.withLock {
                seq += 1
                if let index = rows.firstIndex(where: { $0["id"] as? String == row["id"] as? String }) { rows[index] = row } else { rows.append(row) }
            }
        }

        private func notify(_ changes: Set<String>) {
            Task { @MainActor in changed?(changes) }
        }

        /// 20 background tasks finish, each answered with a streamed reply and a tool call.
        func burst(_ count: Int = 20) async {
            lock.withLock { running = true }
            notify(["status-changed"])
            for index in 0..<count {
                let at = Date().timeIntervalSince1970 * 1000
                upsert(BurstDemo.encode(["id": "n\(index)", "kind": "conversation", "role": "user", "initiator": "system",
                                         "systemMessageKind": "child-completed", "text": "Background task \(index) finished: batch \(index) is ready.", "createdAt": at]))
                notify(["events-appended"])
                for step in 1...5 {
                    try? await Task.sleep(for: .milliseconds(120))
                    upsert(BurstDemo.encode(["id": "r\(index)", "kind": "conversation", "role": "assistant",
                                             "text": BurstDemo.reply(1000 + index, words: step * 220), "createdAt": at + 100]))
                    notify(["events-appended"])
                }
                try? await Task.sleep(for: .milliseconds(150))
                upsert(BurstDemo.encode(["id": "w\(index)", "kind": "work", "workKind": "command", "status": "completed", "title": "Ran a command",
                                         "command": "bb-report --batch \(index)", "output": BurstDemo.table(rows: 40, seed: 3000 + index), "createdAt": at + 900]))
                notify(["events-appended"])
                try? await Task.sleep(for: .milliseconds(130))
            }
            lock.withLock { running = false }
            notify(["status-changed"])
        }
    }

    // MARK: Harness

    /// Loads the whole thread, then types through quiet, the burst, and quiet again.
    @MainActor static func run(_ model: ThreadModel) {
        guard enabled, !started, !quiet else { return }
        started = true
        Task { @MainActor in
            while !model.loaded { try? await Task.sleep(for: .milliseconds(100)) }
            await model.loadAll()
            try? await Task.sleep(for: .seconds(2))
            guard let field else { return say("[burst] no composer field") }
            field.becomeFirstResponder()
            try? await Task.sleep(for: .seconds(1))
            say("[burst] rows=\(model.rows.count)")
            let meter = Meter()
            meter.start()
            let typist = Task { @MainActor in
                var typed = 0
                while !Task.isCancelled {
                    meter.keystroke()
                    field.insertText(typed % 6 == 5 ? " " : "a")
                    typed += 1
                    try? await Task.sleep(for: .milliseconds(110))
                }
            }
            meter.phase = "idle"
            try? await Task.sleep(for: .seconds(4))
            meter.phase = "burst"
            let fetches = Server.shared.timelineFetches
            let signals = signalCount
            await Server.shared.burst()
            try? await Task.sleep(for: .milliseconds(500))
            let burstSignals = signalCount - signals
            let burstFetches = Server.shared.timelineFetches - fetches
            meter.phase = "after"
            try? await Task.sleep(for: .seconds(4))
            typist.cancel()
            meter.stop()
            meter.report(signals: burstSignals, fetches: burstFetches, rows: model.rows.count)
            say("[burst] done")
            RenderCount.set("burst.done", 1)
        }
    }
    @MainActor private static var started = false
    /// Change signals the model received.
    @MainActor static var signalCount = 0

    nonisolated static func say(_ line: String) {
        FileHandle.standardError.write(Data((line + "\n").utf8))
    }

    /// Keystroke-to-frame latency: from inserting a key to the next display
    /// link callback, which waits while the main thread is busy. And frames
    /// that took longer than two refresh intervals.
    @MainActor final class Meter: NSObject {
        var phase = "idle" {
            didSet { bodies[oldValue, default: 0] += threadBodies() }
        }
        private var link: CADisplayLink?
        private var pendingKey: CFTimeInterval?
        private var last: CFTimeInterval = 0
        private var latencies: [String: [Double]] = [:]
        private var frames: [String: (count: Int, dropped: Int, worst: Double, over: Double)] = [:]
        private var bodies: [String: Int] = [:]
        private var bodiesMark = 0

        private func threadBodies() -> Int {
            let now = RenderCount.counts["thread.body"] ?? 0
            defer { bodiesMark = now }
            return now - bodiesMark
        }

        func start() {
            bodiesMark = RenderCount.counts["thread.body"] ?? 0
            link = CADisplayLink(target: self, selector: #selector(tick))
            link?.add(to: .main, forMode: .common)
        }

        func stop() {
            bodies[phase, default: 0] += threadBodies()
            link?.invalidate()
            link = nil
        }

        func keystroke() { pendingKey = CACurrentMediaTime() }

        @objc private func tick(_ link: CADisplayLink) {
            let now = CACurrentMediaTime()
            if let key = pendingKey {
                latencies[phase, default: []].append((now - key) * 1000)
                pendingKey = nil
            }
            defer { last = link.timestamp }
            guard last > 0 else { return }
            let frame = link.timestamp - last
            let expected = link.targetTimestamp - link.timestamp
            var stats = frames[phase] ?? (0, 0, 0, 0)
            stats.count += 1
            stats.worst = max(stats.worst, frame)
            if frame > expected * 2 { stats.dropped += 1 }
            stats.over += max(0, frame - expected)
            frames[phase] = stats
        }

        func report(signals: Int, fetches: Int, rows: Int) {
            for phase in ["idle", "burst", "after"] {
                let values = (latencies[phase] ?? []).sorted()
                guard !values.isEmpty else { continue }
                func pct(_ p: Double) -> Int { Int(values[min(values.count - 1, Int(Double(values.count) * p))].rounded()) }
                let f = frames[phase] ?? (0, 0, 0, 0)
                let result = ["keys": values.count, "p50": pct(0.5), "p95": pct(0.95), "max": Int(values.last!.rounded()),
                              "dropped": f.dropped, "worst": Int(f.worst * 1000), "overrun": Int(f.over * 1000), "threadBodies": bodies[phase] ?? 0]
                for (key, value) in result { RenderCount.set("burst.\(phase).\(key)", value) }
                say("[burst] phase=\(phase) keys=\(values.count) latency_p50=\(pct(0.5))ms p95=\(pct(0.95))ms max=\(Int(values.last!.rounded()))ms frames=\(f.count) dropped=\(f.dropped) worst=\(Int(f.worst * 1000))ms overrun=\(Int(f.over * 1000))ms thread_bodies=\(bodies[phase] ?? 0)")
            }
            let burst = frames["burst"] ?? (0, 0, 0, 0)
            let perSignal = signals > 0 ? Int(burst.over * 1000 / Double(signals)) : 0
            RenderCount.set("burst.signals", signals)
            RenderCount.set("burst.overrunPerSignal", perSignal)
            say("[burst] signals=\(signals) fetches=\(fetches) rows=\(rows) overrun_per_signal=\(perSignal)ms")
        }
    }
}
#endif
