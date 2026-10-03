import XCTest
@testable import BBStudio

@MainActor final class OfficeInboxStoreTests: XCTestCase {
    private func event(_ key: String, type: OfficeInboxEvent.Kind = .request, space: String = "sp_one") -> OfficeInboxEvent {
        OfficeInboxEvent(key: key, spaceId: space, type: type, source: "test", title: key, body: "Review", createdAt: 1)
    }

    func testActionIsPendingThenRollsBackOnFailure() async throws {
        var completion: CheckedContinuation<Void, Error>?
        let original = event("request")
        let store = InboxStore(fetch: { _ in OfficeInboxPage(events: [original]) },
                               counts: { OfficeInboxCounts(bySpace: ["sp_one": .init(requests: 1, unreadReports: 0)]) },
                               mutate: { _, _ in try await withCheckedThrowingContinuation { completion = $0 } })
        await store.load()
        let action = Task { await store.act(key: "request", actionId: "approve") }
        for _ in 0..<100 where completion == nil { await Task.yield() }
        let finish = try XCTUnwrap(completion)
        XCTAssertTrue(store.events[0].isPending)
        XCTAssertEqual(store.counts.count().requests, 0)
        XCTAssertNotNil(store.events[0].doneAt)
        let duplicate = await store.act(key: "request", actionId: "deny")
        XCTAssertFalse(duplicate)
        await store.refresh() // A source signal during an action must preserve its overlay.
        XCTAssertTrue(store.events[0].isPending)
        finish.resume(throwing: BBError(status: 500, message: "Denied by source"))
        let succeeded = await action.value
        XCTAssertFalse(succeeded)
        XCTAssertEqual(store.events, [original])
        XCTAssertEqual(store.counts.count().requests, 1)
        XCTAssertEqual(store.error, "Denied by source")
        XCTAssertTrue(store.pendingKeys.isEmpty)
    }

    func testReadAndDoneUpdateOnlyTheirSpaceCounts() async throws {
        var values = [event("report", type: .report), event("request", space: "sp_two")]
        var counts = OfficeInboxCounts(bySpace: ["sp_one": .init(requests: 0, unreadReports: 1), "sp_two": .init(requests: 1, unreadReports: 0)])
        let store = InboxStore(fetch: { _ in OfficeInboxPage(events: values) }, counts: { counts }, mutate: { keys, operation in
            switch operation {
            case .read:
                values[0].readAt = 2
                counts.bySpace["sp_one"]?.unreadReports = 0
            case .done:
                values.removeAll { keys.contains($0.key) }
                counts.bySpace["sp_two"]?.requests = 0
            case .act: XCTFail("Unexpected action")
            }
        })
        await store.load()
        let read = await store.read(keys: ["report"])
        XCTAssertTrue(read)
        XCTAssertEqual(store.counts.count().unreadReports, 0)
        XCTAssertEqual(store.counts.count(spaceId: "sp_two").requests, 1)
        let done = await store.done(keys: ["request"])
        XCTAssertTrue(done)
        XCTAssertEqual(store.events.map(\.id), ["report"])
        XCTAssertEqual(store.counts.count().requests, 0)
        XCTAssertTrue(store.pendingKeys.isEmpty)
    }

    func testCursorAppendDeduplicatesEvents() async {
        let first = event("one")
        let second = event("two")
        let store = InboxStore(fetch: { cursor in
            cursor == nil ? OfficeInboxPage(events: [first], nextCursor: "next") : OfficeInboxPage(events: [first, second])
        }, counts: { OfficeInboxCounts(bySpace: [:]) }, mutate: { _, _ in })
        await store.load()
        XCTAssertEqual(store.nextCursor, "next")
        await store.loadMore()
        XCTAssertEqual(store.events.map(\.id), ["one", "two"])
        XCTAssertNil(store.nextCursor)
        let unknown = await store.done(keys: ["unknown"])
        XCTAssertFalse(unknown)
    }

    func testOlderRefreshCannotResurrectCompletedAction() async throws {
        var oldRefresh: CheckedContinuation<OfficeInboxPage, Error>?
        var call = 0
        var finished = false
        let original = event("request")
        let store = InboxStore(fetch: { _ in
            call += 1
            if call == 2 { return try await withCheckedThrowingContinuation { oldRefresh = $0 } }
            return OfficeInboxPage(events: finished ? [] : [original])
        }, counts: { OfficeInboxCounts(bySpace: ["sp_one": .init(requests: finished ? 0 : 1, unreadReports: 0)]) }, mutate: { _, _ in finished = true })
        await store.load()
        let refresh = Task { await store.refresh() }
        for _ in 0..<100 where oldRefresh == nil { await Task.yield() }
        let finish = try XCTUnwrap(oldRefresh)
        let done = await store.done(keys: ["request"])
        XCTAssertTrue(done)
        finish.resume(returning: OfficeInboxPage(events: [original]))
        await refresh.value
        XCTAssertTrue(store.events.isEmpty)
        XCTAssertEqual(store.counts.count().requests, 0)
    }
    func testOverlappingActionsCommitAndRollbackIndependently() async throws {
        var completions: [String: CheckedContinuation<Void, Error>] = [:]
        let originals = [event("one"), event("two")]
        let store = InboxStore(fetch: { _ in OfficeInboxPage(events: originals) },
                               counts: { OfficeInboxCounts(bySpace: ["sp_one": .init(requests: 2, unreadReports: 0)]) },
                               mutate: { keys, _ in try await withCheckedThrowingContinuation { completions[keys[0]] = $0 } })
        await store.load()
        let one = Task { await store.done(keys: ["one"]) }
        let two = Task { await store.done(keys: ["two"]) }
        for _ in 0..<100 where completions.count < 2 { await Task.yield() }
        let first = try XCTUnwrap(completions["one"])
        let second = try XCTUnwrap(completions["two"])
        XCTAssertEqual(store.counts.count().requests, 0)
        first.resume()
        let committed = await one.value
        XCTAssertTrue(committed)
        XCTAssertEqual(store.events.map(\.key), ["two"])
        XCTAssertTrue(store.events[0].isPending)
        XCTAssertEqual(store.counts.count().requests, 0)
        second.resume(throwing: BBError(status: 500, message: "Retry this one"))
        let rejected = await two.value
        XCTAssertFalse(rejected)
        XCTAssertEqual(store.events.map(\.key), ["two"])
        XCTAssertFalse(store.events[0].isPending)
        XCTAssertEqual(store.counts.count().requests, 1)
    }

    func testRealtimeReconnectAndInboxSourcesRefreshButUnrelatedSignalsDoNot() async {
        var fetches = 0
        let store = InboxStore(fetch: { _ in
            fetches += 1
            return OfficeInboxPage(events: [])
        }, counts: { OfficeInboxCounts(bySpace: [:]) }, mutate: { _, _ in })
        await store.receiveRealtime(.pluginSignal(pluginId: "unrelated", channel: "changed", payload: .null))
        XCTAssertEqual(fetches, 0)
        await store.receiveRealtime(.connected)
        await store.receiveRealtime(.changed(entity: "thread", id: "thr_one", changes: ["interactions"]))
        for plugin in ["studio", "pages", "bot-teams", "feed", "studio-tasks"] {
            await store.receiveRealtime(.pluginSignal(pluginId: plugin, channel: "changed", payload: .null))
        }
        XCTAssertEqual(fetches, 7)
        XCTAssertFalse(store.isLoading)
    }

}
