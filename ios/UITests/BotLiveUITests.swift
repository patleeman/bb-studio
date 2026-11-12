import XCTest

/// Read-only probe of the Bot tab on the server the simulator is signed in
/// to: its chat, scrolling up through earlier history (across handoffs), and
/// Activity. Sends nothing and changes nothing. Screenshots land in
/// `/tmp/qa-bot-live-*.png`. Skipped unless `TEST_RUNNER_BBGO_BOT_PROBE=1`;
/// `TEST_RUNNER_BBGO_BOT_PROBE_SWIPES=<n>` scrolls further.
final class BotLiveUITests: StagedServerUITestCase {
    private let app = XCUIApplication()

    func testBrowseBotReadOnly() throws {
        let env = ProcessInfo.processInfo.environment
        guard env["BBGO_BOT_PROBE"] == "1" else { throw XCTSkip("Set TEST_RUNNER_BBGO_BOT_PROBE=1") }
        let swipes = Int(env["BBGO_BOT_PROBE_SWIPES"] ?? "") ?? 12
        app.launchArguments += ["-skipPushPrompt", "YES", "-openURL", "bbstudio://bot"]
        app.launchStaged(server: qaServer)
        sleep(8)
        screenshot("chat")
        for index in 1...swipes {
            app.swipeDown(velocity: .fast)
            sleep(2)
            if index % 3 == 0 { screenshot("history-\(index)") }
        }
        let activity = app.buttons.matching(NSPredicate(format: "label BEGINSWITH 'Activity'")).firstMatch
        XCTAssertTrue(activity.waitForExistence(timeout: 10))
        activity.tap()
        sleep(3)
        screenshot("activity")
    }

    private func screenshot(_ name: String) {
        let shot = XCUIScreen.main.screenshot()
        try? shot.pngRepresentation.write(to: URL(fileURLWithPath: "/tmp/qa-bot-live-\(name).png"))
        let attachment = XCTAttachment(screenshot: shot)
        attachment.name = name
        attachment.lifetime = .keepAlways
        add(attachment)
    }
}
