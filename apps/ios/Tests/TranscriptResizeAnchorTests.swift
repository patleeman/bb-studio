import XCTest
@testable import BBStudio

@MainActor
final class TranscriptResizeAnchorTests: XCTestCase {
    private func viewport(_ width: CGFloat, height: CGFloat = 600, offset: CGFloat = 200, gap: CGFloat = 800) -> TranscriptResizeAnchor.Viewport {
        .init(size: CGSize(width: width, height: height), offset: offset, inset: 80, bottomGap: gap)
    }

    func testOnlyWidthChangesRequestRestoreAndKeepOldOffset() {
        let keeper = TranscriptResizeAnchor()
        XCTAssertNil(keeper.update(viewport(466)))
        keeper.measure("m1", row: .init(width: 466, frame: CGRect(x: 0, y: -20, width: 466, height: 90)))
        XCTAssertNil(keeper.update(viewport(466, height: 300))) // Keyboard.
        XCTAssertNil(keeper.update(viewport(466, offset: 400))) // Reading.
        // New row geometry can arrive before the viewport's width callback.
        keeper.measure("m1", row: .init(width: 459.5, frame: CGRect(x: 0, y: 200, width: 459.5, height: 100)))
        XCTAssertEqual(keeper.update(viewport(459.5)), .message("m1", offset: -20))
        XCTAssertEqual(keeper.correction(for: "m1", offset: -20), 500)
    }

    func testBottomPinAndUserCancellation() {
        let keeper = TranscriptResizeAnchor()
        _ = keeper.update(viewport(466, gap: 0))
        XCTAssertEqual(keeper.update(viewport(951, gap: 500)), .bottom)
        XCTAssertTrue(keeper.restoring)
        let token = keeper.generation
        keeper.cancel()
        XCTAssertFalse(keeper.restoring)
        XCTAssertNotEqual(keeper.generation, token)
        keeper.finish(token) // A cancelled task cannot finish a newer restore.
        XCTAssertFalse(keeper.restoring)
    }
}
