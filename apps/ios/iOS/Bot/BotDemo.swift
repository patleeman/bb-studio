#if DEBUG
import Foundation

/// Debug builds: `-qaBotDemo chat|working|needs|onboarding|list` fills the Bot tab
/// with a deterministic local Bot, chat and Activity, for screenshots without
/// a server. `-qaBotSheet activity|profile` opens a sheet over it.
enum BotDemo {
    static let threadId = "thr_botdemo01"

    struct Fixture {
        var bot: BotInfo?
        var activity: BotActivity?
        var thread: ThreadEntry
        var rows: [TimelineRow]
        var interactions: [PendingInteraction]
        var chain: [String] { [threadId] }
        /// BB's metadata for the threads it started: made from its thread, at these times.
        var startedThreads: [String: ThreadEntry] {
            let made: [(String, Double)] = [("thr_reviewprs1", now - 86_400_000 - 3_600_000 + 70_000), ("thr_research1", now - 600_000 + 20_000),
                                            ("thr_waiting01", now - 600_000 + 21_000), ("thr_deck0001", now - 86_400_000 * 2)]
            return Dictionary(uniqueKeysWithValues: made.map { id, at in
                (id, BotDemo.decode(#"{"id":"\#(id)","projectId":"proj_personal","status":"idle","parentThreadId":"\#(threadId)","createdAt":\#(at),"updatedAt":\#(at)}"#) as ThreadEntry)
            })
        }
        /// Its automations: the original check-in, an evening one, a reminder, a watcher and a runner.
        var automations: [BotAutomation] {
            let t = BotDemo.now
            let row = { (id: String, kind: String, name: String, instruction: String, schedule: String, text: String, state: String, next: Double?, extra: String) in
                #"{"id":"\#(id)","kind":"\#(kind)","name":"\#(name)","original":\#(id == "heartbeat"),"instruction":"\#(instruction)","schedule":\#(schedule),"scheduleText":"\#(text)","state":"\#(state)","nextRunAt":\#(next.map { String($0) } ?? "null"),"lastRunAt":null,"lastOutcome":null,"target":"main","targetName":"Juniper","threadId":"\#(threadId)"\#(extra)}"#
            }
            let json = "[" + [
                row("heartbeat", "checkin", "Check-in", "What your Memory page's Check-in section says.", #"{"type":"times","days":[1,2,3,4,5],"times":["08:00"]}"#, "Weekdays 8:00", "active", t + 50_400_000, ""),
                row("aut_evening", "checkin", "Evening wrap-up", "Wrap up what got done today and what's left for tomorrow.", #"{"type":"times","days":[1,2,3,4,5],"times":["18:00"]}"#, "Weekdays 18:00", "active", t + 21_600_000, #","model":{"model":"gpt-5-mini","reasoning":"low"}"#),
                row("aut_deploy", "reminder", "Check the deploy", "Check whether the deploy finished and tell me.", #"{"type":"once","at":\#(t + 7_200_000)}"#, "Once, today 4:00 PM", "active", t + 7_200_000, ""),
                row("aut_release", "watcher", "Release watch", "Tell me only if it's a major version.", #"{"type":"interval","every":15,"unit":"minutes","days":[0,1,2,3,4,5,6],"quiet":{"from":"22:00","to":"07:00"}}"#, "Every 15 min, every day · quiet 22:00–7:00", "active", t + 600_000, #","script":{"body":"curl -fsS https://api.github.com/repos/acme/app/releases/latest | jq -r .tag_name","interpreter":"bash","timeoutMs":60000,"workingDirectory":null,"envKeys":[]}"#),
                row("run_inbox", "runner", "Inbox watch", "Check my inbox for replies from Dana.", #"{"type":"cron","cron":"0 9-17/2 * * 1-5"}"#, "Cron 0 9-17/2 * * 1-5", "paused", nil, ""),
            ].joined(separator: ",") + "]"
            return BotDemo.decode(json)
        }
        var automationRuns: [BotAutomationRun] {
            let t = BotDemo.now
            return BotDemo.decode(#"[{"id":"r3","at":\#(t - 900_000),"status":"skipped","manual":false,"outcome":"Nothing new","threadId":null},{"id":"r2","at":\#(t - 1_800_000),"status":"succeeded","manual":false,"outcome":"Woke it: v2.0.0","threadId":null},{"id":"r1","at":\#(t - 2_700_000),"status":"skipped","manual":true,"outcome":"Nothing new","threadId":null}]"#)
        }
    }

    static var variant: String? {
        let arguments = ProcessInfo.processInfo.arguments
        guard let index = arguments.firstIndex(of: "-qaBotDemo"), arguments.indices.contains(index + 1) else { return nil }
        return arguments[index + 1]
    }

    /// `-qaDemoLatency <ms>`: the chat's thread comes from a local server
    /// behind that much latency (`BotDemo.Server`), and the bot and the Bots
    /// list wait as long, as on a phone over Tailscale. `-qaDemoMessages <n>`
    /// sizes the chat, `-qaDemoPage <rows>` the server's pages (BB pages by
    /// turns, so a page of a working Bot runs to hundreds of rows),
    /// `-qaDemoColdCache` drops what's cached first, and `-qaDemoSend <text>`
    /// sends a message once the chat is in. `-qaDemoLong` makes it a long,
    /// compacted chat: runs of up to 60 tool rows folded into "Worked",
    /// replies from a line to a screenful, and a "/compact" every 40
    /// exchanges; a send there works, streams a long reply, then settles on
    /// a short one.
    struct Served {
        var latency: Duration
        var messages: Int
        var coldCache: Bool
        var send: String?
        var page: Int
        var long: Bool
    }

    static let served: Served? = {
        let arguments = ProcessInfo.processInfo.arguments
        func value(_ name: String) -> String? {
            arguments.firstIndex(of: name).flatMap { arguments.indices.contains($0 + 1) ? arguments[$0 + 1] : nil }
        }
        guard variant != nil, let ms = value("-qaDemoLatency").flatMap(Int.init) else { return nil }
        return Served(latency: .milliseconds(ms), messages: value("-qaDemoMessages").flatMap(Int.init) ?? 300,
                      coldCache: arguments.contains("-qaDemoColdCache"), send: value("-qaDemoSend"),
                      page: value("-qaDemoPage").flatMap(Int.init) ?? 24, long: arguments.contains("-qaDemoLong"))
    }()

    /// With `-qaDemoColdCache`, drops the cached chat, bot and Bots list
    /// once per launch, before anything reads them, for timing a first open.
    @MainActor static func dropCachesIfAsked(serverURL: URL) {
        guard served?.coldCache == true, !droppedCaches else { return }
        droppedCaches = true
        for key in ["thread-\(threadId)", "bot-primary", "bots"] { DiskCache.remove(key, serverURL: serverURL) }
    }
    @MainActor private static var droppedCaches = false

    /// Waits as long as a request to the server would.
    static func latency() async {
        if let served { try? await Task.sleep(for: served.latency) }
    }

    /// The chat's thread as a server would serve it: pages of the newest rows,
    /// and a send that starts a turn and answers after a few seconds.
    final class Server: @unchecked Sendable {
        static let shared = Server()
        private let lock = NSLock()
        private var rows: [TimelineRow] = BotDemo.longRows
        private var running = false
        private var sends = 0
        /// Called on the main actor when the thread changes, as BB's realtime would.
        @MainActor var changed: (() -> Void)?

        static var pageSize: Int { BotDemo.served?.page ?? 24 }

        func client(_ baseURL: URL) -> BBClient {
            let client = BBClient(baseURL: baseURL)
            client.transport = { [self] method, path, body in
                await BotDemo.latency()
                return respond(method, path, body)
            }
            return client
        }

        private func respond(_ method: String, _ path: String, _ body: Data?) -> (Int, Data) {
            let base = "/api/v1/threads/\(BotDemo.threadId)"
            if method == "GET", path == base { return (200, lock.withLock { BotDemo.threadJSON(running: running) }) }
            if method == "GET", path.hasPrefix(base + "/timeline") { return (200, page(path)) }
            if method == "POST", path == base + "/send" {
                let text = body.flatMap { try? JSONDecoder().decode(JSONValue.self, from: $0) }.flatMap(Self.text) ?? ""
                send(text)
                return (200, Data(#"{"ok":true}"#.utf8))
            }
            if method == "POST", path == base + "/read" { return (200, Data("{}".utf8)) }
            return (404, Data(#"{"error":{"message":"Not in the demo"}}"#.utf8))
        }

        private static func text(_ body: JSONValue) -> String? {
            guard case .object(let fields) = body, case .array(let input)? = fields["input"] else { return nil }
            for part in input { if case .object(let item) = part, case .string(let text)? = item["text"] { return text } }
            return nil
        }

        private func page(_ path: String) -> Data {
            lock.withLock {
                let components = URLComponents(string: path)
                let before = components?.queryItems?.first { $0.name == "beforeAnchorSeq" }?.value.flatMap(Int.init)
                let end = min(before ?? rows.count, rows.count)
                let start = max(0, end - Self.pageSize)
                struct Cursor: Encodable { var anchorSeq: Int; var anchorId: String }
                struct PageInfo: Encodable { var hasOlderRows: Bool; var olderCursor: Cursor? }
                struct Page: Encodable { var rows: [TimelineRow]; var maxSeq: Int; var timelinePage: PageInfo }
                let slice = Array(rows[start..<end])
                let info = PageInfo(hasOlderRows: start > 0, olderCursor: start > 0 ? Cursor(anchorSeq: start, anchorId: rows[start].id) : nil)
                return (try? JSONEncoder().encode(Page(rows: slice, maxSeq: rows.count, timelinePage: info))) ?? Data()
            }
        }

        private func send(_ text: String) {
            let at = Date().timeIntervalSince1970 * 1000
            let sent = lock.withLock {
                sends += 1
                running = true
                rows.append(BotDemo.row(id: "sent\(sends)", role: "user", text: text, at: at))
                return sends
            }
            notify()
            guard BotDemo.served?.long == true else {
                Task {
                    try? await Task.sleep(for: .seconds(3))
                    lock.withLock {
                        rows.append(BotDemo.row(id: "reply\(sent)", role: "assistant", text: "Got it. I'll take care of **that** now.", at: at + 3_000))
                        running = false
                    }
                    notify()
                }
                return
            }
            Task { await work(sent, at: at) }
        }

        /// A turn as BB streams one: tool calls one after another, a long
        /// reply growing in chunks, and then the reply settling on its final,
        /// much shorter text, so the bottom of the chat shrinks under a
        /// reader who's following it.
        private func work(_ sent: Int, at: Double) async {
            func step(_ change: () -> Void) async {
                try? await Task.sleep(for: .milliseconds(450))
                lock.withLock(change)
                notify()
            }
            for index in 0..<6 {
                await step {
                    if index > 0 { rows[rows.count - 1] = BotDemo.workRow(id: "turn\(sent)w\(index - 1)", tool: "bb_threads_list", at: at + Double(index) * 500) }
                    rows.append(BotDemo.workRow(id: "turn\(sent)w\(index)", tool: "bb_threads_list", at: at + Double(index) * 500 + 100, status: "running"))
                }
            }
            await step { rows[rows.count - 1] = BotDemo.workRow(id: "turn\(sent)w5", tool: "bb_threads_list", at: at + 3_000) }
            let paragraphs = (1...20).map { "Paragraph \($0) of the draft: the venue, the budget and the flights, with what each needs from you this week." }
            for chunk in 1...paragraphs.count {
                await step {
                    let row = BotDemo.row(id: "reply\(sent)", role: "assistant", text: paragraphs.prefix(chunk).joined(separator: "\n\n"), at: at + 4_000)
                    if rows.last?.id == row.id { rows[rows.count - 1] = row } else { rows.append(row) }
                }
            }
            await step {
                rows[rows.count - 1] = BotDemo.row(id: "reply\(sent)", role: "assistant", text: "Reply \(sent): all set. I'll take care of **that** now.", at: at + 4_000)
                running = false
            }
        }

        private func notify() {
            Task { @MainActor in changed?() }
        }
    }

    fileprivate static func row(id: String, role: String, text: String, at: Double) -> TimelineRow {
        let escaped = text.replacingOccurrences(of: "\\", with: "\\\\").replacingOccurrences(of: "\"", with: "\\\"").replacingOccurrences(of: "\n", with: "\\n")
        return decode(#"{"id":"\#(id)","kind":"conversation","role":"\#(role)","text":"\#(escaped)","createdAt":\#(at)}"#)
    }

    fileprivate static func workRow(id: String, tool: String, at: Double, status: String = "completed") -> TimelineRow {
        decode(#"{"id":"\#(id)","kind":"work","workKind":"tool","toolName":"\#(tool)","title":"\#(tool)","status":"\#(status)","output":"","createdAt":\#(at)}"#)
    }

    fileprivate static func threadJSON(running: Bool) -> Data {
        Data(#"{"id":"\#(threadId)","projectId":"proj_personal","environmentId":"env_botdemo01","title":"Juniper","status":"\#(running ? "active" : "idle")","createdAt":1,"updatedAt":\#(now)}"#.utf8)
    }

    static var sheet: String? {
        let arguments = ProcessInfo.processInfo.arguments
        guard let index = arguments.firstIndex(of: "-qaBotSheet"), arguments.indices.contains(index + 1) else { return nil }
        return arguments[index + 1]
    }

    static var current: Fixture? {
        guard let variant else { return nil }
        let running = variant == "working"
        let bot = variant == "onboarding" ? nil : BotInfo(
            name: "Juniper", avatar: "🌿", state: .active,
            lead: ThreadLead(threadId: threadId, heartbeat: "weekdays", time: "08:00"),
            shape: "blob", color: "#2ba59a", role: "My chief of staff. Keeps the week on track and chases loose ends.")
        return Fixture(bot: bot, activity: activity(needs: variant == "needs"), thread: thread(running: running, needs: variant == "needs"),
                       rows: served != nil && variant == "chat" ? longRows : rows(variant), interactions: variant == "needs" ? interactions : [])
    }

    /// The Bots list: Juniper alone, or with two more for `-qaBotDemo list`.
    static var bots: [BotInfo]? {
        guard let fixture = current else { return nil }
        guard let juniper = fixture.bot.map({ $0.with(id: "bot_juniper", primary: true, external: false) }) else { return [] }
        guard variant == "list" else { return [juniper] }
        let scout = BotInfo(name: "Scout", avatar: "🔭", state: .active, lead: ThreadLead(threadId: "thr_scout01"),
                            shape: "star", color: "#e0803a", role: "Watches competitors and the news.")
            .with(id: "bot_scout", primary: false, external: false)
        let ledger = BotInfo(name: "Ledger", avatar: "🧾", state: .paused, lead: ThreadLead(threadId: "thr_ledger01"),
                             shape: "hexagon", color: "#5b6ee1", role: "Keeps the books.")
            .with(id: "bot_ledger", primary: false, external: true)
        return [juniper, scout, ledger]
    }

    static var summaries: [String: BotSummary] {
        [
            "bot_juniper": BotSummary(preview: "Just one thing: the Lisbon offsite budget needs your sign-off by 3pm.", needsYou: 1, running: false, updatedAt: now - 600_000),
            "bot_scout": BotSummary(preview: "Two competitors shipped pricing changes this week. Summary is on your Pages.", needsYou: 0, running: true, updatedAt: now - 120_000),
            "bot_ledger": BotSummary(preview: "October invoices are reconciled. Three receipts are still missing.", needsYou: 0, running: false, updatedAt: now - 86_400_000 * 2),
        ]
    }

    static var runners: [BotRunner] {
        decode(#"""
        [{"id":"run_inbox","name":"Inbox sweep","state":"active","schedule":{"cadence":"every2hours"},"lastReport":"4 new threads, none urgent.","lastReportAt":\#(now - 1_800_000)},
         {"id":"run_prs","name":"PR watcher","state":"active","schedule":{"cadence":"weekdays","time":"09:00"},"lastReport":"Release PR is waiting on CI.","lastReportAt":\#(now - 7_200_000),"urgent":true},
         {"id":"run_news","name":"Industry news","state":"paused","schedule":{"cadence":"daily","time":"07:30"},"lastReport":"Quiet day.","lastReportAt":\#(now - 86_400_000 * 3)}]
        """#)
    }

    fileprivate static func decode<T: Decodable>(_ json: String) -> T {
        try! JSONDecoder().decode(T.self, from: Data(json.utf8))
    }

    private static var now: Double { Date().timeIntervalSince1970 * 1000 }

    private static func thread(running: Bool, needs: Bool) -> ThreadEntry {
        decode(#"{"id":"\#(threadId)","projectId":"proj_personal","environmentId":"env_botdemo01","title":"Juniper","status":"\#(running || needs ? "active" : "idle")","createdAt":1,"updatedAt":\#(now),"hasPendingInteraction":\#(needs)}"#)
    }

    /// The served chat's rows, made once.
    static let longRows: [TimelineRow] = rows("chat", long: served?.messages ?? 300)

    private static func rows(_ variant: String, long: Int? = nil) -> [TimelineRow] {
        let yesterday = now - 86_400_000 - 3_600_000
        let today = now - 600_000
        func message(_ id: String, _ role: String, _ text: String, _ at: Double) -> String {
            let escaped = text.replacingOccurrences(of: "\\", with: "\\\\").replacingOccurrences(of: "\"", with: "\\\"").replacingOccurrences(of: "\n", with: "\\n")
            return #"{"id":"\#(id)","kind":"conversation","role":"\#(role)","text":"\#(escaped)","createdAt":\#(at)}"#
        }
        func work(_ id: String, _ tool: String, _ at: Double, status: String = "completed", output: String = "") -> String {
            #"{"id":"\#(id)","kind":"work","workKind":"tool","toolName":"\#(tool)","title":"\#(tool)","status":"\#(status)","output":"\#(output)","createdAt":\#(at)}"#
        }
        if let long { return decode("[" + longChat(long, message: message, work: work).joined(separator: ",") + "]") }
        var items = [
            message("m1", "assistant", "Good morning! Three things today:\n\n- **Design review** at 10:00, the deck is ready\n- Two PRs waiting on you\n- Your flight to Lisbon checks in tonight", yesterday),
            message("m2", "user", "Thanks. Can you get the PRs moving?", yesterday + 60_000),
            work("w1", "bb_thread_start", yesterday + 70_000, output: "{\\\"threadId\\\":\\\"thr_reviewprs1\\\"}"),
            message("m3", "assistant", "On it. I started a thread to review both and will ping you if anything needs a decision.", yesterday + 90_000),
            #"{"id":"s1","kind":"conversation","role":"user","initiator":"system","text":"[bb system] @thread:thr_reviewprs1 completed","systemMessageKind":"child-completed","systemMessageSubject":{"kind":"thread","threadId":"thr_reviewprs1","threadName":"Review open PRs"},"createdAt":\#(yesterday + 3_000_000)}"#,
            message("s2", "assistant", "✓", yesterday + 3_010_000),
            message("m4", "user", "What needs me today?", today),
            work("w2", "pages_read", today + 5_000),
            work("w3", "bb_threads_list", today + 8_000),
            work("w4", "calendar_events", today + 12_000),
        ]
        switch variant {
        case "working":
            items.append(work("w5", "bb_thread_start", today + 20_000, status: "running"))
        case "needs":
            items.append(message("m5", "assistant", "The PR review finished. One fix touches the release workflow, so I'd like your OK before I push it.", today + 30_000))
        default:
            items.append(message("m5", "assistant", "Just one thing: the **Lisbon offsite budget** needs your sign-off by 3pm. The PRs are merged and the deck is final.\n\nWant me to draft the approval note?\n\n::next{reply=\"👍 Draft it|🕒 Remind me at 2|🙅 Not today\" do=\"📅 Block focus time\"}", today + 30_000))
        }
        return decode("[" + items.joined(separator: ",") + "]")
    }

    /// A long chat for timing: `count` messages of Markdown, lists, tables,
    /// code, reactions and quick replies, with work between, over a few weeks.
    private static func longChat(_ count: Int, message: (String, String, String, Double) -> String,
                                 work: (String, String, Double, String, String) -> String) -> [String] {
        let start = longNow - Double(count) * 1_800_000
        let replies = [
            "Here's where things stand:\n\n- **Design review** moved to Thursday\n- The deck has *two* open comments\n- [The brief](https://example.com/brief) is final\n\nAnything else?",
            "## Release notes\n\nThe build is green. Three changes went in:\n\n1. Faster sync on launch\n2. Fixed the share sheet\n3. New `::next` chips\n\n::reactions{items=\"👍|🎉|👀\"}",
            "I checked the logs. The failure is in the retry loop:\n\n```swift\nfunc retry() async throws {\n    for attempt in 1...3 {\n        do { return try await send() }\n        catch { try await Task.sleep(for: .seconds(attempt)) }\n    }\n}\n```\n\nIt never rethrows after the last attempt. Want me to fix it?",
            "| Item | Owner | Due |\n| --- | --- | --- |\n| Budget | Dana | Fri |\n| Venue | Sam | Mon |\n| Flights | You | Tue |\n\nThe venue is the one to watch.",
            "Quick summary of today: two meetings, one review, and the **Lisbon** flight checks in tonight. > Remember the passport.\n\n::next{reply=\"👍 Thanks|🕒 Later\" do=\"📅 Block time\"}",
        ]
        let asks = ["What's on today?", "Can you check the build?", "Why did the deploy fail?", "Who owns what for the offsite?", "Anything I'm forgetting?"]
        var out: [String] = []
        let long = served?.long == true
        let exchanges = count / 2
        for index in 0..<exchanges {
            let at = start + Double(index) * 3_600_000
            if long, compacts(index) {
                out.append(message("c\(index)", "user", "/compact", at - 60_000))
            }
            out.append(message("u\(index)", "user", asks[index % asks.count], at))
            if long {
                // Runs of tool calls of every length, folded into one "Worked" row each.
                let steps = [0, 1, 3, 0, 12, 0, 2, 60, 5, 0, 24][index % 11]
                for step in 0..<steps {
                    out.append(work("w\(index)s\(step)", ["bb_threads_list", "pages_read", "calendar_events", "shell"][step % 4], at + 5_000 + Double(step) * 100, "completed", ""))
                }
                // Replies from a line to a screenful.
                let paragraphs = [1, 4, 1, 9, 2, 1, 14][index % 7]
                let text = index == exchanges - 1 ? replies[4]
                    : (0..<paragraphs).map { "\(replies[(index + $0) % 4])" }.joined(separator: "\n\n")
                out.append(message("a\(index)", "assistant", text, at + 30_000))
            } else {
                if index % 3 == 0 { out.append(work("w\(index)", "bb_threads_list", at + 5_000, "completed", "")) }
                out.append(message("a\(index)", "assistant", replies[index % replies.count], at + 30_000))
            }
        }
        return out
    }

    /// When the long chat was made, so its "/compact" rows and their compactions line up.
    private static let longNow = now

    /// The long chat's compactions: Studio's warmer sends "/compact" every 40 exchanges.
    private static func compacts(_ index: Int) -> Bool { index > 0 && index % 40 == 0 }

    /// What Studio recorded for each of those "/compact" messages.
    static var compactionsJSON: String {
        guard served?.long == true else { return "[]" }
        let count = served?.messages ?? 300
        let start = longNow - Double(count) * 1_800_000
        let times = (0..<(count / 2)).filter(compacts).map { start + Double($0) * 3_600_000 - 90_000 }
        return "[" + times.map { #"{"threadId":"\#(threadId)","at":\#($0),"tokens":180000}"# }.joined(separator: ",") + "]"
    }

    private static var interactions: [PendingInteraction] {
        decode(#"[{"id":"int_demo1","threadId":"\#(threadId)","status":"pending","createdAt":\#(now),"payload":{"kind":"approval","subject":{"kind":"command","command":"git push origin release/1.4","cwd":"~/code/app"},"reason":"Push the release workflow fix","availableDecisions":["allow_once","deny"]}}]"#)
    }

    private static func activity(needs: Bool) -> BotActivity {
        let t = now
        return decode(#"""
        {"compactions":\#(compactionsJSON),
         "needsYou":\#(needs ? #"[{"id":"thr_reviewprs1","title":"Review open PRs","status":"active","relation":"started","needsYou":true,"updatedAt":\#(t)}]"# : "[]"),
         "waiting":[{"id":"thr_waiting01","title":"Summarize inbox","status":"pending","relation":"started","needsYou":false,"updatedAt":\#(t - 120000)}],
         "inProgress":[{"id":"thr_research1","title":"Lisbon offsite options","status":"running","relation":"started","needsYou":false,"updatedAt":\#(t - 60000)}],
         "scheduled":[{"id":"hb","kind":"heartbeat","name":"Check-in","enabled":true,"nextRunAt":\#(t + 50400000)},
                      {"id":"auto1","kind":"automation","name":"Friday wrap-up","enabled":true,"nextRunAt":\#(t + 259200000)}],
         "completed":[\#(needs ? "" : #"{"id":"thr_reviewprs1","title":"Review open PRs","status":"idle","relation":"started","needsYou":false,"updatedAt":\#(t - 3600000)},"#)
                      {"id":"thr_deck0001","title":"Polish the design review deck","status":"idle","relation":"started","needsYou":false,"updatedAt":\#(t - 7200000)}]}
        """#)
    }
}
#endif
