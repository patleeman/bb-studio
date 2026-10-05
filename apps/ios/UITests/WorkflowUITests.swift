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
        XCTAssertTrue(app.buttons["newThreadProject"].exists)
        XCTAssertTrue(app.buttons["newThreadAgent"].exists)
        app.buttons["newThreadWorkspace"].tap()
        XCTAssertTrue(app.buttons["Project checkout"].waitForExistence(timeout: 5))
        XCTAssertTrue(app.buttons["New worktree"].waitForExistence(timeout: 5))
        app.buttons["New worktree"].tap()
        XCTAssertTrue(app.textFields["Base branch (project default)"].exists)
        screenshot("new-thread-workspace")
        app.buttons["newThreadAgent"].tap()
        XCTAssertTrue(app.buttons["Model"].waitForExistence(timeout: 5))
        XCTAssertTrue(app.buttons["Permissions"].exists)
        screenshot("new-thread-agent")
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
