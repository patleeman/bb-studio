import XCTest
@testable import BBStudio

@MainActor
final class HoldToTalkTests: XCTestCase {
    func testTapDictatesInlineWhileIdle() {
        XCTAssertEqual(HoldToTalk.tapAction(for: .idle), .dictate)
        // Words are still landing: a tap does nothing rather than start over.
        XCTAssertEqual(HoldToTalk.tapAction(for: .sending), .none)
    }

    func testTapFinishesADictationOrHandsFreeTalkAndIgnoresAHold() {
        XCTAssertEqual(HoldToTalk.tapAction(for: .dictating), .finish)
        XCTAssertEqual(HoldToTalk.tapAction(for: .handsFree), .finish)
        XCTAssertEqual(HoldToTalk.tapAction(for: .recording), .none)
        XCTAssertEqual(HoldToTalk.tapAction(for: .cancelling), .none)
    }

    func testDictationGoesIntoTheDraftAndATalkIsSent() {
        XCTAssertEqual(HoldToTalk.delivery(for: .dictating), .insert)
        XCTAssertEqual(HoldToTalk.delivery(for: .recording), .send)
        XCTAssertEqual(HoldToTalk.delivery(for: .handsFree), .send)
    }

    func testInlineDictationStreamsAPlainHoldDoesNot() {
        XCTAssertTrue(HoldToTalk.streams(.dictating))
        XCTAssertFalse(HoldToTalk.streams(.recording))
        XCTAssertFalse(HoldToTalk.streams(.handsFree))
    }

    func testDictatingHoldsSendUntilTheWordsLand() {
        var state = DictationState()
        state.handle(DictationState.talk(.dictating))
        XCTAssertEqual(state.label, "Listening…")
        state.handle(DictationState.talk(.sending))
        XCTAssertEqual(state.label, "Transcribing…")
        XCTAssertTrue(state.blocksSend)
        state.handle(DictationState.talk(.idle))
        XCTAssertFalse(state.blocksSend)
    }

    func testTheFinishedTranscriptReplacesTheStreamedWords() {
        var typed: String? = "Note:"
        // The draft shows the streamed partial; the full transcript goes after what was typed.
        XCTAssertEqual(TalkDraft.finished("buy milk and eggs", typed: &typed, draft: "Note: buy milk"), "Note: buy milk and eggs")
        XCTAssertNil(typed)
        // Nothing was typed before: the draft as it was.
        XCTAssertEqual(TalkDraft.finished("hello", typed: &typed, draft: "draft"), "draft hello")
    }

    func testIdleStatesAndLostHoldStayIdle() {
        let talk = HoldToTalk(threadId: "thr_test")
        talk.holdLost()
        XCTAssertEqual(talk.state, .idle)
        XCTAssertFalse(talk.inline)
        // Ending with nothing going on does nothing.
        talk.end()
        XCTAssertEqual(talk.state, .idle)
    }
}
