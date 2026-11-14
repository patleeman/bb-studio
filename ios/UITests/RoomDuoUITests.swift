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

    private func assertOnTheLeftPage(_ element: XCUIElement, _ what: String, file: StaticString = #filePath, line: UInt = #line) {
        XCTAssertTrue(element.waitForExistence(timeout: 10), what, file: file, line: line)
        XCTAssertLessThanOrEqual(element.frame.maxX, 951 / 2 - 16 + 0.5, "\(what) stays left of the hinge", file: file, line: line)
    }

    private func assertOnTheRightPage(_ element: XCUIElement, _ what: String, shift: CGFloat, file: StaticString = #filePath, line: UInt = #line) {
        XCTAssertTrue(element.waitForExistence(timeout: 10), what, file: file, line: line)
        XCTAssertGreaterThanOrEqual(element.frame.minX + shift, 951 / 2 + 16 - 0.5, "\(what) stays right of the hinge", file: file, line: line)
    }

    func testTheUnfoldedDuoIsTheRoomOnTheLeftAndAWorkbenchOnTheRight() throws {
        guard ProcessInfo.processInfo.environment["ROOM_DUO"] != nil else { throw XCTSkip("needs the iPhone Duo simulator") }
        app.launchArguments += ["-skipPushPrompt", "YES", "-qaBotDemo", "chat", "-qaSpacesDemo", "list", "-qaLoopsDemo",
                                "-qaRoomTheme", ProcessInfo.processInfo.environment["ROOM_THEME"] ?? "forest"]
        app.launchOffline()
        if !app.buttons["roomMic"].waitForExistence(timeout: 30) {
            app.terminate()
            app.launchOffline()
        }
        XCTAssertTrue(app.buttons["roomMic"].waitForExistence(timeout: 60), "the outer screen opens on the room")
        capture("4b-folded-rest")
        command("landscape")
        assertOnTheLeftPage(app.buttons["roomMic"], "the room's mic")
        assertOnTheLeftPage(app.buttons["roomInput"], "the room's input")
        assertOnTheLeftPage(app.buttons["roomMenuButton"], "the menu button")
        XCTAssertFalse(app.collectionViews["BotSpaceList"].exists, "no split view")
        XCTAssertTrue(app.scrollViews["workbenchLauncher"].waitForExistence(timeout: 10), "an empty workbench offers places")
        assertOnTheRightPage(app.otherElements["RoomWorkbench"], "the workbench", shift: 0)
        capture("4b-landscape-rest")

        app.buttons["roomMenuButton"].tap()
        XCTAssertTrue(app.buttons["roomPlace-library"].waitForExistence(timeout: 10))
        assertOnTheLeftPage(app.buttons["roomPlace-library"], "the menu")
        capture("4b-landscape-menu")
        app.buttons["roomPlace-library"].tap()
        XCTAssertTrue(app.buttons["workbenchTab-place:library"].waitForExistence(timeout: 10), "Library opens as a tab")
        XCTAssertTrue(app.buttons["roomInput"].waitForExistence(timeout: 10), "the room goes back to rest")
        assertOnTheRightPage(app.otherElements["RoomSheet-library"], "Library, in the tab", shift: 0)
        let tiles = app.buttons.matching(NSPredicate(format: "identifier BEGINSWITH 'library-row-'"))
        XCTAssertTrue(tiles.firstMatch.waitForExistence(timeout: 10))
        let columns = Set(tiles.allElementsBoundByIndex.map { Int($0.frame.minX.rounded()) })
        XCTAssertGreaterThanOrEqual(columns.count, 3, "the Library fills the page with three or more columns")
        XCTAssertTrue(app.textFields["librarySearchField"].exists, "search sits inside the page")
        sleep(2)
        capture("4b-landscape-library")

        app.buttons["roomInput"].tap()
        XCTAssertTrue(app.textViews["composerField"].waitForExistence(timeout: 10), "the chat stands up on the left page")
        assertOnTheLeftPage(app.textViews["composerField"], "the composer")
        XCTAssertTrue(app.buttons["workbenchTab-place:library"].exists, "the workbench stays")
        sleep(1)
        capture("4b-landscape-talk")
        app.buttons["roomLayDown"].tap()
        XCTAssertTrue(app.buttons["roomInput"].waitForExistence(timeout: 10))

        command("split-right")
        app.buttons["workbenchAdd"].tap()
        app.buttons["Todos"].firstMatch.tap()
        XCTAssertTrue(app.buttons["workbenchTab-place:todos"].waitForExistence(timeout: 10), "+ opens more tabs")
        assertOnTheRightPage(app.buttons["workbenchTab-place:todos"], "the new tab", shift: 476)
        app.buttons["workbenchClose"].firstMatch.tap()
        XCTAssertFalse(app.buttons["workbenchTab-place:todos"].waitForExistence(timeout: 3), "a tab closes")
        XCTAssertTrue(app.buttons["workbenchTab-place:library"].exists, "the others stay")

        command("portrait")
        capture("4b-portrait-first")
        XCTAssertTrue(app.buttons["roomMic"].waitForExistence(timeout: 10))
        XCTAssertLessThanOrEqual(app.buttons["roomMic"].frame.maxY, 951 / 2 - 16 + 0.5, "the room is the top page")
        sleep(2)
        capture("4b-portrait-rest")
        app.buttons["roomInput"].tap()
        XCTAssertTrue(app.textViews["composerField"].waitForExistence(timeout: 10))
        XCTAssertLessThanOrEqual(app.textViews["composerField"].frame.maxY, 951 / 2 - 16 + 0.5, "the composer stays above the hinge")
        sleep(1)
        capture("4b-portrait-talk")

        command("outer")
        XCTAssertTrue(app.buttons["roomLayDown"].waitForExistence(timeout: 15), "folding keeps the chat standing")
        capture("4b-folded-talk")
        XCTAssertFalse(app.keyboards.firstMatch.exists, "folding puts the keyboard away")
        let hittable = expectation(for: NSPredicate(format: "isHittable == true"), evaluatedWith: app.textViews["composerField"])
        wait(for: [hittable], timeout: 10)
        shot("4b-folded-talk-screen")
        app.buttons["roomLayDown"].tap()
        XCTAssertTrue(app.buttons["roomMic"].waitForExistence(timeout: 15), "and lays it down to the room")
        XCTAssertFalse(app.otherElements["RoomWorkbench"].exists, "and the workbench waits for the next unfold")
        capture("4b-folded-again")
    }
}
