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

    func testTheFoldedDuoOpensOnTheRoomAndTheUnfoldedDuoKeepsTheSplitView() throws {
        guard ProcessInfo.processInfo.environment["ROOM_DUO"] != nil else { throw XCTSkip("needs the iPhone Duo simulator") }
        app.launchArguments += ["-skipPushPrompt", "YES", "-qaBotDemo", "chat", "-qaSpacesDemo", "list", "-qaLoopsDemo", "-qaRoomTheme", "forest"]
        app.launchOffline()
        XCTAssertTrue(app.buttons["roomMic"].waitForExistence(timeout: 60), "the outer screen opens on the room")
        command("outer")
        shot("duo-folded-room")
        app.buttons["roomMenuButton"].tap()
        sleep(1)
        shot("duo-folded-menu")
        app.buttons["roomMenuClose"].tap()
        command("shift?0")
        XCTAssertTrue(app.collectionViews["BotSpaceList"].waitForExistence(timeout: 15), "the unfolded Duo keeps the split view")
        shot("duo-unfolded-left-page")
        command("split-right")
        shot("duo-unfolded-right-page")
        command("outer")
        XCTAssertTrue(app.buttons["roomMic"].waitForExistence(timeout: 15), "folding again goes back to the room")
        shot("duo-folded-again")
    }
}
