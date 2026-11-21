import XCTest

/// The conversation is home (slice 2), offline (`-qaSpacesDemo list -qaBotDemo
/// chat -qaStrandsDemo -qaConversationHome`): the app opens on the
/// conversation with its strands box; the header's Bot mark (or the name)
/// opens the one list with the Bot and its places; picking a conversation
/// shows it, and the app opens on it next time; the unfolded Duo shows the
/// conversation's context on the left. `TEST_RUNNER_HOME_OUT` keeps PNGs.
final class HomeUITests: ServerIsolatedUITestCase {
    private let app = XCUIApplication()

    private func launch(_ extra: [String] = []) {
        app.launchArguments = ["-skipPushPrompt", "YES", "-qaBotDemo", "chat", "-qaSpacesDemo", "list", "-qaStrandsDemo", "-qaConversationHome"] + extra
        app.launchOffline()
    }

    private func any(_ id: String) -> XCUIElement { app.descendants(matching: .any)[id].firstMatch }

    func testOpensOnTheConversationAndTheHeaderOpensTheList() {
        launch(["-qaRoomConversation", "thr_botdemo01"])
        XCTAssertTrue(app.textViews["Message"].waitForExistence(timeout: 30), "the conversation is the first thing")
        XCTAssertFalse(app.buttons["roomInput"].exists, "no presence screen")
        XCTAssertTrue(app.buttons["strands-toggle"].waitForExistence(timeout: 20), "its strands box")
        let list = app.buttons["roomList"]
        XCTAssertTrue(list.exists, "the Bot's mark in the header")
        shot("1-home")

        list.tap()
        XCTAssertTrue(any("RoomSheet-conversations").waitForExistence(timeout: 10), "the one list")
        XCTAssertTrue(any("roomListHeader").exists, "with the Bot")
        XCTAssertTrue(app.buttons["roomWorker-thr_demo_w2"].exists, "workers under their conversation")
        shot("2-list")
        app.swipeUp()
        XCTAssertTrue(app.buttons["roomPlace-memory"].waitForExistence(timeout: 5), "and the Bot's places")
        XCTAssertTrue(app.buttons["roomSettings"].exists)
        XCTAssertTrue(app.buttons["roomPlace-strands"].exists, "Strands, in Tasks' place")
        XCTAssertFalse(app.buttons["roomPlace-tasks"].exists, "no Tasks")
        shot("3-list-places")
        app.buttons["roomPlace-memory"].tap()
        XCTAssertTrue(app.navigationBars.buttons.firstMatch.waitForExistence(timeout: 10), "Memory opens in the list")
        app.navigationBars.buttons.firstMatch.tap()

        app.swipeDown()
        let launchPrep = app.buttons["roomConversation-thr_demo_interview"]
        XCTAssertTrue(launchPrep.waitForExistence(timeout: 10))
        launchPrep.tap()
        XCTAssertTrue(any("RoomSheet-conversations").waitForNonExistence(timeout: 10), "the list closes")
        let dots = any("conversationPageDots")
        XCTAssertTrue(dots.waitForExistence(timeout: 10))
        XCTAssertFalse(dots.label.hasPrefix("Conversation 1 of"), "another conversation shows: \(dots.label)")
        shot("4-picked")

        app.terminate()
        launch()
        XCTAssertTrue(any("conversationPageDots").waitForExistence(timeout: 30))
        XCTAssertEqual(any("conversationPageDots").label, dots.label, "it opens on the last conversation opened")
    }

    func testTheTitleOpensTheListToo() {
        launch()
        let title = app.buttons["conversationTitleList"]
        XCTAssertTrue(title.waitForExistence(timeout: 30))
        title.tap()
        XCTAssertTrue(any("RoomSheet-conversations").waitForExistence(timeout: 10))
    }

    func testTheUnfoldedDuoShowsTheContextOnTheLeft() throws {
        guard ProcessInfo.processInfo.environment["HOME_DUO"] != nil else { throw XCTSkip("needs the iPhone Duo simulator") }
        launch(["-qaRoomConversation", "thr_botdemo01"])
        XCTAssertTrue(app.textViews["Message"].waitForExistence(timeout: 30))
        XCUIDevice.shared.system.open(URL(string: "bbstudio://qa-duo/landscape")!)
        sleep(3)
        XCTAssertTrue(any("roomContext").waitForExistence(timeout: 15), "the left screen is the conversation's context")
        XCTAssertTrue(any("strands-panel").waitForExistence(timeout: 15), "its strands, open")
        XCTAssertTrue(app.buttons["contextWorker-thr_demo_w2"].waitForExistence(timeout: 10), "its workers")
        XCTAssertFalse(app.buttons["strands-toggle"].exists, "no second strands box on the right")
        shot("5-duo")
        XCUIDevice.shared.system.open(URL(string: "bbstudio://qa-duo/capture?home-duo")!)
        sleep(3)
        let pick = app.buttons["contextConversation-thr_demo_interview"]
        if !pick.isHittable { any("roomContext").swipeUp() }
        pick.tap()
        let moved = XCTNSPredicateExpectation(predicate: NSPredicate(format: "NOT (label BEGINSWITH 'Conversation 1 of')"), object: any("conversationPageDots"))
        XCTAssertEqual(XCTWaiter.wait(for: [moved], timeout: 10), .completed, "picking on the left changes the right")
        shot("6-duo-picked")
        XCUIDevice.shared.system.open(URL(string: "bbstudio://qa-duo/capture?home-duo-picked")!)
        sleep(3)
    }

    private func shot(_ name: String) {
        guard let folder = ProcessInfo.processInfo.environment["HOME_OUT"] else { return }
        sleep(1)
        let url = URL(fileURLWithPath: folder)
        try? FileManager.default.createDirectory(at: url, withIntermediateDirectories: true)
        try? XCUIScreen.main.screenshot().pngRepresentation.write(to: url.appendingPathComponent("\(name).png"))
    }
}
