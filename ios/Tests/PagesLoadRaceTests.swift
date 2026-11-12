import XCTest
@testable import BBStudio

final class PagesLoadRaceTests: XCTestCase {
    private actor ResponseGate {
        private var continuation: CheckedContinuation<Void, Never>?
        private var released = false
        func wait() async {
            guard !released else { return }
            await withCheckedContinuation { continuation = $0 }
        }
        func release() { released = true; continuation?.resume(); continuation = nil }
    }

    @MainActor
    func testOlderTreeAndErrorCannotOverwriteNewerStateOrCache() async {
        for olderFails in [false, true] {
            let server = URL(string: "https://pages-race.invalid")!
            let original = BBClient.storedServerURL
            defer { BBClient.storedServerURL = original }
            BBClient.storedServerURL = server
            let store = PagesStore()
            let client = BBClient(baseURL: server)
            let gate = ResponseGate()
            let calls = LockedCounter()
            let started = expectation(description: "Older request started")
            client.transport = { _, path, _ in
                if path == "/api/v1/projects" { return (200, Data("[]".utf8)) }
                if path.hasSuffix("/rpc/pages.tree") {
                    if calls.next() == 1 {
                        started.fulfill()
                        await gate.wait()
                        if olderFails { throw URLError(.timedOut) }
                        return (200, Data(#"{"ok":true,"result":{"pages":[{"id":"old"}]}}"#.utf8))
                    }
                    return (200, Data(#"{"ok":true,"result":{"pages":[{"id":"new"}]}}"#.utf8))
                }
                return (404, Data())
            }
            let first = Task { await store.load(client) }
            await fulfillment(of: [started], timeout: 2)
            await store.load(client)
            await gate.release()
            await first.value
            XCTAssertEqual(store.pages.map(\.id), ["new"])
            XCTAssertNil(store.error)
            XCTAssertTrue(store.loaded)
            XCTAssertEqual(DiskCache.load(PagesSnapshot.self, key: PagesSnapshot.cacheKey, serverURL: server)?.pages.map(\.id), ["new"])
        }
    }
}
