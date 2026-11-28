import SwiftUI
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

/// The spot a transcript leaves for its rebuild is the reader's, however
/// the window changed it on the way out.
@MainActor
final class TranscriptSpotOnFoldTests: XCTestCase {
    /// On a fold the window resizes the old transcript before it goes: its
    /// header grows and its rows rewrap at the old offset. The spot was taken
    /// then, from that geometry: a row or so off the reader's (the Duo's fold
    /// test moved 22 to 36 pt).
    func testAFoldLeavesTheReadersSpotNotTheResizedOnes() async throws {
        let scene = try XCTUnwrap(UIApplication.shared.connectedScenes.compactMap { $0 as? UIWindowScene }.first)
        let window = UIWindow(windowScene: scene)
        window.frame = CGRect(x: 0, y: 0, width: 600, height: 700)
        defer { window.isHidden = true }
        let key = "thr_fold_\(UUID().uuidString)"
        let controller = TranscriptController()
        controller.spotKey = key
        controller.content = { id in
            AnyView(Text("\(id) " + String(repeating: "the transcript keeps its place ", count: 6)).frame(maxWidth: .infinity, alignment: .leading))
        }
        window.rootViewController = controller
        window.makeKeyAndVisible()
        controller.setRows((0..<60).map { AnyHashable("r\($0)") })
        await settle(window)
        controller.scrollTo("r20", position: .top)
        await settle(window)
        XCTAssertEqual(TranscriptReadingSpots.rebuilt(key)?.row, "r20")

        // The fold, on the transcript that is about to go.
        controller.setTop(AnyView(Color.clear.frame(height: 40)))
        window.frame.size.width = 420
        await settle(window)
        window.rootViewController = UIViewController()
        await settle(window)

        let spot = try XCTUnwrap(TranscriptReadingSpots.rebuilt(key))
        XCTAssertEqual(spot.row, "r20", "the reader's row")
        XCTAssertEqual(spot.distance, 0, accuracy: 0.5)
    }

    private func settle(_ window: UIWindow) async {
        for _ in 0..<10 {
            window.layoutIfNeeded()
            try? await Task.sleep(for: .milliseconds(16))
        }
    }
}
