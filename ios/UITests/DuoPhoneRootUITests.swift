import XCTest

/// The real iPhone Duo simulator, kept on its working outer display. Resize
/// its existing phone window; capture the complete 951×669 hosting hierarchy
/// through UIKit because XCTest's screen capture clips to the outer display.
@MainActor
final class DuoPhoneRootUITests: ServerIsolatedUITestCase {
    private let app = XCUIApplication()

    func testPhoneRootTabsAndPopulatedSplit() throws {
        try requireQAServer()
        let server = qaServer
        app.launchArguments = ["-skipPushPrompt", "YES", "-serverURL", server, "-qaBotDemo", "duo", "-qaDuoPhone",
                               "-openURL", "bbstudio://home"]
        app.launchStaged(server: qaServer)
        XCTAssertTrue(app.staticTexts["Threads"].firstMatch.waitForExistence(timeout: 20))
        command("landscape")
        let window = app.windows.firstMatch
        expectation(for: NSPredicate { _, _ in abs(window.frame.width - 951) < 1 && abs(window.frame.height - 669) < 1 }, evaluatedWith: nil)
        waitForExpectations(timeout: 10)
        // Root tab controls are present exactly once, in the left rail.
        XCTAssertEqual(app.tabBars.count, 0, "No native phone rail beside the custom rail")
        for tab in ["Bot", "Studio", "Settings"] {
            XCTAssertEqual(app.buttons.matching(identifier: tab).count, 1, "One rail: \(tab)")
        }
        XCTAssertEqual(app.navigationBars.matching(identifier: "Threads").count + app.staticTexts.matching(identifier: "duoInboxTitle").count, 1, "Only the list has a Threads title")
        XCTAssertEqual(app.buttons.matching(identifier: "New Thread").count, 1)
        XCTAssertEqual(app.buttons.matching(identifier: "Dictate").count, 1)
        let thread = app.buttons.matching(NSPredicate(format: "label CONTAINS %@", "Draft the ORBIT-42 release notes")).firstMatch
        XCTAssertTrue(thread.waitForExistence(timeout: 15), "The split list fetches its real staged sidebar")
        let conversation = app.buttons["inbox-thread-thr_botdemo01"]
        XCTAssertTrue(conversation.waitForExistence(timeout: 15))
        conversation.tap()
        XCTAssertTrue(app.staticTexts["duoThreadTitle"].waitForExistence(timeout: 15))
        let newest = app.staticTexts["Duo message 80. Review the launch checklist and keep the release notes ready."]
        XCTAssertTrue(newest.waitForExistence(timeout: 15), "The selected thread renders its transcript in the right page")
        XCTAssertGreaterThan(newest.frame.minX, 951 / 2 + 15)
        assertStatusAreaClear()
        capture("fix-threads")
        command("focus")
        XCTAssertTrue(app.keyboards.firstMatch.waitForExistence(timeout: 10))
        print("PHONE KEYBOARD", app.keyboards.firstMatch.frame)
        capture("fix-threads-keyboard")
        let keyboard = XCTAttachment(screenshot: XCUIScreen.main.screenshot())
        keyboard.name = "fix-threads-keyboard-native"
        keyboard.lifetime = .keepAlways
        add(keyboard)
        for (tab, name) in [("bot", "fix-bot"), ("studio", "fix-studio"), ("settings", "fix-settings")] {
            command("tab?" + tab)
            if tab == "bot" {
                XCTAssertTrue(app.textViews.matching(NSPredicate(format: "label BEGINSWITH 'Message' ")).firstMatch.waitForExistence(timeout: 15))
                XCTAssertFalse(app.buttons["Bots"].exists, "No Bot back button on the unfolded phone")
            }
            let content = tab == "settings" ? app.textFields.firstMatch : tab == "studio" ? app.buttons.matching(identifier: "studioItem").firstMatch : app.textViews.firstMatch
            XCTAssertTrue(content.waitForExistence(timeout: 10))
            if content.exists {
                if tab == "studio" { XCTAssertLessThan(content.frame.minX, 475, "Studio list is in the sidebar") }
                else { XCTAssertGreaterThan(content.frame.minX, 475, "\(tab) detail is beside its sidebar") }
            }
            assertStatusAreaClear()
            capture(name)
            XCTAssertEqual(app.tabBars.count, 0)
            for title in ["Bot", "Studio", "Settings"] {
                XCTAssertEqual(app.buttons.matching(identifier: title).count, 1)
            }
        }
    }

    func testColdUnfoldedInboxLoadsWithoutNarrowInbox() throws {
        try requireQAServer()
        let server = qaServer
        app.launchArguments = ["-skipPushPrompt", "YES", "-serverURL", server.replacingOccurrences(of: "127.0.0.1", with: "localhost"),
                               "-qaBotDemo", "duo", "-qaDuoPhone", "-openURL", "bbstudio://settings"]
        app.launchStaged(server: qaServer)
        XCTAssertTrue(app.navigationBars["Settings"].waitForExistence(timeout: 20))
        command("landscape")
        command("tab?threads")
        let thread = app.buttons.matching(NSPredicate(format: "label CONTAINS %@", "Draft the ORBIT-42 release notes")).firstMatch
        XCTAssertTrue(thread.waitForExistence(timeout: 20), "An unprimed split list loads from the real sidebar endpoint")
        let conversation = app.buttons["inbox-thread-thr_botdemo01"]
        XCTAssertTrue(conversation.waitForExistence(timeout: 10))
        conversation.tap()
        let newest = app.staticTexts["Duo message 80. Review the launch checklist and keep the release notes ready."]
        XCTAssertTrue(newest.waitForExistence(timeout: 15), "Cold split-list selection loads the 80-message transcript")
        // The forced window extends beyond the simulator's physical outer
        // screen. Check visible window bounds; right-page taps are clipped by
        // that physical screen even when the full UIKit render is correct.
        XCTAssertGreaterThan(newest.frame.minY, 58)
        XCTAssertLessThan(newest.frame.maxY, 669)
        XCTAssertGreaterThan(newest.frame.minX, 951 / 2 + 15)
        XCTAssertEqual(app.navigationBars.matching(identifier: "Threads").count + app.staticTexts.matching(identifier: "duoInboxTitle").count, 1)
    }

    func testOuterAndPortraitKeepNativePhoneChrome() throws {
        app.launchArguments = ["-skipPushPrompt", "YES", "-qaBotDemo", "duo", "-qaDuoPhone",
                               "-openURL", "bbstudio://settings"]
        app.launchOffline()
        XCTAssertTrue(app.navigationBars["Settings"].waitForExistence(timeout: 20))
        let nativeSettingsButtons = app.buttons.matching(identifier: "Settings").count
        let nativeTabBars = app.tabBars.count
        for size in ["outer", "portrait"] {
            command(size)
            XCTAssertTrue(app.navigationBars["Settings"].exists)
            XCTAssertEqual(app.tabBars.count, nativeTabBars, "\(size): retain native phone navigation")
            XCTAssertEqual(app.buttons.matching(identifier: "Settings").count, nativeSettingsButtons)
            XCTAssertFalse(app.staticTexts["duoInboxTitle"].exists)
        }
    }

    private func assertStatusAreaClear() {
        // Duo's trailing safe area contains the status pill. Captures retain
        // that 84-point inset; no unfolded app action may enter its top band.
        let status = CGRect(x: 951 - 84, y: 0, width: 84, height: 120)
        for button in app.buttons.allElementsBoundByIndex where button.frame.width > 0 && button.frame.height > 0 {
            XCTAssertFalse(button.frame.intersects(status), "Action under the status area: \(button.label)")
        }
    }

    private func command(_ path: String) {
        XCUIDevice.shared.system.open(URL(string: "bbstudio://qa-duo/" + path)!)
    }
    private func capture(_ name: String) {
        command("capture?" + name)
    }
}
