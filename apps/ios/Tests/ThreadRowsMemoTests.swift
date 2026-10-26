import XCTest
@testable import BBStudio

/// The thread view reads the row ids and the grouped timeline on every
/// redraw. Built there, they cost a pass over every row each time; with a
/// long Bot chat that was where a 10 s main-thread hang spent its time.
/// The model works them out once per change of rows.
@MainActor
final class ThreadRowsMemoTests: XCTestCase {
    func testRowIdsAndItemsFollowTheRows() {
        let model = ThreadModel(threadId: "thread", client: BBClient(baseURL: URL(string: "https://memo.invalid")!))
        model.rows = Self.rows(4)
        XCTAssertEqual(model.rowIds, ["r0", "r1", "r2", "r3"])
        XCTAssertEqual(model.shownItems.map(\.id), TimelineItem.group(model.shownRows).map(\.id))

        model.rows.append(contentsOf: Self.rows(2, from: 4))
        XCTAssertEqual(model.rowIds, ["r0", "r1", "r2", "r3", "r4", "r5"], "A new row is in the ids at once")
        XCTAssertEqual(model.shownItems.map(\.id), TimelineItem.group(model.shownRows).map(\.id))

        model.rows = Self.rows(1)
        XCTAssertEqual(model.rowIds, ["r0"], "Replaced rows replace the ids")
        XCTAssertEqual(model.shownItems.map(\.id), ["r0"])
    }

    /// Two redraws a frame for two seconds of a 5,000-row chat: each read
    /// after the first is free, where rebuilding them was a pass over every
    /// row each time.
    func testReadingThemOnEveryRedrawOfALongChatIsCheap() {
        let model = ThreadModel(threadId: "thread", client: BBClient(baseURL: URL(string: "https://memo.invalid")!))
        model.rows = Self.rows(5_000)
        let start = Date()
        var total = 0
        for _ in 0..<240 {
            total += model.rowIds.count + model.shownItems.count
        }
        let elapsed = Date().timeIntervalSince(start)
        XCTAssertEqual(total, 240 * 10_000)
        XCTAssertLessThan(elapsed, 0.05, "240 redraws' reads of a 5,000-row chat took \(elapsed) s")
    }

    private static func rows(_ count: Int, from start: Int = 0) -> [TimelineRow] {
        let json = "[" + (start..<(start + count)).map { index in
            #"{"id":"r\#(index)","kind":"conversation","role":"\#(index.isMultiple(of: 2) ? "user" : "assistant")","text":"Message \#(index)","createdAt":\#(index)}"#
        }.joined(separator: ",") + "]"
        return try! JSONDecoder().decode([TimelineRow].self, from: Data(json.utf8))
    }
}
