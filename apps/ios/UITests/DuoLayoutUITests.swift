import XCTest

/// Run on an owned 13-inch iPad simulator, which fits each Duo-sized window.
/// The debug URL resizes the existing UIWindow; it never relaunches the app.
final class DuoLayoutUITests: XCTestCase {
    func testThreadAndDraftSurviveThreeWindowSizes() throws {
        let app = XCUIApplication()
        app.launchArguments = ["-skipPushPrompt", "YES", "-serverURL", "http://127.0.0.1:9",
                               "-qaBotDemo", "duo", "-openURL", "bbstudio://thread/thr_botdemo01"]
        app.launch()
        let composer = app.textViews["Message"]
        XCTAssertTrue(composer.waitForExistence(timeout: 20))
        resize(app, "outer", CGSize(width: 466, height: 678))
        let session = app.windows.firstMatch.identifier
        composer.tap()
        composer.typeText("Keep this Duo draft")
        // Dismiss the keyboard using the transcript's existing interactive gesture.
        let window = app.windows.firstMatch
        let start = window.coordinate(withNormalizedOffset: CGVector(dx: 0.5, dy: 0.3))
        let end = window.coordinate(withNormalizedOffset: CGVector(dx: 0.5, dy: 0.7))
        for _ in 0..<8 { start.press(forDuration: 0.05, thenDragTo: end) }
        let marker = app.staticTexts.matching(NSPredicate(format: "label BEGINSWITH %@", "Duo message ")).allElementsBoundByIndex
            .first { $0.isHittable && $0.frame.midY > 150 && $0.frame.midY < 400 }
        let anchor = try XCTUnwrap(marker, "A message halfway through the transcript is visible")
        let label = anchor.label
        let messageNumber = Int(label.split(separator: " ")[2].dropLast()) ?? 80
        XCTAssertLessThan(messageNumber, 65, "Start well above the bottom anchor")
        XCTAssertGreaterThan(messageNumber, 10, "Start away from the top")
        let before = anchor.frame.minY
        screenshot(app, "built-outer")

        for (name, size) in [("landscape", CGSize(width: 951, height: 669)),
                             ("portrait", CGSize(width: 669, height: 951)),
                             ("outer", CGSize(width: 466, height: 678))] {
            resize(app, name, size)
            XCTAssertEqual(app.windows.firstMatch.identifier, session, "Resize must not relaunch the process")
            XCTAssertEqual(composer.value as? String, "Keep this Duo draft")
            if name == "landscape" {
                XCTAssertEqual(app.staticTexts["duoThreadTitle"].label, "Juniper", "Same selected thread")
            } else {
                XCTAssertTrue(app.navigationBars["Juniper"].exists, "Same selected thread")
            }
            XCTAssertEqual(app.navigationBars["Juniper"].buttons["Threads"].exists, name != "landscape")
            let retained = app.staticTexts[label].firstMatch
            XCTAssertTrue(retained.exists, "Visible message survives the resize")
            if retained.exists {
                XCTAssertEqual(retained.frame.minY, before, accuracy: 90, "Scroll position stays near the same message")
            }
            screenshot(app, "built-\(name)")
        }
    }

    func testNewestMessageStaysPinnedThroughThreeWindowSizes() {
        let app = XCUIApplication()
        app.launchArguments = ["-skipPushPrompt", "YES", "-serverURL", "http://127.0.0.1:9",
                               "-qaBotDemo", "duo", "-openURL", "bbstudio://thread/thr_botdemo01"]
        app.launch()
        XCTAssertTrue(app.textViews["Message"].waitForExistence(timeout: 20))
        for (name, size) in [("outer", CGSize(width: 466, height: 678)),
                             ("landscape", CGSize(width: 951, height: 669)),
                             ("portrait", CGSize(width: 669, height: 951)),
                             ("outer", CGSize(width: 466, height: 678))] {
            resize(app, name, size)
            let last = app.staticTexts["Duo message 80. Review the launch checklist and keep the release notes ready."]
            let pinned = NSPredicate { _, _ in last.isHittable && !app.buttons["Jump to latest"].exists }
            expectation(for: pinned, evaluatedWith: nil)
            waitForExpectations(timeout: 5)
            screenshot(app, "pinned-\(name)")
        }
    }

    func testKeyboardLeavesListAndRightComposerUsable() {
        XCUIDevice.shared.orientation = .landscapeLeft
        defer { XCUIDevice.shared.orientation = .portrait }
        let app = XCUIApplication()
        app.launchArguments = ["-skipPushPrompt", "YES", "-serverURL", "http://127.0.0.1:9",
                               "-qaBotDemo", "duo", "-openURL", "bbstudio://thread/thr_botdemo01"]
        app.launch()
        let composer = app.textViews["Message"]
        XCTAssertTrue(composer.waitForExistence(timeout: 20))
        composer.tap()
        let keyboard = app.keyboards.firstMatch
        XCTAssertTrue(keyboard.waitForExistence(timeout: 5))
        let window = app.windows.firstMatch
        XCTAssertGreaterThan(window.frame.width, 900)
        XCTAssertGreaterThan(composer.frame.minX, window.frame.width / 2 + 15)
        XCTAssertLessThanOrEqual(composer.frame.maxY, keyboard.frame.minY + 1)
        XCTAssertEqual(keyboard.frame.width, window.frame.width, accuracy: 2)
        let selection = app.buttons["inbox-thread-thr_botdemo01"]
        XCTAssertTrue(selection.isHittable, "The thread list stays usable with the keyboard shown")
        XCTAssertLessThan(selection.frame.maxX, window.frame.width / 2 - 15)
        screenshot(app, "built-ipad-keyboard")
    }

    private func resize(_ app: XCUIApplication, _ name: String, _ size: CGSize) {
        XCUIDevice.shared.system.open(URL(string: "bbstudio://qa-duo/\(name)")!)
        let window = app.windows.firstMatch
        let predicate = NSPredicate { _, _ in
            abs(window.frame.width - size.width) < 1 && abs(window.frame.height - size.height) < 1
        }
        expectation(for: predicate, evaluatedWith: nil)
        waitForExpectations(timeout: 10)
    }

    private func screenshot(_ app: XCUIApplication, _ name: String) {
        let image = app.windows.firstMatch.screenshot()
        let attachment = XCTAttachment(screenshot: image)
        attachment.name = name
        attachment.lifetime = .keepAlways
        add(attachment)
    }
}
