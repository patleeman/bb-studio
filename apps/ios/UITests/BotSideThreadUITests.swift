import XCTest

/// Side threads on the Bot's replies, against a staged BB: taps a reply's
/// "1 reply" row and checks the side thread opens, then starts a new side
/// thread from another reply's menu (Reply in Thread). It forks the chat, so
/// point it at a throwaway server. Screenshots land in
/// `/tmp/qa-side-thread-*.png`. Skipped unless
/// `TEST_RUNNER_BBGO_SIDE_THREAD_SERVER=<url>`; the newest Bot reply needs a
/// side thread whose first message is `TEST_RUNNER_BBGO_SIDE_THREAD_TEXT`, and
/// `TEST_RUNNER_BBGO_SIDE_THREAD_REPLY` is the exact text of a reply without one.
final class BotSideThreadUITests: XCTestCase {
    private let app = XCUIApplication()

    func testOpenAndStartSideThreads() throws {
        let env = ProcessInfo.processInfo.environment
        guard let server = env["BBGO_SIDE_THREAD_SERVER"] else { throw XCTSkip("Set TEST_RUNNER_BBGO_SIDE_THREAD_SERVER") }
        let forkText = env["BBGO_SIDE_THREAD_TEXT"] ?? ""
        let otherReply = env["BBGO_SIDE_THREAD_REPLY"] ?? ""
        app.launchArguments += ["-serverURL", server, "-skipPushPrompt", "YES", "-openURL", "bbstudio://bot"]
        app.launch()

        // The row under the reply with a side thread opens it.
        let row = app.buttons.matching(NSPredicate(format: "label BEGINSWITH '1 reply'")).firstMatch
        XCTAssertTrue(row.waitForExistence(timeout: 30), "No reply row")
        screenshot("1-chat")
        row.tap()
        XCTAssertTrue(app.staticTexts.containing(NSPredicate(format: "label CONTAINS %@", forkText)).firstMatch.waitForExistence(timeout: 20), "Side thread didn't open")
        screenshot("2-side-thread")

        // Back in the chat, another reply's menu starts a new side thread.
        app.navigationBars.buttons.element(boundBy: 0).tap()
        // The reply's exact text: the message that asked for it contains it too.
        let bubble = app.staticTexts.matching(NSPredicate(format: "label == %@", otherReply)).firstMatch
        XCTAssertTrue(bubble.waitForExistence(timeout: 20), "No reply to start from")
        bubble.press(forDuration: 1.2)
        let reply = app.buttons["Reply in Thread"]
        XCTAssertTrue(reply.waitForExistence(timeout: 10), "No Reply in Thread in the menu")
        screenshot("3-menu")
        reply.tap()
        // The new fork opens with the chat's history up to that reply and a composer.
        XCTAssertTrue(app.textViews.firstMatch.waitForExistence(timeout: 30), "New side thread didn't open")
        sleep(3)
        screenshot("4-new-side-thread")
    }

    private func screenshot(_ name: String) {
        let shot = XCUIScreen.main.screenshot()
        try? shot.pngRepresentation.write(to: URL(fileURLWithPath: "/tmp/qa-side-thread-\(name).png"))
        let attachment = XCTAttachment(screenshot: shot)
        attachment.name = name
        attachment.lifetime = .keepAlways
        add(attachment)
    }
}
