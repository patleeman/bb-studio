import XCTest
@testable import BBStudio

/// `Speakable`, a port of Studio's `speakable` (src/voice/live/speakable.test.ts),
/// which Siri's intents speak replies with.
final class SpeakableTests: XCTestCase {
    // MARK: speakable

    func testSpeakableReducesMarkdownToWords() {
        XCTAssertEqual(
            Speakable.text("## Done\n\n- **Two** tests fail in `auth`.\n- See [the log](https://x.y/z)."),
            "Done\nTwo tests fail in auth.\nSee the log.")
    }

    func testSpeakableLeavesOutDirectivesAndComments() {
        XCTAssertEqual(
            Speakable.text("Done.\n\n::page{id=\"pg_1\"}\n\n::next{reply=\"👍 Ship it|🧪 Add tests\" btw=\"🐛 I noticed {x}\"}"),
            "Done.")
        XCTAssertEqual(Speakable.text("See the card ::design{id=\"dsn_1\"} above.<!-- note -->"), "See the card above.")
    }

    func testSpeakableLeavesCodeOutAndPlainSpeechAsIs() {
        XCTAssertEqual(Speakable.text("Here it is:\n```ts\nconst a = 1;\n```\nWant more?"), "Here it is:\n (code left out) \nWant more?")
        XCTAssertEqual(
            Speakable.text("It took about six minutes, and nothing needs you."),
            "It took about six minutes, and nothing needs you.")
    }

    func testSpeakableStripsEmphasisListsQuotesAndTables() {
        XCTAssertEqual(Speakable.text("1. _First_ step\n2) ~~old~~ new"), "First step\nold new")
        XCTAssertEqual(Speakable.text("> Quoted line"), "Quoted line")
        XCTAssertEqual(Speakable.text("| a | b |"), "a b")
        XCTAssertEqual(Speakable.text("![chart](x.png) Look"), "Look")
    }
}

/// Dictation's words in the draft, and what a send carries.
final class DictationTextTests: XCTestCase {
    func testJoinPutsWhatWasSaidAfterWhatWasTyped() {
        XCTAssertEqual(TalkDraft.join(typed: "", heard: "hello"), "hello")
        XCTAssertEqual(TalkDraft.join(typed: "  ", heard: "hello"), "hello")
        XCTAssertEqual(TalkDraft.join(typed: "Note:", heard: "hello"), "Note: hello")
        XCTAssertEqual(TalkDraft.join(typed: "Note: ", heard: "hello"), "Note: hello")
        XCTAssertEqual(TalkDraft.join(typed: "Note", heard: ""), "Note")
    }

    func testSendCarriesTheAgentOnlyNote() {
        let note = "Spoken, not typed."
        let input = BBClient.input("Hello", [], [], agentNote: note)
        XCTAssertEqual(input, [
            ["type": "text", "text": "Hello", "mentions": []],
            ["type": "text", "text": .string(note), "mentions": [], "visibility": "agent-only"],
        ])
        XCTAssertEqual(BBClient.input("Hello", []), [["type": "text", "text": "Hello", "mentions": []]])
    }

    func testInlineDictationSegmentsAreShort() {
        XCTAssertEqual(SegmentPolicy.voice, SegmentPolicy(targetMs: 2500, maxMs: 8000, pauseMs: 300))
        XCTAssertFalse(SegmentPolicy.voice.shouldCut(elapsedMs: 2000, quietMs: 1000))
        XCTAssertTrue(SegmentPolicy.voice.shouldCut(elapsedMs: 2600, quietMs: 300))
        XCTAssertFalse(SegmentPolicy.voice.shouldCut(elapsedMs: 2600, quietMs: 200))
        XCTAssertTrue(SegmentPolicy.voice.shouldCut(elapsedMs: 8000, quietMs: 0))
        // Talk's own recordings keep their long segments.
        XCTAssertFalse(SegmentPolicy.talk.shouldCut(elapsedMs: 8000, quietMs: 1000))
    }

    func testLiveTranscriptJoinsSegmentsSoFar() throws {
        let json = """
            {"recording":{"id":"rec_1","title":"t","titleSource":"user","kind":"dictation","status":"recording","projectId":null,
              "threadId":null,"createdAt":1,"updatedAt":2,"endedAt":null,"durationMs":5000,"segmentCount":3,"pendingCount":1,
              "failedCount":0,"wordCount":4,"preview":"Turn on","archived":false,"audioRemoved":false,"meetingNotes":null},
             "segments":[
              {"id":"s-0","sessionId":"s","status":"done","text":" Turn on "},
              {"id":"s-1","sessionId":"s","status":"done","text":"the lights."},
              {"id":"s-2","sessionId":"s","status":"pending","text":null}]}
            """
        let detail = try JSONDecoder().decode(RecordingDetail.self, from: Data(json.utf8))
        XCTAssertEqual(detail.transcript, "Turn on the lights.")
        XCTAssertEqual(TalkDraft.join(typed: "Please", heard: detail.transcript), "Please Turn on the lights.")
    }
}
