import XCTest

/// Opening the app before Studio's Bots answer (a first launch, or a new
/// server; offline, `-qaSpacesLate <ms>` holds `bot_spaces` back): a loading
/// state, then Home. A link or push that came meanwhile opens once the
/// Bots answer. Only no answer within the timeout (`-qaSpacesFallback
/// <ms>`, 10 s in the app) shows "Can't reach Studio" with Try Again. There's
/// no tab bar to fall back to. `LOADING_OUT` keeps PNGs.
final class SpacesLoadingUITests: ServerIsolatedUITestCase {
    private let app = XCUIApplication()

    private var loading: XCUIElement { app.descendants(matching: .any)["spacesLoading"].firstMatch }
    private var unreachable: XCUIElement { app.descendants(matching: .any)["studioUnreachable"].firstMatch }
    private var home: XCUIElement { app.descendants(matching: .any).matching(NSPredicate(format: "identifier == %@", "home")).firstMatch }

    private func launch(late: String, fallback: Int, extra: [String] = []) {
        app.launchArguments += ["-skipPushPrompt", "YES", "-qaBotDemo", "chat", "-qaSpacesDemo", "list", "-qaReduceMotion",
                                "-qaSpacesLate", late, "-qaSpacesFallback", String(fallback)] + extra
        app.launchOffline()
        XCTAssertTrue(loading.waitForExistence(timeout: 20), "the app opens on the loading state")
        XCTAssertFalse(app.tab("Home").exists, "not the room yet")
        shot("1-loading")
    }

    private func shot(_ name: String) {
        guard let folder = ProcessInfo.processInfo.environment["LOADING_OUT"] else { return }
        let url = URL(fileURLWithPath: folder)
        try? FileManager.default.createDirectory(at: url, withIntermediateDirectories: true)
        try? XCUIScreen.main.screenshot().pngRepresentation.write(to: url.appendingPathComponent("\(name).png"))
    }

    func testAnAnswerGoesFromLoadingToHome() {
        launch(late: "6000", fallback: 30000)
        let deadline = Date().addingTimeInterval(25)
        while !home.exists, Date() < deadline {
            XCTAssertFalse(unreachable.exists, "no failure while it's only slow")
            usleep(200_000)
        }
        XCTAssertTrue(home.exists, "Home once Studio answers")
        XCTAssertFalse(loading.exists)
        shot("2-home")
    }

    func testNoAnswerShowsCantReachStudioWithTryAgain() {
        launch(late: "never", fallback: 3000)
        XCTAssertTrue(unreachable.waitForExistence(timeout: 20), "Can't reach Studio after the timeout")
        XCTAssertTrue(app.buttons["studioRetry"].exists, "with Try Again")
        XCTAssertTrue(app.buttons["studioSettings"].exists, "and Settings")
        shot("3-unreachable")
        app.buttons["studioRetry"].tap()
        XCTAssertTrue(loading.waitForExistence(timeout: 10), "Try Again loads again")
    }

    func testALinkDuringLoadingOpensItsTargetOnceTheRoomShows() {
        launch(late: "6000", fallback: 30000, extra: ["-openURL", "bbstudio://bot"])
        XCTAssertTrue(app.textViews["Message"].waitForExistence(timeout: 30), "the link waits for the Bots, then opens Main")
        XCTAssertFalse(unreachable.exists)
        shot("4-linked")
    }

    func testAnExistingUserColdLaunchingIntoASheetGetsTheRoomAtOnce() {
        app.launchArguments += ["-skipPushPrompt", "YES", "-qaBotDemo", "chat", "-qaSpacesDemo", "list", "-qaReduceMotion",
                                "-openURL", "bbstudio://capture"]
        app.launchOffline()
        XCTAssertTrue(app.navigationBars["Capture to BB"].waitForExistence(timeout: 30), "the sheet is up")
        XCTAssertFalse(loading.exists, "no loading frame for a known Studio")
        XCTAssertTrue(app.tab("Home").exists, "the room's tabs under the sheet")
    }

    func testAThreadLinkForAnExistingUserOpensItInTheRoom() {
        app.launchArguments += ["-skipPushPrompt", "YES", "-qaBotDemo", "chat", "-qaSpacesDemo", "list", "-qaReduceMotion",
                                "-openURL", "bbstudio://bot"]
        app.launchOffline()
        XCTAssertTrue(app.textViews["Message"].waitForExistence(timeout: 30), "the link opens the Bot's Main over Home")
        XCTAssertTrue(app.tab("Home").exists, "in the room, on Home's tab")
    }
}
