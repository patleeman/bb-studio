import UIKit
import XCTest
@testable import BBStudio

@MainActor
final class DictationGateTests: XCTestCase {
    private func state(_ events: DictationState.Event...) -> DictationState {
        var state = DictationState()
        events.forEach { state.handle($0) }
        return state
    }

    func testIdleLetsSend() {
        XCTAssertFalse(DictationState().blocksSend)
        XCTAssertNil(DictationState().label)
    }

    func testListeningAndTranscribingBlockUntilInserted() {
        let listening = state(.listening(.sheet))
        XCTAssertTrue(listening.blocksSend)
        XCTAssertEqual(listening.label, "Listening…")

        let transcribing = state(.listening(.sheet), .transcribing(.sheet))
        XCTAssertTrue(transcribing.blocksSend)
        XCTAssertEqual(transcribing.label, "Transcribing…")

        XCTAssertFalse(state(.listening(.sheet), .transcribing(.sheet), .inserted(.sheet)).blocksSend)
    }

    func testErrorAndCancelAlwaysReset() {
        XCTAssertFalse(state(.listening(.sheet), .failed(.sheet)).blocksSend)
        XCTAssertFalse(state(.listening(.sheet), .transcribing(.sheet), .failed(.sheet)).blocksSend)
        XCTAssertFalse(state(.listening(.sheet), .cancelled(.sheet)).blocksSend)
        XCTAssertFalse(state(.listening(.sheet), .transcribing(.sheet), .cancelled(.sheet)).blocksSend)
    }

    func testSourcesAreTrackedApart() {
        // A talk finishing while the dictation sheet listens must not free Send.
        let both = state(.transcribing(.talk), .listening(.sheet), .inserted(.talk))
        XCTAssertTrue(both.blocksSend)
        XCTAssertEqual(both.label, "Listening…")
        // Someone still talking shows over a transcript on its way.
        XCTAssertEqual(state(.transcribing(.talk), .listening(.keyboard)).label, "Listening…")
    }

    func testRecorderPhasesMapToEvents() {
        XCTAssertEqual(DictationState.sheet(.recording), .listening(.sheet))
        XCTAssertEqual(DictationState.sheet(.finishing), .transcribing(.sheet))
        XCTAssertEqual(DictationState.sheet(.failed("No microphone")), .failed(.sheet))
        XCTAssertNil(DictationState.sheet(.done))
        XCTAssertNil(DictationState.sheet(.idle))
    }

    func testHoldToTalkStatesMapToEvents() {
        XCTAssertEqual(DictationState.talk(.recording), .listening(.talk))
        XCTAssertEqual(DictationState.talk(.handsFree), .listening(.talk))
        XCTAssertEqual(DictationState.talk(.cancelling), .listening(.talk))
        XCTAssertEqual(DictationState.talk(.sending), .transcribing(.talk))
        XCTAssertEqual(DictationState.talk(.idle), .inserted(.talk))
        XCTAssertFalse(state(DictationState.talk(.recording), DictationState.talk(.sending), DictationState.talk(.idle)).blocksSend)
    }

    func testKeyboardDictationWaitsForItsResult() {
        let recording = state(.listening(.keyboard))
        XCTAssertEqual(recording.label, "Listening…")
        // Recording ended: blocked until the result changes the text.
        let ended = state(.listening(.keyboard), .transcribing(.keyboard))
        XCTAssertEqual(ended.label, "Transcribing…")
        XCTAssertFalse(state(.listening(.keyboard), .transcribing(.keyboard), .edited).blocksSend)
        // Or until the keyboard leaves dictation.
        XCTAssertFalse(state(.listening(.keyboard), .transcribing(.keyboard), .inserted(.keyboard)).blocksSend)
        // Live text while still listening doesn't end it.
        XCTAssertTrue(state(.listening(.keyboard), .edited).blocksSend)
    }

    func testKeyboardRecordingEndWithoutDictationIsIgnored() {
        XCTAssertFalse(state(.transcribing(.keyboard)).blocksSend)
    }

    func testKeyboardPlaceholdersBlockUntilRemoved() {
        let pending = state(.placeholderAdded)
        XCTAssertEqual(pending.label, "Transcribing…")
        // Leaving dictation mode doesn't drop a result still on its way.
        XCTAssertTrue(state(.listening(.keyboard), .placeholderAdded, .inserted(.keyboard)).blocksSend)
        XCTAssertFalse(state(.placeholderAdded, .placeholderRemoved).blocksSend)
        XCTAssertFalse(state(.placeholderRemoved).blocksSend)
        // Failure or losing focus clears everything the keyboard had pending.
        XCTAssertFalse(state(.listening(.keyboard), .placeholderAdded, .placeholderAdded, .failed(.keyboard)).blocksSend)
        XCTAssertFalse(state(.placeholderAdded, .cancelled(.keyboard)).blocksSend)
    }

    func testGatePublishesOnlyChanges() {
        let gate = DictationGate()
        var published = 0
        let watch = gate.$state.dropFirst().sink { _ in published += 1 }
        gate.handle(.listening(.sheet))
        gate.handle(.listening(.sheet))
        XCTAssertTrue(gate.blocksSend)
        gate.handle(.cancelled(.sheet))
        XCTAssertFalse(gate.blocksSend)
        XCTAssertEqual(published, 2)
        watch.cancel()
    }

    func testComposerFieldReportsKeyboardDictation() {
        let view = PastingTextView()
        var events: [DictationState.Event] = []
        view.onDictation = { events.append($0) }
        view.dictationRecordingDidEnd()
        view.dictationRecognitionFailed()
        // UITextView's own placeholder still runs under ours.
        let placeholder = view.insertDictationResultPlaceholder
        view.removeDictationResultPlaceholder(placeholder, willInsertResult: false)
        XCTAssertEqual(events, [.transcribing(.keyboard), .failed(.keyboard), .placeholderAdded, .placeholderRemoved])
    }
}
