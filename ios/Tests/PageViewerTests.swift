import XCTest
@testable import BBStudio

/// Round 7: the page viewer's pure parts, each feature at desktop parity.
@MainActor
final class PageViewerTests: XCTestCase {
    // MARK: Blocks and their ids

    func testTopLevelIdLinesSplitBlocksAndNestedOnesStayInside() {
        let source = """
            <!-- ^aaaa0001 -->
            # Title

            <!-- ^aaaa0002 -->
            - one
              <!-- ^aaaa0003 -->
              - nested
            <!-- ^aaaa0004 -->
            - two

            <!-- ^aaaa0005 -->
            ```swift
            <!-- ^notablock -->
            ```
            """
        let blocks = PageDocument.parse(source)
        XCTAssertEqual(blocks.map(\.id), ["aaaa0001", "aaaa0002", "aaaa0004", "aaaa0005"])
        XCTAssertEqual(blocks[1].nested, ["aaaa0003"], "an indented id belongs to the block around it")
        XCTAssertEqual(blocks[1].markdown, "- one\n  - nested")
        XCTAssertTrue(blocks[1].isListItem && blocks[2].isListItem)
        XCTAssertFalse(blocks[0].isListItem)
        XCTAssertTrue(blocks[3].markdown.contains("<!-- ^notablock -->"), "code keeps its text")
    }

    func testAToggleIsOneBlockWithItsBodyIds() {
        let source = "<!-- ^aaaa0001 -->\n<details>\n<summary>## Risks</summary>\n\n<!-- ^aaaa0002 -->\nLate demo.\n\n</details>\n\n<!-- ^aaaa0003 -->\nAfter"
        let blocks = PageDocument.parse(source)
        XCTAssertEqual(blocks.map(\.id), ["aaaa0001", "aaaa0003"])
        XCTAssertEqual(blocks[0].nested, ["aaaa0002"])
    }

    func testTextBeforeTheFirstIdIsABlockToo() {
        XCTAssertEqual(PageDocument.parse("Plain page").map(\.id), ["#0"])
    }

    func testBlocksMatchACommentsFullOrShortId() {
        let block = PageBlock(id: "1a2b3c4d", nested: ["99887766"], markdown: "x", isListItem: false)
        XCTAssertTrue(block.contains("1a2b3c4d-0000-4000-8000-000000000000"), "Studio's thread blockId is the full id")
        XCTAssertTrue(block.contains("99887766"))
        XCTAssertFalse(block.contains("deadbeef"))
        XCTAssertFalse(block.contains(nil))
        XCTAssertEqual(PageDocument.shortId("1a2b-3c4d-5e6f"), "1a2b3c4d")
    }

    func testImagesInReadingOrder() {
        XCTAssertEqual(PageDocument.images("![a](one.png)\ntext ![b](<two words.png> \"t\")"), ["one.png", "two words.png"])
    }

    // MARK: Block kinds

    func testCalloutsTakeTheDesktopsTones() {
        guard case .callout(let tone, let text) = PageSegment.parse("> [!WARNING]\n> Careful **now**").first else {
            return XCTFail("a callout")
        }
        XCTAssertEqual(tone, "warning")
        XCTAssertEqual(text, "Careful **now**")
        XCTAssertEqual(PageSegment.tone("TIP"), "success")
        XCTAssertEqual(PageSegment.tone("CAUTION"), "danger")
        XCTAssertEqual(PageSegment.tone("NOTE"), "info")
        XCTAssertEqual(PageSegment.tone("IMPORTANT"), "info")
    }

    func testTogglesAndToggleHeadings() {
        guard case .toggle(let summary, let level, let body) = PageSegment.parse("<details>\n<summary>## Risks</summary>\n\nLate.\n\n</details>").first else {
            return XCTFail("a toggle")
        }
        XCTAssertEqual(summary, "Risks")
        XCTAssertEqual(level, 2)
        XCTAssertEqual(body, "Late.")
        guard case .toggle(_, let plain, _) = PageSegment.parse("<details><summary>More</summary>\nx\n</details>").first else {
            return XCTFail("a toggle on one line")
        }
        XCTAssertNil(plain)
    }

    func testHtmlAndMermaidAreBlocksButHtmlSourceStaysCode() {
        let segments = PageSegment.parse("```html\n<b>hi</b>\n```\n\n```mermaid\ngraph TD; A-->B\n```\n\n```html source\n<b>x</b>\n```")
        guard segments.count == 3, case .html("<b>hi</b>") = segments[0], case .mermaid("graph TD; A-->B") = segments[1],
              case .markdown(let code) = segments[2] else { return XCTFail("\(segments)") }
        XCTAssertTrue(code.trimmingCharacters(in: .whitespacesAndNewlines).hasPrefix("```html source"), code)
    }

    func testMentionsBecomeLinksDatesAndNames() {
        let day = ISO8601DateFormatter().date(from: "2026-10-01T12:00:00Z")!
        XCTAssertEqual(PageSegment.mention(kind: "page", target: "pg_1", label: "Plan"), "[Plan](bbstudio://page/pg_1)")
        XCTAssertEqual(PageSegment.mention(kind: "thread", target: "thr_1", label: ""), "[thr_1](bbstudio://conversation/thr_1)")
        XCTAssertEqual(PageSegment.mention(kind: "agent", target: "thr_2", label: "Agent · done"), "[Agent · done](bbstudio://conversation/thr_2)")
        XCTAssertEqual(PageSegment.mention(kind: "item", target: "design:dsn_1", label: "Stills"), "[Stills](bbstudio://design/dsn_1)")
        XCTAssertEqual(PageSegment.mention(kind: "item", target: "excalidraw:drw_1", label: "Sketch"), "[Sketch](bbstudio://whiteboard/drw_1)")
        XCTAssertEqual(PageSegment.mention(kind: "item", target: "unknown:x", label: "X"), "**X**")
        XCTAssertEqual(PageSegment.mention(kind: "bot", target: "bot_1", label: "Juniper"), "**Juniper**")
        XCTAssertEqual(PageSegment.mention(kind: "date", target: "2026-10-01", label: "2026-10-01", today: day), "**Today**")
        XCTAssertEqual(PageSegment.relativeDay("2026-10-02", today: day), "Tomorrow")
        XCTAssertEqual(PageSegment.relativeDay("2026-09-30", today: day), "Yesterday")
        XCTAssertNil(PageSegment.relativeDay("soon", today: day))
    }

    func testMentionLinksOpenInTheApp() {
        for link in ["bbstudio://page/pg_1", "bbstudio://conversation/thr_1", "bbstudio://design/dsn_0123456789abcdef", "bbstudio://whiteboard/drw_0123456789abcdef"] {
            guard case .entity = Links.parse(link) else { return XCTFail(link) }
        }
    }

    // MARK: Comments

    func testThreadsListInPageOrderAndMarkTheirBlocks() async {
        let model = PageModel(pageId: "pg_test", backend: FixedComments(threads: [
            thread("late", block: "aaaa0002"), thread("early", block: "aaaa0001-0000"), thread("loose", block: nil),
            thread("done", block: "aaaa0002", resolved: true),
        ]))
        model.markdown = "<!-- ^aaaa0001 -->\nOne\n\n<!-- ^aaaa0002 -->\nTwo"
        await model.loadComments()
        XCTAssertEqual(model.orderedThreads.map(\.id), ["early", "late", "done", "loose"])
        XCTAssertEqual(model.openThreads(in: model.blocks[1]).map(\.id), ["late"], "resolved threads leave the page's marks")
        XCTAssertEqual(model.openComments, 3)
        XCTAssertEqual(model.block(of: model.orderedThreads[0])?.id, "aaaa0001")
    }

    func testCopyGivesMarkdownWithoutBlockIds() {
        let model = PageModel(pageId: "pg_test", backend: FixedComments(threads: []))
        model.markdown = "<!-- ^aaaa0001 -->\n# Plan\n\n<!-- ^aaaa0002 -->\nText"
        XCTAssertEqual(model.plainMarkdown, "# Plan\n\nText")
        XCTAssertFalse(model.isEmpty)
    }

    // MARK: Editing

    func testInsertedMentionsAndDatesUseStudiosSyntax() {
        XCTAssertEqual(PageInsert.mention("page", "pg_1", label: "A [b]"), "@[A [b\\]](page:pg_1) ")
        let wednesday = ISO8601DateFormatter().date(from: "2026-11-25T12:00:00Z")!
        var calendar = Calendar(identifier: .gregorian)
        calendar.timeZone = TimeZone(identifier: "UTC")!
        let dates = PageInsert.dates(from: wednesday, calendar: calendar)
        XCTAssertEqual(dates.map(\.label), ["Today", "Tomorrow", "Next Monday", "Next Friday"])
        XCTAssertEqual(dates.map(\.value), ["2026-11-25", "2026-11-26", "2026-11-30", "2026-11-27"])
    }

    func testInsertedMentionsRenderBack() {
        let inserted = PageInsert.mention("page", "pg_1", label: "Plan").trimmingCharacters(in: .whitespaces)
        XCTAssertEqual(PageSegment.prepare(inserted), "[Plan](bbstudio://page/pg_1)")
    }

    private func thread(_ id: String, block: String?, resolved: Bool = false) -> PageCommentThread {
        PageCommentThread(id: id, resolved: resolved, blockId: block, quote: "", comments: [], updatedAt: 0)
    }
}

@MainActor
private struct FixedComments: PageCommentBackend {
    let threads: [PageCommentThread]
    func threads(_ pageId: String) async throws -> [PageCommentThread] { threads }
    func blocks(_ pageId: String) async throws -> [PageTextBlock] { [] }
    func create(_ pageId: String, block: String, quote: String?, text: String) async throws {}
    func reply(_ pageId: String, thread: String, text: String) async throws {}
    func resolve(_ pageId: String, thread: String, resolved: Bool) async throws {}
}
