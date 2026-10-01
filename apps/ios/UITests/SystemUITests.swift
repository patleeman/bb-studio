import XCTest

final class SystemUITests: XCTestCase {
    func testTaskShortcutOpensCapture() {
        let app = XCUIApplication()
        app.launchArguments += ["-skipPushPrompt", "YES", "-openURL", "bbstudio://new-task"]
        app.launch()
        XCTAssertTrue(app.staticTexts["New Tasks"].waitForExistence(timeout: 10))
        let image = app.screenshot().image
        let attachment = XCTAttachment(image: image)
        attachment.name = "system-task-shortcut"
        attachment.lifetime = .keepAlways
        add(attachment)
        try? image.pngData()?.write(to: URL(fileURLWithPath: "/tmp/qa-ui-ios4-task-shortcut.png"))
    }
}
