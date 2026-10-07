import XCTest
@testable import BBStudio

/// The web's latest Studio changes on the phone: Studio Design, reply cards,
/// and By space's headingless Space lists.
@MainActor
final class StudioDesignTests: XCTestCase {
    /// Viewports are a preset or a custom "WIDTHxHEIGHT"; screens decode them as plain strings.
    func testDesignFrameSizesFollowPresetsAndCustomSizes() throws {
        XCTAssertTrue(designFrameSize("mobile") == (390, 844))
        XCTAssertTrue(designFrameSize("slide") == (1920, 1080))
        XCTAssertTrue(designFrameSize("A4") == (794, 1123))
        XCTAssertTrue(designFrameSize("1200x630") == (1200, 630))
        XCTAssertTrue(designFrameSize("1200×630") == (1200, 630))
        XCTAssertTrue(designFrameSize("100x630") == (1280, 800))
        XCTAssertTrue(designFrameSize("wide") == (1280, 800))
        XCTAssertTrue(designFrameSize(nil) == (1280, 800))
        let screen = try JSONDecoder().decode(DesignScreen.self, from: Data(#"{"id":"1a","viewport":"story"}"#.utf8))
        XCTAssertTrue(screen.size == (1080, 1920))
    }

    /// Frames load the address the plugin gives each screen, so the canvas script version can't drift.
    func testDesignScreenURLUsesThePluginsAddress() throws {
        let client = BBClient(baseURL: URL(string: "https://design.invalid")!)
        let screen = try JSONDecoder().decode(DesignScreen.self, from: Data(#"{"id":"1a","updatedAt":7,"url":"/api/v1/plugins/design/http/screen?design=dsn_0123456789abcdef&screen=1a&v=7&s=6"}"#.utf8))
        XCTAssertEqual(client.designScreenURL("dsn_0123456789abcdef", screen, step: "intro").absoluteString,
                       "https://design.invalid/api/v1/plugins/design/http/screen?design=dsn_0123456789abcdef&screen=1a&v=7&s=6#intro")
        let older = try JSONDecoder().decode(DesignScreen.self, from: Data(#"{"id":"1a","updatedAt":7}"#.utf8))
        XCTAssertEqual(client.designScreenURL("dsn_0123456789abcdef", older).absoluteString,
                       "https://design.invalid/api/v1/plugins/design/http/screen?design=dsn_0123456789abcdef&screen=1a&v=7")
    }

    func testDesignPathsAndLinksOpenTheDesign() {
        XCTAssertEqual(Route(href: "/plugins/design/designs/dsn_0123456789abcdef"), .design(id: "dsn_0123456789abcdef"))
        XCTAssertTrue(BBClient.isDesignId("dsn_0123456789abcdef"))
        XCTAssertFalse(BBClient.isDesignId("dsn_nothex"))
        XCTAssertEqual(StudioKind.of("design").label, "Design")
    }

    func testReplyCardsForPagesDrawingsTablesAndDesigns() {
        let reply = """
            Made it.

            ::page{id="pg_1"}
            ::drawing{id="drw_2"}
            ::table{id="tbl_3"}
            ::design{id="dsn_0123456789abcdef"}
            ::design{id="not-a-design"}
            ::recording{id="rec_abcd1234"}
            ::recording{id="rec_x"}
            ::next{reply="👍 Agree"}
            """
        let items = MarkdownBlock.parse(reply).compactMap { block -> ReplyItem? in
            if case .item(let item) = block { return item }
            return nil
        }
        XCTAssertEqual(items, [.page("pg_1"), .drawing("drw_2"), .table("tbl_3"), .design("dsn_0123456789abcdef"), .recording("rec_abcd1234")])
        XCTAssertEqual(items.map(\.route), [.page(id: "pg_1"), .drawing(id: "drw_2"), .table(id: "tbl_3"), .design(id: "dsn_0123456789abcdef"), .recording(id: "rec_abcd1234")])
        XCTAssertEqual(items.last?.kind.label, "Recording")
    }

    func testTablePreviewShowsTheFirstRowsWithoutHiddenColumns() {
        let table = Tables.GetOutputTable(
            columns: [.init(id: "name", name: "Name"), .init(id: "size", name: "Size")],
            views: [.init(id: "v", name: "All", hidden: ["size"])],
            rows: (0..<25).map { .init(id: "r\($0)", values: ["name": .string("Row \($0)"), "size": .number(Double($0))]) })
        let preview = StudioTablePreview(table)
        XCTAssertEqual(preview.columns, ["Name"])
        XCTAssertEqual(preview.rows.count, StudioTablePreview.rowLimit)
        XCTAssertEqual(preview.rows.first, ["Row 0"])
        XCTAssertEqual(preview.total, 25)
    }

    func testRecordingPreviewPrefersCleanedTextAndSkipsEmptySegments() throws {
        let json = """
            {"recording":{"id":"rec_abcd1234","title":"Standup","status":"done","pendingCount":0,"meetingNotes":{"summary":" Ship Friday. "}},
             "segments":[{"id":"s0","offsetMs":0,"text":"um hello","cleanedText":"Hello."},{"id":"s1","offsetMs":5000,"text":"  "},
                         {"id":"s2","offsetMs":65000,"text":"Bye"}]}
            """
        let output = try JSONDecoder().decode(Talk.RecordingGetOutput.self, from: Data(json.utf8))
        let preview = RecordingPreview(output)
        XCTAssertEqual(preview.summary, "Ship Friday.")
        XCTAssertEqual(preview.lines.map(\.text), ["Hello.", "Bye"])
        XCTAssertEqual(preview.total, 2)
        XCTAssertFalse(preview.transcribing)
        XCTAssertEqual(RecordingPreview.clock(65_000), "1:05")
        XCTAssertEqual(RecordingPreview.clock(3_725_000), "1:02:05")
    }

    func testDesignQuestionsAreAnsweredNatively() throws {
        let json = """
            {"id":"int_1","threadId":"thr_1","status":"pending","origin":{"kind":"plugin","pluginId":"design","rendererId":"design-questions"},
             "payload":{"kind":"plugin","title":"A few questions","data":{"title":"A few questions","questions":[
               {"id":"layout","kind":"choice","question":"Which layout?","options":[{"label":"Sidebar"},{"label":"Tabs"}],"other":true},
               {"id":"mood","kind":"scale","question":"How playful?","minLabel":"Calm","maxLabel":"Loud"}]}}}
            """
        let interaction = try JSONDecoder().decode(PendingInteraction.self, from: Data(json.utf8))
        XCTAssertTrue(interaction.isNative)
        XCTAssertEqual(interaction.summary, "Which layout?")
        let form = try XCTUnwrap(interaction.designQuestions)
        XCTAssertEqual(form.questions.map(\.kind), ["choice", "scale"])
        XCTAssertEqual(form.allDecided, ["layout": ["decide": true], "mood": ["decide": true]])
    }

    private func thread(_ id: String, parent: String? = nil, pinned: Bool = false, unread: Bool = false,
                        status: String = "idle", asks: Bool = false, at: Double = 1) throws -> ThreadEntry {
        var json: [String: Any] = ["id": id, "projectId": "p", "status": status, "createdAt": at, "updatedAt": at,
                                   "latestAttentionAt": at, "lastReadAt": unread ? 0 : at, "hasPendingInteraction": asks]
        if let parent { json["parentThreadId"] = parent }
        if pinned { json["pinnedAt"] = at }
        return try JSONDecoder().decode(ThreadEntry.self, from: JSONSerialization.data(withJSONObject: json))
    }

    /// Lead, then pins in their own Space, then threads that wait on you (or
    /// whose sub-thread does): questions, failures, results; the rest keep order.
    func testSpaceListsTheLeadThenPinsThenWaitingThreadsFirst() throws {
        let model = InboxModel()
        model.spaces = try [JSONDecoder().decode(StudioSpace.self, from: Data(
            #"{"id":"s","isDefault":true,"name":"S","description":"","projectIds":[],"threadIds":[]}"#.utf8))]
        model.leads = ["s": SpaceLead(threadId: "lead")]
        model.threads = try [
            thread("lead", at: 9),
            thread("pin", pinned: true, at: 8),
            thread("quiet", at: 7),
            thread("done", unread: true, at: 6),
            thread("failed", unread: true, status: "error", at: 5),
            thread("parent", at: 4),
            thread("asks", asks: true, at: 3),
        ]
        model.children = ["parent": [try thread("child", parent: "parent", asks: true, at: 2)]]

        let section = try XCTUnwrap(model.spaceSections.first)
        XCTAssertEqual(section.lead?.id, "lead")
        XCTAssertEqual(section.pinned.map(\.id), ["pin"])
        XCTAssertEqual(section.threads.map(\.id), ["parent", "asks", "failed", "done", "quiet"])
    }

    func testWaitingRowsSwapTheirAgeForAPill() throws {
        XCTAssertEqual(SpaceThreadRow.state(of: try thread("a", asks: true)).pill?.label, "NEEDS YOU")
        XCTAssertEqual(SpaceThreadRow.state(of: try thread("b", unread: true, status: "error")).pill?.label, "FAILED")
        XCTAssertEqual(SpaceThreadRow.state(of: try thread("c", unread: true)).pill?.label, "DONE")
        XCTAssertNil(SpaceThreadRow.state(of: try thread("d")).pill)
    }
}
