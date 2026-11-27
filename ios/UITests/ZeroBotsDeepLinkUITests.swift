import XCTest

/// Verifies that a server with Studio installed and 0 Bots renders Home's empty
/// state (never an endless spinner) and still pushes deep links cleanly.
final class ZeroBotsDeepLinkUITests: StagedServerUITestCase {
    func testZeroBotsShowsEmptyHomeAndPushesDeepLinks() throws {
        let env = ProcessInfo.processInfo.environment
        guard (env["TEST_RUNNER_BBGO_QA_ZERO_BOTS"] ?? env["BBGO_QA_ZERO_BOTS"]) == "1" else {
            throw XCTSkip("Set TEST_RUNNER_BBGO_QA_ZERO_BOTS=1 against a staged server with 0 Bots.")
        }
        let app = XCUIApplication()
        app.launchArguments += ["-skipPushPrompt", "YES"]
        app.launchStaged(server: qaServer)

        XCTAssertTrue(app.descendants(matching: .any)["homeNoBots"].waitForExistence(timeout: 20), "empty Home shows when server has 0 Bots")
        XCTAssertFalse(app.activityIndicators.firstMatch.exists, "no endless spinner once loaded")

        app.open(URL(string: "bbstudio://settings")!)
        XCTAssertTrue(app.navigationBars["Settings"].waitForExistence(timeout: 10)
            || app.staticTexts["Settings"].waitForExistence(timeout: 5), "deep link to Settings pushes over empty Home")

        app.open(URL(string: "bbstudio://automations")!)
        XCTAssertTrue(app.navigationBars["Automations"].waitForExistence(timeout: 10)
            || app.staticTexts["Automations"].waitForExistence(timeout: 5), "deep link to Automations pushes over empty Home")
    }
}
