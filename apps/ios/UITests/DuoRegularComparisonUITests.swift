import XCTest

/// Run on owned iPhone Duo and iPad simulators with the same 951×669 window.
/// Only the actual idiom and its safe areas differ; both use RegularPages.
@MainActor
final class DuoRegularComparisonUITests: ServerIsolatedUITestCase {
    func testDarkSidebarsAndOpenDetails() throws {
        let env = ProcessInfo.processInfo.environment
        // Only names the captures.
        let device = env["BBGO_QA_DEVICE"] ?? "duo"
        let app = XCUIApplication()
        app.launchArguments = ["-skipPushPrompt", "YES", "-qaBotDemo", "duo", "-qaDuoPhone", "-qaDuoLong", "-qaDuoColdWide", "-qaDark", "-qaStudioDemo", "-openURL", "bbstudio://bot"]
        app.launchOffline()
        let last = app.staticTexts.matching(NSPredicate(format: "label CONTAINS %@", "History turn 299.")).firstMatch
        XCTAssertTrue(last.waitForExistence(timeout: 30))
        // The Bot's chat row, carrying its attention (it replaced the
        // separate Needs you group, c9a3930e).
        let chat = app.buttons.matching(NSPredicate(format: "label BEGINSWITH %@", "Chat,")).firstMatch
        XCTAssertTrue(chat.exists)
        XCTAssertTrue(chat.label.contains("Waiting for approval"), chat.label)
        XCTAssertGreaterThan(last.frame.minX, 475)
        Thread.sleep(forTimeInterval: 3)
        command("capture?v3-bot-" + device)
        command("capture?v3-bot-bottom-" + device)
        command("mid")
        let middle = app.staticTexts.matching(NSPredicate(format: "label CONTAINS %@", "History turn 150.")).firstMatch
        XCTAssertTrue(middle.waitForExistence(timeout: 20))
        Thread.sleep(forTimeInterval: 2)
        command("capture?v3-bot-mid-" + device)
        command("tab?studio")
        let item = app.buttons.matching(identifier: "studioItem").matching(NSPredicate(format: "label CONTAINS %@", "Duo release review")).firstMatch
        XCTAssertTrue(item.waitForExistence(timeout: 20))
        XCTAssertLessThan(item.frame.maxX, 475)
        item.tap()
        let paragraph = app.staticTexts.matching(NSPredicate(format: "label BEGINSWITH %@", "The regular layout keeps")).firstMatch
        XCTAssertTrue(paragraph.waitForExistence(timeout: 20))
        XCTAssertGreaterThan(paragraph.frame.minX, 475)
        // Selecting a low item may scroll the sidebar. Return its navigation
        // controls into view while leaving the selected detail open.
        let folders = app.staticTexts["Folders"]
        for _ in 0..<3 where !folders.isHittable {
            let origin = app.windows.firstMatch.coordinate(withNormalizedOffset: .zero)
            origin.withOffset(CGVector(dx: 250, dy: 220)).press(forDuration: 0.05,
                thenDragTo: origin.withOffset(CGVector(dx: 250, dy: 550)))
        }
        XCTAssertTrue(folders.isHittable)
        XCTAssertEqual(app.tabBars.count, 0)
        command("capture?v3-studio-" + device)
        command("tab?settings")
        XCTAssertTrue(app.buttons["Server"].exists)
        XCTAssertTrue(app.textFields["settingsServerURL"].waitForExistence(timeout: 10))
        XCTAssertGreaterThan(app.textFields["settingsServerURL"].frame.minX, 475)
        command("capture?v3-settings-" + device)
        command("tab?threads")
        let thread = app.buttons["inbox-thread-thr_botdemo01"]
        XCTAssertTrue(thread.waitForExistence(timeout: 15))
        thread.tap()
        XCTAssertTrue(app.staticTexts["duoThreadTitle"].waitForExistence(timeout: 15))
        command("capture?v3-threads-" + device)
    }

    private func command(_ path: String) { XCUIDevice.shared.system.open(URL(string: "bbstudio://qa-duo/" + path)!) }
}
