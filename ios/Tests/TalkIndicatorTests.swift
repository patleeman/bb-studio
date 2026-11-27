import XCTest
@testable import BBStudio

/// The composer's one indicator while you dictate or talk, and the voice clock it ticks on.
@MainActor
final class TalkIndicatorTests: XCTestCase {
    func testIdleHasNoPlaceholder() {
        XCTAssertNil(TalkIndicator.placeholder(HoldToTalk(threadId: nil)))
    }

    /// Its own clock: the shared one runs only while the app is active, which
    /// depends on what ran before in the test host.
    func testTheVoiceClockRunsOnlyWithSubscribers() {
        let clock = VoiceClock(active: true)
        let id = clock.subscribe {}
        XCTAssertTrue(clock.isRunning)
        clock.unsubscribe(id)
        XCTAssertFalse(clock.isRunning)
    }

    func testTheVoiceClockWaitsWhileTheAppIsInactive() {
        let clock = VoiceClock(active: false)
        let id = clock.subscribe {}
        XCTAssertFalse(clock.isRunning, "no ticks in the background")
        NotificationCenter.default.post(name: UIApplication.didBecomeActiveNotification, object: nil)
        XCTAssertTrue(clock.isRunning, "and it starts when the app comes back")
        clock.unsubscribe(id)
        XCTAssertFalse(clock.isRunning)
    }
}
