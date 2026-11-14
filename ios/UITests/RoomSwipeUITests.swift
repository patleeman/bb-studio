import XCTest

final class RoomSwipeUITests: ServerIsolatedUITestCase {
    private let app = XCUIApplication()
    private var recording: Bool { ProcessInfo.processInfo.environment["ROOM_SWIPE_RECORD"] != nil }

    private func launch() {
        app.launchArguments += ["-skipPushPrompt", "YES", "-qaBotDemo", "chat", "-qaSpacesDemo", "list", "-qaLoopsDemo",
                                "-qaRoomTheme", ProcessInfo.processInfo.environment["ROOM_THEME"] ?? "forest"]
        app.launchOffline()
        if !app.buttons["roomMic"].waitForExistence(timeout: 30) {
            app.terminate()
            app.launchOffline()
        }
        XCTAssertTrue(app.buttons["roomMic"].waitForExistence(timeout: 60), "the app opens on the room")
        pause(2)
    }

    private func pause(_ seconds: UInt32) {
        sleep(recording ? seconds : 1)
    }

    private func swipe(_ element: XCUIElement, by dx: CGFloat, y: CGFloat = 0.5) {
        let start = element.coordinate(withNormalizedOffset: CGVector(dx: dx < 0 ? 0.8 : 0.2, dy: y))
        start.press(forDuration: 0.05, thenDragTo: start.withOffset(CGVector(dx: dx, dy: 0)), withVelocity: .default, thenHoldForDuration: 0)
    }

    private var input: XCUIElement { app.buttons["roomInput"] }
    private var floor: XCUIElement { app.descendants(matching: .any)["RoomFloor"].firstMatch }

    func testSwipingTheFloorPagesThroughTheConversationsAndTheInputFollows() {
        launch()
        XCTAssertEqual(input.label, "Message Juniper")
        XCTAssertEqual(floor.value as? String, "Conversation 1 of 4")
        swipe(floor, by: 220, y: 0.8)
        pause(2)
        XCTAssertEqual(floor.value as? String, "Conversation 1 of 4", "Main is first: a swipe back rubber-bands")
        swipe(floor, by: -220, y: 0.8)
        XCTAssertTrue(input.waitForLabel("Message Launch prep"), "the input talks to the conversation shown")
        XCTAssertEqual(floor.value as? String, "Conversation 2 of 4")
        pause(2)
        input.tap()
        XCTAssertTrue(app.textViews["composerField"].waitForExistence(timeout: 10), "the shown conversation stands up")
        XCTAssertTrue(app.staticTexts["Launch prep"].waitForExistence(timeout: 10), "it is Launch prep")
        pause(3)
        app.buttons["roomLayDown"].tap()
        XCTAssertTrue(input.waitForExistence(timeout: 10))
        XCTAssertEqual(floor.value as? String, "Conversation 2 of 4", "and lies back down where it was")
        pause(1)
        swipe(floor, by: -220, y: 0.8)
        XCTAssertTrue(floor.waitForValue("Conversation 3 of 4"))
        XCTAssertFalse(app.keyboards.firstMatch.exists, "paging at rest never brings the keyboard up")
        pause(2)
        swipe(floor, by: 220, y: 0.8)
        XCTAssertTrue(floor.waitForValue("Conversation 2 of 4"))
        pause(1)
        swipe(floor, by: 220, y: 0.8)
        XCTAssertTrue(input.waitForLabel("Message Juniper"), "back to Main")
        pause(2)
    }

    func testSwipingThePresenceSwitchesBotsAndBack() {
        launch()
        let presence = app.otherElements.matching(NSPredicate(format: "label BEGINSWITH 'Juniper, '")).firstMatch
        XCTAssertTrue(presence.waitForExistence(timeout: 10))
        swipe(presence, by: -200)
        XCTAssertTrue(app.staticTexts["roomBotToast"].waitForExistence(timeout: 5) || app.descendants(matching: .any)["roomBotToast"].exists,
                      "the next Bot's name shows")
        XCTAssertTrue(input.waitForLabel("Message Home") || input.waitForLabel("Message Research"), "the room is the next Bot's")
        let second = input.label
        pause(3)
        let next = app.otherElements.matching(NSPredicate(format: "label CONTAINS ', '")).firstMatch
        swipe(next, by: 200)
        XCTAssertTrue(input.waitForLabel("Message Juniper"), "and back")
        XCTAssertNotEqual(second, "Message Juniper")
        pause(3)
    }
}

private extension XCUIElement {
    func waitForLabel(_ label: String, timeout: TimeInterval = 8) -> Bool {
        let done = XCTNSPredicateExpectation(predicate: NSPredicate(format: "label == %@", label), object: self)
        return XCTWaiter.wait(for: [done], timeout: timeout) == .completed
    }

    func waitForValue(_ value: String, timeout: TimeInterval = 8) -> Bool {
        let done = XCTNSPredicateExpectation(predicate: NSPredicate(format: "value == %@", value), object: self)
        return XCTWaiter.wait(for: [done], timeout: timeout) == .completed
    }
}
