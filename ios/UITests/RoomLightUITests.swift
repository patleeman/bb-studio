import XCTest

final class RoomLightUITests: ServerIsolatedUITestCase {
    private let app = XCUIApplication()
    private var duo: Bool { ProcessInfo.processInfo.environment["ROOM_DUO"] != nil }
    private var theme: String { ProcessInfo.processInfo.environment["ROOM_THEME"] ?? "forest" }
    private var device: String { duo ? "duo" : "iphone" }
    private var checks: Bool { ProcessInfo.processInfo.environment["ROOM_LIGHT_STILLS_ONLY"] == nil }

    private func launch() {
        app.launchArguments += ["-skipPushPrompt", "YES", "-qaBotDemo", "chat", "-qaSpacesDemo", "list", "-qaLoopsDemo", "-qaRoomTheme", theme]
        app.launchOffline()
        if !app.buttons["roomMic"].waitForExistence(timeout: 30) {
            app.terminate()
            app.launchOffline()
        }
        XCTAssertTrue(app.buttons["roomMic"].waitForExistence(timeout: 60), "the app opens on the room")
    }

    private func command(_ path: String, wait: TimeInterval = 3) {
        XCUIDevice.shared.system.open(URL(string: "bbstudio://qa-duo/" + path)!)
        Thread.sleep(forTimeInterval: wait)
    }

    private func shot(_ name: String) {
        guard let folder = ProcessInfo.processInfo.environment["ROOM_OUT"] else { return }
        let url = URL(fileURLWithPath: folder)
        try? FileManager.default.createDirectory(at: url, withIntermediateDirectories: true)
        try? XCUIScreen.main.screenshot().pngRepresentation.write(to: url.appendingPathComponent("\(device)-\(theme)-\(name).png"))
    }

    private func capture(_ name: String) {
        guard ProcessInfo.processInfo.environment["ROOM_OUT"] != nil else { return }
        command("capture?\(device)-\(theme)-\(name)")
    }

    private func any(_ id: String) -> XCUIElement { app.descendants(matching: .any)[id].firstMatch }

    private var floor: XCUIElement { any("RoomStage") }

    private func assertTheLightIsClear(_ when: String, pageRight: CGFloat? = nil, file: StaticString = #filePath, line: UInt = #line) {
        guard checks else { return }
        let marker = any("roomLightSpot")
        XCTAssertTrue(marker.waitForExistence(timeout: 10), "the scene light has a place \(when)", file: file, line: line)
        let light = marker.frame.insetBy(dx: -8, dy: -8)
        let slot = any("roomPresence")
        XCTAssertTrue(slot.exists, "the presence \(when)", file: file, line: line)
        let crystal = CGRect(x: slot.frame.midX - slot.frame.height / 2, y: slot.frame.minY, width: slot.frame.height, height: slot.frame.height)
        XCTAssertFalse(light.intersects(crystal), "the light (\(light)) stays off the presence (\(crystal)) \(when)", file: file, line: line)
        for id in ["roomTitle", "roomNow", "roomMenuButton"] where any(id).exists {
            XCTAssertFalse(light.intersects(any(id).frame), "the light (\(light)) stays off \(id) (\(any(id).frame)) \(when)", file: file, line: line)
        }
        let rows = app.descendants(matching: .any).matching(NSPredicate(format: "identifier BEGINSWITH 'roomCard-'"))
        for index in 0..<rows.count {
            let row = rows.element(boundBy: index)
            XCTAssertFalse(light.intersects(row.frame), "the light (\(light)) stays off a row (\(row.frame)) \(when)", file: file, line: line)
        }
        XCTAssertLessThan(light.midY, crystal.midY, "the light sits up in the corner, above the presence's middle \(when)", file: file, line: line)
        XCTAssertGreaterThan(light.midX, crystal.maxX, "the light sits in the outer corner \(when)", file: file, line: line)
        if let pageRight {
            XCTAssertLessThan(light.maxX, pageRight, "the light stays on the presence's page \(when)", file: file, line: line)
        }
    }

    func testTheSceneLightSitsInTheCornerClearOfThePresenceAndTheRows() {
        launch()
        Thread.sleep(forTimeInterval: 8)
        assertTheLightIsClear("on Main")
        shot("presence-main")
        if duo {
            command("landscape", wait: 10)
            assertTheLightIsClear("unfolded, landscape", pageRight: 951 / 2 - 16)
            capture("unfolded-presence-main")
            command("portrait", wait: 10)
            assertTheLightIsClear("unfolded, portrait")
            capture("unfolded-portrait-presence-main")
            command("outer", wait: 5)
        }
        let start = floor.coordinate(withNormalizedOffset: CGVector(dx: 0.8, dy: 0.8))
        start.press(forDuration: 0.05, thenDragTo: start.withOffset(CGVector(dx: -220, dy: 0)), withVelocity: .default, thenHoldForDuration: 0)
        let next = XCTNSPredicateExpectation(predicate: NSPredicate(format: "value == %@", "Conversation 2 of 4"), object: floor)
        XCTAssertEqual(XCTWaiter().wait(for: [next], timeout: 10), .completed, "the next conversation, in its own light")
        Thread.sleep(forTimeInterval: 4)
        assertTheLightIsClear("in another conversation's light")
        shot("presence-lead")
        if duo {
            command("landscape", wait: 10)
            assertTheLightIsClear("unfolded, another light", pageRight: 951 / 2 - 16)
            capture("unfolded-presence-lead")
            command("outer", wait: 5)
        }
    }
}
