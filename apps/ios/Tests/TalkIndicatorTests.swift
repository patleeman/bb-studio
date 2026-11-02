import XCTest
@testable import BBStudio

/// The composer's one indicator while you dictate or talk, and the voice clock it ticks on.
@MainActor
final class TalkIndicatorTests: XCTestCase {
    func testIdleHasNoPlaceholder() {
        XCTAssertNil(TalkIndicator.placeholder(HoldToTalk(threadId: nil)))
    }

    func testTheVoiceClockRunsOnlyWithSubscribers() {
        let clock = VoiceClock.shared
        let id = clock.subscribe {}
        XCTAssertTrue(clock.isRunning)
        clock.unsubscribe(id)
        XCTAssertFalse(clock.isRunning)
    }
}
