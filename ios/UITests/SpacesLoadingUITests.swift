import XCTest

final class SpacesLoadingUITests: ServerIsolatedUITestCase {
    private let app = XCUIApplication()

    private var loading: XCUIElement { app.descendants(matching: .any)["spacesLoading"].firstMatch }
    private var classic: XCUIElement { app.tabBars.firstMatch }
    private var room: XCUIElement { app.buttons["roomInput"] }

    private func launch(late: String, fallback: Int? = nil) {
        app.launchArguments += ["-skipPushPrompt", "YES", "-qaBotDemo", "chat", "-qaSpacesDemo", "list", "-qaReduceMotion",
                                "-qaSpacesLate", late] + (fallback.map { ["-qaSpacesFallback", String($0)] } ?? [])
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
}
