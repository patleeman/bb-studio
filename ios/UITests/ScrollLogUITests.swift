import XCTest

/// Settings ▸ Diagnostics: the scroll log is off until turned on, fills as
/// the chat scrolls, and can be shared or cleared.
@MainActor
final class ScrollLogUITests: ServerIsolatedUITestCase {
    func testTurningTheLogOnSharingAndClearingIt() {
        let app = XCUIApplication()
        app.launchArguments = ["-skipPushPrompt", "YES",
            "-qaBotDemo", "chat", "-qaDemoLatency", "300", "-qaDark", "-openURL", "bbstudio://bot"]
        app.launchOffline()
        XCTAssertTrue(app.textViews.matching(NSPredicate(format: "label BEGINSWITH 'Message'")).firstMatch.waitForExistence(timeout: 30))
        command("tab?settings")
        let toggle = app.switches["settingsScrollLog"].firstMatch
        for _ in 0..<6 where !toggle.isHittable { app.swipeUp() }
        XCTAssertTrue(toggle.waitForExistence(timeout: 10))
        // Left over from an earlier run: start off and empty.
        if (toggle.value as? String) == "1" { toggle.switches.firstMatch.tap() }
        // Clear sits under Share log, below the fold until scrolled to.
        for _ in 0..<3 where app.buttons["Share log"].exists && !app.buttons["Clear"].isHittable { app.swipeUp() }
        if app.buttons["Clear"].exists { app.buttons["Clear"].tap() }
        _ = app.buttons["Share log"].waitForNonExistence(timeout: 3)
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
        // Dragged down from inside it (a popover on iOS 27): a tap outside
        // could close Settings, a sheet too, with it.
        if close.exists {
            close.tap()
        } else {
            let window = app.windows.firstMatch
            window.coordinate(withNormalizedOffset: CGVector(dx: 0.5, dy: 0.62))
                .press(forDuration: 0.1, thenDragTo: window.coordinate(withNormalizedOffset: CGVector(dx: 0.5, dy: 0.99)))
        }
        XCTAssertTrue(share.waitForExistence(timeout: 5), "Settings stays open")
        for _ in 0..<3 where !app.buttons["Clear"].isHittable { app.swipeUp() }
        XCTAssertTrue(app.buttons["Clear"].waitForExistence(timeout: 5))

        app.buttons["Clear"].tap()
        XCTAssertTrue(share.waitForNonExistence(timeout: 5))
        toggle.switches.firstMatch.tap()
    }

    private func command(_ path: String) { XCUIDevice.shared.system.open(URL(string: "bbstudio://qa-duo/" + path)!) }
}
