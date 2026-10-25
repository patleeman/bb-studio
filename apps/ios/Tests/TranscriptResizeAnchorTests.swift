import XCTest
@testable import BBStudio

@MainActor
final class TranscriptResizeAnchorTests: XCTestCase {
    private func viewport(_ width: CGFloat, height: CGFloat = 600, offset: CGFloat = 200, gap: CGFloat = 800) -> TranscriptResizeAnchor.Viewport {
        .init(size: CGSize(width: width, height: height), offset: offset, inset: 80, bottomGap: gap, contentHeight: 2000)
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

    func testTransientEmptyVisibilityKeepsLastReadingMessage() {
        let keeper = TranscriptResizeAnchor()
        _ = keeper.update(viewport(466))
        keeper.visible(["reading"])
        keeper.measure("reading", row: .init(width: 466, frame: CGRect(x: 0, y: 100, width: 466, height: 100)))
        keeper.visible([])
        keeper.forget("reading")
        XCTAssertEqual(keeper.update(viewport(951)), .message("reading", offset: 100))
    }

    func testRejectsStaleCorrectionOutsideContent() {
        let keeper = TranscriptResizeAnchor()
        _ = keeper.update(viewport(466))
        keeper.measure("m1", row: .init(width: 466, frame: CGRect(x: 0, y: 9000, width: 466, height: 100)))
        XCTAssertNil(keeper.correction(for: "m1", offset: 0), "A lazy row estimate must never send the viewport beyond content")
        keeper.measure("m2", row: .init(width: 466, frame: CGRect(x: 0, y: -9000, width: 466, height: 100)))
        XCTAssertNil(keeper.correction(for: "m2", offset: 0))
    }

    func testOffscreenMeasurementsDoNotBecomeReadingAnchor() {
        let keeper = TranscriptResizeAnchor()
        _ = keeper.update(viewport(466))
        keeper.measure("old", row: .init(width: 466, frame: CGRect(x: 0, y: 9000, width: 466, height: 100)))
        XCTAssertEqual(keeper.update(viewport(951)), .bottom, "Without a valid visible message, fall back to the bottom")
    }

    func testDisappearedLazyRowCannotReplaceTheVisibleReadingAnchor() {
        let keeper = TranscriptResizeAnchor()
        _ = keeper.update(viewport(466))
        keeper.measure("old", row: .init(width: 466, frame: CGRect(x: 0, y: -20, width: 466, height: 100)))
        keeper.measure("reading", row: .init(width: 466, frame: CGRect(x: 0, y: 100, width: 466, height: 100)))
        keeper.forget("old")
        XCTAssertEqual(keeper.update(viewport(951)), .message("reading", offset: 100))
    }

    func testNewestVisibleMessageUsesExistingBottomPinTolerance() {
        let keeper = TranscriptResizeAnchor()
        _ = keeper.update(viewport(466, gap: 80))
        XCTAssertEqual(keeper.update(viewport(951, gap: 500)), .bottom)
    }

    func testSemanticAlignmentForLongMessageAndStrictContentEnd() {
        let keeper = TranscriptResizeAnchor()
        _ = keeper.update(viewport(466))
        keeper.frame = CGRect(x: 0, y: 32, width: 466, height: 600)
        keeper.measure("long", row: .init(width: 466, frame: CGRect(x: 0, y: -300, width: 466, height: 1400)))
        XCTAssertEqual(keeper.alignment(for: "long", offset: -300)!, 0.415, accuracy: 0.001)
        keeper.measure("past", row: .init(width: 466, frame: CGRect(x: 0, y: 1200, width: 466, height: 100)))
        XCTAssertNil(keeper.correction(for: "past", offset: 0), "Insets must not extend the valid point range beyond the actual content end")
    }

    func testVisibilityReportExcludesCachedGhostRows() {
        let keeper = TranscriptResizeAnchor()
        _ = keeper.update(viewport(466))
        keeper.measure("ghost", row: .init(width: 466, frame: CGRect(x: 0, y: 1, width: 466, height: 100)))
        keeper.measure("reading", row: .init(width: 466, frame: CGRect(x: 0, y: 120, width: 466, height: 100)))
        keeper.visible(["reading"])
        XCTAssertEqual(keeper.update(viewport(951)), .message("reading", offset: 120))
    }

    func testShortContentIsNotMistakenForOverscrollAndAnyOvershootIsDetected() {
        XCTAssertEqual(TranscriptResizeAnchor.overshoot(contentHeight: 100, viewportHeight: 500, visibleBottom: 500), 0)
        XCTAssertEqual(TranscriptResizeAnchor.overshoot(contentHeight: 2000, viewportHeight: 500, visibleBottom: 2700), 700)
        // Part of the viewport past the end is still blank: the keyboard closed.
        XCTAssertEqual(TranscriptResizeAnchor.overshoot(contentHeight: 2000, viewportHeight: 500, visibleBottom: 2200), 200)
        XCTAssertEqual(TranscriptResizeAnchor.overshoot(contentHeight: 2000, viewportHeight: 500, visibleBottom: 1990), 0)
    }

    func testTheLastPointPutsTheLastRowAtTheViewportBottom() {
        XCTAssertEqual(TranscriptResizeAnchor.lastPoint(contentHeight: 2933, viewportHeight: 438), 2495)
        XCTAssertEqual(TranscriptResizeAnchor.lastPoint(contentHeight: 300, viewportHeight: 438), 0)
    }

    func testToolOrDayRowsDoNotReplaceTheVisibleMessageAnchor() {
        let keeper = TranscriptResizeAnchor()
        _ = keeper.update(viewport(466))
        keeper.measure("tool", row: .init(width: 466, frame: CGRect(x: 0, y: 80, width: 466, height: 30), isMessage: false))
        keeper.measure("reply", row: .init(width: 466, frame: CGRect(x: 0, y: 130, width: 466, height: 100)))
        XCTAssertEqual(keeper.update(viewport(951)), .message("reply", offset: 130))
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
