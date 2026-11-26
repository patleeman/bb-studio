import XCTest

/// A Bot conversation's ⋯ menu opens its thread's terminals, as a regular thread's
/// does, on the demo Bot (`-qaBotDemo chat`, no server). The open menu lands
/// in `/tmp/qa-bot-terminal-menu.png`.
final class BotTerminalUITests: ServerIsolatedUITestCase {
    func testBotMenuOpensTheChatsTerminals() throws {
        let app = XCUIApplication()
        app.launchArguments += ["-skipPushPrompt", "YES", "-qaBotDemo", "chat", "-openURL", "bbstudio://bot"]
        app.launchOffline()
        let options = app.conversationMore
        XCTAssertTrue(options.waitForExistence(timeout: 20))
        XCTAssertTrue(app.descendants(matching: .any)["composerMic"].firstMatch.waitForExistence(timeout: 20), "the chat loaded")
        app.openConversationMenu()
        let terminals = app.buttons["Terminals"]
        XCTAssertTrue(terminals.waitForExistence(timeout: 5), "Terminals is in the conversation's menu")
        sleep(1)
        try? XCUIScreen.main.screenshot().pngRepresentation.write(to: URL(fileURLWithPath: "/tmp/qa-bot-terminal-menu.png"))
        terminals.tap()
        // The iPhone's bar, or the Duo's title line.
        let title = app.descendants(matching: .any).matching(NSPredicate(format: "identifier == 'shellTitle' AND label == 'Terminals'")).firstMatch
        let opened = NSPredicate { _, _ in app.navigationBars["Terminals"].exists || title.exists }
        XCTAssertEqual(XCTWaiter.wait(for: [XCTNSPredicateExpectation(predicate: opened, object: nil)], timeout: 5), .completed,
                       "it opens the thread's terminals")
    }
}
