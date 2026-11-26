import XCTest

/// The Bot's controls (slice 3), offline (`-qaSpacesDemo
/// list -qaBotDemo chat`; `BotSpacesDemo.State` answers `bot_pause`,
/// `bot_resume`, `bot_stop`, `bot_make_main` and `bot_spaces`' state): Pause
/// from the list's header, the paused line above the composer with Resume,
/// and Make this the Main from a conversation's menu.
/// `TEST_RUNNER_CONTROLS_OUT` keeps PNGs.
final class BotControlsUITests: ServerIsolatedUITestCase {
    private let app = XCUIApplication()

    private func launch() {
        app.launchArguments = ["-skipPushPrompt", "YES", "-qaBotDemo", "chat", "-qaSpacesDemo", "list",
                               "-qaRoomConversation", "thr_botdemo01"]
        app.launchOffline()
        XCTAssertTrue(app.textViews["Message"].waitForExistence(timeout: 30), "the conversation")
    }

    private func any(_ id: String) -> XCUIElement { app.descendants(matching: .any)[id].firstMatch }

    func testPauseFromTheListAndResumeFromTheConversation() {
        launch()
        app.goHome()
        let controls = app.buttons["botControls"]
        XCTAssertTrue(controls.waitForExistence(timeout: 10), "the Bot's controls in the list's header")
        controls.tap()
        XCTAssertTrue(app.buttons["botMainPicker"].waitForExistence(timeout: 5), "the Main picker")
        XCTAssertTrue(app.buttons["botNewMain"].exists)
        XCTAssertTrue(app.buttons["botStop"].exists)
        shot("1-controls")
        app.buttons["botPause"].tap()
        let paused = NSPredicate(format: "label CONTAINS 'Paused'")
        XCTAssertEqual(XCTWaiter.wait(for: [XCTNSPredicateExpectation(predicate: paused, object: any("homeBotStatus"))], timeout: 15), .completed,
                       "the header says Paused")
        shot("2-paused-list")
        app.goHome()
        XCTAssertTrue(app.waitForRoom(timeout: 10), "the conversation opens")
        // Round 5: a lasting state is a chip in the composer's top row, not a banner.
        let chip = app.buttons["chip-paused"]
        XCTAssertTrue(chip.waitForExistence(timeout: 15), "the composer says the Bot is paused")
        XCTAssertTrue(chip.label.contains("Resume"), chip.label)
        XCTAssertFalse(any("botPausedBanner").exists, "no banner above the composer")
        shot("3-paused-chip")
        chip.tap()
        XCTAssertTrue(chip.waitForNonExistence(timeout: 15), "Resume brings it back")
    }

    func testMakeThisTheMainFromAConversation() {
        launch()
        app.goHome()
        let launchPrep = app.buttons["homeConversation-thr_demo_interview"]
        XCTAssertTrue(launchPrep.waitForExistence(timeout: 10))
        launchPrep.tap()
        // The conversation's menu is its title (round 5).
        app.openConversationMenu()
        let make = app.buttons["makeMain"]
        XCTAssertTrue(make.waitForExistence(timeout: 5), "Make this the Main in the conversation's menu")
        shot("4-make-main")
        make.tap()
        XCTAssertTrue(app.staticTexts["This is Juniper's Main now"].waitForExistence(timeout: 10))
    }

    private func shot(_ name: String) {
        guard let folder = ProcessInfo.processInfo.environment["CONTROLS_OUT"] else { return }
        sleep(1)
        let url = URL(fileURLWithPath: folder)
        try? FileManager.default.createDirectory(at: url, withIntermediateDirectories: true)
        try? XCUIScreen.main.screenshot().pngRepresentation.write(to: url.appendingPathComponent("\(name).png"))
    }
}
