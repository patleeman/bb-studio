import XCTest
@testable import BBStudio

/// The Bot's threads, grouped and labeled as on the desktop Bots sidebar.
final class BotThreadsTests: XCTestCase {
    private func activity(_ json: String) throws -> BotActivity {
        try JSONDecoder().decode(BotActivity.self, from: Data(json.utf8))
    }

    // MARK: Groups

    func testGroupsMatchDesktopSidebar() throws {
        let activity = try activity("""
        {"needsYou":[{"id":"ask","title":"Approve push","status":"active","relation":"started","needsYou":true,"updatedAt":50,"parentId":null},
                     {"id":"self","title":"Chat","status":"active","relation":"self","needsYou":true,"updatedAt":60}],
         "waiting":[{"id":"queued","title":"Queued","status":"pending","relation":"started","needsYou":false,"updatedAt":40}],
         "inProgress":[{"id":"worker","title":"Worker","status":"active","relation":"started","needsYou":false,"updatedAt":30,"parentId":"lead"}],
         "scheduled":[{"id":"hb","kind":"heartbeat","name":"Check-in","enabled":true,"nextRunAt":null},
                      {"id":"au","kind":"automation","name":"Friday wrap-up","enabled":true,"nextRunAt":1}],
         "completed":[{"id":"lead","title":"Lead","status":"idle","relation":"started","needsYou":false,"updatedAt":20},
                      {"id":"old","title":"Old","status":"error","relation":"started","needsYou":false,"updatedAt":10},
                      {"id":"kid","title":"Kid","status":"idle","relation":"started","needsYou":false,"updatedAt":5,"parentId":"old"}],
         "latest":null}
        """)
        let groups = BotThreadGroups(activity)
        // Needs you is flat and only the threads it started; a childless one isn't repeated below.
        XCTAssertEqual(groups.needsYou.map(\.id), ["ask"])
        // A worker nests under the lead that started it, and pulls it into Running.
        // Running holds only running work; a queued thread waits to start.
        XCTAssertEqual(BotThreadGroups.rows(groups.running).map { "\($0.id):\($0.depth)" }, ["lead:0", "worker:1"])
        XCTAssertEqual(BotThreadGroups.rows(groups.waiting).map { "\($0.id):\($0.depth)" }, ["queued:0"])
        XCTAssertEqual(BotThreadGroups.rows(groups.recent).map { "\($0.id):\($0.depth)" }, ["old:0", "kid:1"])
        // Recurring leaves out the check-in.
        XCTAssertEqual(groups.recurring.map(\.id), ["au"])
        XCTAssertFalse(groups.isEmpty)
        XCTAssertTrue(BotThreadGroups(nil).isEmpty)
    }

    func testQueuedThreadsWaitToStartUnlessTheirTreeRuns() throws {
        let activity = try activity("""
        {"needsYou":[],
         "waiting":[{"id":"q1","title":"Queued under a runner","status":"pending","relation":"started","needsYou":false,"updatedAt":40,"parentId":"run"},
                    {"id":"q2","title":"Queued under an idle one","status":"pending","relation":"started","needsYou":false,"updatedAt":35,"parentId":"done"}],
         "inProgress":[{"id":"run","title":"Running","status":"active","relation":"started","needsYou":false,"updatedAt":30}],
         "scheduled":[],
         "completed":[{"id":"done","title":"Done","status":"idle","relation":"started","needsYou":false,"updatedAt":20}],
         "latest":null}
        """)
        let groups = BotThreadGroups(activity)
        XCTAssertEqual(BotThreadGroups.rows(groups.running).map(\.id), ["run", "q1"])
        XCTAssertEqual(BotThreadGroups.rows(groups.waiting).map(\.id), ["done", "q2"])
        XCTAssertTrue(groups.recent.isEmpty)
        XCTAssertEqual(BotRowState(BotThreadTone(activity.waiting![1])), .queued)
    }

    func testNeedsYouParentStaysInTreeToHoldChildren() throws {
        let activity = try activity("""
        {"needsYou":[{"id":"p","title":"Parent","status":"active","relation":"started","needsYou":true,"updatedAt":5}],
         "inProgress":[],"scheduled":[],
         "completed":[{"id":"c","title":"Child","status":"idle","relation":"started","needsYou":false,"updatedAt":4,"parentId":"p"}]}
        """)
        let groups = BotThreadGroups(activity)
        XCTAssertEqual(groups.needsYou.map(\.id), ["p"])
        XCTAssertEqual(BotThreadGroups.rows(groups.recent).map(\.id), ["p", "c"])
    }

    func testParentCycleDoesNotLoop() throws {
        let activity = try activity("""
        {"needsYou":[],"inProgress":[],"scheduled":[],
         "completed":[{"id":"a","title":"A","status":"idle","relation":"started","needsYou":false,"updatedAt":2,"parentId":"b"},
                      {"id":"b","title":"B","status":"idle","relation":"started","needsYou":false,"updatedAt":1,"parentId":"a"},
                      {"id":"s","title":"Self","status":"idle","relation":"started","needsYou":false,"updatedAt":3,"parentId":"s"}]}
        """)
        // Neither a nor b is a root; s points at itself, so it is one.
        XCTAssertEqual(BotThreadGroups.rows(BotThreadGroups(activity).recent).map(\.id), ["s"])
    }

    func testTones() throws {
        func tone(_ status: String, needs: Bool = false) throws -> BotThreadTone {
            let thread = try JSONDecoder().decode(BotActivity.Thread.self, from: Data(#"{"id":"t","title":"T","status":"\#(status)","relation":"started","needsYou":\#(needs),"updatedAt":1}"#.utf8))
            return BotThreadTone(thread)
        }
        XCTAssertEqual(try tone("active", needs: true), .needs)
        XCTAssertEqual(try tone("starting"), .running)
        XCTAssertEqual(try tone("pending"), .waiting)
        XCTAssertEqual(try tone("error"), .failed)
        XCTAssertEqual(try tone("failed"), .failed)
        XCTAssertEqual(try tone("idle"), .idle)
        XCTAssertEqual(BotThreadTone.waiting.label, "Waiting to start")
    }

    func testAgeLabels() {
        let now = Date(timeIntervalSince1970: 1_000_000)
        let ms = now.timeIntervalSince1970 * 1000
        XCTAssertEqual(BotAge.label(ms - 10_000, now: now), "now")
        XCTAssertEqual(BotAge.label(ms - 5 * 60_000, now: now), "5m")
        XCTAssertEqual(BotAge.label(ms - 3 * 3_600_000, now: now), "3h")
        XCTAssertEqual(BotAge.label(ms - 2 * 86_400_000, now: now), "2d")
        XCTAssertEqual(BotAge.label(ms - 21 * 86_400_000, now: now), "3w")
    }

    // MARK: Earlier conversations

    func testEarlierIsTheChainBeforeTheBotThreadNewestFirst() {
        let chain = BotChainThreads(threadIds: ["t1", "t2", "t3"], titles: ["t1": "First", "t2": "  "])
        XCTAssertEqual(chain.earlier(current: "t3"), ["t2", "t1"])
        XCTAssertEqual(chain.earlier(current: "other"), [])
        XCTAssertEqual(chain.earlier(current: nil), [])
        XCTAssertEqual(chain.title("t1"), "First")
        XCTAssertEqual(chain.title("t2"), "Untitled")
    }

    // MARK: Runners

    func testRunnerLabels() throws {
        let runners = try JSONDecoder().decode([BotRunner].self, from: Data("""
        [{"id":"a","name":"A","threadId":"thr_a","state":"active","schedule":{"cadence":"custom","time":"09:00","cron":"5 7,17 * * *"},"nextRunAt":0},
         {"id":"b","name":"B","state":"active","schedule":{"cadence":"weekdays","time":"08:30"}},
         {"id":"c","name":"C","state":"paused","schedule":{"cadence":"every2hours","time":"09:00"},"nextRunAt":0},
         {"id":"d","name":"D","state":"active"}]
        """.utf8))
        let utc = TimeZone(identifier: "UTC")!
        let us = Locale(identifier: "en_US")
        XCTAssertEqual(runners[0].threadId, "thr_a")
        XCTAssertEqual(runners[0].plainSchedule, "Daily 7:05 AM and 5:05 PM")
        // 1970-01-01 was a Thursday.
        XCTAssertEqual(runners[0].subtitle(locale: us, timeZone: utc).replacingOccurrences(of: "\u{202F}", with: " "), "Daily 7:05 AM and 5:05 PM · Next run Thu 12:00 AM")
        XCTAssertEqual(runners[1].plainSchedule, "Weekdays 8:30 AM")
        XCTAssertNil(runners[1].nextRunLabel())
        XCTAssertEqual(runners[2].subtitle(), "Paused · Every 2 h")
        XCTAssertNil(runners[2].nextRunLabel())
        XCTAssertEqual(runners[3].plainSchedule, "Manual")
    }

    // MARK: Cron in plain English (desktop schedule.test.ts)

    func testDescribeCronMatchesDesktop() {
        let zone = "America/New_York"
        func describe(_ cron: String, _ timezone: String? = nil) -> String { CronText.describe(cron, timezone: timezone, localZone: zone) }
        XCTAssertEqual(describe("5 7,17 * * *"), "Daily 7:05 AM and 5:05 PM")
        XCTAssertEqual(describe("0 9 * * 1-5"), "Weekdays 9:00 AM")
        XCTAssertEqual(describe("30 8 * * 1"), "Mondays 8:30 AM")
        XCTAssertEqual(describe("30 8 * * mon"), "Mondays 8:30 AM")
        XCTAssertEqual(describe("0 10 * * 0,6"), "Weekends 10:00 AM")
        XCTAssertEqual(describe("0 9 * * 1,3"), "Mon, Wed 9:00 AM")
        XCTAssertEqual(describe("0 */2 * * *"), "Every 2 hours")
        XCTAssertEqual(describe("15 */6 * * 1-5"), "Every 6 hours at :15 on weekdays")
        XCTAssertEqual(describe("0 * * * *"), "Hourly")
        XCTAssertEqual(describe("*/15 * * * *"), "Every 15 minutes")
        XCTAssertEqual(describe("* * * * *"), "Every minute")
        XCTAssertEqual(describe("*/30 9-17 * * 1-5"), "Every 30 minutes, 9 AM–6 PM on weekdays")
        XCTAssertEqual(describe("0 7,12,17,22 * * *"), "4× daily: 7 AM, 12, 5, 10 PM")
        XCTAssertEqual(describe("0,30 9 * * *"), "Daily 9:00 AM and 9:30 AM")
        XCTAssertEqual(describe("0 9 * * *", "Europe/London"), "Daily 9:00 AM (London time)")
        XCTAssertEqual(describe("0 9 * * *", zone), "Daily 9:00 AM")
        XCTAssertEqual(describe("0 9 1 * *"), "Custom: 0 9 1 * *")
        XCTAssertEqual(describe("bad"), "Custom: bad")
        XCTAssertEqual(describe("0  9 * *  *"), "Daily 9:00 AM")
        XCTAssertEqual(describe("30 8 * * MON"), "Mondays 8:30 AM")
        XCTAssertEqual(describe("*/15 9-17 * * 1-5"), "Every 15 minutes, 9 AM–6 PM on weekdays")
        XCTAssertEqual(describe("0 9-17/2 * * 1-5"), "5× weekdays: 9, 11 AM, 1, 3, 5 PM")
        XCTAssertEqual(describe("0 9 * * 1,3,5"), "Mon, Wed, Fri 9:00 AM")
        XCTAssertEqual(describe("0 9 * 1 *"), "Custom: 0 9 * 1 *")
        XCTAssertEqual(describe("61 9 * * *"), "Custom: 61 9 * * *")
    }
}

/// The Bot sidebar row states, shared with desktop (`sidebarAgenda.ts` `runnerLastRun`).
final class BotRowStateTests: XCTestCase {
    private func runner(_ json: String) throws -> BotRunner {
        try JSONDecoder().decode(BotRunner.self, from: Data(#"{"id":"r","name":"Runner",\#(json)}"#.utf8))
    }

    func testLastOutcomeMatchesDesktop() throws {
        XCTAssertNil(try runner(#""state":"active""#).lastOutcome)
        XCTAssertEqual(try runner(#""state":"active","lastRunStatus":"failed""#).lastOutcome, "failed")
        XCTAssertEqual(try runner(#""state":"active","lastRunAt":100,"lastRunStatus":"succeeded","lastLevel":"log","lastReportAt":100"#).lastOutcome, "quiet")
        XCTAssertEqual(try runner(#""state":"active","lastRunAt":100,"lastLevel":"tell","lastReportAt":100"#).lastOutcome, "reported")
        // An older report doesn't describe a later silent run.
        XCTAssertEqual(try runner(#""state":"active","lastRunAt":200,"lastLevel":"urgent","lastReportAt":100"#).lastOutcome, "quiet")
        XCTAssertEqual(try runner(#""state":"active","lastRunAt":200,"lastRunStatus":"Error: timed out""#).lastOutcome, "failed")
    }

    func testRowStatePrecedence() throws {
        XCTAssertEqual(try runner(#""state":"active","running":true,"runningSince":5,"urgent":true"#).rowState, .waiting)
        XCTAssertEqual(try runner(#""state":"active","running":true,"runningSince":5"#).rowState, .running(since: 5))
        XCTAssertEqual(try runner(#""state":"paused","running":true"#).rowState, .paused)
        XCTAssertEqual(try runner(#""state":"active","lastRunAt":1,"lastRunStatus":"failed""#).rowState, .failed)
        XCTAssertEqual(try runner(#""state":"active","lastRunAt":1"#).rowState, .idle)
        // Older Studios send neither field: never running.
        XCTAssertFalse(try runner(#""state":"active""#).isRunning)
    }

    func testRowStatusWording() throws {
        let utc = TimeZone(identifier: "UTC")!
        let locale = Locale(identifier: "en_US")
        let now = Date(timeIntervalSince1970: 1_761_000_000) // Mon Oct 20 2025, 22:40 UTC
        let today = (now.timeIntervalSince1970 - 3_600) * 1000
        let paused = try runner(#""state":"paused","nextRunAt":\#(today)"#).rowStatus(now: now, locale: locale, timeZone: utc)
        XCTAssertEqual(paused.next, "paused")
        XCTAssertNil(paused.outcome)
        let quiet = try runner(#""state":"active","nextRunAt":\#(today),"lastRunAt":1"#).rowStatus(now: now, locale: locale, timeZone: utc)
        XCTAssertEqual(quiet.next, "next 9:40\u{202F}PM")
        XCTAssertEqual(quiet.outcome, "quiet")
        let later = BotRowTime.at((now.timeIntervalSince1970 + 2 * 86_400) * 1000, now: now, locale: locale, timeZone: utc)
        XCTAssertEqual(later, "Wed 10:40\u{202F}PM")
    }

    func testCompactStatusPutsTheNameFirstButKeepsAFailure() throws {
        let utc = TimeZone(identifier: "UTC")!
        let locale = Locale(identifier: "en_US")
        let now = Date(timeIntervalSince1970: 1_761_000_000)
        let today = (now.timeIntervalSince1970 - 3_600) * 1000
        func status(_ json: String) throws -> (next: String?, outcome: String?) {
            try runner(json).rowStatus(compact: true, now: now, locale: locale, timeZone: utc)
        }
        let quiet = try status(#""state":"active","nextRunAt":\#(today),"lastRunAt":1"#)
        XCTAssertEqual(quiet.next, "9:40\u{202F}PM")
        XCTAssertNil(quiet.outcome)
        XCTAssertNil(try status(#""state":"active","nextRunAt":\#(today),"lastRunAt":1,"lastLevel":"tell","lastReportAt":1"#).outcome)
        let failed = try status(#""state":"active","nextRunAt":\#(today),"lastRunAt":1,"lastRunStatus":"failed""#)
        XCTAssertEqual(failed.next, "9:40\u{202F}PM")
        XCTAssertEqual(failed.outcome, "failed")
        XCTAssertEqual(try status(#""state":"paused","nextRunAt":\#(today)"#).next, "paused")
    }

    func testElapsedClock() {
        let now = Date(timeIntervalSince1970: 10_000)
        XCTAssertEqual(BotRowTime.elapsed(since: (10_000 - 42) * 1000, now: now), "0:42")
        XCTAssertEqual(BotRowTime.elapsed(since: (10_000 - 725) * 1000, now: now), "12:05")
        XCTAssertEqual(BotRowTime.elapsed(since: (10_000 - 3_730) * 1000, now: now), "1:02:10")
        XCTAssertEqual(BotRowTime.elapsed(since: (10_000 + 5) * 1000, now: now), "0:00")
    }

    func testThreadToneMapsToRowState() {
        XCTAssertEqual(BotRowState(.needs), .waiting)
        XCTAssertEqual(BotRowState(.waiting), .queued)
        XCTAssertEqual(BotRowState(.running, since: 3), .running(since: 3))
        XCTAssertEqual(BotRowState(.failed), .failed)
        XCTAssertEqual(BotRowState(.idle), .idle)
    }
}
