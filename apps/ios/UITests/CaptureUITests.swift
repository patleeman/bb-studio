import XCTest

final class CaptureUITests: XCTestCase {
    func testCaptureDeepLinkShowsAllOptions() {
        let app = XCUIApplication()
        app.launchArguments = ["-skipPushPrompt", "YES"]
        app.launch()
        app.open(URL(string: "bbstudio://capture")!)
        let notificationAlert = XCUIApplication(bundleIdentifier: "com.apple.springboard").alerts.firstMatch
        if notificationAlert.waitForExistence(timeout: 10) {
            notificationAlert.buttons["Don’t Allow"].tap()
        }
        XCTAssertTrue(app.navigationBars["Capture to BB"].waitForExistence(timeout: 10))
        for id in ["voice", "dictate", "note", "task", "file", "thread"] {
            XCTAssertTrue(app.buttons["capture-\(id)"].exists, "Missing \(id)")
        }
        try? app.screenshot().pngRepresentation.write(to: URL(fileURLWithPath: "/tmp/qa-ui-ios6-capture.png"))
        app.buttons["capture-note"].tap()
        XCTAssertTrue(app.descendants(matching: .any)["captureNoteText"].waitForExistence(timeout: 5))
        app.buttons["Back"].tap()
        app.buttons["capture-file"].tap()
        XCTAssertTrue(app.navigationBars["Photo or file"].waitForExistence(timeout: 5))
        XCTAssertTrue(app.buttons["captureFileSave"].exists)
    }
}
