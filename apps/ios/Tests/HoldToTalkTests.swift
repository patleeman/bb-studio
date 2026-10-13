import XCTest
@testable import BBStudio

@MainActor
final class HoldToTalkTests: XCTestCase {
    func testTapDictatesWhileIdleOrTranscribing() {
        XCTAssertEqual(HoldToTalk.tapAction(for: .idle), .dictate)
        // The mic looks idle while a talk transcribes; a tap must still work.
        XCTAssertEqual(HoldToTalk.tapAction(for: .sending), .dictate)
    }

    func testTapSendsHandsFreeAndIgnoresHold() {
        XCTAssertEqual(HoldToTalk.tapAction(for: .handsFree), .send)
        XCTAssertEqual(HoldToTalk.tapAction(for: .recording), .none)
        XCTAssertEqual(HoldToTalk.tapAction(for: .cancelling), .none)
    }

    func testIdleTapOpensDictationAndLostHoldStaysIdle() {
        let talk = HoldToTalk(threadId: "thr_test")
        var dictated = 0
        talk.tap { dictated += 1 }
        XCTAssertEqual(dictated, 1)
        talk.holdLost()
        XCTAssertEqual(talk.state, .idle)
        talk.tap { dictated += 1 }
        XCTAssertEqual(dictated, 2)
    }
}
