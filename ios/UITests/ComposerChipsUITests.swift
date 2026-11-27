import XCTest

/// Round 5, change 1, offline (`-qaBotDemo chat -qaSpacesDemo list
/// -qaStrandsDemo -qaShelfDemo`): a Bot conversation's lasting states are
/// chips in the composer's top row, the model fallback is a quiet line at the
/// end of the transcript, and the strands line stays the one thing above the
/// composer (no shelf cards, no needs-you count). `TEST_RUNNER_CHIPS_OUT` keeps PNGs.
final class ComposerChipsUITests: ServerIsolatedUITestCase {
    private let app = XCUIApplication()

    private func any(_ id: String) -> XCUIElement { app.descendants(matching: .any)[id].firstMatch }

    func testLastingStatesAreChipsAndTheFallbackIsALine() {
        app.launchArguments = ["-skipPushPrompt", "YES", "-qaBotDemo", "chat", "-qaSpacesDemo", "list", "-qaConversationHome",
                               "-qaRoomConversation", "thr_botdemo01", "-qaStrandsDemo", "-qaShelfDemo"]
        app.launchOffline()
        XCTAssertTrue(app.textViews["Message"].waitForExistence(timeout: 30), "the conversation")

        XCTAssertTrue(any("composerChips").waitForExistence(timeout: 15), "the composer's chip row")
        for chip in ["chip-planMode", "chip-goal", "chip-todos", "chip-background"] {
            XCTAssertTrue(any(chip).exists, "\(chip) is a chip")
        }
        XCUIDevice.shared.system.open(URL(string: "bbstudio://qa-duo/bottom")!)
        sleep(2)
        let fallback = app.descendants(matching: .any).matching(NSPredicate(format: "identifier BEGINSWITH 'notice-fallback-' AND NOT (identifier ENDSWITH '-action')")).firstMatch
        XCTAssertTrue(fallback.waitForExistence(timeout: 10), "the model fallback is a transcript line")

        let toggle = app.buttons["strands-toggle"]
        XCTAssertTrue(toggle.exists, "the strands line is the slot")
        XCTAssertFalse(toggle.label.contains("need"), "no needs-you count: \(toggle.label)")
        XCTAssertFalse(app.buttons["queueSummary"].exists, "no shelf cards above the composer")
        shot("1-chips")

        app.buttons["chip-todos"].tap()
        XCTAssertTrue(app.navigationBars["Todos"].waitForExistence(timeout: 5), "todos open in a sheet")
        XCTAssertTrue(app.staticTexts["Mirror the sidebar sections on Home"].exists)
        shot("2-todos")
        app.buttons["Done"].tap()

        app.buttons.matching(NSPredicate(format: "identifier BEGINSWITH 'notice-fallback-' AND identifier ENDSWITH '-action'")).firstMatch.tap()
        XCTAssertTrue(fallback.waitForNonExistence(timeout: 5), "Dismiss takes the line away")
    }

    private func shot(_ name: String) {
        guard let folder = ProcessInfo.processInfo.environment["CHIPS_OUT"] else { return }
        sleep(1)
        let url = URL(fileURLWithPath: folder)
        try? FileManager.default.createDirectory(at: url, withIntermediateDirectories: true)
        try? XCUIScreen.main.screenshot().pngRepresentation.write(to: url.appendingPathComponent("\(name).png"))
    }
}
