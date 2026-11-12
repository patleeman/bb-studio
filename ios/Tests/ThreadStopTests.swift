import XCTest
@testable import BBStudio

@MainActor
final class ThreadStopTests: XCTestCase {
    func testFailedStopRefreshesStateAndKeepsItsError() async {
        let client = BBClient(baseURL: URL(string: "https://stop.invalid")!)
        let refreshes = LockedCounter()
        client.transport = { _, path, _ in
            if path.hasSuffix("/stop") { throw URLError(.timedOut) }
            if path.contains("/timeline?") {
                _ = refreshes.next()
                return (200, Data(#"{"rows":[],"maxSeq":0}"#.utf8))
            }
            if path == "/api/v1/threads/thread" {
                return (200, Data(#"{"id":"thread","projectId":"p","status":"idle","createdAt":1,"updatedAt":1}"#.utf8))
            }
            return (404, Data())
        }
        let model = ThreadModel(threadId: "thread", client: client)
        await model.stop()
        XCTAssertNotNil(model.error)
        XCTAssertEqual(model.thread?.status, "idle")
        XCTAssertEqual(refreshes.next(), 2)
        XCTAssertFalse(model.stopping)
    }

    func testPendingStopRejectsDuplicateRequests() async {
        let client = BBClient(baseURL: URL(string: "https://stop.invalid")!)
        let calls = LockedCounter()
        let started = expectation(description: "Stop started")
        client.transport = { _, path, _ in
            if path.hasSuffix("/stop") {
                _ = calls.next()
                started.fulfill()
                try await Task.sleep(for: .milliseconds(200))
                return (200, Data("{}".utf8))
            }
            return (404, Data())
        }
        let model = ThreadModel(threadId: "thread", client: client)
        let first = Task { await model.stop() }
        await fulfillment(of: [started], timeout: 2)
        XCTAssertTrue(model.stopping)
        await model.stop()
        await first.value
        XCTAssertEqual(calls.next(), 2)
        XCTAssertFalse(model.stopping)
    }
}
