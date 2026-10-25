import XCTest

/// Patrick, Oct 25: attach a photo in the Bot chat, go back, open the chat
/// again, and the photo is gone; the draft text survives. Attachments wait
/// in the composer with the draft, per thread.
@MainActor
final class DraftAttachmentUITests: XCTestCase {
    func testAnAttachedPhotoSurvivesLeavingAndReopeningTheChat() {
        let app = XCUIApplication()
        app.launchArguments = ["-skipPushPrompt", "YES", "-serverURL", "http://127.0.0.1:9",
            "-qaBotDemo", "chat", "-qaDemoLatency", "300", "-qaDemoColdCache", "-qaDark", "-openURL", "bbstudio://bot"]
        app.launch()
        let composer = app.textViews.matching(NSPredicate(format: "label BEGINSWITH 'Message'")).firstMatch
        XCTAssertTrue(composer.waitForExistence(timeout: 30))
        let attachment = app.buttons["Remove attachment"].firstMatch
        // Sent again if the chat wasn't listening yet: a busy machine shows the composer first.
        for _ in 0..<3 where !attachment.exists {
            XCUIDevice.shared.system.open(URL(string: "bbstudio://qa-duo/attach")!)
            _ = attachment.waitForExistence(timeout: 5)
        }
        XCTAssertTrue(attachment.exists, "The photo never reached the composer")

        app.buttons["Bots"].firstMatch.tap()
        let row = app.buttons.matching(NSPredicate(format: "label CONTAINS 'Juniper'")).firstMatch
        XCTAssertTrue(row.waitForExistence(timeout: 10), "The Bots list has no Juniper row")
        row.tap()
        XCTAssertTrue(composer.waitForExistence(timeout: 10))
        XCTAssertTrue(attachment.waitForExistence(timeout: 5), "The photo was lost on reopening the chat")

        // Removed from the composer, it stays removed.
        attachment.tap()
        XCTAssertTrue(attachment.waitForNonExistence(timeout: 5))
        app.buttons["Bots"].firstMatch.tap()
        XCTAssertTrue(row.waitForExistence(timeout: 10))
        row.tap()
        XCTAssertTrue(composer.waitForExistence(timeout: 10))
        XCTAssertFalse(attachment.waitForExistence(timeout: 3), "A removed photo came back")
    }
}
