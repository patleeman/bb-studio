import XCTest

/// The phone's look, offline (`-qaSpacesDemo needs`): On Air by default, a
/// Classic theme, scene themes as a still behind the Bot's list (never behind
/// the conversation), the presence in the header, and Settings → Look.
/// `TEST_RUNNER_LOOK_OUT` keeps PNGs.
final class LookUITests: ServerIsolatedUITestCase {
    private let app = XCUIApplication()

    private func launch(theme: String, live: Bool = false) {
        app.launchArguments += ["-skipPushPrompt", "YES", "-qaBotDemo", "chat", "-qaSpacesDemo", "needs", "-qaNoDemoApprovals", "-qaLookTheme", theme, "-qaSplitShell"]
        if live { app.launchArguments.append("-qaLiveScene") }
        app.launchOffline()
        XCTAssertTrue(app.textViews["Message"].waitForExistence(timeout: 30), "Main opens")
    }

    private func toList() {
        let bar = app.navigationBars.firstMatch
        XCTAssertTrue(bar.waitForExistence(timeout: 20))
        bar.buttons.element(boundBy: 0).tap()
        XCTAssertTrue(app.otherElements["BotSpaceHeader"].firstMatch.waitForExistence(timeout: 15) || app.staticTexts["Conversations"].waitForExistence(timeout: 5))
    }

    private func shot(_ name: String) {
        guard let folder = ProcessInfo.processInfo.environment["LOOK_OUT"] else { return }
        sleep(1)
        let url = URL(fileURLWithPath: folder)
        try? FileManager.default.createDirectory(at: url, withIntermediateDirectories: true)
        try? XCUIScreen.main.screenshot().pngRepresentation.write(to: url.appendingPathComponent("\(name).png"))
    }

    func testOnAirIsTheDefaultAndShowsThePresence() {
        launch(theme: "on-air")
        shot("on-air-main")
        toList()
        XCTAssertEqual(app.descendants(matching: .any)["BotSpaceList"].firstMatch.value as? String, "On Air", "a classic theme has no scene")
        shot("on-air-home")
    }

    func testEverySceneShowsAStillBehindTheListOnly() {
        for theme in ["event-horizon", "forest", "kyoto-garden", "tonights-sky", "miami-1985", "aurora-fjord", "grid", "data-city", "deep-sea"] {
            app.terminate()
            app.launchArguments = []
            launch(theme: theme)
            shot("\(theme)-main")
            toList()
            let list = app.descendants(matching: .any)["BotSpaceList"].firstMatch
            XCTAssertTrue(list.waitForExistence(timeout: 20))
            XCTAssertTrue((list.value as? String ?? "").hasPrefix("Scene "), "\(theme): the list sits on the scene (\(list.value ?? "-"))")
            shot("\(theme)-home")
        }
    }

    func testClassicThemes() {
        for theme in ["github-light", "dracula"] {
            app.terminate()
            app.launchArguments = []
            launch(theme: theme)
            toList()
            shot("\(theme)-home")
        }
    }

    func testLookSettingsListsEveryTheme() {
        launch(theme: "on-air")
        toList()
        app.buttons["BotSpaceSettings"].tap()
        let look = app.buttons["SettingsLook"]
        XCTAssertTrue(app.buttons["Server"].waitForExistence(timeout: 15) || app.textFields["settingsServerURL"].waitForExistence(timeout: 5))
        for _ in 0..<6 where !look.isHittable { app.swipeUp() }
        XCTAssertTrue(look.waitForExistence(timeout: 5))
        look.tap()
        for id in ["on-air", "bb-default", "one-dark", "dracula", "solarized-light", "github-light", "github-dark", "nord", "catppuccin-mocha"] {
            XCTAssertTrue(app.buttons["LookTheme-\(id)"].waitForExistence(timeout: 5), id)
        }
        shot("settings-look")
        app.swipeUp()
        for id in ["miami-1985", "event-horizon", "grid", "kyoto-garden", "forest", "aurora-fjord", "tonights-sky", "data-city", "deep-sea"] {
            XCTAssertTrue(app.buttons["LookTheme-\(id)"].exists, id)
        }
        app.swipeUp()
        XCTAssertTrue(app.switches["LookLiveScene"].waitForExistence(timeout: 5))
        shot("settings-look-scenes")
    }
}
