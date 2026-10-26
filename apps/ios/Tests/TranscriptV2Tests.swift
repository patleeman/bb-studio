import XCTest
@testable import BBStudio

/// The UIKit transcript's follow state machine and anchor math.
final class TranscriptFollowTests: XCTestCase {
    func testOnlyTheReadersRestAndTheJumpChangeFollowing() {
        var follow = TranscriptFollow()
        XCTAssertEqual(follow.mode, .following)
        follow.handle(.appended(3))
        XCTAssertEqual(follow.mode, .following, "New rows don't change it")
        XCTAssertEqual(follow.unseen, 0, "Following sees every row")
        follow.handle(.readerScrollEnded(nearEnd: false))
        XCTAssertEqual(follow.mode, .reading)
        follow.handle(.appended(2))
        follow.handle(.appended(1))
        XCTAssertEqual(follow.unseen, 3, "Rows that came in while reading count for the pill")
        follow.handle(.readerScrollEnded(nearEnd: true))
        XCTAssertEqual(follow.mode, .following)
        XCTAssertEqual(follow.unseen, 0)
        follow.handle(.readRow)
        XCTAssertEqual(follow.mode, .reading)
        XCTAssertTrue(follow.handle(.jumpToLatest))
        XCTAssertEqual(follow.mode, .following)
        XCTAssertFalse(follow.handle(.jumpToLatest), "No change, no notice")
    }

    func testMaxOffsetKeepsAShortChatAtTheTop() {
        // 300 pt of rows in a 600 pt view under an 80 pt header: rests at the top, no gap above.
        XCTAssertEqual(TranscriptGeometry.maxOffset(contentHeight: 300, boundsHeight: 600, topInset: 80, bottomInset: 100), -80)
        // A long chat: its end just above the composer.
        XCTAssertEqual(TranscriptGeometry.maxOffset(contentHeight: 2000, boundsHeight: 600, topInset: 80, bottomInset: 100), 1500)
    }

    func testClampNeverRestsPastTheEnd() {
        XCTAssertEqual(TranscriptGeometry.clamp(1800, contentHeight: 2000, boundsHeight: 600, topInset: 80, bottomInset: 100), 1500)
        XCTAssertEqual(TranscriptGeometry.clamp(-300, contentHeight: 2000, boundsHeight: 600, topInset: 80, bottomInset: 100), -80)
        XCTAssertEqual(TranscriptGeometry.clamp(.nan, contentHeight: 2000, boundsHeight: 600, topInset: 80, bottomInset: 100), 1500)
    }

    func testDistanceToEndIsNegativePastTheEnd() {
        XCTAssertEqual(TranscriptGeometry.distanceToEnd(offset: 1500, contentHeight: 2000, boundsHeight: 600, bottomInset: 100), 0)
        XCTAssertEqual(TranscriptGeometry.distanceToEnd(offset: 1700, contentHeight: 2000, boundsHeight: 600, bottomInset: 100), -200)
    }

    func testReadingAnchorIsTheFirstRowEndingBelowTheTop() {
        let frames = (0..<10).map { CGRect(x: 0, y: CGFloat($0) * 100, width: 300, height: 90) }
        let ids = (0..<10).map { "r\($0)" }
        let anchor = TranscriptGeometry.readingAnchor(ids: ids, frames: frames, offset: 170, topInset: 80)
        // The view's top is at 250: r2 (200–290) crosses it, so r3, 50 pt below the top, is the anchor.
        XCTAssertEqual(anchor?.id, "r3")
        XCTAssertEqual(anchor?.distance, 50)
        // A row that starts right at the top is the anchor itself.
        XCTAssertEqual(TranscriptGeometry.readingAnchor(ids: ids, frames: frames, offset: 220, topInset: 80)?.id, "r3")
        // After 3 rows of 100 pt go in above, the same distance puts r3 where it was.
        XCTAssertEqual(TranscriptGeometry.offset(restoring: 50, rowTop: 600, topInset: 80), 470)
    }

    @MainActor
    func testAppendedCountsOnlyRowsAfterTheOldEnd() {
        XCTAssertEqual(TranscriptController.appendedCount(old: ["a", "b"], new: ["z", "a", "b", "c", "d"]), 2)
        XCTAssertEqual(TranscriptController.appendedCount(old: ["a", "b"], new: ["z", "a", "b"]), 0, "A prepend isn't new")
        XCTAssertEqual(TranscriptController.appendedCount(old: [], new: ["a"]), 0)
    }
}

/// The replay harness on synthetic rows, in a window of each layout's size,
/// with a simulated keyboard. The gate for the UIKit transcript.
@MainActor
final class TranscriptReplayTests: XCTestCase {
    private func replay(_ layout: TranscriptReplay.Layout) async throws -> TranscriptReplay.Report {
        let scene = try XCTUnwrap(UIApplication.shared.connectedScenes.compactMap { $0 as? UIWindowScene }.first)
        let window = UIWindow(windowScene: scene)
        defer { window.isHidden = true }
        let report = await TranscriptReplay(window: window, layout: layout).run()
        print("TRANSCRIPT-REPLAY " + report.summary)
        for step in report.steps {
            print(String(format: "TRANSCRIPT-STEP %@ | %@ | past=%.2f follow=%@ drift=%@ gap=%.2f layouts=%d writes=%d insets=%d rest=%d/%d %@",
                report.layout, step.name, step.pastEnd, step.followGap.map { String(format: "%.2f", $0) } ?? "-",
                step.anchorDrift.map { String(format: "%.2f", $0) } ?? "-", step.composerGapError, step.layouts,
                step.offsetWrites, step.insetWrites, step.restLayouts, step.restWrites, step.failures.joined(separator: "; ")))
        }
        if let dir = ProcessInfo.processInfo.environment["TRANSCRIPT_REPORT_DIR"],
           let data = try? JSONEncoder().encode(report.steps) {
            try? data.write(to: URL(fileURLWithPath: dir).appending(path: "replay-\(layout.name).json"))
        }
        return report
    }

    func testReplayOnAPhone() async throws {
        let report = try await replay(.phone)
        XCTAssertEqual(report.failures, [], report.summary)
    }

    func testReplayOnTheDuoOuterScreen() async throws {
        let report = try await replay(.duoOuter)
        XCTAssertEqual(report.failures, [], report.summary)
    }

    func testReplayOnTheDuoInnerScreen() async throws {
        let report = try await replay(.duoInner)
        XCTAssertEqual(report.failures, [], report.summary)
    }
}
