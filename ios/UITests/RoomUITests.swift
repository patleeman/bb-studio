import XCTest

final class RoomUITests: ServerIsolatedUITestCase {
    private let app = XCUIApplication()

    private var theme: String { ProcessInfo.processInfo.environment["ROOM_THEME"] ?? "forest" }

    private func launch(_ extra: [String] = []) {
        app.launchArguments += ["-skipPushPrompt", "YES", "-qaBotDemo", "chat", "-qaSpacesDemo", "list", "-qaLoopsDemo",
                                "-qaRoomTheme", theme] + extra
        app.launchOffline()
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

    func testTheRoomAtRestShowsTheDayAndMainLyingDown() {
        launch()
        XCTAssertTrue(app.buttons["roomMenuButton"].exists)
        XCTAssertTrue(any("roomDayLine").waitForExistence(timeout: 10), "one line about the day")
        XCTAssertTrue(app.buttons.matching(NSPredicate(format: "identifier BEGINSWITH 'roomCard-'")).firstMatch.waitForExistence(timeout: 15), "today's cards")
        XCTAssertTrue(app.buttons["RoomFloor"].exists, "Main's messages lie behind them")
        XCTAssertTrue(app.buttons["roomMic"].exists)
        XCTAssertFalse(app.textViews["composerField"].exists, "no chat while at rest")
        XCTAssertFalse(app.buttons.matching(NSPredicate(format: "identifier BEGINSWITH 'reply-in-thread-'")).firstMatch.exists,
                       "the resting chat is hidden from VoiceOver")
        shot("1-rest")
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
        XCTAssertTrue(field.waitForNonExistence(timeout: 10))
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

    func testTheFloorStandsTheChatUpToo() {
        launch()
        app.standRoomChat()
        XCTAssertTrue(app.textViews["composerField"].waitForExistence(timeout: 10))
        XCTAssertFalse(app.keyboards.firstMatch.exists, "the floor opens the chat to read, without the keyboard")
        app.buttons["roomLayDown"].tap()
        XCTAssertTrue(app.buttons["roomInput"].waitForExistence(timeout: 10))
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

    func testTheMenuOpensEachPlaceAsASheetAndPullingDownGoesBack() {
        launch()
        app.buttons["roomMenuButton"].tap()
        XCTAssertTrue(app.buttons["roomPlace-todos"].waitForExistence(timeout: 10))
        XCTAssertTrue(app.staticTexts.matching(NSPredicate(format: "label ENDSWITH ' today'")).firstMatch.exists, "Todos with today's count")
        XCTAssertTrue(app.buttons["roomWorkingNow"].exists, "what's working now")
        XCTAssertTrue(app.buttons["roomTheme"].exists)
        XCTAssertTrue(app.buttons["roomSettings"].exists)
        shot("4-menu")

        for (place, check, name) in [("todos", "loops-screen", "5-todos"), ("conversations", "roomNewConversation", "6-conversations"),
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

    func testACardOpensTodosAndAConversationOpensOverTheRoom() {
        launch()
        let card = app.buttons.matching(NSPredicate(format: "identifier BEGINSWITH 'roomCard-'")).firstMatch
        XCTAssertTrue(card.waitForExistence(timeout: 15))
        card.tap()
        XCTAssertTrue(any("loops-screen").waitForExistence(timeout: 15), "a card opens Todos")
        app.closeRoomSheet()
        app.openRoomPlace("conversations")
        let other = app.buttons.matching(NSPredicate(format: "identifier BEGINSWITH 'roomConversation-' AND NOT identifier ENDSWITH %@", "thr_botdemo01")).firstMatch
        XCTAssertTrue(other.waitForExistence(timeout: 15))
        other.tap()
        XCTAssertTrue(app.textViews["composerField"].waitForExistence(timeout: 15), "the conversation opens")
        app.navigationBars.firstMatch.buttons.element(boundBy: 0).tap()
        XCTAssertTrue(app.buttons["roomInput"].waitForExistence(timeout: 10), "back to the room")
    }

    func testMotionForTheRecording() throws {
        guard ProcessInfo.processInfo.environment["ROOM_MOTION"] != nil else { throw XCTSkip("only for the screen recording") }
        launch(ProcessInfo.processInfo.environment["ROOM_MOTION"] == "reduce" ? ["-qaReduceMotion"] : [])
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

    func testReduceMotionStillStandsUpAndLaysDown() {
        launch(["-qaReduceMotion"])
        app.buttons["roomInput"].tap()
        XCTAssertTrue(app.textViews["composerField"].waitForExistence(timeout: 10))
        shot("2-talk-reduce-motion")
        app.buttons["roomLayDown"].tap()
        XCTAssertTrue(app.buttons["roomInput"].waitForExistence(timeout: 10))
    }
}
