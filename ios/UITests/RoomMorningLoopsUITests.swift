import XCTest

final class RoomMorningLoopsUITests: ServerIsolatedUITestCase {
    private let app = XCUIApplication()
    private var device: String { ProcessInfo.processInfo.environment["ROOM_DUO"] != nil ? "duo" : "iphone" }

    private func launch(_ extra: [String] = []) {
        app.launchArguments += ["-skipPushPrompt", "YES", "-qaBotDemo", "chat", "-qaSpacesDemo", "list", "-qaLoopsDemo",
                                "-qaRoomTheme", "forest", "-qaRoomMode", "read"] + extra
        app.launchOffline()
        if !app.textViews["composerField"].waitForExistence(timeout: 30) {
            app.terminate()
            app.launchOffline()
        }
        XCTAssertTrue(app.textViews["composerField"].waitForExistence(timeout: 60), "the room's chat stands up")
    }

    private func shot(_ name: String) {
        guard let folder = ProcessInfo.processInfo.environment["ROOM_OUT"] else { return }
        let url = URL(fileURLWithPath: folder)
        try? FileManager.default.createDirectory(at: url, withIntermediateDirectories: true)
        try? XCUIScreen.main.screenshot().pngRepresentation.write(to: url.appendingPathComponent("\(device)-\(name).png"))
    }

    private var rows: XCUIElementQuery { app.buttons.matching(identifier: "loop-row") }

    private func scrollToTheMorning() {
        let heading = app.staticTexts["On today's list"]
        let window = app.windows.firstMatch.frame
        let start = app.coordinate(withNormalizedOffset: .zero).withOffset(CGVector(dx: window.width / 2, dy: window.height * 0.25))
        func placed() -> Bool { heading.exists && heading.frame.minY > window.height * 0.12 && heading.frame.maxY < window.height * 0.45 }
        for _ in 0..<40 where !placed() {
            if heading.exists, heading.frame.minY > window.height * 0.45 {
                start.withOffset(CGVector(dx: 0, dy: 160)).press(forDuration: 0.05, thenDragTo: start.withOffset(CGVector(dx: 0, dy: 40)), withVelocity: .slow, thenHoldForDuration: 0.2)
            } else {
                start.press(forDuration: 0.05, thenDragTo: start.withOffset(CGVector(dx: 0, dy: 160)), withVelocity: .slow, thenHoldForDuration: 0.2)
            }
        }
        XCTAssertTrue(placed(), "the morning card's list")
        Thread.sleep(forTimeInterval: 1)
    }

    private func wait(_ element: XCUIElement, label: String, _ what: String, file: StaticString = #filePath, line: UInt = #line) {
        let loaded = XCTNSPredicateExpectation(predicate: NSPredicate(format: "label BEGINSWITH %@", label), object: element)
        XCTAssertEqual(XCTWaiter().wait(for: [loaded], timeout: 10), .completed, "\(what): \(element.label)", file: file, line: line)
    }

    func testTheMorningCardsTodosLoadInTheRoomsChat() {
        launch()
        scrollToTheMorning()
        let tax = rows.matching(NSPredicate(format: "label BEGINSWITH %@", "Pay the property tax")).firstMatch
        XCTAssertTrue(tax.waitForExistence(timeout: 10), "a todo row shows its title, not …")
        wait(tax, label: "Pay the property tax installment", "the row is the todo")
        XCTAssertFalse(rows.matching(NSPredicate(format: "label == %@", "Loading a todo")).firstMatch.exists, "no row is left loading")
        XCTAssertTrue(rows.matching(NSPredicate(format: "label BEGINSWITH %@", "Book Thanksgiving flights")).firstMatch.exists)
        shot("morning-loaded")
    }

    func testATodoThatCantLoadSaysSoAndRetries() {
        launch(["-qaLoopsMissing", "loop_flights"])
        scrollToTheMorning()
        let failed = app.descendants(matching: .any).matching(identifier: "loop-row-failed").firstMatch
        XCTAssertTrue(failed.waitForExistence(timeout: 10), "a todo that can't load says so")
        XCTAssertTrue(app.staticTexts["Couldn't load this todo"].exists)
        XCTAssertTrue(app.staticTexts["This task was removed."].exists, "and why")
        let retry = app.buttons["loop-row-retry"]
        XCTAssertTrue(retry.exists, "with Retry")
        XCTAssertTrue(rows.matching(NSPredicate(format: "label BEGINSWITH %@", "Pay the property tax")).firstMatch.exists, "the others still load")
        shot("morning-failed")
        retry.tap()
        XCTAssertTrue(failed.waitForExistence(timeout: 10), "a todo that is still gone says so again after Retry")
    }
}
