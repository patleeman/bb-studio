import XCTest

/// Conversations in the Bot's shell, offline (`-qaSpacesDemo` with
/// `-qaBotDemo chat`): Reply in thread opens a sheet and leaves a replies row,
/// Fork opens its own conversation under its parent, the model chip and the
/// ··· menu's Model and Finish, the workers line, New conversation, and
/// "Quiet check". `TEST_RUNNER_STEP5_OUT` keeps PNGs.
final class ConversationsUITests: ServerIsolatedUITestCase {
    private let app = XCUIApplication()

    private func launch(_ variant: String = "needs") {
        app.launchArguments += ["-skipPushPrompt", "YES", "-qaBotDemo", "chat", "-qaSpacesDemo", variant, "-qaNoDemoApprovals"]
        app.launchOffline()
        XCTAssertTrue(app.waitForRoom(), "Main opens from Home")
        XCTAssertTrue(app.textViews["Message"].waitForExistence(timeout: 30), "Main stands up")
    }

    func testReplyInThreadOpensASheetAndLeavesAReplyRow() {
        launch()
        XCTAssertFalse(app.buttons["conversationWorkers"].exists, "workers are on Home and in the transcript, not a line of their own")
        XCTAssertFalse(app.buttons["Model & permissions"].exists, "the model picker left the input bar")
        XCTAssertFalse(app.buttons["composerExpandToPage"].exists, "no open-as-page control")
        XCTAssertTrue(app.buttons["Send"].exists == false, "dictation is the action while it's empty")
        let existing = app.buttons["replies-m3"]
        for _ in 0..<6 where !existing.exists { app.collectionViews.firstMatch.swipeDown() }
        XCTAssertFalse(app.otherElements["quietCheck"].exists || app.staticTexts["Quiet check"].exists, "the room's Main hides a bare [PASS]")
        XCTAssertTrue(existing.waitForExistence(timeout: 15), "a reply with a thread shows its replies row")
        XCTAssertTrue(existing.label.contains("2 replies"), existing.label)
        shot("conversation")

        XCTAssertFalse(app.buttons.matching(NSPredicate(format: "identifier BEGINSWITH 'reply-in-thread-'")).firstMatch.exists,
                       "no reply button under every message")
        let message = app.collectionViews.firstMatch.staticTexts.matching(NSPredicate(format: "label CONTAINS 'draft the approval note' OR label CONTAINS 'like your OK before I push'")).firstMatch
        for _ in 0..<6 where !message.isHittable { app.collectionViews.firstMatch.swipeUp() }
        XCTAssertTrue(message.waitForExistence(timeout: 10))
        let reply = app.buttons["Reply in thread"]
        for _ in 0..<2 where !reply.exists {
            message.press(forDuration: 1)
            _ = reply.waitForExistence(timeout: 4)
        }
        reply.tap()
        let field = app.textViews["Reply…"]
        XCTAssertTrue(field.waitForExistence(timeout: 15), "the thread opens, pushed over its conversation")
        shot("reply-sheet")
        field.tap()
        field.typeText("Hold it until Friday")
        app.buttons["Send"].firstMatch.tap()
        XCTAssertTrue(app.staticTexts.matching(NSPredicate(format: "label CONTAINS 'Main stays clear'")).firstMatch.waitForExistence(timeout: 15))
        shot("reply-sheet-answered")
        app.closeReplyThread()
        let replies = app.buttons["replies-m5"]
        XCTAssertTrue(replies.waitForExistence(timeout: 15), "the reply row shows under the message")
        XCTAssertTrue(replies.label.contains("2 replies"), replies.label)
        shot("replies-indicator")

        for _ in 0..<6 where !existing.isHittable { app.collectionViews.firstMatch.swipeDown() }
        existing.tap()
        XCTAssertTrue(app.staticTexts.matching(NSPredicate(format: "label CONTAINS 'release workflow fix'")).firstMatch.waitForExistence(timeout: 15),
                      "the replies row reopens its thread")
        app.closeReplyThread()
    }

    func testForkOpensBesideItsConversationWithNoRow() {
        launch("list")
        let text = app.collectionViews.firstMatch.staticTexts.matching(NSPredicate(format: "label CONTAINS 'draft the approval note'")).firstMatch
        XCTAssertTrue(text.waitForExistence(timeout: 15))
        for _ in 0..<6 where !text.isHittable { app.collectionViews.firstMatch.swipeDown() }
        let fork = app.buttons["Fork conversation"]
        for _ in 0..<2 where !fork.exists {
            text.press(forDuration: 1)
            _ = fork.waitForExistence(timeout: 4)
        }
        XCTAssertTrue(app.buttons["Reply in thread"].exists, "Reply in thread is in the menu too")
        XCTAssertFalse(app.buttons["Side Chat"].exists, "side chat is gone from conversations")
        fork.tap()
        XCTAssertTrue(app.staticTexts["Main · fork"].waitForExistence(timeout: 15), "the fork opens in a sheet over its conversation")
        app.closeReplyThread()
        // Review M9: the fork stays reachable from its message.
        let forked = app.buttons.matching(NSPredicate(format: "identifier BEGINSWITH 'forked-'")).firstMatch
        // Back in the conversation it may show its latest: up to the message.
        for _ in 0..<6 where !forked.waitForExistence(timeout: 2) { app.collectionViews.firstMatch.swipeDown() }
        XCTAssertTrue(forked.waitForExistence(timeout: 15), "the message shows its Forked here line")
        XCTAssertTrue(forked.label.contains("Forked here · 1 conversation"), forked.label)
        forked.tap()
        XCTAssertTrue(app.staticTexts["Main · fork"].waitForExistence(timeout: 15), "the line reopens the fork")
        app.closeReplyThread()
        app.openRoomPlace("conversations")
        XCTAssertTrue(app.homeNew.waitForExistence(timeout: 15))
        XCTAssertFalse(app.buttons["homeConversation-thr_demo_fork1"].exists, "a fork has no row of its own")
    }

    func testMainHasNoFinish() {
        launch("list")
        app.openConversationMenu()
        XCTAssertTrue(app.menuItem("Model & permissions").waitForExistence(timeout: 5))
        XCTAssertFalse(app.menuItem("Archive").exists)
        XCTAssertFalse(app.menuItem("Delete conversation…").exists)
    }

    func testNewConversation() {
        launch("list")
        app.openRoomPlace("conversations")
        let plus = app.homeNew
        XCTAssertTrue(plus.waitForExistence(timeout: 10))
        plus.tap()
        let field = app.textViews["Message Juniper"]
        XCTAssertTrue(field.waitForExistence(timeout: 10))
        field.tap()
        field.typeText("Plan the Lisbon dinner")
        app.buttons["newConversationStart"].tap()
        XCTAssertTrue(app.staticTexts["Plan the Lisbon dinner"].waitForExistence(timeout: 15), "the new conversation opens")
        app.openRoomPlace("conversations")
        XCTAssertTrue(app.buttons["homeConversation-thr_demo_new1"].waitForExistence(timeout: 15))
    }

    private func shot(_ name: String) {
        guard let folder = ProcessInfo.processInfo.environment["STEP5_OUT"] else { return }
        sleep(1)
        let url = URL(fileURLWithPath: folder)
        try? FileManager.default.createDirectory(at: url, withIntermediateDirectories: true)
        try? XCUIScreen.main.screenshot().pngRepresentation.write(to: url.appendingPathComponent("\(name).png"))
    }
}
