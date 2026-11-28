import XCTest
import SwiftUI
@testable import BBStudio

/// The UIKit transcript's scroll math.
final class TranscriptFollowTests: XCTestCase {
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

    func testFirstIndexEndingBelow() {
        let frames = (0..<10).map { CGRect(x: 0, y: CGFloat($0) * 100, width: 300, height: 90) }
        XCTAssertEqual(TranscriptGeometry.firstIndex(endingBelow: 250, frames: frames), 2, "r2 (200–290) crosses 250")
        XCTAssertEqual(TranscriptGeometry.firstIndex(endingBelow: 295, frames: frames), 3)
        XCTAssertNil(TranscriptGeometry.firstIndex(endingBelow: 2000, frames: frames))
    }

    @MainActor
    func testAppendedCountsOnlyRowsAfterTheOldEnd() {
        XCTAssertEqual(TranscriptController.appendedCount(old: ["a", "b"], new: ["z", "a", "b", "c", "d"]), 2)
        XCTAssertEqual(TranscriptController.appendedCount(old: ["a", "b"], new: ["z", "a", "b"]), 0, "A prepend isn't new")
        XCTAssertEqual(TranscriptController.appendedCount(old: [], new: ["a"]), 0)
    }

    @MainActor
    func testPrependedOnlyWhenRowsGoInAboveTheFirst() {
        XCTAssertTrue(TranscriptController.prepended(old: ["a", "b"], new: ["y", "z", "a", "b"]))
        XCTAssertFalse(TranscriptController.prepended(old: ["a", "b"], new: ["a", "b", "c"]), "An append isn't")
        XCTAssertFalse(TranscriptController.prepended(old: ["a", "b"], new: ["c", "d"]), "A newer page replacing them isn't")
        XCTAssertFalse(TranscriptController.prepended(old: [], new: ["a"]))
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

/// Older rows paged in at the top, on rows of known heights in a phone-sized
/// window: the row at the top of what the reader sees stays where it was,
/// whatever measures late.
@MainActor
final class TranscriptPrependTests: XCTestCase {
    private var heights: [String: CGFloat] = [:]
    private var window: UIWindow!
    private var controller: TranscriptController!

    override func setUp() async throws {
        let scene = try XCTUnwrap(UIApplication.shared.connectedScenes.compactMap { $0 as? UIWindowScene }.first)
        window = UIWindow(windowScene: scene)
        window.frame = CGRect(x: 0, y: 0, width: 402, height: 874)
        controller = TranscriptController()
        controller.content = { [unowned self] id in
            AnyView(Text("row").frame(maxWidth: .infinity).frame(height: self.heights[id as? String ?? ""] ?? 100))
        }
        window.rootViewController = controller
        window.makeKeyAndVisible()
        let rows = (0..<40).map { "r\($0)" }
        for id in rows { heights[id] = 100 }
        controller.setRows(rows.map(AnyHashable.init))
        await settle()
    }

    override func tearDown() async throws {
        window.isHidden = true
        window = nil
        controller = nil
    }

    /// A row is as tall as its content wherever it sits: under the header,
    /// in the middle, over the home indicator. A hosted cell used to take
    /// the safe area it overlapped as padding (r1 measured 162 pt under
    /// the 62 pt header), so rows changed height as they scrolled across
    /// either edge, and the replay's prepends moved the reader 34 pt.
    func testARowMeasuresTheSameUnderTheHeaderAndTheHomeIndicator() async throws {
        let view = try XCTUnwrap(controller.collectionView)
        // A phone has both; the Duo's screens may have only the top.
        XCTAssertGreaterThan(window.safeAreaInsets.top + window.safeAreaInsets.bottom, 0)
        assertRowsOnScreenAre(100, "at the end, over the home indicator")
        let r1 = try XCTUnwrap(controller.layout.frame(of: "r1"))
        controller.simulateReaderScroll(to: r1.midY - view.contentInset.top)
        await settle()
        assertRowsOnScreenAre(100, "at the top, r1 under the header")
    }

    /// A row above the reader's that changes height moves nothing the reader
    /// sees, at once: the layout's frames and the offset change together,
    /// with no layout pass between them left for later.
    func testARowAboveTheReaderResizesWithTheOffsetInTheSameTurn() async throws {
        let view = try XCTUnwrap(controller.collectionView)
        let r5 = try XCTUnwrap(controller.layout.frame(of: "r5"))
        controller.simulateReaderScroll(to: r5.minY + 30 - view.contentInset.top)
        await settle()
        let r6 = try XCTUnwrap(controller.layout.frame(of: "r6"))
        let before = r6.minY - view.contentOffset.y
        heights["r5"] = 134
        controller.reconfigure(["r5"])
        let now = try XCTUnwrap(controller.layout.frame(of: "r6"))
        XCTAssertEqual(now.minY - view.contentOffset.y, before, accuracy: 1, "r6 moved before the next layout pass")
        XCTAssertEqual(view.contentSize.height, controller.layout.collectionViewContentSize.height, accuracy: 0.5)
        await settle()
        let settled = try XCTUnwrap(controller.layout.frame(of: "r6"))
        XCTAssertEqual(controller.layout.frame(of: "r5")?.height ?? 0, 134, accuracy: 0.5)
        XCTAssertEqual(settled.minY - view.contentOffset.y, before, accuracy: 1, "r6 moved")
    }

    /// The race in the replay's paging (it failed about half its runs, all
    /// of them under load): the reader's drag leaves them on r2, with r1
    /// across the top edge. r1 then measures shorter and grows upward, so
    /// it's whole at the top: the row a prepend keeps. A page goes in, and r1
    /// measures again after the restore (here it changes in the same update;
    /// in the replay a recycled cell's stale measure was corrected a turn
    /// late). r1 used to grow upward, as a row above the drag's row, and
    /// moved by its change in height: 34 pt in the replay.
    func testAPrependHoldsTheRowItKeepsThroughItsLateMeasure() async throws {
        let view = try XCTUnwrap(controller.collectionView)
        let r1 = try XCTUnwrap(controller.layout.frame(of: "r1"))
        controller.simulateReaderScroll(to: r1.minY + 30 - view.contentInset.top)
        await settle()
        heights["r1"] = 20
        controller.reconfigure(["r1"])
        await settle()
        let top = view.contentOffset.y + view.contentInset.top
        let shrunk = try XCTUnwrap(controller.layout.frame(of: "r1"))
        XCTAssertEqual(shrunk.height, 20, accuracy: 0.5)
        XCTAssertGreaterThanOrEqual(shrunk.minY, top - 0.5, "r1 is whole at the top: the row a prepend keeps")
        let before = shrunk.minY - view.contentOffset.y

        let older = (0..<30).map { "o\($0)" }
        for id in older { heights[id] = 100 }
        heights["r1"] = 54
        controller.setRows(older.map(AnyHashable.init) + controller.ids, changed: ["r1"])
        await settle()

        let after = try XCTUnwrap(controller.layout.frame(of: "r1"))
        XCTAssertEqual(after.height, 54, accuracy: 0.5)
        XCTAssertEqual(after.minY - view.contentOffset.y, before, accuracy: 1, "the kept row moved")
        XCTAssertFalse(controller.atEnd)
    }

    /// A page of rows estimated far from their real heights goes in, and
    /// they measure as they come near: the kept row never moves.
    func testAPrependOfMisestimatedRowsHoldsTheTopRow() async throws {
        let view = try XCTUnwrap(controller.collectionView)
        controller.simulateReaderScroll(to: 40 - view.contentInset.top)
        await settle()
        let top = view.contentOffset.y + view.contentInset.top
        let index = try XCTUnwrap(controller.layout.frames.firstIndex { $0.minY >= top - 0.5 })
        let kept = controller.layout.ids[index]
        let before = controller.layout.frames[index].minY - view.contentOffset.y

        let older = (0..<30).map { "o\($0)" }
        for (index, id) in older.enumerated() { heights[id] = index % 2 == 0 ? 30 : 260 }
        controller.setRows(older.map(AnyHashable.init) + controller.ids)
        XCTAssertNil(view.cellForItem(at: IndexPath(item: 0, section: 0)), "a cell laid out at the old offset, among the new rows")
        await settle()

        let after = try XCTUnwrap(controller.layout.frame(of: kept))
        XCTAssertEqual(after.minY - view.contentOffset.y, before, accuracy: 1, "the kept row moved")
        XCTAssertTrue(controller.misfitRows().isEmpty, "every row on screen measured")
    }

    private func assertRowsOnScreenAre(_ height: CGFloat, _ where: String, line: UInt = #line) {
        let view = controller.collectionView!
        let shown = view.indexPathsForVisibleItems.map(\.item).sorted()
        XCTAssertFalse(shown.isEmpty, line: line)
        for item in shown {
            XCTAssertEqual(controller.layout.frames[item].height, height, accuracy: 0.5,
                           "\(controller.layout.ids[item]) \(`where`)", line: line)
        }
    }

    /// Lets layout and self-sizing run out.
    private func settle() async {
        for _ in 0..<10 {
            window.layoutIfNeeded()
            try? await Task.sleep(for: .milliseconds(16))
        }
    }
}
