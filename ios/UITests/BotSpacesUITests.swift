import XCTest

/// The Bot's list as home (`-qaSpacesDemo`, local spaces, no server): launch
/// opens Main, Back shows the list, and the header swipe and the dots switch
/// Bots. `TEST_RUNNER_STEP4_OUT` keeps PNGs of each state.
final class BotSpacesUITests: ServerIsolatedUITestCase {
    private let app = XCUIApplication()

    private func launch(_ variant: String = "needs") {
        app.launchArguments += ["-skipPushPrompt", "YES", "-qaBotDemo", "chat", "-qaSpacesDemo", variant]
        app.launchOffline()
    }

    private var list: XCUIElement { app.collectionViews["BotSpaceList"] }

    private func back() {
        let bar = app.navigationBars.firstMatch
        XCTAssertTrue(bar.waitForExistence(timeout: 20))
        bar.buttons.element(boundBy: 0).tap()
    }

    func testLaunchOpensMainAndBackShowsTheList() {
        launch()
        XCTAssertTrue(app.textViews["Message"].waitForExistence(timeout: 30), "Main's composer shows")
        XCTAssertFalse(app.tabBars.firstMatch.exists, "no tab bar")
        shot("main")
        back()
        XCTAssertTrue(list.waitForExistence(timeout: 10), "Back shows the Bot's list")
        let main = list.buttons["conversation-thr_botdemo01"]
        XCTAssertTrue(main.waitForExistence(timeout: 10))
        XCTAssertTrue(main.label.contains("Push bb-studio-native to origin?"), "the needs-you reason is on line 2: \(main.label)")
        XCTAssertTrue(list.buttons["conversation-thr_demo_thread"].label.contains("Forked from Main"), "a thread sits under its parent")
        XCTAssertTrue(list.buttons["worker-thr_demo_w2"].exists, "a running worker")
        XCTAssertTrue(app.buttons["space-dot-bot_home"].label.contains("needs you"), "Home's dot is amber")
        shot("list-needs")
        main.tap()
        XCTAssertTrue(app.textViews["Message"].waitForExistence(timeout: 20), "the row opens Main again")
    }

    func testSwitchingBots() {
        launch()
        XCTAssertTrue(app.textViews["Message"].waitForExistence(timeout: 30))
        back()
        XCTAssertTrue(app.staticTexts["Juniper"].waitForExistence(timeout: 10))
        let dot = app.buttons["space-dot-bot_home"]
        XCTAssertTrue(dot.waitForExistence(timeout: 10))
        dot.tap()
        let home = list.buttons["conversation-thr_home_main"]
        XCTAssertTrue(home.waitForExistence(timeout: 10), "the dot shows Home's list")
        XCTAssertTrue(home.label.contains("Approve the plumber's quote?"))
        XCTAssertTrue(app.buttons["space-dot-bot_home"].isSelected)
        shot("list-home")
        XCTAssertTrue(app.staticTexts["Home"].exists)
        app.staticTexts["Home"].swipeLeft()
        XCTAssertTrue(list.buttons["conversation-thr_research_main"].waitForExistence(timeout: 10), "a swipe on the header shows the next Bot")
        app.staticTexts["Research"].swipeRight()
        XCTAssertTrue(list.buttons["conversation-thr_home_main"].waitForExistence(timeout: 10), "and back")
    }

    func testMoreAndSettingsKeepTheOldScreens() {
        launch("list")
        XCTAssertTrue(app.textViews["Message"].waitForExistence(timeout: 30))
        back()
        XCTAssertTrue(list.waitForExistence(timeout: 10))
        app.buttons["BotSpaceSettings"].tap()
        XCTAssertTrue(app.navigationBars["Settings"].waitForExistence(timeout: 10), "Settings opens over the list")
        app.swipeDown(velocity: .fast)
        XCTAssertTrue(list.waitForExistence(timeout: 10))
        app.buttons["BotSpaceMore"].tap()
        app.buttons["All BB threads"].tap()
        XCTAssertTrue(app.navigationBars["Threads"].waitForExistence(timeout: 10), "the Threads list opens")
    }

    private func shot(_ name: String) {
        guard let folder = ProcessInfo.processInfo.environment["STEP4_OUT"] else { return }
        sleep(1)
        let url = URL(fileURLWithPath: folder)
        try? FileManager.default.createDirectory(at: url, withIntermediateDirectories: true)
        try? XCUIScreen.main.screenshot().pngRepresentation.write(to: url.appendingPathComponent("\(name).png"))
    }
}
