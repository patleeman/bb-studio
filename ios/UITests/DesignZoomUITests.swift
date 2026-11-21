import XCTest

/// A design zooms, offline (`-qaDesignDemo`: one design with a phone and a
/// desktop screen whose pages say `user-scalable=no`): a tap or a pinch on a
/// screen's picture opens it full screen; there a pinch zooms and a double tap
/// zooms back. `designZoom` is the page's zoom scale. `TEST_RUNNER_ROUND2_OUT`
/// keeps PNGs.
final class DesignZoomUITests: ServerIsolatedUITestCase {
    private let app = XCUIApplication()

    private func launch() {
        app.launchArguments = ["-skipPushPrompt", "YES", "-qaBotDemo", "chat", "-qaSpacesDemo", "list", "-qaConversationHome",
                               "-qaRoomConversation", "thr_botdemo01", "-qaDesignDemo"]
        app.launchOffline()
        XCTAssertTrue(app.textViews["Message"].waitForExistence(timeout: 30))
        XCUIDevice.shared.system.open(URL(string: "bbstudio://design/dsn_demo")!)
        XCTAssertTrue(app.buttons["designScreen-1b"].waitForExistence(timeout: 20), "the design's screens")
    }

    /// The player's page zoom scale (`designZoom`).
    private var zoom: Double {
        Double(app.descendants(matching: .any)["designZoom"].firstMatch.value as? String ?? "") ?? 0
    }

    /// The zoom once it has held for a second (the page fits after it loads).
    private func settledZoom() -> Double {
        var last = -1.0
        for _ in 0..<20 {
            Thread.sleep(forTimeInterval: 0.5)
            let now = zoom
            if now > 0, abs(now - last) < 0.0005 { return now }
            last = now
        }
        return zoom
    }

    private func waitForZoom(_ check: @escaping (Double) -> Bool, timeout: TimeInterval = 10) -> Bool {
        let until = Date().addingTimeInterval(timeout)
        while Date() < until {
            if check(zoom) { return true }
            Thread.sleep(forTimeInterval: 0.3)
        }
        return false
    }

    func testPinchZoomsTheScreenAndDoubleTapZoomsBack() {
        launch()
        // Its left part: on the folded Duo the wide thumbnail runs under the rail.
        app.buttons["designScreen-1b"].coordinate(withNormalizedOffset: CGVector(dx: 0.15, dy: 0.5)).tap()
        let page = app.webViews["designPlayerPage"]
        XCTAssertTrue(page.waitForExistence(timeout: 15), "a tap on the screen's picture plays it")
        let fit = settledZoom()
        XCTAssertGreaterThan(fit, 0, "the page has a zoom")
        shot("14-design-fit")
        page.pinch(withScale: 3, velocity: 2)
        XCTAssertTrue(waitForZoom { $0 > fit * 1.5 }, "a pinch zooms in: \(fit) → \(zoom)")
        // A drag pans: back to the page's top left, where its cards are.
        for _ in 0..<3 {
            page.swipeDown(velocity: .fast)
            page.swipeRight(velocity: .fast)
        }
        XCTAssertTrue(waitForZoom { $0 > fit * 1.5 }, "panning keeps the zoom: \(zoom)")
        shot("15-design-zoomed")
        let zoomed = settledZoom()
        page.doubleTap()
        XCTAssertTrue(waitForZoom { $0 < zoomed * 0.8 }, "a double tap zooms back out: \(zoomed) → \(zoom)")
        app.buttons["Done"].tap()
    }

    func testPinchingAThumbnailOpensIt() {
        launch()
        app.buttons["designScreen-1a"].pinch(withScale: 2.5, velocity: 2)
        let page = app.webViews["designPlayerPage"]
        XCTAssertTrue(page.waitForExistence(timeout: 15), "a pinch on a screen opens it full screen")
        let fit = settledZoom()
        page.pinch(withScale: 2.5, velocity: 2)
        XCTAssertTrue(waitForZoom { $0 > fit * 1.5 }, "where a pinch zooms: \(fit) → \(zoom)")
    }

    private func shot(_ name: String) {
        guard let folder = ProcessInfo.processInfo.environment["ROUND2_OUT"] else { return }
        sleep(1)
        let url = URL(fileURLWithPath: folder)
        try? FileManager.default.createDirectory(at: url, withIntermediateDirectories: true)
        try? XCUIScreen.main.screenshot().pngRepresentation.write(to: url.appendingPathComponent("\(name).png"))
    }
}
