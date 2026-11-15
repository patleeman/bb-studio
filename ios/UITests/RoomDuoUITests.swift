import XCTest

final class RoomDuoUITests: ServerIsolatedUITestCase {
    private let app = XCUIApplication()

    private func command(_ path: String) {
        XCUIDevice.shared.system.open(URL(string: "bbstudio://qa-duo/" + path)!)
        sleep(3)
    }

    private func shot(_ name: String) {
        guard let folder = ProcessInfo.processInfo.environment["ROOM_OUT"] else { return }
        let url = URL(fileURLWithPath: folder)
        try? FileManager.default.createDirectory(at: url, withIntermediateDirectories: true)
        try? XCUIScreen.main.screenshot().pngRepresentation.write(to: url.appendingPathComponent("\(name).png"))
    }

    private func capture(_ name: String) {
        command("capture?" + name)
    }

    private func hinge() -> [Int] {
        guard let text = app.windows.firstMatch.value as? String,
              let json = try? JSONSerialization.jsonObject(with: Data(text.utf8)) as? [String: Any] else { return [] }
        return (json["hingeCenter"] as? [Int]) ?? []
    }

    private func assertNoBand(_ what: String, file: StaticString = #filePath, line: UInt = #line) {
        let pixel = hinge()
        XCTAssertEqual(pixel.count, 3, "the hinge's pixel was read", file: file, line: line)
        XCTAssertGreaterThan(pixel.reduce(0, +), 30, "\(what): the scene runs across the hinge, no black band (\(pixel))", file: file, line: line)
    }

    private func assertOnTheLeftPage(_ element: XCUIElement, _ what: String, file: StaticString = #filePath, line: UInt = #line) {
        XCTAssertTrue(element.waitForExistence(timeout: 10), what, file: file, line: line)
        XCTAssertLessThanOrEqual(element.frame.maxX, 951 / 2 - 16 + 0.5, "\(what) stays left of the hinge", file: file, line: line)
    }

    private func assertOnTheRightPage(_ element: XCUIElement, _ what: String, shift: CGFloat, file: StaticString = #filePath, line: UInt = #line) {
        XCTAssertTrue(element.waitForExistence(timeout: 10), what, file: file, line: line)
        XCTAssertGreaterThanOrEqual(element.frame.minX + shift, 951 / 2 + 16 - 0.5, "\(what) stays right of the hinge", file: file, line: line)
    }

    private func press(_ id: String) {
        let element = app.buttons[id]
        if element.isHittable && element.frame.maxX <= 466 && element.frame.maxY <= 678 { element.tap() } else { command("activate?" + id) }
    }

    private func assertTheMenuClosesFromTheMenuButtonsSpot(_ posture: String, file: StaticString = #filePath, line: UInt = #line) {
        let menu = app.buttons["roomMenuButton"]
        XCTAssertTrue(menu.waitForExistence(timeout: 15), "\(posture): the menu button", file: file, line: line)
        sleep(1)
        let spot = menu.frame
        XCTAssertGreaterThanOrEqual(min(spot.width, spot.height), 44, "\(posture): a 44-point target", file: file, line: line)
        press("roomMenuButton")
        let close = app.buttons["roomMenuClose"]
        XCTAssertTrue(close.waitForExistence(timeout: 10), "\(posture): the menu's close", file: file, line: line)
        XCTAssertTrue(app.buttons["roomPlace-tasks"].waitForExistence(timeout: 10), file: file, line: line)
        sleep(1)
        XCTAssertEqual(app.buttons.matching(identifier: "roomMenuClose").count, 1, "\(posture): one close", file: file, line: line)
        XCTAssertEqual(close.label, "Back to the room", file: file, line: line)
        XCTAssertEqual(close.frame.minX, spot.minX, accuracy: 0.5, "\(posture): close where the menu button was", file: file, line: line)
        XCTAssertEqual(close.frame.minY, spot.minY, accuracy: 0.5, "\(posture): close where the menu button was", file: file, line: line)
        XCTAssertEqual(close.frame.width, spot.width, accuracy: 0.5, file: file, line: line)
        XCTAssertEqual(close.frame.height, spot.height, accuracy: 0.5, file: file, line: line)
        let gutter = spot.minX - 8
        for id in ["roomPlace-tasks", "roomPlace-schedules", "roomWorkingNow", "roomTheme", "roomSettings"] where app.buttons[id].exists {
            XCTAssertLessThanOrEqual(app.buttons[id].frame.maxX, gutter, "\(posture): \(id) stays out of the rail", file: file, line: line)
        }
        press("roomMenuClose")
        XCTAssertTrue(menu.waitForExistence(timeout: 10), "\(posture): back to the room", file: file, line: line)
        sleep(1)
        XCTAssertEqual(menu.frame.minX, spot.minX, accuracy: 0.5, file: file, line: line)
        XCTAssertEqual(menu.frame.minY, spot.minY, accuracy: 0.5, file: file, line: line)
    }

    func testTheMenuClosesFromTheMenuButtonsSpotOnTheRail() throws {
        guard ProcessInfo.processInfo.environment["ROOM_DUO"] != nil else { throw XCTSkip("needs the iPhone Duo simulator") }
        app.launchArguments += ["-skipPushPrompt", "YES", "-qaBotDemo", "chat", "-qaSpacesDemo", "list", "-qaLoopsDemo", "-qaRoomTheme", "forest"]
        app.launchOffline()
        if !app.buttons["roomMenuButton"].waitForExistence(timeout: 30) {
            app.terminate()
            app.launchOffline()
        }
        XCTAssertTrue(app.buttons["roomMenuButton"].waitForExistence(timeout: 60))
        assertTheMenuClosesFromTheMenuButtonsSpot("folded")
        command("landscape")
        assertTheMenuClosesFromTheMenuButtonsSpot("landscape")
        command("portrait")
        assertTheMenuClosesFromTheMenuButtonsSpot("portrait")
        press("roomMenuButton")
        for id in ["roomPlace-tasks", "roomPlace-schedules", "roomTheme", "roomSettings"] {
            XCTAssertTrue(app.buttons[id].waitForExistence(timeout: 5), id)
            XCTAssertLessThanOrEqual(app.buttons[id].frame.maxY, 951 / 2 - 16 + 0.5, "portrait: \(id) fits the top page")
            XCTAssertGreaterThanOrEqual(app.buttons[id].frame.minY, 0, "portrait: \(id) isn't cut off")
        }
        press("roomMenuClose")
        command("outer")
        press("roomMenuButton")
        XCTAssertTrue(app.buttons["roomMenuClose"].waitForExistence(timeout: 10))
        command("landscape")
        XCTAssertTrue(app.buttons["roomMenuClose"].waitForExistence(timeout: 10), "the menu stays open across unfolding")
        XCTAssertEqual(app.buttons.matching(identifier: "roomMenuClose").count, 1)
        command("outer")
        XCTAssertTrue(app.buttons["roomMenuClose"].waitForExistence(timeout: 10), "and folding from landscape")
        press("roomMenuClose")
        assertTheMenuClosesFromTheMenuButtonsSpot("folded again")
    }

    private func assertOnTheTopPage(_ element: XCUIElement, _ what: String, file: StaticString = #filePath, line: UInt = #line) {
        XCTAssertTrue(element.waitForExistence(timeout: 10), what, file: file, line: line)
        XCTAssertLessThanOrEqual(element.frame.maxY, 951 / 2 - 16 + 0.5, "\(what) stays above the hinge", file: file, line: line)
    }

    private func assertOnTheBottomPage(_ element: XCUIElement, _ what: String, file: StaticString = #filePath, line: UInt = #line) {
        XCTAssertTrue(element.waitForExistence(timeout: 10), what, file: file, line: line)
        XCTAssertGreaterThanOrEqual(element.frame.minY, 951 / 2 + 16 - 0.5, "\(what) stays below the hinge", file: file, line: line)
    }

    private func any(_ id: String) -> XCUIElement { app.descendants(matching: .any)[id].firstMatch }

    private func openPlace(_ place: String, check: String, portrait: Bool = false) {
        command("activate?roomMenuButton")
        let row = app.buttons["roomPlace-\(place)"]
        XCTAssertTrue(row.waitForExistence(timeout: 10), "\(place) in the menu")
        if portrait { assertOnTheTopPage(row, "the menu") } else { assertOnTheLeftPage(row, "the menu") }
        row.tap()
        XCTAssertTrue(any("RoomSpread").waitForExistence(timeout: 10), "\(place) opens across both screens")
        XCTAssertTrue(any(check).waitForExistence(timeout: 15), "\(place)'s list")
    }

    private func closePlace() {
        let back = app.buttons["roomSpreadBack"]
        XCTAssertTrue(back.waitForExistence(timeout: 10), "one way back to the room")
        back.tap()
        XCTAssertTrue(app.buttons["roomNow"].waitForExistence(timeout: 10), "back to the room")
    }

    func testTheUnfoldedDuoIsOneRoomAcrossBothScreens() throws {
        guard ProcessInfo.processInfo.environment["ROOM_DUO"] != nil else { throw XCTSkip("needs the iPhone Duo simulator") }
        app.launchArguments += ["-skipPushPrompt", "YES", "-qaBotDemo", "chat", "-qaSpacesDemo", "list", "-qaLoopsDemo", "-qaRoomLead",
                                "-qaRoomTheme", ProcessInfo.processInfo.environment["ROOM_THEME"] ?? "forest"]
        app.launchOffline()
        if !app.buttons["roomMic"].waitForExistence(timeout: 30) {
            app.terminate()
            app.launchOffline()
        }
        XCTAssertTrue(app.buttons["roomMic"].waitForExistence(timeout: 60), "the outer screen opens on the room")
        XCTAssertTrue(app.buttons["roomNow"].waitForExistence(timeout: 10))
        sleep(2)
        capture("p-folded-main")
        shot("p-folded-main-screen")

        command("landscape")
        sleep(2)
        assertOnTheLeftPage(app.buttons["roomNow"], "the presence screen's Now line")
        assertOnTheLeftPage(any("roomTitle"), "the name")
        assertOnTheLeftPage(app.buttons["roomCard-wc_demo_fork"], "a row on it")
        XCTAssertTrue(app.textViews["composerField"].waitForExistence(timeout: 10), "the conversation itself is open")
        assertOnTheRightPage(app.textViews["composerField"], "its input", shift: 0)
        assertOnTheRightPage(any("roomConversation"), "the conversation", shift: 0)
        XCTAssertFalse(app.buttons["roomInput"].exists, "one input: the conversation's")
        XCTAssertFalse(app.collectionViews["BotSpaceList"].exists, "no split view")
        XCTAssertFalse(app.buttons.matching(NSPredicate(format: "identifier BEGINSWITH 'roomConversation-'")).firstMatch.exists,
                       "the conversations list isn't on the right")
        XCTAssertTrue(app.buttons["roomMenuButton"].exists, "the rail has the menu")
        XCTAssertGreaterThan(app.buttons["roomMenuButton"].frame.minX, 951 - 100, "in the rail")
        sleep(2)
        capture("p-landscape-main")
        assertNoBand("landscape")

        command("shift?240")
        let stage = any("RoomStage")
        stage.swipeLeft()
        XCTAssertTrue(any("roomTitle").waitForLabel(prefix: "Launch prep"), "a swipe on the left moves both screens to the next conversation")
        XCTAssertTrue(app.staticTexts["Launch prep"].exists || app.textViews["composerField"].exists)
        command("landscape")
        sleep(3)
        capture("p-landscape-lead")
        assertNoBand("landscape, another light")
        command("shift?240")
        any("RoomStage").swipeRight()
        XCTAssertTrue(any("roomTitle").waitForLabel(prefix: "Juniper"), "and back")
        command("landscape")

        openPlace("memory", check: "memoryProfile")
        XCTAssertFalse(app.buttons["roomNow"].isHittable, "the place covers both screens")
        assertOnTheRightPage(any("roomSpreadEmpty"), "the item's page", shift: 0)
        let records = app.buttons.matching(NSPredicate(format: "identifier BEGINSWITH 'memory-record-' OR identifier BEGINSWITH 'memoryRecord'"))
        if records.firstMatch.waitForExistence(timeout: 5) {
            assertOnTheLeftPage(records.firstMatch, "the list")
        }
        sleep(2)
        capture("p-landscape-memory")
        closePlace()

        openPlace("library", check: "library-page")
        let tiles = app.buttons.matching(NSPredicate(format: "identifier BEGINSWITH 'library-row-'"))
        XCTAssertTrue(tiles.firstMatch.waitForExistence(timeout: 10))
        assertOnTheLeftPage(tiles.firstMatch, "the Library's list")
        tiles.firstMatch.tap()
        XCTAssertTrue(any("roomSpreadDetail").waitForExistence(timeout: 10), "an item opens on the right")
        assertOnTheRightPage(any("roomSpreadDetail"), "the item", shift: 0)
        sleep(2)
        capture("p-landscape-library")
        closePlace()

        openPlace("tasks", check: "tasks-screen")
        let task = app.buttons["task-row-task_demo_quote"]
        XCTAssertTrue(task.waitForExistence(timeout: 10))
        assertOnTheLeftPage(task, "a task in the list")
        task.tap()
        XCTAssertTrue(any("task-task_demo_quote").waitForExistence(timeout: 10), "the task opens on the right")
        assertOnTheRightPage(any("roomSpreadTask"), "the task", shift: 0)
        sleep(2)
        capture("p-landscape-tasks")
        closePlace()

        command("portrait")
        sleep(3)
        assertOnTheTopPage(app.buttons["roomNow"], "the presence screen")
        assertOnTheBottomPage(app.textViews["composerField"], "the conversation's input")
        capture("p-portrait-main")
        assertNoBand("portrait")
        openPlace("memory", check: "memoryProfile", portrait: true)
        sleep(2)
        capture("p-portrait-memory")
        closePlace()

        command("outer")
        XCTAssertTrue(app.buttons["roomMic"].waitForExistence(timeout: 15), "folding goes back to the room")
        app.openRoomPlace("library")
        XCTAssertTrue(any("RoomSheet-library").waitForExistence(timeout: 10), "a place opens as a sheet when folded")
        command("landscape")
        XCTAssertTrue(any("RoomSpread").waitForExistence(timeout: 10), "and stays open across both screens when unfolded")
        XCTAssertTrue(any("library-page").waitForExistence(timeout: 10))
        capture("p-unfold-library")
        command("outer")
        XCTAssertTrue(any("RoomSheet-library").waitForExistence(timeout: 10), "and folds back into its sheet")
        app.closeRoomSheet()
        if app.buttons["roomMenuClose"].waitForExistence(timeout: 5) { app.buttons["roomMenuClose"].tap() }
        XCTAssertTrue(app.buttons["roomInput"].waitForExistence(timeout: 10))
        XCTAssertFalse(any("roomConversation").exists)
        app.buttons["roomInput"].tap()
        XCTAssertTrue(app.buttons["roomLayDown"].waitForExistence(timeout: 10), "the conversation stands up on the outer screen")
        command("landscape")
        XCTAssertTrue(app.textViews["composerField"].waitForExistence(timeout: 10), "unfolding with it open puts it on the right")
        assertOnTheRightPage(app.textViews["composerField"], "the conversation", shift: 0)
        XCTAssertTrue(app.buttons["roomNow"].exists, "beside the presence screen")
        capture("p-unfold-standing")
        command("outer")
        XCTAssertTrue(app.buttons["roomMic"].waitForExistence(timeout: 15))
    }

    func testTheRecording() throws {
        guard ProcessInfo.processInfo.environment["ROOM_RECORD"] != nil else { throw XCTSkip("only for the recording") }
        app.launchArguments += ["-skipPushPrompt", "YES", "-qaBotDemo", "chat", "-qaSpacesDemo", "list", "-qaLoopsDemo", "-qaRoomLead",
                                "-qaRoomTheme", ProcessInfo.processInfo.environment["ROOM_THEME"] ?? "forest"]
        app.launchOffline()
        if !app.buttons["roomNow"].waitForExistence(timeout: 30) {
            app.terminate()
            app.launchOffline()
        }
        XCTAssertTrue(app.buttons["roomNow"].waitForExistence(timeout: 60))
        sleep(4)
        command("record?start")
        sleep(2)
        let stage = any("RoomStage")
        stage.swipeLeft()
        XCTAssertTrue(any("roomTitle").waitForLabel(prefix: "Launch prep"))
        sleep(3)
        stage.swipeUp()
        XCTAssertTrue(app.buttons["roomLayDown"].waitForExistence(timeout: 10))
        sleep(3)
        app.buttons["roomLayDown"].tap()
        sleep(2)
        stage.swipeRight()
        sleep(2)
        command("landscape")
        sleep(5)
        command("record?stop")
    }
}

private extension XCUIElement {
    func waitForLabel(prefix: String, timeout: TimeInterval = 8) -> Bool {
        let done = XCTNSPredicateExpectation(predicate: NSPredicate(format: "label BEGINSWITH %@", prefix), object: self)
        return XCTWaiter.wait(for: [done], timeout: timeout) == .completed
    }
}
