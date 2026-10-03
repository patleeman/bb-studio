import XCTest

/// Runs only against the deterministic Stage 9 fixture; never submits work or approvals.
final class OfficeCaptureUITests: XCTestCase {
    private func launch(_ tab: String) throws -> XCUIApplication {
        guard ProcessInfo.processInfo.environment["BB_OFFICE_CAPTURE_DIR"] != nil else {
            throw XCTSkip("Set BB_OFFICE_CAPTURE_DIR after seeding the Office fixture")
        }
        continueAfterFailure = false
        let app = XCUIApplication()
        app.launchArguments = ["-serverURL", StagedFixture.serverURL, "-skipPushPrompt", "YES", "-officeTab", tab]
        app.launch()
        return app
    }
    private func capture(_ app: XCUIApplication, _ name: String) throws {
        let shot = app.screenshot()
        let attachment = XCTAttachment(screenshot: shot); attachment.name = name; attachment.lifetime = .keepAlways; add(attachment)
        let directory = URL(fileURLWithPath: ProcessInfo.processInfo.environment["BB_OFFICE_CAPTURE_DIR"]!)
        try FileManager.default.createDirectory(at: directory, withIntermediateDirectories: true)
        try shot.pngRepresentation.write(to: directory.appendingPathComponent(name + ".png"))
    }
    func testInbox() throws {
        let app = try launch("inbox")
        XCTAssertTrue(app.navigationBars["Inbox"].waitForExistence(timeout: 20))
        XCTAssertTrue(app.staticTexts["Atlas wants to edit the release checklist"].waitForExistence(timeout: 20))
        XCTAssertTrue(app.staticTexts["ORBIT-42 checks are ready"].waitForExistence(timeout: 20))
        try capture(app, "office-inbox")
    }
    func testHome() throws {
        let app = try launch("home")
        XCTAssertTrue(app.buttons["Hand Off to a Bot"].waitForExistence(timeout: 20))
        XCTAssertTrue(app.staticTexts["Atlas wants to edit the release checklist"].waitForExistence(timeout: 20))
        try capture(app, "office-home")
    }
    func testWork() throws {
        let app = try launch("work")
        XCTAssertTrue(app.navigationBars["Work"].waitForExistence(timeout: 20))
        XCTAssertTrue(app.staticTexts["Orbit"].waitForExistence(timeout: 20))
        try capture(app, "office-work")
    }
    func testTeamAndDesk() throws {
        let app = try launch("team")
        XCTAssertTrue(app.staticTexts["ORBIT-42 release room"].waitForExistence(timeout: 20))
        XCTAssertTrue(app.staticTexts["Atlas"].waitForExistence(timeout: 20))
        try capture(app, "office-team")
        app.buttons["Atlas"].tap()
        XCTAssertTrue(app.buttons["Chat"].waitForExistence(timeout: 20))
        XCTAssertTrue(app.staticTexts["Atlas"].exists)
        XCTAssertTrue(app.buttons["Tasks"].exists)
        try capture(app, "office-bot-chat")
        app.buttons["Tasks"].tap()
        XCTAssertTrue(app.staticTexts["Review the ORBIT-42 release checklist"].waitForExistence(timeout: 20))
        try capture(app, "office-bot-tasks")
    }
}
