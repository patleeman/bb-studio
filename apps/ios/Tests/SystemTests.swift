import XCTest
@testable import BBStudio

final class SystemTests: XCTestCase {
    func testMarkdownKeepsTaskCardOutsideCodeFence() {
        let blocks = MarkdownBlock.parse("""
        ```text
        ::task{id="tsk_abcdefghijklmnop"}
        ```
        ::task{id="tsk_abcdefghijklmnop"}
        """)
        XCTAssertEqual(blocks.count, 2)
        guard case .code = blocks[0] else { return XCTFail("Directive inside code became a card") }
        guard case .task(let id) = blocks[1] else { return XCTFail("Task directive did not become a card") }
        XCTAssertEqual(id, "tsk_abcdefghijklmnop")
    }

    @MainActor
    func testOutboxKeepsMessageOrderUntilRemoved() {
        let threadId = "thr_test_\(UUID().uuidString)"
        let outbox = Outbox.shared
        outbox.add(threadId: threadId, text: "First", mentions: [])
        outbox.add(threadId: threadId, text: "Second", mentions: [])
        let queued = outbox.messages(for: threadId)
        defer { for message in outbox.messages(for: threadId) { outbox.remove(message.id) } }
        XCTAssertEqual(queued.map(\.text), ["First", "Second"])
        outbox.remove(queued[0].id)
        XCTAssertEqual(outbox.messages(for: threadId).map(\.text), ["Second"])
    }

    func testTaskDueTodayAndDoneFiltering() throws {
        let today = StudioTask.day(.now)
        let json = """
        {"id":"tsk_abcdefghijklmnop","title":"Pay invoice","description":"","status":"todo", "due":"\(today)",
         "createdAt":0,"updatedAt":0,"archived":false,"openThreads":0,"links":0}
        """
        let task = try JSONDecoder().decode(StudioTask.self, from: Data(json.utf8))
        XCTAssertEqual(task.due, today)
        XCTAssertFalse(task.isOverdue)
        XCTAssertEqual(StudioTask.formatDue(today), "Today")
    }

    func testStudioItemDecodesOptionalFieldsForSpotlight() throws {
        let json = """
        {"pluginId":"pages","id":"pg_123","kind":"page","title":"Project plan",
         "createdAt":1000,"updatedAt":2000,"archived":false}
        """
        let item = try JSONDecoder().decode(StudioItem.self, from: Data(json.utf8))
        XCTAssertEqual(item.id, "pages:pg_123")
        XCTAssertEqual(item.displayTitle, "Project plan")
        XCTAssertNil(item.preview)
    }
}
