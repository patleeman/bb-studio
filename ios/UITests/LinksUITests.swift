import XCTest

/// `bbstudio://<kind>/<id>` links in the Bot's shell, offline (`-qaSpacesDemo
/// list` with `-qaBotDemo chat`; `BotSpacesDemo.State` answers
/// `links.resolve`): a Bot page, a worker, Memory, and a link to a
/// conversation that isn't there. `TEST_RUNNER_STEP9_OUT` keeps PNGs.
final class LinksUITests: ServerIsolatedUITestCase {
    private let app = XCUIApplication()

    private func launch(_ link: String) {
        app.launchArguments += ["-skipPushPrompt", "YES", "-qaBotDemo", "chat", "-qaSpacesDemo", "list", "-openURL", link]
        app.launchOffline()
    }

    private func any(_ id: String) -> XCUIElement { app.descendants(matching: .any).matching(NSPredicate(format: "identifier == %@", id)).firstMatch }

    func testABotPageLinkOpensThePage() {
        launch("bbstudio://archive")
        XCTAssertTrue(any("archive-page").waitForExistence(timeout: 30), "the Archive page")
        XCTAssertTrue(app.buttons["archive-finished-thr_demo_lisbon"].waitForExistence(timeout: 15))
        shot("archive-link")
        app.goHome()
    }

    func testAWorkerLinkOpensTheWorkerReadOnly() {
        launch("bbstudio://worker/thr_demo_w3")
        let title = app.conversationTitle
        XCTAssertTrue(title.waitForExistence(timeout: 30), "the worker")
        XCTAssertTrue(title.label.hasPrefix("Mock question bank"), title.label)
        XCTAssertFalse(app.textViews["Message"].exists, "read-only")
        shot("worker-link")
    }

    /// Old `bb://record/…` links in replies open Memory too (LinksTests); `bbstudio://record` is the recorder.
    func testAMemoryLinkOpensMemory() {
        launch("bbstudio://memory")
        XCTAssertTrue(any("memory-page").waitForExistence(timeout: 30), "the Memory page")
        XCTAssertTrue(any("memoryBudget").waitForExistence(timeout: 15), "on Core")
    }

    func testAMissingConversationSaysNotFound() {
        launch("bbstudio://conversation/thr_gone")
        XCTAssertTrue(app.staticTexts["Not found: bb://conversation/thr_gone"].waitForExistence(timeout: 30), "links.resolve says it's gone")
        shot("not-found")
    }

    private func shot(_ name: String) {
        guard let folder = ProcessInfo.processInfo.environment["STEP9_OUT"] else { return }
        sleep(1)
        let url = URL(fileURLWithPath: folder)
        try? FileManager.default.createDirectory(at: url, withIntermediateDirectories: true)
        try? XCUIScreen.main.screenshot().pngRepresentation.write(to: url.appendingPathComponent("\(name).png"))
    }
}
