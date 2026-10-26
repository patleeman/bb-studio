import XCTest

/// A mini app, live, against a staged BB whose Studio has one
/// (`TEST_RUNNER_BBGO_QA_MINI=mini_…`): its records load through the phone's
/// relay, Add task writes one, the count saves shared state, and a network
/// call is refused with the desktop note. The app must have an "Add task"
/// button, a "Count <n>" button and a "Fetch" button that shows the error,
/// as scripts in the README set up. It adds a record and bumps the count.
final class MiniAppUITests: StagedServerUITestCase {
    private let app = XCUIApplication()

    func testMiniAppRelaysRecordsStateAndRefusals() throws {
        guard let id = ProcessInfo.processInfo.environment["BBGO_QA_MINI"], !id.isEmpty else {
            throw XCTSkip("Set TEST_RUNNER_BBGO_QA_MINI to a staged mini app")
        }
        continueAfterFailure = false
        app.launchArguments += ["-skipPushPrompt", "YES", "-openURL", "bbstudio://mini/\(id)"]
        app.launchStaged(server: qaServer)

        let web = app.webViews.firstMatch
        let add = web.buttons["Add task"]
        XCTAssertTrue(add.waitForExistence(timeout: 30), "the frame rendered")
        screenshot("loaded")

        let before = web.staticTexts.count
        add.tap()
        let grew = expectation(for: NSPredicate(format: "count > %d", before), evaluatedWith: web.staticTexts)
        wait(for: [grew], timeout: 10)  // db.insert went through and the list reloaded

        let count = web.buttons.matching(NSPredicate(format: "label BEGINSWITH 'Count '")).firstMatch
        let old = Int(count.label.dropFirst(6)) ?? 0
        count.tap()
        XCTAssertTrue(web.buttons["Count \(old + 1)"].waitForExistence(timeout: 5))

        web.buttons["Fetch"].tap()
        let refused = web.staticTexts["Open this mini app in BB on your computer to reach the internet."]
        XCTAssertTrue(refused.waitForExistence(timeout: 10), "fetch is refused on the phone")
        screenshot("after")
    }

    private func screenshot(_ name: String) {
        let shot = XCUIScreen.main.screenshot()
        try? shot.pngRepresentation.write(to: URL(fileURLWithPath: "/tmp/qa-mini-\(name).png"))
    }
}
