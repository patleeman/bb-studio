import XCTest

/// The phone's look, offline (`-qaSpacesDemo needs`): On Air by default, a
/// Classic theme, scene themes as a still behind the shell (Home and the
/// conversation, round 7), and Settings → Look. `TEST_RUNNER_LOOK_OUT` keeps PNGs.
final class LookUITests: ServerIsolatedUITestCase {
    private let app = XCUIApplication()

    private func launch(theme: String, live: Bool = false) {
        app.launchArguments += ["-skipPushPrompt", "YES", "-qaBotDemo", "chat", "-qaSpacesDemo", "needs", "-qaNoDemoApprovals", "-qaLookTheme", theme]
        if live { app.launchArguments.append("-qaLiveScene") }
        app.launchOffline()
        XCTAssertTrue(app.waitForRoom(timeout: 60), "Main opens")
    }

    /// Home, back from Main.
    private func toList() {
        app.goHome()
    }

    /// The scene behind the shell: its theme's id, or none for a Classic theme.
    private var scene: XCUIElement { app.descendants(matching: .any)["shellScene"].firstMatch }

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
        // A Classic phone theme has no scene of its own: the shell's default one (BotTheme.fallback).
        XCTAssertTrue(scene.waitForExistence(timeout: 20))
        XCTAssertEqual(scene.value as? String, "aurora-fjord", "a classic theme falls back to the default scene")
        shot("on-air-home")
    }

    func testEverySceneShowsAStillBehindTheShell() {
        for theme in ["event-horizon", "forest", "kyoto-garden", "tonights-sky", "miami-1985", "aurora-fjord", "grid", "data-city", "deep-sea"] {
            app.terminate()
            app.launchArguments = []
            launch(theme: theme)
            shot("\(theme)-main")
            toList()
            XCTAssertTrue(scene.waitForExistence(timeout: 20), "\(theme): Home sits on the scene")
            XCTAssertEqual(scene.value as? String, theme)
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
        app.openRoomPlace("settings")
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
