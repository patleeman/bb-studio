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
        XCTAssertTrue(app.textViews["Message"].waitForExistence(timeout: 30), "Main opens")
    }

    private func back() {
        let bar = app.navigationBars.firstMatch
        XCTAssertTrue(bar.waitForExistence(timeout: 20))
        bar.buttons.element(boundBy: 0).tap()
    }

    func testReplyInThreadOpensASheetAndLeavesAReplyRow() {
        launch()
        let chip = app.buttons["conversationModelChip"]
        XCTAssertTrue(chip.waitForExistence(timeout: 10), "the model chip is in the header")
        XCTAssertTrue(chip.label.contains("Opus 5.5"), chip.label)
        let workers = app.buttons["conversationWorkers"]
        XCTAssertTrue(workers.waitForExistence(timeout: 10))
        XCTAssertTrue(workers.label.contains("2 workers from here"), workers.label)
        XCTAssertFalse(app.buttons["Model & permissions"].exists, "the model picker left the input bar")
        XCTAssertFalse(app.buttons["composerExpandToPage"].exists, "no open-as-page control")
        XCTAssertTrue(app.buttons["Send"].exists == false, "dictation is the action while it's empty")
        XCTAssertTrue(app.otherElements["quietCheck"].exists || app.staticTexts["Quiet check"].exists, "[PASS] reads Quiet check")
        let existing = app.buttons["replies-m3"]
        XCTAssertTrue(existing.waitForExistence(timeout: 15), "a reply with a thread shows its replies row")
        XCTAssertTrue(existing.label.contains("2 replies"), existing.label)
        shot("conversation")

        let reply = app.buttons["reply-in-thread-m5"]
        XCTAssertTrue(reply.waitForExistence(timeout: 10))
        reply.tap()
        let field = app.textViews["Reply…"]
        XCTAssertTrue(field.waitForExistence(timeout: 15), "the thread opens as a sheet")
        XCTAssertTrue(app.buttons["replyThreadDone"].exists)
        shot("reply-sheet")
        field.tap()
        field.typeText("Hold it until Friday")
        app.buttons["Send"].firstMatch.tap()
        XCTAssertTrue(app.staticTexts.matching(NSPredicate(format: "label CONTAINS 'Main stays clear'")).firstMatch.waitForExistence(timeout: 15))
        shot("reply-sheet-answered")
        app.buttons["replyThreadDone"].tap()
        let replies = app.buttons["replies-m5"]
        XCTAssertTrue(replies.waitForExistence(timeout: 15), "the reply row shows under the message")
        XCTAssertTrue(replies.label.contains("2 replies"), replies.label)
        shot("replies-indicator")

        existing.tap()
        XCTAssertTrue(app.staticTexts.matching(NSPredicate(format: "label CONTAINS 'release workflow fix'")).firstMatch.waitForExistence(timeout: 15),
                      "the replies row reopens its thread")
        app.buttons["replyThreadDone"].tap()
    }

    func testForkOpensBesideItsConversationWithNoRow() {
        launch("list")
        let text = app.staticTexts.matching(NSPredicate(format: "label CONTAINS 'draft the approval note'")).firstMatch
        XCTAssertTrue(text.waitForExistence(timeout: 15))
        let fork = app.buttons["Fork conversation"]
        for _ in 0..<2 where !fork.exists {
            text.press(forDuration: 1)
            _ = fork.waitForExistence(timeout: 4)
        }
        XCTAssertTrue(app.buttons["Reply in thread"].exists, "Reply in thread is in the menu too")
        XCTAssertFalse(app.buttons["Side Chat"].exists, "side chat is gone from conversations")
        fork.tap()
        XCTAssertTrue(app.staticTexts["Main · fork"].waitForExistence(timeout: 15), "the fork opens in a sheet over its conversation")
        app.buttons["replyThreadDone"].tap()
        // Review M9: the fork stays reachable from its message.
        let forked = app.buttons.matching(NSPredicate(format: "identifier BEGINSWITH 'forked-'")).firstMatch
        XCTAssertTrue(forked.waitForExistence(timeout: 15), "the message shows its Forked here line")
        XCTAssertTrue(forked.label.contains("Forked here · 1 conversation"), forked.label)
        forked.tap()
        XCTAssertTrue(app.staticTexts["Main · fork"].waitForExistence(timeout: 15), "the line reopens the fork")
        app.buttons["replyThreadDone"].tap()
        back()
        XCTAssertTrue(app.collectionViews["BotSpaceList"].waitForExistence(timeout: 15))
        XCTAssertFalse(app.collectionViews["BotSpaceList"].buttons["conversation-thr_demo_fork1"].exists, "a fork has no row of its own")
    }

    func testMainHasNoFinish() {
        launch("list")
        app.navigationBars.buttons["More"].tap()
        XCTAssertTrue(app.buttons["menuModel"].waitForExistence(timeout: 5))
        XCTAssertFalse(app.buttons["menuFinish"].exists)
    }

    func testNewConversation() {
        launch("list")
        back()
        let plus = app.buttons["BotSpaceNewConversation"]
        XCTAssertTrue(plus.waitForExistence(timeout: 10))
        plus.tap()
        let field = app.textFields["newConversationField"].exists ? app.textFields["newConversationField"] : app.textViews["newConversationField"]
        XCTAssertTrue(field.waitForExistence(timeout: 10))
        field.typeText("Plan the Lisbon dinner")
        app.buttons["newConversationStart"].tap()
        XCTAssertTrue(app.staticTexts["Plan the Lisbon dinner"].waitForExistence(timeout: 15), "the new conversation opens")
        back()
        XCTAssertTrue(app.collectionViews["BotSpaceList"].buttons["conversation-thr_demo_new1"].waitForExistence(timeout: 15))
    }

    private func shot(_ name: String) {
        guard let folder = ProcessInfo.processInfo.environment["STEP5_OUT"] else { return }
        sleep(1)
        let url = URL(fileURLWithPath: folder)
        try? FileManager.default.createDirectory(at: url, withIntermediateDirectories: true)
        try? XCUIScreen.main.screenshot().pngRepresentation.write(to: url.appendingPathComponent("\(name).png"))
    }
}
