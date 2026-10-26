import XCTest

/// Screenshots of the Bot's one "needs you" (`-qaBotAttention`, on the local
/// `-qaBotDemo` Bot; the server is a closed local port, so nothing leaves the
/// simulator): the Bot asked a question, a thread under Running waits for an
/// approval the Bot owns, and a runner's urgent report reads "reported".
/// Skipped unless `TEST_RUNNER_BBGO_STATES_OUT` names a folder; PNGs land
/// there as `<TEST_RUNNER_BBGO_STATES_TAG><name>.png`.
@MainActor
final class BotAttentionCaptureUITests: ServerIsolatedUITestCase {
    private let app = XCUIApplication()

    override func setUpWithError() throws {
        try super.setUpWithError()
        guard ProcessInfo.processInfo.environment["BBGO_STATES_OUT"] != nil else {
            throw XCTSkip("Set TEST_RUNNER_BBGO_STATES_OUT to a folder")
        }
        continueAfterFailure = false
    }

    /// The Activity sheet on the phone.
    func testActivityPhone() throws {
        guard UIDevice.current.userInterfaceIdiom == .phone else { throw XCTSkip("Phone only") }
        launch(["-qaBotDemo", "chat", "-qaBotSheet", "activity", "-qaBotAttention", "-qaReduceMotion", "-bot.threads.closed", "earlier"])
        XCTAssertTrue(text(containing: "Asked you a question").waitForExistence(timeout: 20))
        XCTAssertTrue(text(containing: "Waiting for approval").exists)
        sleep(1)
        fullHeight()
        shot("phone")
    }

    /// The same sidebar in the unfolded Duo, a 951×669 window on the iPad simulator.
    func testActivityDuo() throws {
        guard UIDevice.current.userInterfaceIdiom == .pad else { throw XCTSkip("iPad only") }
        launch(["-qaBotDemo", "duo", "-qaDuoPhone", "-qaDuoLong", "-qaDuoColdWide", "-qaReduceMotion", "-qaBotAttention", "-openURL", "bbstudio://bot"])
        XCTAssertTrue(text(containing: "Waiting for approval").waitForExistence(timeout: 30))
        XCTAssertTrue(text(containing: "Asked you a question").exists)
        sleep(2)
        shot("duo")
    }

    /// The Bots list: the bot that needs you says why, with a count.
    func testBotListPhone() throws {
        guard UIDevice.current.userInterfaceIdiom == .phone else { throw XCTSkip("Phone only") }
        launch(["-qaBotDemo", "list", "-qaBotAttention"])
        // It may open on the primary bot's chat; its ‹ (top left) goes to the list.
        let list = app.staticTexts["Scout"]
        if !list.waitForExistence(timeout: 15) {
            app.windows.firstMatch.coordinate(withNormalizedOffset: CGVector(dx: 0.095, dy: 0.096)).tap()
        }
        XCTAssertTrue(app.staticTexts["Scout"].waitForExistence(timeout: 10))
        XCTAssertTrue(text(containing: "Asked you a question").exists)
        sleep(1)
        shot("phone-botlist")
    }

    /// The Bot's chat: its header says why it needs you instead of "Needs you".
    func testChatHeaderPhone() throws {
        guard UIDevice.current.userInterfaceIdiom == .phone else { throw XCTSkip("Phone only") }
        launch(["-qaBotDemo", "chat", "-qaBotAttention", "-qaReduceMotion"])
        // A launch after the Bots list may reopen the list; the chat is its row.
        XCTAssertTrue(app.staticTexts["Juniper"].firstMatch.waitForExistence(timeout: 20))
        sleep(2)
        if app.staticTexts["Primary"].exists { app.staticTexts["Primary"].tap() }
        // VoiceOver reads the full reason even when the header shows the short one.
        XCTAssertTrue(text(containing: "Juniper, Asked you a question").waitForExistence(timeout: 20))
        sleep(2)
        shot("phone-chat")
    }

    /// The BB status widget's view with the Bot's attention (`-qaStateDemo widgets`).
    func testWidgetsPhone() throws {
        guard UIDevice.current.userInterfaceIdiom == .phone else { throw XCTSkip("Phone only") }
        launch(["-qaStateDemo", "widgets"])
        XCTAssertTrue(app.descendants(matching: .any)["widget-systemMedium"].waitForExistence(timeout: 20))
        XCTAssertTrue(text(containing: "Asked you a question").exists)
        sleep(1)
        shot("widget")
    }

    /// Drags the sheet's grabber to the top.
    private func fullHeight() {
        let window = app.windows.firstMatch
        window.coordinate(withNormalizedOffset: CGVector(dx: 0.5, dy: 0.485))
            .press(forDuration: 0.1, thenDragTo: window.coordinate(withNormalizedOffset: CGVector(dx: 0.5, dy: 0.05)))
        sleep(2)
    }

    private func launch(_ arguments: [String]) {
        app.launchArguments = ["-skipPushPrompt", "YES"] + arguments
        app.launchOffline()
    }

    private func text(containing value: String) -> XCUIElement {
        app.descendants(matching: .any).matching(NSPredicate(format: "label CONTAINS %@", value)).firstMatch
    }

    private func shot(_ name: String) {
        sleep(1)
        let env = ProcessInfo.processInfo.environment
        let folder = URL(fileURLWithPath: env["BBGO_STATES_OUT"]!)
        try? FileManager.default.createDirectory(at: folder, withIntermediateDirectories: true)
        let data = XCUIScreen.main.screenshot().pngRepresentation
        try? data.write(to: folder.appendingPathComponent("\(env["BBGO_STATES_TAG"] ?? "")\(name).png"))
    }
}
