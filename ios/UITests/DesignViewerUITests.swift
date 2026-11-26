import XCTest

/// Round 7: design comments and the player's modes, offline (`-qaDesignDemo`:
/// screens 1a and 1b, one open comment pinned on 1a's title, and a stand-in
/// for Studio's screen script). `VIEWERS_OUT` keeps PNGs.
final class DesignViewerUITests: ServerIsolatedUITestCase {
    private let app = XCUIApplication()

    private func launch() {
        app.launchArguments = ["-skipPushPrompt", "YES", "-qaBotDemo", "chat", "-qaSpacesDemo", "list",
                               "-qaRoomConversation", "thr_botdemo01", "-qaDesignDemo"]
        app.launchOffline()
        XCTAssertTrue(app.textViews["Message"].waitForExistence(timeout: 30))
        XCUIDevice.shared.system.open(URL(string: "bbstudio://design/dsn_demo")!)
        XCTAssertTrue(app.buttons["designScreen-1a"].waitForExistence(timeout: 20), "the design's screens")
    }

    private var live: XCUIElement { app.webViews["designPlayerPage"] }

    func testCommentsListOpensAPinnedScreen() {
        launch()
        app.buttons["designComments"].tap()
        let first = app.buttons["designComment-1"]
        XCTAssertTrue(first.waitForExistence(timeout: 10), "the open comment, numbered")
        XCTAssertTrue(app.staticTexts["Bigger title"].exists)
        shot("design-comments")
        first.tap()
        XCTAssertTrue(live.waitForExistence(timeout: 15), "it opens its screen live, in comment mode")
        XCTAssertTrue(live.buttons["Comment 1"].waitForExistence(timeout: 15), "with its pin on the element")
        XCTAssertEqual(app.segmentedControls["designMode"].buttons["Comment"].isSelected, true)
        shot("design-pin")
    }

    func testCommentModePinsANewComment() {
        launch()
        app.buttons["designScreen-1a"].coordinate(withNormalizedOffset: CGVector(dx: 0.15, dy: 0.5)).tap()
        let modes = app.segmentedControls["designMode"]
        XCTAssertTrue(modes.waitForExistence(timeout: 15))
        modes.buttons["Comment"].tap()
        XCTAssertTrue(live.waitForExistence(timeout: 15))
        let card = live.staticTexts["Card 2"]
        XCTAssertTrue(card.waitForExistence(timeout: 15), "the live screen")
        card.tap()
        XCTAssertTrue(app.navigationBars["New Comment"].waitForExistence(timeout: 10), "a tap on an element starts a comment on it")
        let field = app.textFields["designCommentField"].exists ? app.textFields["designCommentField"] : app.textViews["designCommentField"]
        field.typeText("Tighter padding")
        shot("design-new-comment")
        app.buttons["designCommentSave"].tap()
        XCTAssertTrue(live.buttons["Comment 2"].waitForExistence(timeout: 15), "its pin appears on the element")
        shot("design-new-pin")
        app.buttons["Done"].firstMatch.tap()
        app.buttons["designComments"].tap()
        XCTAssertTrue(app.buttons["designComment-2"].waitForExistence(timeout: 10), "and it's in the list")
    }

    func testResolveAndReopen() {
        launch()
        app.buttons["designComments"].tap()
        let first = app.buttons["designComment-1"]
        XCTAssertTrue(first.waitForExistence(timeout: 10))
        first.swipeLeft()
        app.buttons["Resolve"].tap()
        XCTAssertTrue(app.staticTexts["No open comments"].waitForExistence(timeout: 10))
        app.segmentedControls["designCommentsFilter"].buttons["Resolved"].tap()
        let resolved = app.buttons["designComment-1"]
        XCTAssertTrue(resolved.waitForExistence(timeout: 10), "under Resolved")
        resolved.swipeLeft()
        app.buttons["Reopen"].tap()
        app.segmentedControls["designCommentsFilter"].buttons.element(boundBy: 0).tap()
        XCTAssertTrue(app.buttons["designComment-1"].waitForExistence(timeout: 10), "open again")
    }

    func testThePlayerSwipesBetweenARoundsScreens() {
        launch()
        app.buttons["designScreen-1a"].coordinate(withNormalizedOffset: CGVector(dx: 0.15, dy: 0.5)).tap()
        XCTAssertTrue(app.navigationBars["1a · Phone"].waitForExistence(timeout: 15))
        app.descendants(matching: .any)["designStill"].firstMatch.swipeLeft()
        XCTAssertTrue(app.navigationBars["1b · Desktop"].waitForExistence(timeout: 10), "a swipe at fit goes to the next option")
        app.buttons["designExport"].tap()
        XCTAssertTrue(app.buttons["Export PDF"].waitForExistence(timeout: 5))
        XCTAssertTrue(app.buttons["Download HTML"].exists)
    }

    private func shot(_ name: String) {
        guard let folder = ProcessInfo.processInfo.environment["VIEWERS_OUT"] else { return }
        sleep(1)
        let url = URL(fileURLWithPath: folder)
        try? FileManager.default.createDirectory(at: url, withIntermediateDirectories: true)
        try? XCUIScreen.main.screenshot().pngRepresentation.write(to: url.appendingPathComponent("\(name)-\(UIDevice.current.name).png"))
    }
}
