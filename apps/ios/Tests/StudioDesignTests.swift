import XCTest
@testable import BBStudio

/// The web's latest Studio changes on the phone: Studio Design and reply cards.
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
        let inStudio = try JSONDecoder().decode(DesignScreen.self, from: Data(#"{"id":"1a","updatedAt":7,"url":"/api/v1/plugins/studio/http/designs/screen?design=dsn_0123456789abcdef&screen=1a&v=7&s=6"}"#.utf8))
        XCTAssertEqual(client.designScreenURL("dsn_0123456789abcdef", inStudio).absoluteString,
                       "https://design.invalid/api/v1/plugins/studio/http/designs/screen?design=dsn_0123456789abcdef&screen=1a&v=7&s=6")
        let older = try JSONDecoder().decode(DesignScreen.self, from: Data(#"{"id":"1a","updatedAt":7}"#.utf8))
        XCTAssertEqual(client.designScreenURL("dsn_0123456789abcdef", older).absoluteString,
                       "https://design.invalid/api/v1/plugins/design/http/screen?design=dsn_0123456789abcdef&screen=1a&v=7")
    }

    func testDesignPathsAndLinksOpenTheDesign() {
        XCTAssertEqual(Route(href: "/plugins/design/designs/dsn_0123456789abcdef"), .design(id: "dsn_0123456789abcdef"))
        XCTAssertEqual(Route(href: "/plugins/studio/studio/designs/dsn_0123456789abcdef"), .design(id: "dsn_0123456789abcdef"))
        XCTAssertTrue(BBClient.isDesignId("dsn_0123456789abcdef"))
        XCTAssertFalse(BBClient.isDesignId("dsn_nothex"))
        XCTAssertEqual(StudioKind.of("design").label, "Design")
    }

    func testReplyCardsForPagesDrawingsAndDesigns() {
        let reply = """
            Made it.

            ::page{id="pg_1"}
            ::drawing{id="drw_2"}
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
        XCTAssertEqual(items, [.page("pg_1"), .drawing("drw_2"), .design("dsn_0123456789abcdef"), .recording("rec_abcd1234")])
        XCTAssertEqual(items.map(\.route), [.page(id: "pg_1"), .drawing(id: "drw_2"), .design(id: "dsn_0123456789abcdef"), .recording(id: "rec_abcd1234")])
        XCTAssertEqual(items.last?.kind.label, "Recording")
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

    func testRecordingsFallBackToTheTalkPluginOnAnOlderServer() async throws {
        let client = BBClient(baseURL: URL(string: "http://localhost")!)
        var paths: [String] = []
        client.transport = { _, path, _ in
            paths.append(path)
            if path.hasPrefix("/api/v1/plugins/studio/") { return (404, Data(#"{"ok":false,"error":{"message":"No such method"}}"#.utf8)) }
            return (200, Data(#"{"ok":true,"result":{}}"#.utf8))
        }
        try await client.renameRecording("rec_aaaaaaaaaaaa", title: "QA")
        XCTAssertEqual(paths, ["/api/v1/plugins/studio/rpc/recordings.recording_rename", "/api/v1/plugins/talk/rpc/recording_rename"])
        recordingsInStudio = true
    }

    func testItemPathsOpenTheItem() {
        XCTAssertEqual(Route(href: "/plugins/pages/pages/pg_1"), .page(id: "pg_1"))
        XCTAssertEqual(Route(href: "/plugins/studio/studio/pages/pg_1"), .page(id: "pg_1"))
        XCTAssertEqual(Route(href: "/plugins/studio/studio/pages/pg_1/chat/thr_1"), .page(id: "pg_1"))
        XCTAssertEqual(Route(href: "/plugins/studio/studio/artifacts/art_1"), .artifact(id: "art_1"))
        XCTAssertEqual(Route(href: "/plugins/artifacts/artifacts/art_1"), .artifact(id: "art_1"))
        XCTAssertEqual(Route(href: "/plugins/studio/studio/drawings/drw_1"), .drawing(id: "drw_1"))
        XCTAssertEqual(Route(href: "/plugins/excalidraw/drawings/drw_1"), .drawing(id: "drw_1"))
        XCTAssertEqual(Route(href: "/plugins/studio/studio/recordings/rec_1"), .recording(id: "rec_1"))
        XCTAssertEqual(Route(href: "/plugins/talk/recordings/rec_1"), .recording(id: "rec_1"))
    }
}
