import XCTest
@testable import BBStudio

/// The Bot chat's earlier threads load above it while the chain can change
/// underneath (a handoff, or `bot_chain` answering again).
final class BotChainRaceTests: XCTestCase {
    private let server = URL(string: "https://chain-race.invalid")!

    /// The chain resets the earlier pages while a page of the earliest one is
    /// in flight: the late page is dropped instead of writing into the emptied
    /// list (it indexed `earlierPages[0]` and crashed).
    @MainActor
    func testChainChangeDuringAnEarlierPageDropsItInsteadOfCrashing() async {
        let client = BBClient(baseURL: server)
        let calls = LockedCounter()
        client.transport = { _, path, _ in
            if path.hasPrefix("/api/v1/threads/thr_a/timeline") {
                if calls.next() == 1 {
                    return (200, Data(#"""
                        {"rows":[{"id":"a2","kind":"conversation","role":"assistant","text":"later"}],
                        "timelinePage":{"hasOlderRows":true,"olderCursor":{"anchorSeq":2,"anchorId":"a2"}}}
                        """#.utf8))
                }
                try await Task.sleep(for: .milliseconds(300))
                return (200, Data(#"{"rows":[{"id":"a1","kind":"conversation","role":"user","text":"first"}]}"#.utf8))
            }
            return (404, Data(#"{"error":{"message":"not here"}}"#.utf8))
        }
        let model = ThreadModel(threadId: "thr_b", client: client)
        model.chainBefore = ["thr_a"]
        let first = await model.loadOlder()
        XCTAssertEqual(first, .added)
        XCTAssertEqual(model.earlierPages.map(\.threadId), ["thr_a"])

        async let second = model.loadOlder()
        try? await Task.sleep(for: .milliseconds(100))
        // A handoff: the chain moved on, so the loaded pages reset.
        model.chainBefore = ["thr_x"]
        let result = await second
        XCTAssertNotEqual(result, .added)
        XCTAssertTrue(model.earlierPages.isEmpty)
    }

    /// The same for a chain thread's first page: it belongs to the old chain.
    @MainActor
    func testChainChangeDuringANewChainThreadDropsIt() async {
        let client = BBClient(baseURL: server)
        client.transport = { _, path, _ in
            if path.hasPrefix("/api/v1/threads/thr_a/timeline") {
                try await Task.sleep(for: .milliseconds(300))
                return (200, Data(#"{"rows":[{"id":"a1","kind":"conversation","role":"user","text":"first"}]}"#.utf8))
            }
            return (404, Data(#"{"error":{"message":"not here"}}"#.utf8))
        }
        let model = ThreadModel(threadId: "thr_b", client: client)
        model.chainBefore = ["thr_a"]
        async let load = model.loadOlder()
        try? await Task.sleep(for: .milliseconds(100))
        model.chainBefore = ["thr_x"]
        _ = await load
        XCTAssertTrue(model.earlierPages.isEmpty)
    }
}
