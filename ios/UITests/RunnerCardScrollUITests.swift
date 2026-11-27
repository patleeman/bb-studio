import XCTest

/// Home's list of conversations with their workers and runners: on a phone,
/// and on the Duo's inner screen (Home brought back on the book's left page). It
/// scrolls in one scroll view with one indicator at its edge. No scroll view
/// nests inside it, so no second indicator is drawn over a row. Offline, on
/// the local Bot demo. See docs/ios/runner-card-scroll.
///
/// `TEST_RUNNER_RUNNERS_LAYOUT`: `phone` (default, an iPhone) or `split`
/// (the iPhone Duo inner screen, two pages). `TEST_RUNNER_RUNNERS_SHOTS=<dir>`
/// saves the screen while the list scrolls.
@MainActor
final class RunnerCardScrollUITests: ServerIsolatedUITestCase {
    private let app = XCUIApplication()
    private let layout = ProcessInfo.processInfo.environment["RUNNERS_LAYOUT"] ?? "phone"

    func testRunnersScrollInOneScrollView() throws {
        app.launchArguments = ["-skipPushPrompt", "YES", "-qaBotDemo", layout == "split" ? "duo" : "chat",
            "-qaDark", "-openURL", "bbstudio://bot"]
            + (layout == "split" ? ["-qaDuoPhone", "-qaDuoColdWide", "-qaDuoWideTitles"] : [])
        app.launchOffline()
        XCTAssertTrue(app.otherElements["threadComposer"].firstMatch.waitForExistence(timeout: 30))
        app.openRoomPlace("conversations")
        let runner = app.buttons.matching(NSPredicate(format: "identifier BEGINSWITH 'homeWorker-'")).firstMatch
        XCTAssertTrue(runner.waitForExistence(timeout: 15), "a worker's row shows")
        Thread.sleep(forTimeInterval: 1)
        let list = try XCTUnwrap(listScroll(containing: runner.frame), "the list's scroll view")
        print("RUNNERS \(layout) list=\(list.frame) runner=\(runner.frame)")
        // Scroll it a little, so any indicator shows.
        let start = app.coordinate(withNormalizedOffset: .zero).withOffset(CGVector(dx: runner.frame.midX, dy: runner.frame.midY))
        start.press(forDuration: 0.1, thenDragTo: start.withOffset(CGVector(dx: 0, dy: -60)), withVelocity: .slow, thenHoldForDuration: 0.2)
        shot("scrolling")
        command("capture?runner-card-\(layout)")

        // Every vertical scroll view inside the list's frame, other than the list itself.
        let geometry = try layoutGeometry()
        for scroll in geometry.scrolls where scroll.indicator && scroll.width > 20 {
            print("RUNNERS \(layout) scroll=\(scroll.frame) content=\(scroll.contentHeight) adjustedRight=\(scroll.adjustedRight) indicatorRight=\(scroll.indicatorRight) safeRight=\(scroll.safeRight) indicators=\(scroll.indicators.map(\.frame))")
        }
        let nested = geometry.scrolls.filter { scroll in
            scroll.frame != list.frame && list.frame.insetBy(dx: -1, dy: -1).contains(scroll.frame)
                && scroll.frame.width > 0 && scroll.frame.height > 0
                && scroll.indicator && scroll.contentHeight > scroll.frame.height + 1
        }
        for scroll in nested { print("RUNNERS \(layout) nested=\(scroll.frame) content=\(scroll.contentHeight)") }
        XCTAssertTrue(nested.isEmpty, "\(layout): a vertical scroll view nests inside the runners list: \(nested.map(\.frame))")
        // The list's own indicator sits at its trailing edge, past the rows'
        // text ("next 12:05 PM"), not inset by a safe area it doesn't touch.
        let mine = try XCTUnwrap(geometry.scrolls.first { $0.frame == list.frame }, "\(layout): the list after scrolling")
        let indicator = try XCTUnwrap(mine.indicators.map(\.frame).first { $0.height > $0.width }, "\(layout): the list's vertical indicator")
        let trailing = runner.frame.maxX
        print("RUNNERS \(layout) indicator=\(indicator) listMaxX=\(list.frame.maxX) rowsMaxX=\(trailing)")
        XCTAssertGreaterThanOrEqual(indicator.minX, trailing - 1,
                                    "\(layout): the list's indicator is drawn over the rows, \(list.frame.maxX - indicator.maxX) points in from its edge")
    }

    /// The scroll view that holds the runner rows: the smallest one around them.
    private func listScroll(containing row: CGRect) throws -> Scroll? {
        try layoutGeometry().scrolls
            .filter { $0.frame.contains(CGPoint(x: row.midX, y: row.midY)) && $0.contentHeight > 0 }
            .max { $0.frame.minY < $1.frame.minY }
    }

    private func layoutGeometry() throws -> Geometry {
        command("layout")
        let value = try XCTUnwrap(app.windows.firstMatch.value as? String)
        return try JSONDecoder().decode(Geometry.self, from: Data(value.utf8))
    }

    private func shot(_ name: String) {
        guard let dir = ProcessInfo.processInfo.environment["RUNNERS_SHOTS"] else { return }
        try? XCUIScreen.main.screenshot().pngRepresentation
            .write(to: URL(fileURLWithPath: dir).appending(path: "screen-\(layout)-\(name).png"))
    }

    private func command(_ path: String) {
        XCUIDevice.shared.system.open(URL(string: "bbstudio://qa-duo/" + path)!)
        // A fresh simulator asks once before opening the app's links.
        let open = XCUIApplication(bundleIdentifier: "com.apple.springboard").buttons["Open"]
        if open.waitForExistence(timeout: 1.5) { open.tap() }
    }

    private struct Geometry: Decodable {
        let scrolls: [Scroll]
    }

    private struct Rect: Decodable {
        let x: CGFloat
        let y: CGFloat
        let width: CGFloat
        let height: CGFloat
        var frame: CGRect { CGRect(x: x, y: y, width: width, height: height) }
    }

    private struct Scroll: Decodable {
        let x: CGFloat
        let y: CGFloat
        let width: CGFloat
        let height: CGFloat
        let contentHeight: CGFloat
        let adjustedRight: CGFloat
        /// Shows a vertical indicator (the Duo's status-bar strip cells don't).
        let indicator: Bool
        let indicatorRight: CGFloat
        let safeRight: CGFloat
        let indicators: [Rect]
        var frame: CGRect { CGRect(x: x, y: y, width: width, height: height) }
    }
}
