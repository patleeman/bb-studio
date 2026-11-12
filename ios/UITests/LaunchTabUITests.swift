import XCTest

/// Bot is the primary tab: a cold launch opens on it, and a link still opens
/// its own target. Runs on the demo Bot (`-qaBotDemo`, no server). Without
/// Bot spaces the tab bar stays; with them (`-qaSpacesDemo`) a cold launch
/// opens Main of the current Bot over its list.
final class LaunchTabUITests: ServerIsolatedUITestCase {
    private let app = XCUIApplication()

    func testColdLaunchOpensOnBot() {
        app.launchArguments += ["-skipPushPrompt", "YES", "-qaBotDemo", "chat"]
        app.launchOffline()
        let bot = app.tabBars.buttons["Bot"]
        XCTAssertTrue(bot.waitForExistence(timeout: 20))
        XCTAssertTrue(bot.isSelected, "the Bot tab is selected")
        XCTAssertFalse(app.tabBars.buttons["Threads"].isSelected)
        XCTAssertTrue(app.buttons["Juniper options"].waitForExistence(timeout: 20), "the Bot's chat shows")
        // Killed and relaunched, it opens on Bot again.
        app.terminate()
        app.launchOffline()
        XCTAssertTrue(bot.waitForExistence(timeout: 20))
        XCTAssertTrue(bot.isSelected, "Bot again after the app is killed")
    }

    func testLaunchLinkOpensItsOwnTab() {
        app.launchArguments += ["-skipPushPrompt", "YES", "-qaBotDemo", "chat", "-openURL", "bbstudio://thread/thr_launchlink"]
        app.launchOffline()
        // The thread hides the tab bar; it is pushed on the Threads tab.
        let thread = app.navigationBars["Thread"]
        XCTAssertTrue(thread.waitForExistence(timeout: 20), "the thread link opens the thread")
        XCTAssertEqual(thread.buttons["BackButton"].label, "Threads", "on the Threads tab")
        XCTAssertTrue(app.textViews["Message"].waitForExistence(timeout: 20), "the thread's composer shows")
        sleep(2)
        XCTAssertTrue(thread.exists, "and Bot doesn't take over afterwards")
        XCTAssertFalse(app.buttons["Juniper options"].exists, "the Bot chat isn't showing")
    }

    func testColdLaunchOpensMainWithSpaces() {
        app.launchArguments += ["-skipPushPrompt", "YES", "-qaBotDemo", "chat", "-qaSpacesDemo", "list"]
        app.launchOffline()
        XCTAssertTrue(app.textViews["Message"].waitForExistence(timeout: 30), "Main's composer shows")
        XCTAssertFalse(app.tabBars.firstMatch.exists, "no tab bar with spaces")
        let list = app.collectionViews["BotSpaceList"]
        XCTAssertFalse(list.exists && list.isHittable, "the list is under Main")
        app.terminate()
        app.launchOffline()
        XCTAssertTrue(app.textViews["Message"].waitForExistence(timeout: 30), "Main again after the app is killed")
        XCTAssertFalse(app.tabBars.firstMatch.exists)
    }
}
