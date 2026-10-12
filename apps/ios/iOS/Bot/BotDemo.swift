#if DEBUG
import Foundation

/// Debug builds: `-qaBotDemo chat|working|needs|onboarding` fills the Bot tab
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

    private static func decode<T: Decodable>(_ json: String) -> T {
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
