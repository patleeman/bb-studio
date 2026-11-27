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

    // MARK: The thread list's subscription while idle

    @MainActor
    func testTheThreadListRestsWhileIdleAndCatchesUpOnce() {
        let realtime = BBRealtime(client: BBClient(baseURL: URL(string: "https://energy.invalid")!))
        realtime.subscribeThreadList()
        var events: [RealtimeEvent] = []
        realtime.listen { events.append($0) }
        realtime.pauseThreadList(true)
        realtime.pauseThreadList(true)
        XCTAssertTrue(events.isEmpty, "resting says nothing")
        realtime.pauseThreadList(false)
        realtime.pauseThreadList(false)
        XCTAssertEqual(events.count, 1, "back in use: one catch-up, however often it's told")
        guard case .changed(let entity, let id, let changes) = events.first else { return XCTFail("a thread change") }
        XCTAssertEqual(entity, "thread")
        XCTAssertNil(id)
        XCTAssertTrue(changes.isEmpty, "not streaming: the list reloads soon")
    }

    // MARK: The socket's thread list

    func testTheSocketAsksForTheListWithoutOtherThreadsEvents() throws {
        let client = BBClient(baseURL: URL(string: "https://studio.invalid")!)
        let url = client.webSocketURL
        XCTAssertEqual(url.scheme, "wss")
        XCTAssertEqual(url.path, "/ws")
        let items = try XCTUnwrap(URLComponents(url: url, resolvingAgainstBaseURL: false)?.queryItems)
        XCTAssertEqual(items, [URLQueryItem(name: "listEvents", value: "status")])
    }

    // MARK: Cancellation, caching, and session bounds

    @MainActor
    func testCancelledBackgroundPollExitsWithoutWaitingForForeground() async {
        let gate = EnergyGate(watchKeyboard: false)
        gate.setBackground(true)
        let started = expectation(description: "poll started")
        let ended = expectation(description: "poll ended on cancel")
        let task = Task { @MainActor in
            started.fulfill()
            await gate.pollWait(.milliseconds(10))
            ended.fulfill()
        }
        await fulfillment(of: [started], timeout: 1)
        try? await Task.sleep(for: .milliseconds(40))
        task.cancel()
        await fulfillment(of: [ended], timeout: 1)
    }

    func testExecutionOptionsAreCachedPerClientAndProvider() async throws {
        let count = ExecutionOptionsCallCounter()
        let client = BBClient(baseURL: URL(string: "https://cache.invalid")!)
        client.transport = { _, path, _ in
            count.increment()
            return (200, Data(#"{"providers":[],"models":[]}"#.utf8))
        }
        _ = try await client.executionOptions(providerId: "claude-code", cachedFor: .seconds(300))
        _ = try await client.executionOptions(providerId: "claude-code", cachedFor: .seconds(300))
        XCTAssertEqual(count.value, 1, "same provider reuses cached options when cachedFor is set")
        _ = try await client.executionOptions(providerId: "codex", cachedFor: .seconds(300))
        XCTAssertEqual(count.value, 2, "different provider fetches separately")
        _ = try await client.executionOptions(providerId: "claude-code")
        XCTAssertEqual(count.value, 3, "pickers without cachedFor always fetch fresh options")
    }

    func testSinglePassRPCDecodingHandlesOkErrorAndNullResult() async throws {
        struct Payload: Decodable, Equatable { var name: String }
        let client = BBClient(baseURL: URL(string: "https://rpc.invalid")!)
        client.transport = { _, path, _ in
            if path.hasSuffix("/ok") { return (200, Data(#"{"ok":true,"result":{"name":"ready"}}"#.utf8)) }
            if path.hasSuffix("/null") { return (200, Data(#"{"ok":true,"result":null}"#.utf8)) }
            return (200, Data(#"{"ok":false,"error":{"message":"denied"}}"#.utf8))
        }
        let ok: Payload = try await client.rpc("studio", "ok")
        XCTAssertEqual(ok, Payload(name: "ready"))
        let none: Payload? = try await client.rpcIfPresent("studio", "null")
        XCTAssertNil(none)
        do {
            let _: Payload = try await client.rpc("studio", "fail")
            XCTFail("expected error")
        } catch let error as BBError {
            XCTAssertEqual(error.message, "denied")
        }
    }

    @MainActor
    func testRoomSessionsEvictsLeastRecentlyUsedSessionsBeyondCap() {
        let sessions = RoomSessions(main: "t0")
        let first = sessions.current
        for i in 1...10 {
            sessions.show("t\(i)")
            _ = sessions.current
        }
        let latest = sessions.session(for: "t10")
        XCTAssertTrue(sessions.current === latest)
        // Oldest session t0 was evicted, so asking for it builds a fresh instance.
        let reloaded = sessions.session(for: "t0")
        XCTAssertEqual(reloaded.threadId, "t0")
        XCTAssertFalse(first === reloaded, "oldest session should be evicted past maxCached")
    }
}

private final class ExecutionOptionsCallCounter: @unchecked Sendable {
    private let lock = NSLock()
    private var _value = 0
    var value: Int { lock.withLock { _value } }
    func increment() { lock.withLock { _value += 1 } }
}
