import XCTest

/// `bbstudio://<kind>/<id>` links in the Bot's shell, offline (`-qaSpacesDemo
/// list` with `-qaBotDemo chat`; `BotSpacesDemo.State` answers
/// `links.resolve`): a Bot page, a worker, a memory record, and a link to a
/// conversation that isn't there. `TEST_RUNNER_STEP9_OUT` keeps PNGs.
final class LinksUITests: ServerIsolatedUITestCase {
    private let app = XCUIApplication()

    private func launch(_ link: String) {
        app.launchArguments += ["-skipPushPrompt", "YES", "-qaBotDemo", "chat", "-qaSpacesDemo", "list", "-openURL", link]
        app.launchOffline()
    }

    private func any(_ id: String) -> XCUIElement { app.descendants(matching: .any)[id].firstMatch }

    func testABotPageLinkOpensThePage() {
        launch("bbstudio://archive")
        XCTAssertTrue(app.navigationBars["Archive"].waitForExistence(timeout: 30), "the Archive page")
        XCTAssertTrue(app.buttons["archive-finished-thr_demo_lisbon"].waitForExistence(timeout: 15))
        shot("archive-link")
        app.navigationBars.firstMatch.buttons.element(boundBy: 0).tap()
        XCTAssertTrue(app.collectionViews["BotSpaceList"].waitForExistence(timeout: 15), "Back shows the list")
    }

    func testAWorkerLinkOpensTheWorkerReadOnly() {
        launch("bbstudio://worker/thr_demo_w3")
        XCTAssertTrue(any("workerTitle").waitForExistence(timeout: 30), "the worker")
        XCTAssertTrue(any("workerTitle").label.hasPrefix("Mock question bank"), any("workerTitle").label)
        XCTAssertFalse(app.textViews["Message"].exists, "read-only")
        shot("worker-link")
    }

    func testARecordLinkOpensTheRecord() {
        launch("bbstudio://record/mem_3")
        XCTAssertTrue(any("memoryRecordText").waitForExistence(timeout: 30), "the record")
        XCTAssertTrue(any("memoryRecordText").label.contains("Friday 10:00"))
        app.navigationBars.firstMatch.buttons.element(boundBy: 0).tap()
        XCTAssertTrue(app.textViews["Message"].waitForExistence(timeout: 15), "Back goes to Main")
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
