import XCTest

final class RoomUITests: ServerIsolatedUITestCase {
    private let app = XCUIApplication()

    private var theme: String { ProcessInfo.processInfo.environment["ROOM_THEME"] ?? "forest" }

    private func launch(_ extra: [String] = []) {
        app.launchArguments += ["-skipPushPrompt", "YES", "-qaBotDemo", "chat", "-qaSpacesDemo", "list", "-qaLoopsDemo",
                                "-qaRoomTheme", theme] + extra
        app.launchOffline()
        if !app.buttons["roomMic"].waitForExistence(timeout: 30) {
            app.terminate()
            app.launchOffline()
        }
        XCTAssertTrue(app.buttons["roomMic"].waitForExistence(timeout: 60), "the app opens on the room")
    }

    private func shot(_ name: String) {
        guard let folder = ProcessInfo.processInfo.environment["ROOM_OUT"] else { return }
        sleep(1)
        let url = URL(fileURLWithPath: folder)
        try? FileManager.default.createDirectory(at: url, withIntermediateDirectories: true)
        try? XCUIScreen.main.screenshot().pngRepresentation.write(to: url.appendingPathComponent("\(theme)-\(name).png"))
    }

    private func any(_ id: String) -> XCUIElement { app.descendants(matching: .any)[id].firstMatch }

    func testTheRoomAtRestShowsTheNameWhatItsDoingAndTheTasks() {
        launch()
        XCTAssertTrue(app.buttons["roomMenuButton"].exists)
        let title = any("roomTitle")
        XCTAssertTrue(title.waitForExistence(timeout: 10), "the name at the top")
        XCTAssertTrue(title.label.hasPrefix("Juniper"), "Main is the Bot's own name: \(title.label)")
        let now = app.buttons["roomNow"]
        XCTAssertTrue(now.waitForExistence(timeout: 10), "a live Now line")
        XCTAssertTrue(now.label.hasPrefix("Now: "), now.label)
        XCTAssertTrue(app.buttons.matching(NSPredicate(format: "identifier BEGINSWITH 'roomCard-wc_demo_fork'")).firstMatch.waitForExistence(timeout: 15),
                      "on it: the agents' tasks")
        XCTAssertTrue(app.buttons.matching(NSPredicate(format: "identifier == 'roomCard-task_demo_quote'")).firstMatch.exists, "yours: the user's tasks")
        let row = app.buttons["roomCard-wc_demo_fork"]
        XCTAssertGreaterThanOrEqual(row.frame.height, 44, "rows are 44 points tall")
        XCTAssertTrue(row.label.contains("3/5 Tests"), "with the step: \(row.label)")
        XCTAssertTrue(any("RoomStage").exists)
        XCTAssertTrue(app.buttons["roomMic"].exists)
        XCTAssertFalse(app.textViews["composerField"].isHittable, "the chat is put away")
        XCTAssertFalse(app.buttons.matching(NSPredicate(format: "identifier BEGINSWITH 'reply-in-thread-'")).firstMatch.exists,
                       "and hidden from VoiceOver")
        shot("1-rest")
    }

    func testAConversationWithNothingForYouSaysSo() {
        launch(["-qaRoomLead", "-qaRoomConversation", "thr_demo_interview"])
        XCTAssertTrue(any("roomYoursEmpty").waitForExistence(timeout: 15), "Nothing waiting on you")
        XCTAssertTrue(any("roomTitle").label.hasPrefix("Launch prep"))
        XCTAssertTrue(app.buttons["roomNow"].label.contains("Waiting on two workers"), app.buttons["roomNow"].label)
        XCTAssertTrue(app.buttons["roomCard-wc_demo_prep_slides"].waitForExistence(timeout: 10))
        XCTAssertFalse(app.buttons["roomCard-task_demo_prep"].exists, "its own task is the Now line, not a row")
        XCTAssertNotEqual(any("roomLight").value as? String, "day", "its own light")
        shot("1-lead-empty-yours")
    }

    func testTheInputStandsTheChatUpAndTheChevronLaysItDown() {
        launch()
        app.buttons["roomInput"].tap()
        let field = app.textViews["composerField"]
        XCTAssertTrue(field.waitForExistence(timeout: 10), "the chat stands up")
        XCTAssertTrue(app.keyboards.firstMatch.waitForExistence(timeout: 10), "with the keyboard")
        XCTAssertFalse(app.buttons["roomMenuButton"].exists, "the day is gone")
        shot("2-talk")
        app.buttons["roomLayDown"].tap()
        XCTAssertTrue(app.buttons["roomInput"].waitForExistence(timeout: 10), "back to the room")
        XCTAssertFalse(field.isHittable)
        XCTAssertFalse(app.keyboards.firstMatch.exists)
    }

    func testATapOnAMessageKeepsTheChatUpAndATapBetweenMessagesLaysItDown() {
        launch()
        app.buttons["roomInput"].tap()
        let matches = app.staticTexts.matching(identifier: "done with the hosting thing")
        XCTAssertTrue(matches.firstMatch.waitForExistence(timeout: 10))
        let bubble = matches.element(boundBy: matches.count - 1)
        bubble.tap()
        sleep(1)
        XCTAssertTrue(app.buttons["roomLayDown"].exists, "a tap on a message keeps the chat standing")
        let cells = app.collectionViews.firstMatch.cells.allElementsBoundByIndex.filter { $0.frame.minY > 120 && $0.frame.maxY < 560 }
        XCTAssertGreaterThan(cells.count, 1, "two rows on screen")
        let gap = (cells[0].frame.maxY + cells[1].frame.minY) / 2
        app.coordinate(withNormalizedOffset: .zero).withOffset(CGVector(dx: 200, dy: gap)).tap()
        XCTAssertTrue(app.buttons["roomInput"].waitForExistence(timeout: 10), "a tap between messages lays it down")
    }

    func testASwipeUpOpensTheConversationToRead() {
        launch()
        any("RoomStage").swipeUp()
        XCTAssertTrue(app.buttons["roomLayDown"].waitForExistence(timeout: 10), "the conversation opens")
        XCTAssertTrue(app.textViews["composerField"].isHittable)
        XCTAssertFalse(app.keyboards.firstMatch.exists, "to read, without the keyboard")
        app.buttons["roomLayDown"].tap()
        XCTAssertTrue(app.buttons["roomInput"].waitForExistence(timeout: 10))
        XCTAssertTrue(app.buttons["roomNow"].isHittable, "back to the room")
    }

    func testRecordingShowsTheWaveAndHowToSend() {
        launch(["-qaRoomMode", "record"])
        XCTAssertTrue(any("roomWave").waitForExistence(timeout: 10), "the input becomes a waveform")
        XCTAssertTrue(app.staticTexts["Release to send · slide left to cancel"].exists)
        XCTAssertFalse(app.buttons["roomInput"].exists)
        shot("3-record")
    }

    func testATappedRecordingSaysTapToSend() {
        launch(["-qaRoomMode", "recordLocked"])
        XCTAssertTrue(any("roomWave").waitForExistence(timeout: 10))
        XCTAssertTrue(app.staticTexts["Tap the mic to send"].exists)
        shot("3-record-tapped")
    }

    func testAMenuItemIsItsTextAndTheSpaceBesideItDoesNothing() {
        launch()
        app.buttons["roomMenuButton"].tap()
        let menu = any("RoomMenu")
        XCTAssertTrue(app.buttons["roomPlace-memory"].waitForExistence(timeout: 10))
        sleep(1)
        let column: CGFloat = 22
        let titles = ["tasks": "Tasks", "conversations": "Conversations", "memory": "Memory", "library": "Library", "schedules": "Schedules"]
        for (place, title) in titles {
            let item = app.buttons["roomPlace-\(place)"]
            XCTAssertGreaterThanOrEqual(item.frame.height, 44, "\(place): 44 points tall at least")
            XCTAssertTrue(item.label.hasPrefix(title), item.label)
            XCTAssertEqual(item.frame.minX, column - 12, accuracy: 1, "\(place): 12 points before its text")
            XCTAssertLessThan(item.frame.width, menu.frame.width * 0.8, "\(place): not the whole row")
        }
        for id in ["roomTheme", "roomSettings"] {
            XCTAssertGreaterThanOrEqual(app.buttons[id].frame.height, 44, id)
            XCTAssertGreaterThanOrEqual(app.buttons[id].frame.width, 44, id)
        }
        let memory = app.buttons["roomPlace-memory"].frame
        app.coordinate(withNormalizedOffset: .zero).withOffset(CGVector(dx: memory.maxX + 30, dy: memory.midY)).tap()
        sleep(1)
        XCTAssertFalse(any("RoomSheet-memory").exists, "a tap beside Memory opens nothing")
        XCTAssertTrue(app.buttons["roomPlace-memory"].exists, "the menu stays")
        app.coordinate(withNormalizedOffset: .zero).withOffset(CGVector(dx: memory.maxX - 4, dy: memory.midY)).tap()
        XCTAssertTrue(any("RoomSheet-memory").waitForExistence(timeout: 10), "its padding still opens it")
        shot("4-menu-hit")
    }

    func testTheMenuOpensEachPlaceAsASheetAndPullingDownGoesBack() {
        launch()
        app.buttons["roomMenuButton"].tap()
        XCTAssertTrue(app.buttons["roomPlace-tasks"].waitForExistence(timeout: 10))
        XCTAssertTrue(app.staticTexts.matching(NSPredicate(format: "label ENDSWITH ' today'")).firstMatch.exists, "Tasks with today's count")
        XCTAssertTrue(app.buttons["roomWorkingNow"].exists, "what's working now")
        XCTAssertTrue(app.buttons["roomTheme"].exists)
        XCTAssertTrue(app.buttons["roomSettings"].exists)
        shot("4-menu")

        for (place, check, name) in [("tasks", "tasks-screen", "5-tasks"), ("conversations", "roomNewConversation", "6-conversations"),
                                     ("memory", "memoryProfile", "7-memory"), ("library", "library-page", "8-library")] {
            app.openRoomPlace(place)
            XCTAssertTrue(any(check).waitForExistence(timeout: 15), "\(place) opens as a sheet")
            shot(name)
            app.closeRoomSheet()
            XCTAssertTrue(app.buttons["roomPlace-\(place)"].waitForExistence(timeout: 10), "pulling down goes back to the menu")
        }
        app.openRoomPlace("schedules")
        XCTAssertTrue(app.staticTexts["Check-in"].waitForExistence(timeout: 15), "Schedules keeps its screen")
        app.closeRoomSheet()

        app.buttons["roomMenuClose"].tap()
        XCTAssertTrue(app.buttons["roomInput"].waitForExistence(timeout: 10), "back to the room")
    }

    func testARowOpensItsTaskAndAConversationOpensOverTheRoom() {
        launch()
        let row = app.buttons["roomCard-task_demo_quote"]
        XCTAssertTrue(row.waitForExistence(timeout: 15))
        row.tap()
        XCTAssertTrue(any("task-sheet").waitForExistence(timeout: 15), "a row opens its task")
        app.buttons["task-sheet-close"].tap()
        XCTAssertTrue(app.buttons["roomNow"].waitForExistence(timeout: 10))
        app.openRoomPlace("conversations")
        let other = app.buttons.matching(NSPredicate(format: "identifier BEGINSWITH 'roomConversation-' AND NOT identifier ENDSWITH %@", "thr_botdemo01")).firstMatch
        XCTAssertTrue(other.waitForExistence(timeout: 15))
        other.tap()
        XCTAssertTrue(app.textViews["composerField"].waitForExistence(timeout: 15), "the conversation opens")
        if app.buttons["roomLayDown"].exists {
            app.buttons["roomLayDown"].tap()
        } else if app.buttons["folded-back"].exists {
            app.buttons["folded-back"].tap()
        } else {
            app.navigationBars.firstMatch.buttons.element(boundBy: 0).tap()
        }
        XCTAssertTrue(app.buttons["roomInput"].waitForExistence(timeout: 10), "back to the room")
    }

    func testMotionForTheRecording() throws {
        guard ProcessInfo.processInfo.environment["ROOM_MOTION"] != nil else { throw XCTSkip("only for the screen recording") }
        var extra = ProcessInfo.processInfo.environment["ROOM_MOTION"] == "reduce" ? ["-qaReduceMotion"] : []
        if let count = ProcessInfo.processInfo.environment["ROOM_MESSAGES"] { extra += ["-qaDemoMessages", count] }
        launch(extra)
        sleep(2)
        let stage = any("RoomStage")
        stage.swipeLeft()
        sleep(2)
        stage.swipeLeft()
        sleep(2)
        stage.swipeRight()
        sleep(1)
        stage.swipeRight()
        sleep(2)
        stage.swipeUp()
        XCTAssertTrue(app.buttons["roomLayDown"].waitForExistence(timeout: 10))
        sleep(2)
        app.buttons["roomLayDown"].tap()
        sleep(2)
        for _ in 0..<2 {
            app.buttons["roomInput"].tap()
            XCTAssertTrue(app.textViews["composerField"].waitForExistence(timeout: 10))
            sleep(2)
            app.buttons["roomLayDown"].tap()
            XCTAssertTrue(app.buttons["roomInput"].waitForExistence(timeout: 10))
            sleep(2)
        }
        app.buttons["roomMenuButton"].tap()
        sleep(2)
        app.openRoomPlace("memory")
        sleep(2)
        app.closeRoomSheet()
        sleep(1)
        app.buttons["roomMenuClose"].tap()
        sleep(2)
    }

    func testChoosingAThemeRestylesTheRoom() {
        launch()
        let scene = any("roomScene")
        XCTAssertTrue(scene.waitForExistence(timeout: 10))
        let before = scene.value as? String
        let target = before == "aurora-fjord" ? "tonights-sky" : "aurora-fjord"
        app.buttons["roomMenuButton"].tap()
        let theme = app.buttons["roomTheme"]
        XCTAssertTrue(theme.waitForExistence(timeout: 10))
        theme.tap()
        let choice = app.buttons["roomTheme-\(target)"]
        XCTAssertTrue(choice.waitForExistence(timeout: 10))
        choice.tap()
        let restyled = NSPredicate(format: "value == %@", target)
        expectation(for: restyled, evaluatedWith: scene)
        waitForExpectations(timeout: 15)
        app.buttons["roomMenuClose"].tap()
        shot("9-theme-changed")
    }

    func testReduceMotionStillStandsUpAndLaysDown() {
        launch(["-qaReduceMotion"])
        app.buttons["roomInput"].tap()
        XCTAssertTrue(app.textViews["composerField"].waitForExistence(timeout: 10))
        shot("2-talk-reduce-motion")
        app.buttons["roomLayDown"].tap()
        XCTAssertTrue(app.buttons["roomInput"].waitForExistence(timeout: 10))
    }
}
