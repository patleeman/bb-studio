import XCTest
@testable import BBStudio

/// A transcript rebuilt in place (the Duo folding, the window resizing)
/// opens at the reading spot of the one it replaces; one opened afresh
/// doesn't.
@MainActor
final class TranscriptReadingSpotsTests: XCTestCase {
    private func key() -> String { "thr_spot_\(UUID().uuidString)" }
    private let reading = TranscriptReadingSpots.Spot(row: AnyHashable("m42"), distance: 12, unseen: 3)

    func testANewTranscriptForAConversationStillShowingOpensAtItsSpot() {
        let key = key()
        TranscriptReadingSpots.appeared(key)
        TranscriptReadingSpots.save(reading, for: key)
        XCTAssertEqual(TranscriptReadingSpots.rebuilt(key), reading)
    }

    func testOneJustGoneCountsAsARebuild() {
        let key = key()
        TranscriptReadingSpots.appeared(key)
        TranscriptReadingSpots.save(reading, for: key)
        TranscriptReadingSpots.disappeared(key, now: 100)
        XCTAssertEqual(TranscriptReadingSpots.rebuilt(key, now: 101), reading)
        XCTAssertNil(TranscriptReadingSpots.rebuilt(key, now: 100 + TranscriptReadingSpots.rebuildWindow + 0.1),
                     "opened again later: the end, as any reopen")
    }

    func testNeverShownOrAtTheEndOpensAtTheEnd() {
        let key = key()
        TranscriptReadingSpots.save(reading, for: key)
        XCTAssertNil(TranscriptReadingSpots.rebuilt(key), "not shown before")
        TranscriptReadingSpots.appeared(key)
        TranscriptReadingSpots.save(nil, for: key)
        XCTAssertNil(TranscriptReadingSpots.rebuilt(key), "at the end: nothing to restore")
    }
}
