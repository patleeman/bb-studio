import XCTest
@testable import BBStudio

@MainActor
final class RelatedReplyTests: XCTestCase {
    func testFailurePreservesTheDraftAndParent() async {
        let client = BBClient(baseURL: URL(string: "https://reply.invalid")!)
        client.transport = { _, _, _ in (500, Data()) }
        let draft = RelatedReply()
        draft.parentId = "comment"
        draft.text = "My reply"
        await draft.send(pluginId: "pages", itemId: "page", client: client)
        XCTAssertEqual(draft.text, "My reply")
        XCTAssertEqual(draft.parentId, "comment")
        XCTAssertNotNil(draft.error)
        XCTAssertFalse(draft.posting)
    }

    func testSuccessClearsOnlyTheSubmittedDraftAndBlocksDuplicateSends() async {
        let client = BBClient(baseURL: URL(string: "https://reply.invalid")!)
        let calls = LockedCounter()
        let started = expectation(description: "Reply started")
        client.transport = { _, _, _ in
            if calls.next() == 1 { started.fulfill() }
            try await Task.sleep(for: .milliseconds(100))
            return (200, Data(#"{"ok":true,"result":{}}"#.utf8))
        }
        let draft = RelatedReply()
        draft.parentId = "comment"
        draft.text = "First reply"
        let first = Task { await draft.send(pluginId: "pages", itemId: "page", client: client) }
        await fulfillment(of: [started], timeout: 2)
        XCTAssertTrue(draft.posting)
        draft.text = "Edited reply"
        await draft.send(pluginId: "pages", itemId: "page", client: client)
        await first.value
        XCTAssertEqual(calls.next(), 2)
        XCTAssertEqual(draft.text, "Edited reply")
        XCTAssertEqual(draft.parentId, "comment")
        await draft.send(pluginId: "pages", itemId: "page", client: client)
        XCTAssertEqual(draft.text, "")
        XCTAssertNil(draft.parentId)
    }
}
