import XCTest

/// The Bot chat's ⋯ menu opens its thread's terminals, as a regular thread's
/// does, on the demo Bot (`-qaBotDemo chat`, no server). The open menu lands
/// in `/tmp/qa-bot-terminal-menu.png`.
final class BotTerminalUITests: XCTestCase {
    func testBotMenuOpensTheChatsTerminals() throws {
        let app = XCUIApplication()
        app.launchArguments += ["-skipPushPrompt", "YES", "-qaBotDemo", "chat", "-openURL", "bbstudio://bot"]
        app.launch()
        let options = app.buttons["Juniper options"]
        XCTAssertTrue(options.waitForExistence(timeout: 20))
        XCTAssertTrue(app.descendants(matching: .any)["composerMic"].firstMatch.waitForExistence(timeout: 20), "the chat loaded")
        options.tap()
        let terminals = app.buttons["Terminals"]
        XCTAssertTrue(terminals.waitForExistence(timeout: 5), "Terminals is in the Bot's menu")
        sleep(1)
        try? XCUIScreen.main.screenshot().pngRepresentation.write(to: URL(fileURLWithPath: "/tmp/qa-bot-terminal-menu.png"))
        terminals.tap()
        XCTAssertTrue(app.navigationBars["Terminals"].waitForExistence(timeout: 5), "it opens the thread's terminals")
    }
}
