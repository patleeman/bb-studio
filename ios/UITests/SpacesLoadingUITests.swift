import XCTest

final class SpacesLoadingUITests: ServerIsolatedUITestCase {
    private let app = XCUIApplication()

    private var loading: XCUIElement { app.descendants(matching: .any)["spacesLoading"].firstMatch }
    private var classic: XCUIElement { app.tabBars.firstMatch }
    private var room: XCUIElement { app.buttons["roomInput"] }

    private func launch(late: String, fallback: Int? = nil, extra: [String] = []) {
        app.launchArguments += ["-skipPushPrompt", "YES", "-qaBotDemo", "chat", "-qaSpacesDemo", "list", "-qaReduceMotion",
                                "-qaSpacesLate", late] + (fallback.map { ["-qaSpacesFallback", String($0)] } ?? []) + extra
        app.launchOffline()
        let started = loading.waitForExistence(timeout: 20) || classic.exists || room.exists
        if !started {
            app.terminate()
            app.launchOffline()
        }
        guard fallback != nil else { return }
        XCTAssertTrue(loading.waitForExistence(timeout: 20), "the app opens on the neutral loading state")
        XCTAssertFalse(classic.exists, "no classic chrome while loading")
        XCTAssertFalse(room.exists, "no room layout while loading")
        shot("1-loading")
    }

    private func shot(_ name: String) {
        guard let folder = ProcessInfo.processInfo.environment["LOADING_OUT"] else { return }
        let url = URL(fileURLWithPath: folder)
        try? FileManager.default.createDirectory(at: url, withIntermediateDirectories: true)
        try? XCUIScreen.main.screenshot().pngRepresentation.write(to: url.appendingPathComponent("\(name).png"))
    }

    func testAnAnswerBeforeTheFallbackGoesStraightToTheRoom() {
        launch(late: "10000", fallback: 20000)
        let deadline = Date().addingTimeInterval(20)
        while !room.exists, Date() < deadline {
            XCTAssertFalse(classic.exists, "the classic layout never flashes")
            usleep(200_000)
        }
        XCTAssertTrue(room.exists, "the room")
        XCTAssertFalse(classic.exists)
        XCTAssertFalse(loading.exists)
    }

    func testAFallbackToClassicSwitchesToTheRoomWhenTheAnswerComes() {
        launch(late: "18000", fallback: 10000)
        XCTAssertTrue(classic.waitForExistence(timeout: 8), "classic after the fallback")
        XCTAssertFalse(loading.exists)
        XCTAssertFalse(room.exists)
        shot("2-classic")
        XCTAssertTrue(room.waitForExistence(timeout: 20), "the room on its own, no refresh")
        XCTAssertFalse(classic.exists)
        shot("3-room")
    }

    func testNeverAnsweringFallsBackToClassicAndStaysThere() {
        launch(late: "never")
        XCTAssertTrue(classic.waitForExistence(timeout: 10), "classic after about 3 s")
        XCTAssertFalse(loading.exists)
        sleep(8)
        XCTAssertTrue(classic.exists)
        XCTAssertFalse(room.exists)
        XCTAssertFalse(loading.exists, "loading shows once per launch")
    }

    func testADraftHoldsTheSwitchUntilTheChatIsPutAway() {
        launch(late: "14000")
        XCTAssertTrue(classic.waitForExistence(timeout: 10))
        let field = app.textViews["composerField"]
        if !field.waitForExistence(timeout: 20) { print("TREE-START", app.debugDescription, "TREE-END") }
        XCTAssertTrue(field.exists)
        field.tap()
        field.typeText("half a thought")
        let typed = Date()
        while Date().timeIntervalSince(typed) < 14 {
            XCTAssertFalse(room.exists, "no switch while writing")
            sleep(1)
        }
        XCTAssertTrue(classic.exists)
        XCTAssertEqual(field.value as? String, "half a thought", "the draft is still there")
        shot("4-held")
        field.typeText(String(repeating: XCUIKeyboardKey.delete.rawValue, count: "half a thought".count))
        app.staticTexts.matching(NSPredicate(format: "label CONTAINS 'approval note'")).firstMatch.tap()
        XCTAssertTrue(app.keyboards.firstMatch.waitForNonExistence(timeout: 5), "the keyboard is put away")
        XCTAssertTrue(room.waitForExistence(timeout: 15), "the room once the chat is idle")
    }

    func testASheetHoldsTheSwitchUntilItCloses() {
        launch(late: "15000")
        XCTAssertTrue(classic.waitForExistence(timeout: 10))
        let message = app.staticTexts.matching(NSPredicate(format: "label CONTAINS 'approval note'")).firstMatch
        XCTAssertTrue(message.waitForExistence(timeout: 20))
        let select = app.buttons["Select Text"]
        for _ in 0..<2 where !select.exists {
            message.press(forDuration: 1)
            _ = select.waitForExistence(timeout: 4)
        }
        select.tap()
        let done = app.navigationBars["Select Text"].buttons["Done"]
        XCTAssertTrue(done.waitForExistence(timeout: 10), "the sheet is up")
        let opened = Date()
        while Date().timeIntervalSince(opened) < 16 {
            XCTAssertFalse(room.exists, "no switch under a sheet")
            sleep(1)
        }
        XCTAssertTrue(done.exists, "the sheet is still up")
        shot("5-sheet-held")
        done.tap()
        XCTAssertTrue(room.waitForExistence(timeout: 20), "the room once the sheet closed and the chat is quiet")
    }

    func testALoopsLinkDuringLoadingOpensTheLoops() {
        launch(late: "12000", extra: ["-qaLoopsDemo", "-openURL", "bbstudio://loops"])
        let loops = app.descendants(matching: .any)["loops-screen"].firstMatch
        XCTAssertTrue(loops.waitForExistence(timeout: 20), "the link is not dropped: classic shows the Loops")
        XCTAssertFalse(loading.exists)
        sleep(14)
        XCTAssertFalse(room.exists, "the Loops hold the switch")
        app.buttons["loops-back"].firstMatch.tap()
        XCTAssertTrue(room.waitForExistence(timeout: 20), "the room once the chat is back")
        XCTAssertFalse(loops.exists, "nothing latched reopens the Loops")
    }

    func testAnExistingUserColdLaunchingIntoASheetGetsTheRoomAtOnce() {
        app.launchArguments += ["-skipPushPrompt", "YES", "-qaBotDemo", "chat", "-qaSpacesDemo", "list", "-qaReduceMotion",
                                "-openURL", "bbstudio://capture"]
        app.launchOffline()
        let sheet = app.navigationBars["Capture to BB"]
        let deadline = Date().addingTimeInterval(30)
        while !(sheet.exists && room.exists), Date() < deadline {
            XCTAssertFalse(classic.exists, "no classic frame")
            XCTAssertFalse(loading.exists, "no loading frame")
            usleep(200_000)
        }
        XCTAssertTrue(sheet.exists, "the sheet is up")
        XCTAssertTrue(room.exists, "over the room")
    }

    func testALoopsLinkForAnExistingUserOpensTheRoomsTodos() {
        app.launchArguments += ["-skipPushPrompt", "YES", "-qaBotDemo", "chat", "-qaSpacesDemo", "list", "-qaReduceMotion",
                                "-qaLoopsDemo", "-openURL", "bbstudio://loops"]
        app.launchOffline()
        XCTAssertTrue(app.descendants(matching: .any)["loops-screen"].firstMatch.waitForExistence(timeout: 30), "the room opens its Todos")
        XCTAssertFalse(classic.exists)
    }

    func testAnExistingUserTappingBotFromThreadsGetsTheRoomAtOnce() {
        app.launchArguments += ["-skipPushPrompt", "YES", "-qaBotDemo", "chat", "-qaSpacesDemo", "list", "-qaReduceMotion",
                                "-qaStartOnThreads"]
        app.launchOffline()
        let bot = app.tabBars.buttons["Bot"]
        XCTAssertTrue(bot.waitForExistence(timeout: 30), "the link opens Threads")
        XCTAssertFalse(room.exists)
        sleep(2)
        bot.tap()
        let tapped = Date()
        XCTAssertTrue(room.waitForExistence(timeout: 10))
        XCTAssertLessThan(Date().timeIntervalSince(tapped), 2.5, "the room at once, not after the touch hold")
    }
}
