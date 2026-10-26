import XCTest
@testable import BBStudio

final class DuoLayoutTests: XCTestCase {
    func testWindowDecisions() {
        for (size, split) in [
            (CGSize(width: 466, height: 678), false),
            (CGSize(width: 669, height: 951), false),
            (CGSize(width: 951, height: 669), true),
            (CGSize(width: 899, height: 669), false),
            (CGSize(width: 900, height: 669), true),
            (CGSize(width: 1024, height: 1366), false),
            (CGSize(width: 1366, height: 1024), true),
            (CGSize(width: 900, height: 900), false),
            (CGSize(width: 678, height: 466), false),
        ] {
            XCTAssertEqual(DuoLayout(size: size).twoPages, split, "\(size)")
        }
    }

    func testGutterCentersOnWindowIncludingAsymmetricSafeArea() {
        for leading: CGFloat in [0, 24, 84] {
            let layout = DuoLayout(size: CGSize(width: 951, height: 669), leadingInset: leading)
            XCTAssertEqual(leading + layout.railWidth + layout.listWidth + DuoLayout.gutter / 2, 475.5)
        }
        let portrait = DuoLayout(size: CGSize(width: 669, height: 951))
        XCTAssertEqual(portrait.railWidth, 0)
        XCTAssertEqual(portrait.listWidth, 0)
    }

    func testPaneWidthsAndSnapPoints() {
        let size = CGSize(width: 951, height: 669)
        let even = DuoLayout(size: size, trailingInset: 84)
        XCTAssertEqual(even.listWidth, 395.5)
        XCTAssertEqual(DuoLayout(size: size, pane: .narrow).listWidth, 300)
        let hidden = DuoLayout(size: size, pane: .hidden)
        XCTAssertEqual(hidden.listWidth, 0)
        XCTAssertEqual(hidden.gutterWidth, 0, "No divider with the list hidden")
        XCTAssertFalse(hidden.showsList)
        // A drag previews under the finger, with a little give past even;
        // the list keeps its width until the drag ends.
        let dragged = DuoLayout(size: size, dragWidth: 500)
        XCTAssertEqual(dragged.dragTarget, 419.5)
        XCTAssertEqual(dragged.listWidth, 395.5)
        XCTAssertEqual(DuoLayout(size: size, pane: .hidden, dragWidth: -20).dragTarget, 0)
        for (width, pane) in [(0, DuoPane.hidden), (140, .hidden), (160, .narrow), (340, .narrow), (360, .even), (440, .even)] as [(CGFloat, DuoPane)] {
            XCTAssertEqual(even.snap(width), pane, "\(width)")
        }
        // One page: no list at any choice.
        XCTAssertEqual(DuoLayout(size: CGSize(width: 466, height: 678), pane: .narrow).listWidth, 0)
    }

    func testTranscriptClearsTheStatusColumnOnlyAsFarAsItMust() {
        XCTAssertEqual(RegularScrollingSurface.inset(column: 84, width: 459.5, readableWidth: 760), 84)
        XCTAssertEqual(RegularScrollingSurface.inset(column: 84, width: 887, readableWidth: 760), 20.5)
        XCTAssertEqual(RegularScrollingSurface.inset(column: 84, width: 1200, readableWidth: 760), 0)
        XCTAssertEqual(RegularScrollingSurface.inset(column: 84, width: 887, readableWidth: nil), 84)
        XCTAssertEqual(RegularScrollingSurface.inset(column: 0, width: 459.5, readableWidth: 760), 0)
    }

    @MainActor
    func testResizeDoesNotChangeSelectedRouteOrStoredDraft() {
        let app = AppModel.shared
        let previousPath = app.path
        let previousTab = app.tab
        let id = "duo-retention-\(UUID())"
        defer {
            app.path = previousPath
            app.tab = previousTab
            Drafts.save(id, text: "", mentions: [], serverURL: app.serverURL)
        }
        app.openThread(id)
        Drafts.save(id, text: "Keep this unsent draft", mentions: [], serverURL: app.serverURL)
        for size in [CGSize(width: 466, height: 678), CGSize(width: 951, height: 669), CGSize(width: 669, height: 951)] {
            _ = DuoLayout(size: size)
            XCTAssertEqual(app.path, [.thread(id: id)])
            XCTAssertEqual(Drafts.load(id, serverURL: app.serverURL)?.text, "Keep this unsent draft")
        }
    }
}
