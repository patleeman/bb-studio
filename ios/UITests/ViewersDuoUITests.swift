import XCTest

/// Round 7, on the iPhone Duo simulator unfolded (`bbstudio://qa-duo/landscape`),
/// offline: a page with its comments, and a design's player zooming.
/// `VIEWERS_OUT` keeps PNGs.
final class ViewersDuoUITests: ServerIsolatedUITestCase {
    private let app = XCUIApplication()

    private func any(_ id: String) -> XCUIElement { app.descendants(matching: .any)[id].firstMatch }

    /// The simulator's screen is as wide as the outer one: bring the inner screen's right or left page onto it.
    private func page(_ side: String) {
        XCUIDevice.shared.system.open(URL(string: side == "right" ? "bbstudio://qa-duo/split-right" : "bbstudio://qa-duo/landscape")!)
        sleep(2)
    }

    /// Finds `id` on whichever page of the unfolded screen shows it.
    private func onEitherPage(_ id: String) -> Bool {
        if any(id).waitForExistence(timeout: 8) { return true }
        page("right")
        return any(id).waitForExistence(timeout: 8)
    }

    private func launchUnfolded() throws {
        try XCTSkipUnless(UIDevice.current.name.lowercased().contains("duo"), "an iPhone Duo simulator")
        app.launchArguments = ["-skipPushPrompt", "YES", "-qaBotDemo", "chat", "-qaSpacesDemo", "list", "-qaConversation",
                               "thr_botdemo01", "-qaWorkbenchDemo", "-qaPageDemo", "-qaDesignDemo"]
        app.launchOffline()
        XCTAssertTrue(app.textViews["Message"].waitForExistence(timeout: 30))
        XCUIDevice.shared.system.open(URL(string: "bbstudio://qa-duo/landscape")!)
        sleep(3)
    }

    func testAPageUnfolded() throws {
        try launchUnfolded()
        XCUIDevice.shared.system.open(URL(string: "bbstudio://page/qa-demo")!)
        XCTAssertTrue(onEitherPage("pageScroll"), "the page opens")
        XCTAssertTrue(app.buttons["pageCommentMark-aaaa0004"].waitForExistence(timeout: 10), "comment marks")
        shot("duo-unfolded-page")
        // Pushed over the conversation; its bar's Comments is where the system puts the bar's buttons.
        let comments = app.screenAction("comments")
        XCTAssertTrue(comments.waitForExistence(timeout: 10), "Comments in the page's bar")
        app.press(comments, id: "screenAction-comments")
        XCTAssertTrue(onEitherPage("Add the press kit."), "the comments")
        shot("duo-unfolded-page-comments")
    }

    func testADesignUnfolded() throws {
        try launchUnfolded()
        XCUIDevice.shared.system.open(URL(string: "bbstudio://design/dsn_demo")!)
        let screen = app.buttons["designScreen-1b"]
        XCTAssertTrue(screen.waitForExistence(timeout: 20))
        shot("duo-unfolded-design")
        screen.coordinate(withNormalizedOffset: CGVector(dx: 0.15, dy: 0.5)).tap()
        let still = any("designStill")
        XCTAssertTrue(still.waitForExistence(timeout: 15))
        // Drawn and fit to the width (its value is the zoom, from then on): a double tap before that does nothing.
        let drawn = XCTNSPredicateExpectation(predicate: NSPredicate { _, _ in (still.value as? String) == "1.0000" }, object: nil)
        XCTAssertEqual(XCTWaiter.wait(for: [drawn], timeout: 20), .completed, "the still is drawn")
        // Its left part: the simulator shows one page of the inner screen, and the still spans both.
        still.coordinate(withNormalizedOffset: CGVector(dx: 0.2, dy: 0.4)).doubleTap()
        let until = Date().addingTimeInterval(10)
        while (Double(still.value as? String ?? "") ?? 0) < 1.5, Date() < until { Thread.sleep(forTimeInterval: 0.25) }
        XCTAssertGreaterThan(Double(still.value as? String ?? "") ?? 0, 1.5, "a double tap zooms on the Duo too")
        shot("duo-unfolded-design-zoomed")
    }

    private func shot(_ name: String) {
        guard let folder = ProcessInfo.processInfo.environment["VIEWERS_OUT"] else { return }
        sleep(1)
        let url = URL(fileURLWithPath: folder)
        try? FileManager.default.createDirectory(at: url, withIntermediateDirectories: true)
        try? XCUIScreen.main.screenshot().pngRepresentation.write(to: url.appendingPathComponent("\(name).png"))
    }
}
