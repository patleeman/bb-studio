import XCTest

/// After a send in a long chat, the chat follows the reply to its end and
/// shows it, rather than going blank between the header and the composer
/// with "Jump to latest" up. Runs on the served demo Bot (`-qaBotDemo chat
/// -qaDemoLong`, no server): thousands of rows with runs of tool rows folded
/// into "Worked", replies from a line to a screenful, and "/compact"s; a send
/// there works, streams a long reply, and settles on a short one. The same
/// thread opens as a regular thread too. Screens land in `/tmp/qa-chat-send-*.png`.
final class ChatSendScrollUITests: XCTestCase {
    override func setUp() {
        continueAfterFailure = false
    }

    private func launch(_ url: String) -> XCUIApplication {
        let app = XCUIApplication()
        app.launchArguments += ["-skipPushPrompt", "YES", "-qaBotDemo", "chat", "-qaDemoLatency", "150",
                                "-qaDemoMessages", "4000", "-qaDemoPage", "600", "-qaDemoLong", "-qaDemoColdCache",
                                "-openURL", url]
        app.launch()
        return app
    }

    func testBotChatShowsTheReplyAfterASend() throws {
        let app = launch("bbstudio://bot")
        let composer = app.textViews["Message Juniper"]
        XCTAssertTrue(composer.waitForExistence(timeout: 30), "the chat loaded")
        try sendAndCheck(app, composer: composer, text: "Plan the offsite", reply: 1, name: "bot")
        // Again with the keyboard down, as after dictating.
        try sendAndCheck(app, composer: composer, text: "And the flights", reply: 2, name: "bot-again", dismissKeyboard: true)
    }

    func testBotChatShowsTheReplyAfterASendFromFarUp() throws {
        let app = launch("bbstudio://bot")
        let composer = app.textViews["Message Juniper"]
        XCTAssertTrue(composer.waitForExistence(timeout: 30), "the chat loaded")
        sleep(2)
        // Far up the chat, through rows the lazy stack only estimates.
        let scroll = app.scrollViews.firstMatch
        for _ in 0..<8 { scroll.swipeDown(velocity: .fast) }
        sleep(1)
        XCTAssertTrue(app.buttons["Jump to latest"].exists, "scrolled up")
        try sendAndCheck(app, composer: composer, text: "Plan the offsite", reply: 1, name: "bot-far")
    }

    /// Scrolling up while the reply streams leaves the reader where they
    /// scrolled to: the stream doesn't pull them back down under their finger.
    /// "Jump to latest" takes them back, and the chat stays at the end.
    func testScrollingUpWhileTheReplyStreamsStaysPut() throws {
        let app = launch("bbstudio://bot")
        let composer = app.textViews["Message Juniper"]
        XCTAssertTrue(composer.waitForExistence(timeout: 30), "the chat loaded")
        sleep(2)
        composer.tap()
        composer.typeText("Plan the offsite")
        app.buttons["Send"].tap()
        // Mid-stream: the long draft is growing.
        let streaming = app.staticTexts.matching(NSPredicate(format: "label CONTAINS %@", "Paragraph 2 of the draft")).firstMatch
        XCTAssertTrue(streaming.waitForExistence(timeout: 20), "the reply is streaming")
        // A short drag of the chat itself (above the composer and keyboard:
        // the scroll view runs under them), with the end still close by.
        let area = visibleRect(app, composer: composer)
        let origin = app.windows.firstMatch.coordinate(withNormalizedOffset: .zero)
        origin.withOffset(CGVector(dx: area.midX, dy: area.minY + 40))
            .press(forDuration: 0.05, thenDragTo: origin.withOffset(CGVector(dx: area.midX, dy: area.maxY - 20)),
                   withVelocity: .slow, thenHoldForDuration: 0.1)
        sleep(1)
        try? XCUIScreen.main.screenshot().pngRepresentation.write(to: URL(fileURLWithPath: "/tmp/qa-chat-send-dragged.png"))
        // Hold on to the reply streaming in: it grows down from where it
        // starts, so its top stays put on screen unless the chat moves.
        let draft = app.staticTexts.matching(NSPredicate(format: "label CONTAINS %@", "Paragraph 1 of the draft")).firstMatch
        XCTAssertTrue(draft.exists, "the reply is drawn")
        let draftTop = draft.frame.minY
        // A long pull can carry the reply below the composer: then there's
        // nothing in view of it to keep.
        let wasInView = draft.frame.intersects(visibleRect(app, composer: composer))
        // The stream goes on; the chat stays where the reader left it.
        sleep(2)
        let screen = XCUIScreen.main.screenshot()
        try? screen.pngRepresentation.write(to: URL(fileURLWithPath: "/tmp/qa-chat-send-scrolled-up.png"))
        let after = visibleRect(app, composer: composer)
        XCTAssertFalse(app.buttons["Send"].exists, "still streaming")
        XCTAssertEqual(draft.frame.minY, draftTop, accuracy: 40, "the chat didn't move under the reader")
        if wasInView { XCTAssertTrue(draft.frame.intersects(after), "what was in view still is: \(draft.frame) in \(after)") }
        let jump = app.buttons["Jump to latest"]
        XCTAssertTrue(jump.exists, "Jump to latest shows")
        let final = app.staticTexts.matching(NSPredicate(format: "label CONTAINS %@", "Reply 1: all set")).firstMatch
        XCTAssertTrue(app.buttons["Send"].waitForExistence(timeout: 30), "the turn ended")
        sleep(1)

        jump.tap()
        sleep(2)
        let back = visibleRect(app, composer: composer)
        XCTAssertTrue(final.waitForExistence(timeout: 5) && final.frame.intersects(back), "Jump to latest shows the reply: \(final.frame) in \(back)")
        XCTAssertGreaterThan(final.frame.maxY, back.maxY - 90, "at the bottom: \(final.frame) in \(back)")
        XCTAssertFalse(jump.exists, "Jump to latest goes once at the bottom")
        // And stays there.
        sleep(3)
        XCTAssertTrue(final.frame.intersects(visibleRect(app, composer: composer)), "still at the end")
        XCTAssertFalse(app.buttons["Jump to latest"].exists, "still pinned")
    }

    func testThreadShowsTheReplyAfterASend() throws {
        let app = launch("bbstudio://thread/thr_botdemo01")
        let composer = app.textViews["Message"]
        XCTAssertTrue(composer.waitForExistence(timeout: 30), "the thread loaded")
        try sendAndCheck(app, composer: composer, text: "Plan the offsite", reply: 1, name: "thread")
        try sendAndCheck(app, composer: composer, text: "And the flights", reply: 2, name: "thread-again", dismissKeyboard: true)
    }

    /// Sends `text`, waits for the turn to end, and checks the reply's end is on screen.
    private func sendAndCheck(_ app: XCUIApplication, composer: XCUIElement, text: String, reply: Int, name: String,
                              dismissKeyboard: Bool = false, file: StaticString = #filePath, line: UInt = #line) throws {
        sleep(2)
        composer.tap()
        composer.typeText(text)
        let send = app.buttons["Send"]
        XCTAssertTrue(send.waitForExistence(timeout: 5), "Send", file: file, line: line)
        send.tap()
        if dismissKeyboard {
            sleep(1)
            app.navigationBars.firstMatch.coordinate(withNormalizedOffset: CGVector(dx: 0.5, dy: 0.5)).tap()
        }
        // The turn streams a long reply, then settles on its short final text.
        let final = app.staticTexts.matching(NSPredicate(format: "label CONTAINS %@", "Reply \(reply): all set")).firstMatch
        let landed = final.waitForExistence(timeout: 40)
        _ = app.buttons["Send"].waitForExistence(timeout: 10)
        sleep(2)
        let screen = XCUIScreen.main.screenshot()
        try? screen.pngRepresentation.write(to: URL(fileURLWithPath: "/tmp/qa-chat-send-\(name).png"))
        let attachment = XCTAttachment(screenshot: screen)
        attachment.lifetime = .keepAlways
        add(attachment)
        XCTAssertTrue(landed, "the reply landed and is laid out", file: file, line: line)
        XCTAssertTrue(app.buttons["Send"].exists, "the turn ended", file: file, line: line)

        let shown = visibleRect(app, composer: composer)
        let texts = app.staticTexts.allElementsBoundByIndex
        let onScreen = texts.filter { $0.exists && !$0.frame.isEmpty && $0.frame.intersects(shown) }
        XCTAssertFalse(onScreen.isEmpty, "the transcript isn't blank between the header and the composer", file: file, line: line)
        XCTAssertTrue(final.isHittable, "the reply is on screen", file: file, line: line)
        XCTAssertTrue(final.frame.intersects(shown), "the reply is in view: \(final.frame) in \(shown)", file: file, line: line)
        XCTAssertLessThanOrEqual(final.frame.maxY, shown.maxY + 8, "the reply's end is above the composer: \(final.frame) in \(shown)", file: file, line: line)
        XCTAssertGreaterThan(final.frame.maxY, shown.maxY - 90, "the reply sits at the bottom, not over a blank past the end: \(final.frame) in \(shown)", file: file, line: line)
        XCTAssertFalse(app.buttons["Jump to latest"].exists, "still at the bottom", file: file, line: line)
    }

    /// Between the header and the composer.
    private func visibleRect(_ app: XCUIApplication, composer: XCUIElement) -> CGRect {
        let window = app.windows.firstMatch.frame
        let top = app.navigationBars.firstMatch.exists ? app.navigationBars.firstMatch.frame.maxY : window.minY + 120
        let bottom = composer.frame.minY - 12
        return CGRect(x: window.minX, y: top, width: window.width, height: max(0, bottom - top))
    }
}
