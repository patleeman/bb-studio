import XCTest

/// The Bot's threads list (Running, Waiting to start, Runners, Recurring…):
/// in the Activity sheet on a phone and in the Duo's sidebar, it scrolls in
/// one scroll view with one indicator at its edge. No scroll view nests inside
/// it, so no second indicator is drawn over a runner's "next 12:05 PM" or its
/// summary. Offline, on the local Bot demo. See docs/ios/runner-card-scroll.
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
        // The phone's sheet, from the bell; the Duo's sidebar is already showing.
        if layout != "split" {
            let bell = app.buttons.matching(NSPredicate(format: "label BEGINSWITH 'Activity'")).firstMatch
            XCTAssertTrue(bell.waitForExistence(timeout: 10), "the Activity button")
            bell.tap()
        }
        let runner = app.descendants(matching: .any).matching(NSPredicate(format: "label BEGINSWITH 'PR watcher'")).firstMatch
        XCTAssertTrue(runner.waitForExistence(timeout: 15), "the Runners group shows")
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

        // The other sidebar lists beside two pages share the same margins.
        guard layout == "split" else { return }
        for tab in ["threads", "studio"] {
            command("tab?\(tab)")
            Thread.sleep(forTimeInterval: 2)
            guard let sidebar = try layoutGeometry().scrolls.first(where: {
                abs($0.x - list.frame.minX) < 2 && $0.height > 400 && $0.indicator && $0.contentHeight > $0.height
            }) else { print("RUNNERS \(tab): the sidebar doesn't scroll"); continue }
            let point = app.coordinate(withNormalizedOffset: .zero).withOffset(CGVector(dx: sidebar.frame.midX, dy: sidebar.frame.midY))
            point.press(forDuration: 0.1, thenDragTo: point.withOffset(CGVector(dx: 0, dy: -60)), withVelocity: .slow, thenHoldForDuration: 0.2)
            let after = try XCTUnwrap(layoutGeometry().scrolls.first { $0.frame == sidebar.frame }, "\(tab): the sidebar after scrolling")
            let bar = try XCTUnwrap(after.indicators.map(\.frame).first { $0.height > $0.width }, "\(tab): the sidebar's vertical indicator")
            print("RUNNERS \(tab) sidebar=\(sidebar.frame) indicator=\(bar)")
            XCTAssertGreaterThanOrEqual(bar.minX, sidebar.frame.maxX - 8, "\(tab): the sidebar's indicator is \(sidebar.frame.maxX - bar.maxX) points in from its edge")
        }
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
