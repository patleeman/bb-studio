import XCTest
@testable import BBStudio

@MainActor
final class PageLoadTests: XCTestCase {
    private actor Gate {
        private var waiters: [CheckedContinuation<Void, Never>] = []
        private var open = false
        func wait() async {
            guard !open else { return }
            await withCheckedContinuation { waiters.append($0) }
        }
        func release() {
            open = true
            waiters.forEach { $0.resume() }
            waiters = []
        }
    }

    private func until(_ condition: @MainActor () -> Bool, timeout: TimeInterval = 2) async {
        let end = Date().addingTimeInterval(timeout)
        while !condition(), Date() < end { try? await Task.sleep(for: .milliseconds(5)) }
    }

    func testSlowLoadFinishesAndStopsWaiting() async {
        let load = PageLoad<String>()
        let gate = Gate()
        load.run(key: "bot_a") {
            await gate.wait()
            return "records"
        }
        XCTAssertTrue(load.waiting)
        XCTAssertEqual(load.phase, .loading)
        await gate.release()
        await load.settle()
        XCTAssertEqual(load.value, "records")
        XCTAssertEqual(load.phase, .loaded)
        XCTAssertFalse(load.waiting)
    }

    func testCachedBotFlipsToLoadedBotMidRequest() async {
        let load = PageLoad<String>()
        let cachedGate = Gate()
        load.run(key: "server|bot_cached") {
            await cachedGate.wait()
            return "cached bot's records"
        }
        load.run(key: "server|bot_loaded") {
            try await Task.sleep(for: .milliseconds(20))
            return "loaded bot's records"
        }
        await load.settle()
        await cachedGate.release()
        try? await Task.sleep(for: .milliseconds(20))
        XCTAssertEqual(load.value, "loaded bot's records")
        XCTAssertEqual(load.phase, .loaded)
        XCTAssertEqual(load.key, "server|bot_loaded")
    }

    func testRebuiltViewWithTheSameKeyJoinsTheLoadInFlight() async {
        let load = PageLoad<Int>()
        let gate = Gate()
        var calls = 0
        let fetch: () async throws -> Int = {
            calls += 1
            await gate.wait()
            return calls
        }
        load.run(key: "k", fetch)
        load.run(key: "k", fetch)
        load.run(key: "k", fetch)
        await gate.release()
        await load.settle()
        XCTAssertEqual(calls, 1)
        XCTAssertEqual(load.value, 1)
    }

    func testCancellationWeDidNotAskForRetries() async {
        for error: Error in [CancellationError(), URLError(.cancelled)] {
            let load = PageLoad<String>()
            var calls = 0
            load.run(key: "k") {
                calls += 1
                if calls == 1 { throw error }
                return "ok"
            }
            await load.settle()
            XCTAssertEqual(load.value, "ok")
            XCTAssertEqual(load.phase, .loaded)
            XCTAssertEqual(calls, 2)
        }
    }

    func testCancellationThatKeepsHappeningEndsInAnErrorNotASpinner() async {
        let load = PageLoad<String>(retries: 2)
        var calls = 0
        load.run(key: "k") {
            calls += 1
            throw URLError(.cancelled)
        }
        await load.settle()
        XCTAssertEqual(calls, 3)
        XCTAssertNotNil(load.error)
        XCTAssertFalse(load.waiting)
    }

    func testFailureShowsAnErrorAndRetryLoads() async {
        let load = PageLoad<String>(describe: { _ in "Can't reach BB." })
        var fail = true
        load.run(key: "k") {
            if fail { throw URLError(.timedOut) }
            return "items"
        }
        await load.settle()
        XCTAssertEqual(load.error, "Can't reach BB.")
        XCTAssertFalse(load.waiting)
        fail = false
        load.retry()
        XCTAssertEqual(load.phase, .loading)
        await load.settle()
        XCTAssertEqual(load.value, "items")
        XCTAssertNil(load.error)
    }

    func testRefreshKeepsWhatWasShownAndANewBotClearsIt() async {
        let load = PageLoad<String>()
        load.run(key: "bot_a") { "a" }
        await load.settle()
        let gate = Gate()
        load.run(key: "bot_a|search", scope: "bot_a") {
            await gate.wait()
            return "a, searched"
        }
        XCTAssertEqual(load.value, "a")
        XCTAssertFalse(load.waiting)
        await gate.release()
        await load.settle()
        XCTAssertEqual(load.value, "a, searched")
        load.run(key: "bot_b") {
            try await Task.sleep(for: .seconds(5))
            return "b"
        }
        XCTAssertNil(load.value)
        XCTAssertTrue(load.waiting)
        load.cancel()
    }

    func testMemoryOverviewErrorSurvivesRecordsLoading() async {
        let server = URL(string: "https://memory-load.invalid")!
        let client = BBClient(baseURL: server)
        client.transport = { _, path, _ in
            if path.hasSuffix("/rpc/memory.overview") { return (500, Data(#"{"ok":false,"error":"overview broke"}"#.utf8)) }
            if path.hasSuffix("/rpc/memory.list") { return (200, Data(#"{"ok":true,"result":{"records":[],"total":0}}"#.utf8)) }
            return (404, Data())
        }
        let overview = PageLoad<MemoryOverview>()
        let records = PageLoad<(records: [MemoryRecord], total: Int)>()
        overview.run(key: "s|bot") { try await client.memoryOverview(botId: "bot") }
        records.run(key: "s|bot|||newest", scope: "s|bot") { try await client.memoryRecords(botId: "bot", query: "", topic: nil, sort: .newest) }
        await overview.settle()
        await records.settle()
        XCTAssertNotNil(overview.error)
        XCTAssertNil(overview.value)
        XCTAssertFalse(overview.waiting)
        XCTAssertEqual(records.phase, .loaded)
        XCTAssertNotNil(overview.error)
    }

    func testSlowLibraryThroughTheClientWithTheBotFlip() async {
        let server = URL(string: "https://library-load.invalid")!
        let client = BBClient(baseURL: server)
        let gate = Gate()
        client.transport = { _, path, body in
            guard path.hasSuffix("/rpc/bot_library") else { return (404, Data()) }
            let text = body.flatMap { String(data: $0, encoding: .utf8) } ?? ""
            if text.contains("bot_cached") { await gate.wait() }
            try await Task.sleep(for: .milliseconds(50))
            return (200, Data(#"{"ok":true,"result":{"items":[]}}"#.utf8))
        }
        let load = PageLoad<[BotLibraryItem]>()
        load.run(key: "s|bot_cached") { try await client.botLibrary(botId: "bot_cached") }
        try? await Task.sleep(for: .milliseconds(10))
        load.run(key: "s|bot_loaded") { try await client.botLibrary(botId: "bot_loaded") }
        await load.settle()
        await gate.release()
        XCTAssertEqual(load.phase, .loaded)
        XCTAssertEqual(load.value?.count, 0)
        XCTAssertEqual(load.key, "s|bot_loaded")
    }
}
