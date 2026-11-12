import XCTest
@testable import BBStudio

/// What the large and extra-large widgets add to their entries.
final class WidgetLargeSizesTests: XCTestCase {
    private func rows(_ json: String) throws -> [TimelineRow] {
        try JSONDecoder().decode([TimelineRow].self, from: Data(json.utf8))
    }

    func testBotHistoryIsTheChatBeforeTheLatestReplyNewestFirst() throws {
        let rows = try rows("""
        [{"id":"u1","kind":"conversation","role":"user","text":"First **ask**","createdAt":1000},
         {"id":"a1","kind":"conversation","role":"assistant","text":"On it.","createdAt":2000},
         {"id":"w1","kind":"work","text":"ran a tool"},
         {"id":"s1","kind":"conversation","role":"user","initiator":"system","text":"child-completed"},
         {"id":"u2","kind":"conversation","role":"user","text":"Second ask","createdAt":3000},
         {"id":"a2","kind":"conversation","role":"assistant","text":"Latest reply","createdAt":4000}]
        """)
        let history = BotProvider.history(rows, before: "a2")
        XCTAssertEqual(history.map(\.id), ["u2", "a1", "u1"])
        XCTAssertEqual(history.map(\.fromYou), [true, false, true])
        // Markdown markers go, as in the latest message.
        XCTAssertEqual(history.last?.text, "First ask")
    }

    func testBotHistoryKeepsFourShortLines() throws {
        let long = String(repeating: "x", count: 500)
        let json = (0..<8).map { #"{"id":"m\#($0)","kind":"conversation","role":"assistant","text":"\#(long)"}"# }.joined(separator: ",")
        let history = BotProvider.history(try rows("[\(json)]"), before: nil)
        XCTAssertEqual(history.map(\.id), ["m7", "m6", "m5", "m4"])
        XCTAssertTrue(history.allSatisfy { $0.text.count == 200 })
    }

    func testBotTrackingIsWhatItWaitsBehindThenWorksOnButNotItsOwnChat() throws {
        let activity = try JSONDecoder().decode(BotActivity.self, from: Data("""
        {"inProgress":[{"id":"self","title":"Bot","status":"active","relation":"self","updatedAt":1},
                       {"id":"t1","title":"Offsite","status":"active","relation":"started","updatedAt":5,"runningSince":3,
                        "waitingFor":"Waiting for approval"}],
         "waiting":[{"id":"t0","title":"Digest","status":"pending","relation":"started","updatedAt":7}],
         "scheduled":[],"completed":[]}
        """.utf8))
        let tracked = BotProvider.tracking(activity)
        XCTAssertEqual(tracked.map(\.id), ["t0", "t1"])
        XCTAssertEqual(tracked[1].waitingFor, "Waiting for approval")
        XCTAssertEqual(tracked[1].at, 3)
        XCTAssertEqual(tracked[0].at, 7)
    }

    func testStatusLargeListsWaitingThreadsEvenWhenTheBotCounts() {
        let waiting = ThreadEntry.widgetSample("thr_a", "Approve deploy", minutesAgo: 2, pending: true)
        let running = ThreadEntry.widgetSample("thr_r", "Offsite", minutesAgo: 1)
        let summary = ThreadSummary([waiting, running])
        let entry = StatusProvider.entry(summary, needs: .bot(count: 1, reason: "Asked you a question"))
        // The small sizes keep counting only the Bot; the large ones list the thread too.
        XCTAssertEqual(entry.needsYou, [])
        XCTAssertEqual(entry.needsCount, 1)
        XCTAssertEqual(entry.waiting.map(\.id), ["thr_a"])
        XCTAssertEqual(entry.running.map(\.id), ["thr_r"])
    }

    func testWorkLargeListsUpToFiveWaitingThenRunningFillsTenRows() {
        // The sample: the Bot's reason, two waiting, seven running, all shown.
        XCTAssertTrue(WorkEntry.largeLimits(reason: true, pending: 2, running: 7) == (2, 7))
        // Crowded: five waiting, the rest of ten rows running.
        XCTAssertTrue(WorkEntry.largeLimits(reason: true, pending: 8, running: 9) == (5, 4))
        XCTAssertTrue(WorkEntry.largeLimits(reason: false, pending: 8, running: 9) == (5, 5))
        // Nothing waiting: running gets the room.
        XCTAssertTrue(WorkEntry.largeLimits(reason: false, pending: 0, running: 12) == (0, 10))
        XCTAssertTrue(WorkEntry.largeLimits(reason: false, pending: 0, running: 0) == (0, 0))
    }

    func testWorkNeedsYouCountsTheRowsItLists() {
        // The sample: the Bot's question and two threads waiting on an approval.
        XCTAssertEqual(WorkEntry.sample.needsCount, 3)
        var entry = WorkEntry.placeholder
        XCTAssertEqual(entry.needsCount, 0)
        // BB's own count (no Bot) already includes the waiting threads.
        entry.attention = 4
        entry.approvals = 2
        XCTAssertEqual(entry.needsCount, 4)
        entry.attention = 0
        XCTAssertEqual(entry.needsCount, 2)
    }

    func testRowAges() {
        let now = Date(timeIntervalSince1970: 100_000)
        XCTAssertEqual(WidgetText.age(100_000_000 - 10_000, now: now), "now")
        XCTAssertEqual(WidgetText.age(100_000_000 - 4 * 60_000, now: now), "4m")
        XCTAssertEqual(WidgetText.age(100_000_000 - 3 * 3_600_000, now: now), "3h")
        XCTAssertNil(WidgetText.age(nil, now: now))
    }
}
