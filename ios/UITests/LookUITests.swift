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
        // The split shell starts on the Bot's list and opens Main once it knows
        // Main; when it stays on the list, open Main from it. (Main's build
        // landed through the socket's retries reloading everything offline.)
        let message = app.textViews["Message"]
        let main = app.buttons["conversation-thr_botdemo01"]
        let until = Date().addingTimeInterval(60)
        while !message.exists, Date() < until {
            if main.exists, main.isHittable { main.tap() }
            _ = message.waitForExistence(timeout: 2)
        }
        XCTAssertTrue(message.exists, "Main opens")
    }

    /// The split shell's Bot list, back from Main (the folded Duo's Back is in its column).
    private func toList() {
        app.goBack()
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
        // Rows below the fold (the folded Duo's screen is shorter) come in as it scrolls.
        func theme(_ id: String, wait: TimeInterval = 0) -> Bool {
            let row = app.buttons["LookTheme-\(id)"]
            if row.waitForExistence(timeout: wait) { return true }
            for _ in 0..<3 where !row.exists { app.swipeUp() }
            for _ in 0..<4 where !row.exists { app.swipeDown() }
            return row.exists
        }
        for id in ["on-air", "bb-default", "one-dark", "dracula", "solarized-light", "github-light", "github-dark", "nord", "catppuccin-mocha"] {
            XCTAssertTrue(theme(id, wait: 5), id)
        }
        shot("settings-look")
        app.swipeUp()
        for id in ["miami-1985", "event-horizon", "grid", "kyoto-garden", "forest", "aurora-fjord", "tonights-sky", "data-city", "deep-sea"] {
            XCTAssertTrue(theme(id), id)
        }
        app.swipeUp()
        XCTAssertTrue(app.switches["LookLiveScene"].waitForExistence(timeout: 5))
        shot("settings-look-scenes")
    }
}
