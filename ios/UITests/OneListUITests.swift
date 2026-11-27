import XCTest

/// One list, offline (`-qaSpacesDemo list -qaBotDemo
/// chat`; the demo's BB thread list has two projects with threads of no Bot,
/// and Bot threads in the personal project): the conversation list over the
/// conversation is the only list. The Bot's conversations come first, then
/// Projects (closed, each project closed) with the threads that belong to no
/// Bot; search searches it all; Automations is in Schedules; nothing opens
/// BB's own Threads screen. `TEST_RUNNER_ROUND2_OUT` keeps PNGs.
final class OneListUITests: ServerIsolatedUITestCase {
    private let app = XCUIApplication()

    private func launch() {
        app.launchArguments = ["-skipPushPrompt", "YES", "-qaBotDemo", "chat", "-qaSpacesDemo", "list",
                               "-qaRoomConversation", "thr_botdemo01"]
        app.launchOffline()
        XCTAssertTrue(app.textViews["Message"].waitForExistence(timeout: 30), "the conversation")
    }

    private func any(_ id: String) -> XCUIElement { app.descendants(matching: .any)[id].firstMatch }

    private func openList() {
        app.buttons["roomList"].tap()
        XCTAssertTrue(any("RoomSheet-conversations").waitForExistence(timeout: 10), "the one list")
    }

    private func scrollTo(_ element: XCUIElement) {
        for _ in 0..<6 where !(element.exists && element.isHittable) { app.swipeUp() }
    }

    func testProjectThreadsAreInTheOneListClosedUntilOpened() {
        launch()
        openList()
        XCTAssertTrue(app.buttons["roomConversation-thr_demo_interview"].exists, "the Bot's conversations first")
        let projects = app.buttons["roomProjects"]
        scrollTo(projects)
        XCTAssertTrue(projects.exists, "then Projects")
        XCTAssertFalse(app.buttons["roomProject-proj_site"].exists, "closed by default")
        projects.tap()
        let site = app.buttons["roomProject-proj_site"]
        XCTAssertTrue(site.waitForExistence(timeout: 15), "the projects, once opened")
        // Home's composer sits at the foot (round 5): rows under it appear once scrolled to.
        scrollTo(app.buttons["roomProject-proj_personal"])
        XCTAssertTrue(app.buttons["roomProject-proj_personal"].exists, "No project too, for a thread of no Bot there")
        XCTAssertFalse(app.buttons["projectThread-thr_site_form"].exists, "each project closed too")
        site.tap()
        let form = app.buttons["projectThread-thr_site_form"]
        XCTAssertTrue(form.waitForExistence(timeout: 5))
        scrollTo(app.buttons["projectThread-thr_site_mobile"])
        XCTAssertTrue(app.buttons["projectThread-thr_site_mobile"].exists, "with the thread it started under it")
        XCTAssertGreaterThan(app.buttons["projectThread-thr_site_mobile"].frame.minX + 1, form.frame.minX, "nested")
        scrollTo(app.buttons["roomProject-proj_personal"])
        app.buttons["roomProject-proj_personal"].tap()
        scrollTo(app.buttons["projectThread-thr_plain_receipts"])
        XCTAssertTrue(app.buttons["projectThread-thr_plain_receipts"].waitForExistence(timeout: 5))
        for botThread in [BotThreadIds.main, "thr_demo_interview", "thr_demo_w2", "thr_bot_child"] {
            XCTAssertFalse(app.buttons["projectThread-\(botThread)"].exists, "\(botThread) is a Bot's, so not under Projects")
        }
        shot("11-projects")
        form.tap()
        XCTAssertTrue(app.staticTexts["The form posts twice on Safari."].waitForExistence(timeout: 15), "the thread opens")
    }

    func testSearchSearchesTheOneList() {
        launch()
        openList()
        let search = app.textFields["roomSearch"]
        XCTAssertTrue(search.waitForExistence(timeout: 5), "a search field on the list")
        search.tap()
        search.typeText("form")
        XCTAssertTrue(app.buttons["projectThread-thr_site_form"].waitForExistence(timeout: 15), "a project thread")
        XCTAssertFalse(app.buttons["roomConversation-thr_demo_interview"].exists, "not what doesn't match")
        shot("12-search")
        app.buttons["roomSearchClear"].tap()
        search.tap()
        search.typeText("Launch")
        XCTAssertTrue(app.buttons["roomConversation-thr_demo_interview"].waitForExistence(timeout: 5), "and the Bot's conversations")
        XCTAssertFalse(app.buttons["projectThread-thr_site_form"].exists)
    }

    func testAutomationsAreInSchedules() {
        launch()
        openList()
        let schedules = app.botMenuItem("schedules")
        app.openBotMenu()
        XCTAssertTrue(schedules.waitForExistence(timeout: 5))
        schedules.tap()
        let all = app.buttons["schedulesAllAutomations"]
        for _ in 0..<4 where !all.exists { app.swipeUp() }
        XCTAssertTrue(all.waitForExistence(timeout: 10), "All automations, in the Bot's Schedules")
        shot("13-schedules")
    }

    func testNothingOpensTheThreadsScreen() {
        launch()
        XCUIDevice.shared.system.open(URL(string: "bbstudio://threads")!)
        XCTAssertTrue(any("RoomSheet-conversations").waitForExistence(timeout: 15), "a threads link opens the one list")
        XCTAssertFalse(app.navigationBars["Threads"].exists, "not BB's Threads screen")
        app.closeRoomSheet()
        XCTAssertTrue(any("RoomSheet-conversations").waitForNonExistence(timeout: 10))
        XCUIDevice.shared.system.open(URL(string: "bbstudio://new")!)
        XCTAssertTrue(any("newConversationWith").waitForExistence(timeout: 15), "New thread is New conversation")
        XCTAssertEqual(any("newConversationWith").label, "New conversation with Juniper")
        app.buttons["Cancel"].tap()
        XCUIDevice.shared.system.open(URL(string: "bbstudio://thread/thr_site_form")!)
        XCTAssertTrue(app.staticTexts["The form posts twice on Safari."].waitForExistence(timeout: 15), "a thread opens in the room")
        XCTAssertFalse(app.navigationBars["Threads"].exists)
        XCUIDevice.shared.system.open(URL(string: "bbstudio://settings")!)
        XCTAssertTrue(app.textFields["settingsServerURL"].waitForExistence(timeout: 15), "Settings")
        XCTAssertFalse(app.buttons["settingsAllThreads"].exists, "no All BB threads in Settings")
    }

    private enum BotThreadIds { static let main = "thr_botdemo01" }

    private func shot(_ name: String) {
        guard let folder = ProcessInfo.processInfo.environment["ROUND2_OUT"] else { return }
        sleep(1)
        let url = URL(fileURLWithPath: folder)
        try? FileManager.default.createDirectory(at: url, withIntermediateDirectories: true)
        try? XCUIScreen.main.screenshot().pngRepresentation.write(to: url.appendingPathComponent("\(name).png"))
    }
}
