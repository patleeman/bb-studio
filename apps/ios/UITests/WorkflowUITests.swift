import XCTest

final class WorkflowUITests: XCTestCase {
    private let app = XCUIApplication()

    override func setUp() {
        continueAfterFailure = false
        app.launch()
    }

    func testPluginStatusAndWorkspaceChoices() {
        app.buttons["Settings"].tap()
        app.buttons["Plugins"].tap()
        XCTAssertTrue(app.navigationBars["Plugins"].waitForExistence(timeout: 10))
        XCTAssertTrue(app.staticTexts.matching(NSPredicate(format: "label CONTAINS[c] 'running'")).firstMatch.waitForExistence(timeout: 10))
        screenshot("plugins")

        app.open(URL(string: "bbstudio://new")!)
        XCTAssertTrue(app.navigationBars["New thread"].waitForExistence(timeout: 10))
        XCTAssertTrue(app.staticTexts["Workspace"].exists)
        app.buttons.matching(NSPredicate(format: "label BEGINSWITH 'Use'")).firstMatch.tap()
        XCTAssertTrue(app.buttons["Project checkout"].exists)
        XCTAssertTrue(app.buttons["New worktree"].waitForExistence(timeout: 5))
        app.buttons["New worktree"].tap()
        XCTAssertTrue(app.textFields["Base branch (project default)"].exists)
        screenshot("new-thread-workspace")
    }

    /// New thread is presented above the Office tabs, including a cold Home launch.
    func testNewThreadFromHomeAndTeam() {
        app.terminate()
        app.launchArguments = ["-skipPushPrompt", "YES", "-officeTab", "home"]
        app.launch()
        let newThread = app.buttons["New Thread"]
        XCTAssertTrue(newThread.waitForExistence(timeout: 10))
        newThread.tap()
        XCTAssertTrue(app.navigationBars["New thread"].waitForExistence(timeout: 10))
        app.buttons["Cancel"].tap()
        app.buttons["Team"].tap()
        app.open(URL(string: "bbstudio://new")!)
        XCTAssertTrue(app.navigationBars["New thread"].waitForExistence(timeout: 10))
        app.buttons["Cancel"].tap()
    }

    func testAutomationEditor() {
        app.open(URL(string: "bbstudio://automations")!)
        XCTAssertTrue(app.navigationBars["Automations"].waitForExistence(timeout: 10))
        app.buttons["workflowNewAutomation"].tap()
        XCTAssertTrue(app.navigationBars["New automation"].waitForExistence(timeout: 5))
        XCTAssertTrue(app.textFields["workflowAutomationName"].exists)
        XCTAssertTrue(app.textFields["workflowAutomationPrompt"].exists)
        screenshot("automation-editor")
    }

    private func screenshot(_ name: String) {
        let image = XCUIScreen.main.screenshot().image
        let data = image.pngData()!
        try? data.write(to: URL(fileURLWithPath: "/tmp/qa-ui-ios3-\(name).png"))
        add(XCTAttachment(screenshot: XCUIScreen.main.screenshot()))
    }
}
