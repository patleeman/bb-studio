import XCTest
@testable import BBStudio

final class SystemTests: XCTestCase {
    func testMarkdownKeepsArtifactCardOutsideCodeFence() {
        let blocks = MarkdownBlock.parse("""
        ```text
        ::artifact{id="art_abcdefghijklmnop"}
        ```
        ::artifact{id="art_abcdefghijklmnop"}
        """)
        XCTAssertEqual(blocks.count, 2)
        guard case .code = blocks[0] else { return XCTFail("Directive inside code became a card") }
        guard case .artifact(let id) = blocks[1] else { return XCTFail("Artifact directive did not become a card") }
        XCTAssertEqual(id, "art_abcdefghijklmnop")
    }

    func testAppCardsPickTheirRendererByTheId() {
        func card(_ line: String) -> String? {
            switch MarkdownBlock.parse(line).first {
            case .artifact(let id): "saved:" + id
            case .item(.mini(let id)): "interactive:" + id
            default: nil
            }
        }
        for name in ["app", "artifact", "mini"] {
            XCTAssertEqual(card("::\(name){id=\"art_abcdefghijklmnop\"}"), "saved:art_abcdefghijklmnop", name)
            XCTAssertEqual(card("::\(name){id=\"mini_0123456789abcdef\"}"), "interactive:mini_0123456789abcdef", name)
        }
        XCTAssertNil(card(#"::app{id="nonsense"}"#))
        XCTAssertTrue(EmbedCard.studioRef("app", "mini_0123456789abcdef")! == ("minis", "mini_0123456789abcdef"))
        XCTAssertTrue(EmbedCard.studioRef("app", "art_abcdefghijklmnop")! == ("artifacts", "art_abcdefghijklmnop"))
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
