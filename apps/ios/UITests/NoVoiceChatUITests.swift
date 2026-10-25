import XCTest

/// New voice chat is gone: the Bot's rail has the bell and the ⋯ menu but no
/// phone button, and a thread's ⋯ menu has no New Voice Chat. The composer's
/// mic and speaker stay. On the local `-qaBotDemo` Bot; the server is a closed
/// local port, so nothing leaves the simulator. Runs on an iPhone, or with
/// `TEST_RUNNER_NO_VOICE_DUO=1` on the iPhone Duo's outer screen (466×678).
/// `TEST_RUNNER_NO_VOICE_SHOTS=<dir>` saves dark screenshots there.
@MainActor
final class NoVoiceChatUITests: XCTestCase {
    private let app = XCUIApplication()
    private let duo = ProcessInfo.processInfo.environment["NO_VOICE_DUO"] != nil

    func testBotRailHasNoVoiceChatButton() {
        app.launchArguments = ["-skipPushPrompt", "YES", "-serverURL", "http://127.0.0.1:9", "-qaDark", "-qaReduceMotion",
                               "-qaBotDemo", duo ? "duo" : "chat", "-openURL", "bbstudio://bot"]
        if duo { app.launchArguments.append("-qaDuoPhone") }
        app.launch()
        let composer = app.textViews.matching(NSPredicate(format: "label BEGINSWITH 'Message'")).firstMatch
        XCTAssertTrue(composer.waitForExistence(timeout: 30))
        if duo { XCUIDevice.shared.system.open(URL(string: "bbstudio://qa-duo/outer")!) }
        let bell = app.buttons.matching(NSPredicate(format: "label BEGINSWITH 'Activity'")).firstMatch
        XCTAssertTrue(bell.waitForExistence(timeout: 10), "The bell stays")
        XCTAssertTrue(app.buttons["Juniper options"].exists, "The ⋯ menu stays")
        sleep(2)
        shot("bot-rail")
        XCTAssertFalse(app.buttons["New voice chat"].exists, "No phone button in the Bot's rail")
        XCTAssertEqual(app.buttons.matching(NSPredicate(format: "label CONTAINS[c] 'voice chat'")).count, 0)
        XCTAssertTrue(app.buttons["composerMic"].exists, "The composer's mic stays")
    }

    func testThreadMenuHasNoVoiceChat() {
        app.launchArguments = ["-skipPushPrompt", "YES", "-serverURL", "http://127.0.0.1:9", "-qaDark", "-qaReduceMotion",
                               "-qaBotDemo", "duo", "-openURL", "bbstudio://thread/thr_botdemo01"]
        if duo { app.launchArguments.append("-qaDuoPhone") }
        app.launch()
        XCTAssertTrue(app.textViews["Message"].waitForExistence(timeout: 30))
        if duo { XCUIDevice.shared.system.open(URL(string: "bbstudio://qa-duo/outer")!) }
        sleep(2)
        shot("thread")
        let more = app.buttons["More"].firstMatch
        XCTAssertTrue(more.waitForExistence(timeout: 10))
        more.tap()
        XCTAssertTrue(app.buttons["Find in thread"].waitForExistence(timeout: 5), "The thread menu opened")
        sleep(1)
        shot("thread-menu")
        XCTAssertFalse(app.buttons["New Voice Chat"].exists, "No New Voice Chat in the thread menu")
    }

    private func shot(_ name: String) {
        guard let dir = ProcessInfo.processInfo.environment["NO_VOICE_SHOTS"] else { return }
        try? FileManager.default.createDirectory(atPath: dir, withIntermediateDirectories: true)
        try? XCUIScreen.main.screenshot().pngRepresentation
            .write(to: URL(fileURLWithPath: dir).appending(path: "\(duo ? "duo" : "iphone")-\(name).png"))
    }
}
