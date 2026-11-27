import XCTest

/// Round 5, change 3, on the iPhone Duo simulator unfolded, offline: Home on
/// the left and the live conversation on the right; the title moves the
/// conversation left and shows its Workspace on the right (Info first,
/// clear of the status column); a worker from Strands opens live on the
/// right; Home brings Home back. `TEST_RUNNER_DUO_WS_OUT` keeps PNGs.
final class DuoWorkspaceUITests: ServerIsolatedUITestCase {
    private let app = XCUIApplication()

    private func any(_ id: String) -> XCUIElement { app.descendants(matching: .any)[id].firstMatch }

    /// The simulator's screen is as wide as the outer one: bring the inner screen's right or left page onto it.
    private func page(_ side: String) {
        XCUIDevice.shared.system.open(URL(string: side == "right" ? "bbstudio://qa-duo/split-right" : "bbstudio://qa-duo/landscape")!)
        sleep(2)
    }

    func testTheUnfoldedDuoIsChatAndWorkspace() throws {
        try XCTSkipUnless(UIDevice.current.name.lowercased().contains("duo"), "an iPhone Duo simulator")
        app.launchArguments = ["-skipPushPrompt", "YES", "-qaBotDemo", "chat", "-qaSpacesDemo", "list", "-qaRoomConversation",
                               "thr_botdemo01", "-qaStrandsDemo", "-qaWorkspaceDemo", "-qaPageDemo"]
        app.launchOffline()
        XCTAssertTrue(app.textViews["Message"].waitForExistence(timeout: 30))
        XCUIDevice.shared.system.open(URL(string: "bbstudio://qa-duo/landscape")!)
        sleep(3)
        XCTAssertTrue(any("roomContext").waitForExistence(timeout: 15), "Home on the left")
        XCTAssertTrue(any("roomConversation").exists, "the live conversation on the right")
        shot("1-home")

        page("right")
        let title = app.buttons["conversationMore"]
        XCTAssertTrue(title.waitForExistence(timeout: 10))
        title.tap()
        XCTAssertTrue(any("duoWorkspace").waitForExistence(timeout: 10), "the Workspace on the right")
        XCTAssertTrue(any("workspaceInfo").waitForExistence(timeout: 10), "Info first")
        XCTAssertFalse(any("roomContext").exists, "the conversation took the left screen")
        let strip = any("workspaceStrip")
        XCTAssertTrue(strip.waitForExistence(timeout: 5))
        let window = app.windows.firstMatch.frame
        XCTAssertLessThanOrEqual(app.buttons["workspaceModel"].frame.maxX, window.maxX - 60, "the Workspace stays clear of the status column")
        shot("2-workspace")

        app.buttons["workspaceTab-strands"].tap()
        let worker = app.buttons.matching(NSPredicate(format: "identifier BEGINSWITH 'strand-worker-'")).firstMatch
        XCTAssertTrue(worker.waitForExistence(timeout: 10), "a strand's worker")
        worker.tap()
        XCTAssertTrue(app.buttons["duoWorkerBack"].waitForExistence(timeout: 10), "the worker live on the right")
        shot("3-worker")
        app.buttons["duoWorkerBack"].tap()
        XCTAssertTrue(any("workspaceStrip").waitForExistence(timeout: 5))

        page("left")
        app.buttons["roomList"].firstMatch.tap()
        XCTAssertTrue(any("roomContext").waitForExistence(timeout: 10), "Home comes back on the left")
    }

    private func shot(_ name: String) {
        guard let folder = ProcessInfo.processInfo.environment["DUO_WS_OUT"] else { return }
        sleep(1)
        let url = URL(fileURLWithPath: folder)
        try? FileManager.default.createDirectory(at: url, withIntermediateDirectories: true)
        try? XCUIScreen.main.screenshot().pngRepresentation.write(to: url.appendingPathComponent("\(name).png"))
    }
}
