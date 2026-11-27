import XCTest

/// A design's screens open and zoom, offline (`-qaDesignDemo`: one design with
/// a desktop screen, 1280 wide, and a phone screen, 390 wide, whose pages say
/// `user-scalable=no`). A tap or a pinch on a screen's picture opens it full
/// screen as a still, painted at fit-to-width with no touch; a pinch zooms, a
/// drag pans at that zoom, a double tap zooms back to fit, and a tap plays the
/// live prototype. `designStill`'s value is the zoom relative to fit.
/// `TEST_RUNNER_ROUND2_OUT` keeps PNGs.
final class DesignZoomUITests: ServerIsolatedUITestCase {
    private let app = XCUIApplication()

    private func launch() {
        app.launchArguments = ["-skipPushPrompt", "YES", "-qaBotDemo", "chat", "-qaSpacesDemo", "list",
                               "-qaConversation", "thr_botdemo01", "-qaDesignDemo"]
        app.launchOffline()
        XCTAssertTrue(app.textViews["Message"].waitForExistence(timeout: 30))
        XCUIDevice.shared.system.open(URL(string: "bbstudio://design/dsn_demo")!)
        XCTAssertTrue(app.buttons["designScreen-1b"].waitForExistence(timeout: 20), "the design's screens")
    }

    private var still: XCUIElement { app.descendants(matching: .any)["designStill"].firstMatch }

    /// The zoom relative to fit-to-width.
    private var zoom: Double { Double(still.value as? String ?? "") ?? 0 }

    private func waitForZoom(_ check: @escaping (Double) -> Bool, timeout: TimeInterval = 10) -> Bool {
        let until = Date().addingTimeInterval(timeout)
        while Date() < until {
            if check(zoom) { return true }
            Thread.sleep(forTimeInterval: 0.25)
        }
        return false
    }

    /// The share of sampled pixels that are bright (the demo page's white text on dark): zero for a blank still.
    private func painted(_ element: XCUIElement) -> Double {
        let screen = XCUIScreen.main.screenshot().image
        let scale = screen.scale, frame = element.frame
        let crop = CGRect(x: frame.minX * scale, y: frame.minY * scale, width: frame.width * scale, height: frame.height * scale)
        guard let image = screen.cgImage?.cropping(to: crop),
              let data = image.dataProvider?.data, let bytes = CFDataGetBytePtr(data) else { return 0 }
        let row = image.bytesPerRow, step = image.bitsPerPixel / 8
        var bright = 0, sampled = 0
        for y in stride(from: 0, to: image.height, by: 2) {
            for x in stride(from: 0, to: image.width, by: 2) {
                let at = y * row + x * step
                sampled += 1
                if Int(bytes[at]) + Int(bytes[at + 1]) + Int(bytes[at + 2]) > 3 * 170 { bright += 1 }
            }
        }
        return sampled > 0 ? Double(bright) / Double(sampled) : 0
    }

    private func open(_ screen: String) {
        // Its left part: on the folded Duo a wide thumbnail runs under the right column.
        app.buttons["designScreen-\(screen)"].coordinate(withNormalizedOffset: CGVector(dx: 0.15, dy: 0.5)).tap()
        XCTAssertTrue(still.waitForExistence(timeout: 15), "the screen opens full screen")
    }

    func testTheLargeScreenPaintsAtFitAndZoomsInOneScrollView() {
        launch()
        open("1b")
        XCTAssertTrue(waitForZoom { abs($0 - 1) < 0.01 }, "it opens at fit-to-width: \(zoom)")
        XCTAssertGreaterThan(painted(still), 0.001, "painted with no pinch")
        let frame = still.frame
        shot("1-large-open")

        still.pinch(withScale: 3, velocity: 2)
        XCTAssertTrue(waitForZoom { $0 > 1.8 }, "a pinch zooms in: \(zoom)")
        let zoomed = zoom
        for _ in 0..<2 {
            still.swipeDown(velocity: .fast)
            still.swipeRight(velocity: .fast)
        }
        Thread.sleep(forTimeInterval: 1)
        XCTAssertEqual(zoom, zoomed, accuracy: 0.01, "a pan keeps the zoom: nothing snaps it back")
        XCTAssertEqual(still.frame.minY, frame.minY, accuracy: 0.5, "the still stays put while its picture pans")
        XCTAssertEqual(still.frame.height, frame.height, accuracy: 0.5)
        XCTAssertGreaterThan(painted(still), 0.002, "painted after the pan")
        shot("2-large-zoomed")

        still.doubleTap()
        XCTAssertTrue(waitForZoom { abs($0 - 1) < 0.01 }, "a double tap zooms back to fit: \(zoom)")
        still.pinch(withScale: 0.4, velocity: -2)
        Thread.sleep(forTimeInterval: 1)
        XCTAssertEqual(zoom, 1, accuracy: 0.01, "it never stays smaller than fit")

        still.tap()
        let live = app.webViews["designPlayerPage"]
        XCTAssertTrue(live.waitForExistence(timeout: 10), "a tap plays the live prototype")
        let until = Date().addingTimeInterval(10)
        while painted(live) < 0.001, Date() < until { Thread.sleep(forTimeInterval: 0.5) }
        XCTAssertGreaterThan(painted(live), 0.001, "the live page is painted with no touch")
        shot("3-large-playing")
        app.segmentedControls["designMode"].buttons["View"].tap()
        XCTAssertTrue(still.waitForExistence(timeout: 10), "and View goes back to the still")
    }

    func testTheSmallScreenPaintsAtFitToo() {
        launch()
        open("1a")
        XCTAssertTrue(waitForZoom { abs($0 - 1) < 0.01 }, "it opens at fit-to-width: \(zoom)")
        XCTAssertGreaterThan(painted(still), 0.001, "painted with no pinch")
        shot("4-small-open")
        still.swipeUp(velocity: .fast)
        Thread.sleep(forTimeInterval: 1)
        XCTAssertEqual(zoom, 1, accuracy: 0.01, "a pan at fit doesn't zoom")
        still.pinch(withScale: 2.5, velocity: 2)
        XCTAssertTrue(waitForZoom { $0 > 1.5 }, "a pinch zooms: \(zoom)")
        shot("5-small-zoomed")
    }

    func testPinchingAThumbnailOpensIt() {
        launch()
        app.buttons["designScreen-1a"].pinch(withScale: 2.5, velocity: 2)
        XCTAssertTrue(still.waitForExistence(timeout: 15), "a pinch on a screen opens it full screen")
        XCTAssertTrue(waitForZoom { abs($0 - 1) < 0.01 }, "at fit: \(zoom)")
    }

    private func shot(_ name: String) {
        guard let folder = ProcessInfo.processInfo.environment["ROUND2_OUT"] else { return }
        sleep(1)
        let url = URL(fileURLWithPath: folder)
        try? FileManager.default.createDirectory(at: url, withIntermediateDirectories: true)
        try? XCUIScreen.main.screenshot().pngRepresentation.write(to: url.appendingPathComponent("\(name).png"))
    }
}
