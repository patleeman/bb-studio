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
    }

    static var variant: String? {
        let arguments = ProcessInfo.processInfo.arguments
        guard let index = arguments.firstIndex(of: "-qaBotDemo"), arguments.indices.contains(index + 1) else { return nil }
        return arguments[index + 1]
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
                       rows: rows(variant), interactions: variant == "needs" ? interactions : [])
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
        decode(#"{"id":"\#(threadId)","projectId":"proj_personal","title":"Juniper","status":"\#(running || needs ? "active" : "idle")","createdAt":1,"updatedAt":\#(now),"hasPendingInteraction":\#(needs)}"#)
    }

    private static func rows(_ variant: String) -> [TimelineRow] {
        let yesterday = now - 86_400_000 - 3_600_000
        let today = now - 600_000
        func message(_ id: String, _ role: String, _ text: String, _ at: Double) -> String {
            let escaped = text.replacingOccurrences(of: "\\", with: "\\\\").replacingOccurrences(of: "\"", with: "\\\"").replacingOccurrences(of: "\n", with: "\\n")
            return #"{"id":"\#(id)","kind":"conversation","role":"\#(role)","text":"\#(escaped)","createdAt":\#(at)}"#
        }
        func work(_ id: String, _ tool: String, _ at: Double, status: String = "completed", output: String = "") -> String {
            #"{"id":"\#(id)","kind":"work","workKind":"tool","toolName":"\#(tool)","title":"\#(tool)","status":"\#(status)","output":"\#(output)","createdAt":\#(at)}"#
        }
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

    private static var interactions: [PendingInteraction] {
        decode(#"[{"id":"int_demo1","threadId":"\#(threadId)","status":"pending","createdAt":\#(now),"payload":{"kind":"approval","subject":{"kind":"command","command":"git push origin release/1.4","cwd":"~/code/app"},"reason":"Push the release workflow fix","availableDecisions":["allow_once","deny"]}}]"#)
    }

    private static func activity(needs: Bool) -> BotActivity {
        let t = now
        return decode(#"""
        {"needsYou":\#(needs ? #"[{"id":"thr_reviewprs1","title":"Review open PRs","status":"active","relation":"started","needsYou":true,"updatedAt":\#(t)}]"# : "[]"),
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
