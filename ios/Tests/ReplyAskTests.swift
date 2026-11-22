import XCTest
@testable import BBStudio

/// A reply that needs the user, marked in place (desktop's `ask-mark.ts` rules).
final class ReplyAskTests: XCTestCase {
    func testFindsTheSentenceWithWhitespaceFolded() {
        let blocks = ["Just one thing: the Lisbon offsite budget needs your sign-off by 3pm.", "Want me to draft\n  the approval note?"]
        let found = ReplyAsk.find("Want me to draft the approval note?", in: blocks)
        XCTAssertEqual(found, [1: 0..<blocks[1].count], "the whole second block, its line break folded")
    }

    func testTheLastMatchWinsOverAnEarlierQuote() {
        let blocks = ["You asked: “Ship it today?”", "So, ship it today?"]
        let found = ReplyAsk.find("ship it today?", in: blocks)
        XCTAssertEqual(found?.keys.sorted(), [1], "the reply's own sentence, not the quote before it")
        XCTAssertEqual(found?[1], 4..<18)
    }

    func testACutSentenceMatchesByItsStart() {
        let blocks = ["Should I book the 9:40 flight to Lisbon or wait for the fares to drop next week?"]
        let found = ReplyAsk.find("Should I book the 9:40 flight…", in: blocks)
        XCTAssertEqual(found, [0: 0..<29])
    }

    func testNoMarkWhenTheSentenceIsNotThere() {
        XCTAssertNil(ReplyAsk.find("Want me to send it?", in: ["The PRs are merged."]))
        XCTAssertNil(ReplyAsk.find("   ", in: ["Anything"]))
    }

    func testMarkdownIsMatchedAsItShows() {
        // The blocks are the rendered text: **bold** and `code` are already plain.
        let shown = String(MarkdownText.inline("Approve the **Lisbon offsite budget** by `3pm`?").characters)
        XCTAssertNotNil(ReplyAsk.find("Approve the Lisbon offsite budget by 3pm?", in: [shown]))
    }

    func testTheMarkedBlocksOfAMessage() {
        let blocks = MarkdownBlock.parse("Just one thing.\n\n- First\n- Want me to draft the approval note?\n\nThanks!")
        let marked = MarkdownText.marked(blocks, ReplyAskMark(ask: "Want me to draft the approval note?", seq: 7))
        XCTAssertEqual(marked.count, 1)
        XCTAssertEqual(marked.keys.first?.item, 1, "the list's second item")
        let lastParagraph = MarkdownText.marked(blocks, ReplyAskMark(ask: nil, seq: 7))
        XCTAssertEqual(lastParagraph.keys.first, MarkdownText.TextKey(block: 2), "no sentence named: the last paragraph")
        XCTAssertTrue(MarkdownText.marked(blocks, ReplyAskMark(ask: "Not in it", seq: 7)).isEmpty)
    }

    func testOnlyAnOpenNeedsYouReplyMarksItsTurnsNewestMessage() {
        let tags = StrandTags(tags: [.init(turnId: "t1", seq: 1, strandId: "s"), .init(turnId: "t2", seq: 5, strandId: "s")],
                              replies: [.init(turnId: "t1", seq: 3, tag: "needs-you", ask: "Old?", resolved: true),
                                        .init(turnId: "t2", seq: 8, tag: "status", ask: nil, resolved: false),
                                        .init(turnId: "t2", seq: 9, tag: "needs-you", ask: "Ship it?", resolved: false)])
        XCTAssertNil(tags.openReply(turnId: "t1"), "resolved")
        XCTAssertEqual(tags.openReply(turnId: "t2")?.seq, 9)
        XCTAssertEqual(tags.turn(atSeq: 7)?.turnId, "t2")
        XCTAssertNil(tags.turn(atSeq: 0))
    }
}
