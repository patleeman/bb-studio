import XCTest

/// Side threads on the Bot's replies, against a staged BB: taps a reply's
/// "1 reply" row and checks the side thread opens, then starts a new side
/// thread from another reply's Reply in thread icon, in its action row. It forks the chat, so
/// point it at a throwaway server. Screenshots land in
/// `/tmp/qa-side-thread-*.png`. Skipped unless
/// `TEST_RUNNER_BBGO_QA_SERVER=<url>`; the newest Bot reply needs a
/// side thread whose first message is `TEST_RUNNER_BBGO_SIDE_THREAD_TEXT`, and
/// `TEST_RUNNER_BBGO_SIDE_THREAD_REPLY` is the exact text of a reply without one.
final class BotSideThreadUITests: StagedServerUITestCase {
    private let app = XCUIApplication()

    func testOpenAndStartSideThreads() throws {
        let env = ProcessInfo.processInfo.environment
        let server = qaServer
        let forkText = env["BBGO_SIDE_THREAD_TEXT"] ?? ""
        let otherReply = env["BBGO_SIDE_THREAD_REPLY"] ?? ""
        app.launchArguments += ["-serverURL", server, "-skipPushPrompt", "YES", "-openURL", "bbstudio://bot"]
        app.launchStaged(server: qaServer)

        // The row under the reply with a side thread opens it.
        let row = app.buttons.matching(NSPredicate(format: "label BEGINSWITH '1 reply'")).firstMatch
        XCTAssertTrue(row.waitForExistence(timeout: 30), "No reply row")
        screenshot("1-chat")
        row.tap()
        XCTAssertTrue(app.staticTexts.containing(NSPredicate(format: "label CONTAINS %@", forkText)).firstMatch.waitForExistence(timeout: 20), "Side thread didn't open")
        screenshot("2-side-thread")

        // Back in the chat, another reply's Reply in thread icon, in its action row, starts a new side thread.
        app.navigationBars.buttons.element(boundBy: 0).tap()
        // The reply's exact text: the message that asked for it contains it too.
        let bubble = app.staticTexts.matching(NSPredicate(format: "label == %@", otherReply)).firstMatch
        // An older reply: scroll up to it.
        for _ in 0..<6 where !(bubble.waitForExistence(timeout: 3) && bubble.isHittable) { app.swipeDown() }
        XCTAssertTrue(bubble.waitForExistence(timeout: 20), "No reply to start from")
        // The icon nearest below the reply's bubble.
        let buttons = app.buttons.matching(identifier: "bot-reply-in-thread").allElementsBoundByIndex.filter { $0.isHittable && $0.frame.minY >= bubble.frame.maxY - 1 }
        let reply = try XCTUnwrap(buttons.min { $0.frame.minY < $1.frame.minY }, "No Reply in thread under the reply")
        XCTAssertEqual(reply.label, "Reply in thread")
        screenshot("3-button")
        reply.tap()
        // The new fork opens with the chat's history up to that reply and a composer.
        XCTAssertTrue(app.textViews.firstMatch.waitForExistence(timeout: 30), "New side thread didn't open")
        sleep(3)
        screenshot("4-new-side-thread")
    }

    /// A new side thread shows in the chat only as its reply's row: no
    /// "Started …" card. Its own transcript doesn't open on Codex's
    /// deprecation notice. `TEST_RUNNER_BBGO_SIDE_THREAD_REPLY` is the exact
    /// text of a reply without a side thread.
    func testNewSideThreadShowsOnlyAsItsReplyRow() throws {
        let otherReply = ProcessInfo.processInfo.environment["BBGO_SIDE_THREAD_REPLY"] ?? ""
        app.launchArguments += ["-serverURL", qaServer, "-skipPushPrompt", "YES", "-openURL", "bbstudio://bot"]
        app.launchStaged(server: qaServer)

        let bubble = app.staticTexts.matching(NSPredicate(format: "label == %@", otherReply)).firstMatch
        for _ in 0..<6 where !(bubble.waitForExistence(timeout: 3) && bubble.isHittable) { app.swipeDown() }
        XCTAssertTrue(bubble.waitForExistence(timeout: 20), "No reply to start from")
        let buttons = app.buttons.matching(identifier: "bot-reply-in-thread").allElementsBoundByIndex.filter { $0.isHittable && $0.frame.minY >= bubble.frame.maxY - 1 }
        let reply = try XCTUnwrap(buttons.min { $0.frame.minY < $1.frame.minY }, "No Reply in thread under the reply")
        reply.tap()
        XCTAssertTrue(app.textViews.firstMatch.waitForExistence(timeout: 30), "New side thread didn't open")
        sleep(4)
        screenshot("5-new-side-thread-first-rows")
        XCTAssertFalse(app.staticTexts["Deprecation notice"].exists, "The side thread shows Codex's deprecation notice")

        // Back in the chat once the Activity has refreshed: the reply's row, no card.
        app.navigationBars.buttons.element(boundBy: 0).tap()
        XCTAssertTrue(bubble.waitForExistence(timeout: 20))
        sleep(8)
        screenshot("6-chat-after-new-side-thread")
        let started = app.descendants(matching: .any).matching(NSPredicate(format: "label BEGINSWITH 'Started '"))
        XCTAssertEqual(started.count, 0, "A side thread shows as a Started card: \(started.allElementsBoundByIndex.map(\.label))")
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
