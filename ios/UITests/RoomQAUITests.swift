import XCTest

final class RoomQAUITests: ServerIsolatedUITestCase {
    private let app = XCUIApplication()
    private var theme: String { ProcessInfo.processInfo.environment["ROOM_THEME"] ?? "forest" }
    private var duo: Bool { ProcessInfo.processInfo.environment["ROOM_DUO"] != nil }

    private func launch(_ extra: [String] = [], loops: Bool = true, expectRoom: Bool = true) {
        app.launchArguments += ["-skipPushPrompt", "YES", "-qaBotDemo", "chat", "-qaSpacesDemo", "list", "-qaRoomTheme", theme]
            + (loops ? ["-qaLoopsDemo"] : []) + extra
        app.launchOffline()
        guard expectRoom else { return }
        if !app.buttons["roomMic"].waitForExistence(timeout: 30) {
            app.terminate()
            app.launchOffline()
        }
        XCTAssertTrue(app.buttons["roomMic"].waitForExistence(timeout: 60), "the app opens on the room")
        sleep(2)
    }

    private func shot(_ name: String) {
        guard let folder = ProcessInfo.processInfo.environment["ROOM_OUT"] else { return }
        sleep(1)
        let url = URL(fileURLWithPath: folder)
        try? FileManager.default.createDirectory(at: url, withIntermediateDirectories: true)
        try? XCUIScreen.main.screenshot().pngRepresentation.write(to: url.appendingPathComponent("qa-\(theme)-\(name).png"))
    }

    private func command(_ path: String) {
        XCUIDevice.shared.system.open(URL(string: "bbstudio://qa-duo/" + path)!)
        sleep(3)
    }

    private func waitHittable(_ element: XCUIElement, _ what: String) {
        let done = XCTNSPredicateExpectation(predicate: NSPredicate(format: "isHittable == true"), object: element)
        XCTAssertEqual(XCTWaiter.wait(for: [done], timeout: 10), .completed, what)
    }

    func testOneBotRubberBandsAndShowsNoToast() {
        launch(["-qaOneBot"])
        let presence = app.otherElements.matching(NSPredicate(format: "label BEGINSWITH 'Juniper, '")).firstMatch
        XCTAssertTrue(presence.waitForExistence(timeout: 10))
        let start = presence.coordinate(withNormalizedOffset: CGVector(dx: 0.8, dy: 0.5))
        start.press(forDuration: 0.05, thenDragTo: start.withOffset(CGVector(dx: -200, dy: 0)))
        XCTAssertFalse(app.staticTexts["roomBotToast"].waitForExistence(timeout: 2), "no other Bot to switch to")
        XCTAssertEqual(app.buttons["roomInput"].label, "Message Juniper")
        shot("one-bot")
    }

    func testNoTodosLeavesTheDayQuiet() {
        launch(["-qaLoopsEmpty"])
        XCTAssertTrue(app.descendants(matching: .any)["roomDayLine"].waitForExistence(timeout: 10))
        XCTAssertFalse(app.buttons.matching(NSPredicate(format: "identifier BEGINSWITH 'roomCard-'")).firstMatch.exists, "no cards")
        shot("no-todos")
    }

    func testLongMessagesAndCodeLieOnTheFloorAndStandUp() {
        launch(["-qaDemoMessages", "14"], loops: false)
        shot("long-rest")
        app.buttons["RoomFloor"].tap()
        waitHittable(app.buttons["roomLayDown"], "the chat stands up to read")
        shot("long-read")
    }

    func testDynamicTypeXXL() {
        launch(["-UIPreferredContentSizeCategoryName", "UICTContentSizeCategoryXXL"])
        waitHittable(app.buttons["roomInput"], "the input")
        waitHittable(app.buttons["roomMenuButton"], "the menu")
        shot("xxl-rest")
        app.buttons["roomInput"].tap()
        XCTAssertTrue(app.textViews["composerField"].waitForExistence(timeout: 10))
        shot("xxl-talk")
        app.buttons["roomLayDown"].tap()
        app.buttons["roomMenuButton"].tap()
        XCTAssertTrue(app.buttons["roomPlace-todos"].waitForExistence(timeout: 10))
        shot("xxl-menu")
    }

    func testBackgroundAndForegroundKeepTheRoom() {
        launch()
        app.buttons["roomInput"].tap()
        XCTAssertTrue(app.textViews["composerField"].waitForExistence(timeout: 10))
        XCUIDevice.shared.press(.home)
        sleep(3)
        app.activate()
        waitHittable(app.buttons["roomLayDown"], "the chat is still standing")
        app.buttons["roomLayDown"].tap()
        XCTAssertTrue(app.buttons["roomInput"].waitForExistence(timeout: 10))
        XCUIDevice.shared.press(.home)
        sleep(3)
        app.activate()
        waitHittable(app.buttons["roomInput"], "the room is back at rest")
        shot("foreground")
    }

    func testEveryControlHasALabel() throws {
        launch()
        try app.performAccessibilityAudit(for: [.sufficientElementDescription])
        app.buttons["roomInput"].tap()
        XCTAssertTrue(app.textViews["composerField"].waitForExistence(timeout: 10))
        try app.performAccessibilityAudit(for: [.sufficientElementDescription])
        app.buttons["roomLayDown"].tap()
        app.buttons["roomMenuButton"].tap()
        XCTAssertTrue(app.buttons["roomPlace-todos"].waitForExistence(timeout: 10))
        try app.performAccessibilityAudit(for: [.sufficientElementDescription])
    }

    func testASlowServerStillOpensTheRoom() {
        launch(["-qaDemoLatency", "2500"], expectRoom: false)
        sleep(2)
        shot("slow-early")
        XCTAssertTrue(app.buttons["roomMic"].waitForExistence(timeout: 60), "the room arrives")
        sleep(4)
        shot("slow-late")
        app.buttons["roomInput"].tap()
        XCTAssertTrue(app.textViews["composerField"].waitForExistence(timeout: 20))
    }

    func testOfflineOffersRetry() {
        app.launchArguments += ["-skipPushPrompt", "YES"]
        app.launchOffline()
        sleep(8)
        shot("offline")
        let retry = app.buttons.matching(NSPredicate(format: "label CONTAINS[c] 'Retry' OR label CONTAINS[c] 'Try again'")).firstMatch
        XCTAssertTrue(retry.waitForExistence(timeout: 20), "an offline launch says so and offers Retry")
        retry.tap()
        sleep(2)
        XCTAssertTrue(app.state == .runningForeground)
    }

    func testLandscapeKeepsTheRoomUsable() {
        launch()
        XCUIDevice.shared.orientation = .landscapeLeft
        sleep(2)
        waitHittable(app.buttons["roomInput"], "the input in landscape")
        shot("landscape-rest")
        app.buttons["roomInput"].tap()
        XCTAssertTrue(app.textViews["composerField"].waitForExistence(timeout: 10))
        shot("landscape-talk")
        XCUIDevice.shared.orientation = .portrait
        sleep(2)
        waitHittable(app.buttons["roomLayDown"], "back in portrait, still standing")
    }

    func testUnfoldingDuringTheSwingUpLandsCleanly() throws {
        guard duo else { throw XCTSkip("needs the iPhone Duo simulator") }
        launch()
        app.buttons["roomInput"].tap()
        XCUIDevice.shared.system.open(URL(string: "bbstudio://qa-duo/landscape")!)
        sleep(4)
        XCTAssertTrue(app.textViews["composerField"].exists, "the chat stood up")
        XCTAssertTrue(app.otherElements["RoomWorkbench"].exists, "beside the workbench")
        command("capture?qa-unfold-mid-swing")
        app.buttons["roomLayDown"].tap()
        XCUIDevice.shared.system.open(URL(string: "bbstudio://qa-duo/outer")!)
        sleep(4)
        waitHittable(app.buttons["roomInput"], "folding mid-way lands at rest")
        XCTAssertFalse(app.otherElements["RoomWorkbench"].exists)
        command("capture?qa-fold-mid-lay")
    }
}
