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

    func testFastPathStatusTokenAndPassChecksMatchEdgeCases() {
        XCTAssertTrue(SilentOutput.isPass("[PASS]"))
        XCTAssertTrue(SilentOutput.isPass("  **[pass]** \n"))
        XCTAssertTrue(SilentOutput.isPass("`_[PaSs]_`"))
        XCTAssertFalse(SilentOutput.isPass("[PASS] done"))
        XCTAssertFalse(SilentOutput.isPass(""))
        XCTAssertFalse(SilentOutput.isPass(nil))

        for token in ["[pass]", " `[FAIL]` ", "**[failed]**", "~[DONE]~", "[ok]", "[skip]", "[SKIPPED]", "[noop]"] {
            XCTAssertTrue(RoomText.isStatusToken(token), token)
        }
        XCTAssertFalse(RoomText.isStatusToken("[PASS] extra"))
        XCTAssertFalse(RoomText.isStatusToken("[unknown]"))
        XCTAssertFalse(RoomText.isStatusToken("plain text"))

        let directive = Directive.last(in: "Hello\n\n::next{reply=\"👍 Looks good\"}")
        XCTAssertEqual(Directive.next(from: directive).reply, ["👍 Looks good"])
        XCTAssertTrue(Directive.reactions(from: directive).isEmpty)
        XCTAssertNil(Directive.last(in: "Plain message without directives"))
    }

    func testMarkdownInlineFastPathMatchesCommonMarkParser() throws {
        let plainSamples = [
            "",
            "region-1000-0",
            "4512",
            "p95 (ms)",
            "Hello, world.",
            "Status ok / degraded",
            "foo--bar",
            "\"quoted\" and 'single'",
        ]
        for sample in plainSamples {
            XCTAssertFalse(MarkdownText.hasInlineSyntax(sample), "expected plain fast path for \(sample)")
            let expected = try AttributedString(markdown: sample, options: .init(interpretedSyntax: .inlineOnlyPreservingWhitespace))
            XCTAssertEqual(MarkdownText.inline(sample), expected, "mismatch for \(sample)")
        }
        for rich in ["team **0**", "`ok`", "[link](https://example.com)", "a &amp; b", "https://example.com", "@thread:thr_abc123", "a_b_c", "~~strike~~"] {
            XCTAssertTrue(MarkdownText.hasInlineSyntax(rich), "expected rich path for \(rich)")
        }
    }

    func testMarkdownBlockGuardsParseAllBlockKinds() {
        let source = """
        ## Heading Two

        Plain paragraph line.

        ---

        - First bullet
        - [x] Done task
        1. Numbered item

        | Region | p95 (ms) |
        | --- | ---: |
        | region-1-0 | 120 |

        > Quoted line

        ![alt](https://example.com/a.png)
        """
        let blocks = MarkdownBlock.parse(source)
        XCTAssertEqual(blocks.count, 7)
        if case .heading(2, "Heading Two") = blocks[0] {} else { XCTFail("expected heading, got \(blocks[0])") }
        if case .paragraph("Plain paragraph line.") = blocks[1] {} else { XCTFail("expected paragraph, got \(blocks[1])") }
        if case .rule = blocks[2] {} else { XCTFail("expected rule, got \(blocks[2])") }
        if case .list(let items) = blocks[3] { XCTAssertEqual(items.count, 3) } else { XCTFail("expected list, got \(blocks[3])") }
        if case .table(let header, let rows) = blocks[4] {
            XCTAssertEqual(header, ["Region", "p95 (ms)"])
            XCTAssertEqual(rows, [["region-1-0", "120"]])
        } else { XCTFail("expected table, got \(blocks[4])") }
        if case .quote("Quoted line") = blocks[5] {} else { XCTFail("expected quote, got \(blocks[5])") }
        if case .image(alt: "alt", src: "https://example.com/a.png") = blocks[6] {} else { XCTFail("expected image, got \(blocks[6])") }
    }

    private static func rows(_ count: Int, from start: Int = 0) -> [TimelineRow] {
        let json = "[" + (start..<(start + count)).map { index in
            #"{"id":"r\#(index)","kind":"conversation","role":"\#(index.isMultiple(of: 2) ? "user" : "assistant")","text":"Message \#(index)","createdAt":\#(index)}"#
        }.joined(separator: ",") + "]"
        return try! JSONDecoder().decode([TimelineRow].self, from: Data(json.utf8))
    }
}
