import XCTest

/// Settings ▸ Diagnostics: the scroll log is off until turned on, fills as
/// the chat scrolls, and can be shared or cleared.
@MainActor
final class ScrollLogUITests: XCTestCase {
    func testTurningTheLogOnSharingAndClearingIt() {
        let app = XCUIApplication()
        app.launchArguments = ["-skipPushPrompt", "YES", "-serverURL", "http://127.0.0.1:9",
            "-qaBotDemo", "chat", "-qaDemoLatency", "300", "-qaDark", "-openURL", "bbstudio://bot"]
        app.launch()
        XCTAssertTrue(app.textViews.matching(NSPredicate(format: "label BEGINSWITH 'Message'")).firstMatch.waitForExistence(timeout: 30))
        command("tab?settings")
        let toggle = app.switches["settingsScrollLog"].firstMatch
        for _ in 0..<6 where !toggle.isHittable { app.swipeUp() }
        XCTAssertTrue(toggle.waitForExistence(timeout: 10))
        // Left over from an earlier run: start off and empty.
        if (toggle.value as? String) == "1" { toggle.switches.firstMatch.tap() }
        if app.buttons["Clear"].exists { app.buttons["Clear"].tap() }
        XCTAssertFalse(app.buttons["Share log"].exists, "Nothing to share before the log is on")
        if (toggle.value as? String) != "1" { toggle.switches.firstMatch.tap() }
        XCTAssertEqual(toggle.value as? String, "1")

        command("tab?bot")
        for _ in 0..<2 { app.swipeDown() }
        app.swipeUp()
        command("tab?settings")
        for _ in 0..<6 where !toggle.isHittable { app.swipeUp() }
        let share = app.buttons["Share log"]
        XCTAssertTrue(share.waitForExistence(timeout: 10), "Scrolling the chat wrote the log")
        share.tap()
        XCTAssertTrue(app.otherElements["ActivityListView"].waitForExistence(timeout: 10)
            || app.navigationBars["UIActivityContentView"].waitForExistence(timeout: 5), "The system share sheet opens")
        let close = app.buttons["Close"].firstMatch
        // Above the half-height sheet, which closes it.
        if close.exists { close.tap() } else { app.windows.firstMatch.coordinate(withNormalizedOffset: CGVector(dx: 0.5, dy: 0.08)).tap() }
        XCTAssertTrue(app.buttons["Clear"].waitForExistence(timeout: 5))

        app.buttons["Clear"].tap()
        XCTAssertTrue(share.waitForNonExistence(timeout: 5))
        toggle.switches.firstMatch.tap()
    }

    private func command(_ path: String) { XCUIDevice.shared.system.open(URL(string: "bbstudio://qa-duo/" + path)!) }
}
