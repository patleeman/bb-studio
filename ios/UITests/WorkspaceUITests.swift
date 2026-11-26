import XCTest

/// Round 5, change 3, offline (`-qaBotDemo chat -qaSpacesDemo needs
/// -qaStrandsDemo -qaWorkspaceDemo -qaPageDemo`): the title opens the
/// Workspace sheet on Info; the strip has Info, Strands and the
/// conversation's tabs (✦ on the agent's); a document grows the sheet; ✕
/// shows only on the active tab; More holds the rest of the old ⋯; Done
/// dismisses. `TEST_RUNNER_WORKSPACE_OUT` keeps PNGs.
final class WorkspaceUITests: ServerIsolatedUITestCase {
    private let app = XCUIApplication()

    private func any(_ id: String) -> XCUIElement { app.descendants(matching: .any)[id].firstMatch }

    func testTheTitleOpensTheWorkspace() throws {
        app.launchArguments = ["-skipPushPrompt", "YES", "-qaBotDemo", "chat", "-qaSpacesDemo", "needs", "-qaRoomConversation",
                               "thr_botdemo01", "-qaStrandsDemo", "-qaWorkspaceDemo", "-qaPageDemo"]
        app.launchOffline()
        XCTAssertTrue(app.textViews["Message"].waitForExistence(timeout: 30))
        let title = app.conversationMore
        XCTAssertTrue(title.waitForExistence(timeout: 10))
        if !app.isFoldedDuo { XCTAssertTrue(title.label.contains("4 tabs"), title.label) }
        title.tap()

        XCTAssertTrue(any("workspaceStrip").waitForExistence(timeout: 10), "the Workspace's strip")
        XCTAssertTrue(any("workspaceInfo").waitForExistence(timeout: 5), "Info first")
        XCTAssertTrue(app.buttons["workspaceModel"].exists, "the model")
        any("workspaceInfo").swipeUp()
        XCTAssertTrue(app.buttons["workspaceFind"].waitForExistence(timeout: 5), "Find")
        XCTAssertTrue(app.buttons["workspaceRename"].exists && app.buttons["workspaceHandsFree"].exists, "Rename, Hands-free")
        XCTAssertFalse(app.buttons.matching(NSPredicate(format: "identifier BEGINSWITH 'workspaceClose-'")).firstMatch.exists, "no ✕ on Info")
        shot("1-info")

        // The strip scrolls sideways; its last tab is off to the right.
        let code = app.buttons["workspaceTab-tab-code"]
        for _ in 0..<3 where code.frame.maxX > app.windows.firstMatch.frame.maxX { any("workspaceStrip").swipeLeft() }
        code.tap()
        XCTAssertTrue(app.staticTexts["Open on the desktop"].waitForExistence(timeout: 5), "a desktop-only tab says so")
        XCTAssertTrue(app.buttons["workspaceClose-tab-code"].exists, "✕ on the active tab")
        XCTAssertFalse(app.buttons["workspaceClose-tab-budget"].exists, "and only there")

        let budget = app.buttons["workspaceTab-tab-budget"]
        for _ in 0..<3 where budget.frame.minX < 0 { any("workspaceStrip").swipeRight() }
        budget.tap()
        XCTAssertTrue(any("workspaceContent-tab-budget").waitForExistence(timeout: 10), "the page tab shows")
        shot("2-page")

        let info = app.buttons["workspaceTab-info"]
        for _ in 0..<3 where info.frame.minX < 0 { any("workspaceStrip").swipeRight() }
        info.tap()
        let more = app.buttons["workspaceMore"]
        XCTAssertTrue(more.waitForExistence(timeout: 5))
        more.tap()
        XCTAssertTrue(app.buttons["menuModel"].waitForExistence(timeout: 5), "More holds the rest of the old ⋯")
        shot("3-more")

        app.buttons["workspaceDone"].tap()
        XCTAssertTrue(any("workspaceStrip").waitForNonExistence(timeout: 5), "Done dismisses")
    }

    private func shot(_ name: String) {
        guard let folder = ProcessInfo.processInfo.environment["WORKSPACE_OUT"] else { return }
        sleep(1)
        let url = URL(fileURLWithPath: folder)
        try? FileManager.default.createDirectory(at: url, withIntermediateDirectories: true)
        try? XCUIScreen.main.screenshot().pngRepresentation.write(to: url.appendingPathComponent("\(name).png"))
    }
}
