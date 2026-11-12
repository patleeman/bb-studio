import XCTest
@testable import BBStudio

@MainActor
final class ServerOperationTests: XCTestCase {
    func testDelayedCreateKeepsAllStepsOnAAndCannotCompleteOnB() async throws {
        try await exerciseSwitch(failCreate: false)
    }

    func testDelayedFailedCreateCleansUpOnlyAAndCannotCompleteOnB() async throws {
        try await exerciseSwitch(failCreate: true)
    }

    func testSavedShortcutCannotTargetClonedIDOnAnotherServer() throws {
        let a = URL(string: "https://a.invalid")!
        let b = URL(string: "https://b.invalid")!
        var entity = ThreadEntity(threadId: "thr_cloned", title: "A thread", serverURL: a)
        XCTAssertEqual(try entity.threadId(on: a), "thr_cloned")
        XCTAssertThrowsError(try entity.threadId(on: b))
        entity.id = "thr_cloned"
        XCTAssertThrowsError(try entity.threadId(on: a))
    }

    func testCurrentServerCompletionRuns() {
        let client = BBClient(baseURL: URL(string: "https://a.invalid")!)
        var completed = false
        XCTAssertTrue(ServerOperation(client: client).complete(currentServer: client.baseURL) { completed = true })
        XCTAssertTrue(completed)
    }

    private func exerciseSwitch(failCreate: Bool) async throws {
        let a = BBClient(baseURL: URL(string: "https://a.invalid")!)
        let b = BBClient(baseURL: URL(string: "https://b.invalid")!)
        let gate = MutationGate()
        let uploaded = expectation(description: "Upload started on A")
        let calls = MutationCalls()
        a.transport = { _, path, _ in
            await calls.append("A " + path)
            if path == "/upload" {
                uploaded.fulfill()
                await gate.wait()
            }
            if path == "/create", failCreate { throw BBError(status: 500, message: "Injected create failure") }
            return (200, Data())
        }
        b.transport = { _, path, _ in
            await calls.append("B " + path)
            return (200, Data())
        }
        var selected = a
        var navigated = false
        var dismissed = false
        let operation = ServerOperation(client: selected)
        let task = Task {
            try await operation.run(currentServer: { selected.baseURL }, work: { client in
                _ = try await client.raw(method: "POST", path: "/upload", body: nil)
                _ = try await client.raw(method: "POST", path: "/profile", body: nil)
                do {
                    _ = try await client.raw(method: "POST", path: "/create", body: nil)
                    return "thr_cloned"
                } catch {
                    _ = try await client.raw(method: "POST", path: "/cleanup", body: nil)
                    throw error
                }
            }, completion: { _ in
                navigated = true
                dismissed = true
            })
        }
        await fulfillment(of: [uploaded], timeout: 2)
        selected = b
        await gate.release()
        do {
            try await task.value
            XCTAssertFalse(failCreate)
        } catch { XCTAssertTrue(failCreate) }
        let recorded = await calls.values
        XCTAssertEqual(recorded, failCreate ? ["A /upload", "A /profile", "A /create", "A /cleanup"] : ["A /upload", "A /profile", "A /create"])
        XCTAssertFalse(navigated)
        XCTAssertFalse(dismissed)
    }
}

private actor MutationCalls {
    var values: [String] = []
    func append(_ value: String) { values.append(value) }
}

private actor MutationGate {
    private var released = false
    private var waiter: CheckedContinuation<Void, Never>?
    func wait() async {
        if released { return }
        await withCheckedContinuation { waiter = $0 }
    }
    func release() {
        released = true
        waiter?.resume()
        waiter = nil
    }
}
