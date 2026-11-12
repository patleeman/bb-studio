import XCTest
@testable import BBStudio

/// Policies that keep the app from waking the radio and CPU when nothing changed.
final class EnergyTests: XCTestCase {
    // MARK: Realtime reconnect backoff

    func testBackoffDoublesToTheCapWhenConnectionsDropAtOnce() {
        var backoff = ReconnectBackoff()
        let delays = (0..<8).map { _ in backoff.delay(afterUptime: 0.5, jitter: 1) }
        XCTAssertEqual(delays, [1, 2, 4, 8, 16, 30, 30, 30])
    }

    func testBackoffKeepsGrowingWhenTheSocketNeverOpens() {
        var backoff = ReconnectBackoff()
        _ = backoff.delay(afterUptime: nil, jitter: 1)
        XCTAssertEqual(backoff.delay(afterUptime: nil, jitter: 1), 2)
    }

    func testBackoffStartsOverOnlyAfterAStableConnection() {
        var backoff = ReconnectBackoff()
        for _ in 0..<4 { _ = backoff.delay(afterUptime: 1, jitter: 1) }
        XCTAssertEqual(backoff.delay(afterUptime: 29, jitter: 1), 16)
        XCTAssertEqual(backoff.delay(afterUptime: 30, jitter: 1), 1)
    }

    func testBackoffJitterStaysInTheUpperHalfOfTheStep() {
        var low = ReconnectBackoff()
        var high = ReconnectBackoff()
        for _ in 0..<10 {
            _ = low.delay(afterUptime: 0, jitter: 0)
            _ = high.delay(afterUptime: 0, jitter: 1)
        }
        XCTAssertEqual(low.delay(afterUptime: 0, jitter: 0), 15)
        XCTAssertEqual(high.delay(afterUptime: 0, jitter: 1), 30)
        var random = ReconnectBackoff()
        for _ in 0..<50 { XCTAssertLessThanOrEqual(random.delay(afterUptime: 0), ReconnectBackoff.cap) }
    }

    // MARK: Older pages at the top of a thread

    func testOlderPagesKeepLoadingWhileTheyAddRows() {
        var failures = 3
        XCTAssertEqual(OlderPage.added.retryDelay(failures: &failures), .milliseconds(500))
        XCTAssertEqual(failures, 0)
    }

    func testOlderPagesStopWhenAPageBringsNothingNew() {
        var failures = 0
        XCTAssertNil(OlderPage.nothing.retryDelay(failures: &failures))
    }

    func testOlderPagesBackOffOnFailures() {
        var failures = 0
        let delays = (0..<8).map { _ in OlderPage.failed.retryDelay(failures: &failures) }
        XCTAssertEqual(delays, [2, 4, 8, 16, 32, 60, 60, 60].map { Duration.seconds($0) })
        XCTAssertEqual(OlderPage.busy.retryDelay(failures: &failures), .milliseconds(500))
        XCTAssertEqual(failures, 8)
    }

    // MARK: Bot Activity polling

    func testActivityPollsOnlyWhileTheTabShowsInTheForeground() {
        XCTAssertNil(BotActivityPoll.interval(visible: false, sceneActive: true, running: true))
        XCTAssertNil(BotActivityPoll.interval(visible: true, sceneActive: false, running: true))
        XCTAssertEqual(BotActivityPoll.interval(visible: true, sceneActive: true, running: true), .seconds(30))
        XCTAssertEqual(BotActivityPoll.interval(visible: true, sceneActive: true, running: false), .seconds(120))
    }

    func testActivityRefreshesOnStatusChangesNotStreamedOutput() {
        XCTAssertTrue(BotActivityPoll.refreshes(on: .changed(entity: "thread", id: "t", changes: ["status"])))
        XCTAssertTrue(BotActivityPoll.refreshes(on: .changed(entity: "thread", id: "t", changes: [])))
        XCTAssertTrue(BotActivityPoll.refreshes(on: .connected))
        XCTAssertFalse(BotActivityPoll.refreshes(on: .changed(entity: "thread", id: "t", changes: ["events-appended"])))
        XCTAssertFalse(BotActivityPoll.refreshes(on: .changed(entity: "page", id: "p", changes: ["status"])))
        XCTAssertFalse(BotActivityPoll.refreshes(on: .pluginSignal(pluginId: "x", channel: "y", payload: .null)))
    }
}
