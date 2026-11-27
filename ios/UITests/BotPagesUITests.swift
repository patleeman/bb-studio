import XCTest

/// The Bot's pages (Memory and Library are tabs, the rest pushed from Home),
/// offline (`-qaSpacesDemo list` with `-qaBotDemo chat`; `BotSpacesDemo.State` answers Memory's RPCs,
/// `bot_library`, `bot_threads_older`, `bot_finished` and `bot_reopen`).
/// `TEST_RUNNER_STEP8_OUT` keeps PNGs.
final class BotPagesUITests: ServerIsolatedUITestCase {
    private let app = XCUIApplication()

    private func launch(_ extra: [String] = []) {
        app.launchArguments += ["-skipPushPrompt", "YES", "-qaBotDemo", "chat", "-qaSpacesDemo", "list"] + extra
        app.launchOffline()
        XCTAssertTrue(app.descendants(matching: .any)["home"].waitForExistence(timeout: 30), "the app opens on Home")
    }

    private func openPage(_ page: String) {
        switch page {
        case "automations": app.openRoomPlace("schedules")
        case "archive":
            app.openRoomPlace("archive")
        default: app.openRoomPlace(page)
        }
    }

    private func any(_ id: String) -> XCUIElement { app.descendants(matching: .any)[id].firstMatch }

    /// Back to Home: its tab.
    private func closeMemory() {
        app.goHome()
    }

    private func text(_ contains: String) -> XCUIElement {
        app.staticTexts.matching(NSPredicate(format: "label CONTAINS %@", contains)).firstMatch
    }

    func testArchiveReopensAFinishedConversation() {
        launch()
        XCTAssertFalse(app.buttons["homeConversation-thr_demo_lisbon"].exists)
        app.openRoomPlace("archive")
        XCTAssertTrue(any("archive-page").waitForExistence(timeout: 15), "Archive, pushed")
        let finished = app.buttons["archive-finished-thr_demo_lisbon"]
        XCTAssertTrue(finished.waitForExistence(timeout: 15), "the finished conversation")
        XCTAssertTrue(app.buttons["archive-conversation-thr_demo_kitchen"].exists, "an older one")
        XCTAssertTrue(app.buttons["archive-worker-thr_demo_w9"].exists, "an old worker")
        shot("archive")

        app.buttons["chip-Failed 1"].tap()
        XCTAssertTrue(app.buttons["archive-worker-thr_demo_w9"].waitForExistence(timeout: 10))
        XCTAssertFalse(app.buttons["archive-finished-thr_demo_lisbon"].exists, "Failed shows failed workers only")
        app.buttons["chip-All"].tap()

        finished.tap()
        XCTAssertTrue(any("finishedSummary").waitForExistence(timeout: 10))
        XCTAssertTrue(any("finishedSummary").label.contains("Alfama"), "its summary from bot_finished")
        shot("archive-finished")
        app.buttons["archiveReopen"].tap()
        XCTAssertTrue(app.textViews["Message"].waitForExistence(timeout: 15), "the reopened conversation")
        app.goHome()
        let reopened = app.buttons["homeConversation-thr_demo_lisbon"]
        for _ in 0..<3 where !reopened.waitForExistence(timeout: 3) { app.swipeUp() }
        XCTAssertTrue(reopened.waitForExistence(timeout: 15), "back in Conversations")
    }

    func testSlowMemoryAndLibraryLoadThroughTheBotFlip() {
        launch(["-qaDemoPageLatency", ProcessInfo.processInfo.environment["PAGE_LATENCY"] ?? "2500", "-qaDemoCachedBot"])
        openPage("memory")
        XCTAssertTrue(any("memory-page").waitForExistence(timeout: 5))
        XCTAssertFalse(any("memoryBudget").exists, "still loading while the answer is slow")
        shot("slow-memory-loading")
        XCTAssertTrue(any("memoryBudget").waitForExistence(timeout: 20), "Memory loads after the Bot's id changes under it")
        XCTAssertTrue(any("memorySection-Preferences").waitForExistence(timeout: 20), "and its Core")
        XCTAssertFalse(any("memoryLoading").exists, "no spinner left")
        shot("slow-memory-loaded")
        closeMemory()
        openPage("library")
        XCTAssertTrue(any("library-page").waitForExistence(timeout: 5), "the Library tab")
        XCTAssertFalse(app.descendants(matching: .any).matching(NSPredicate(format: "identifier BEGINSWITH 'library-row-'")).firstMatch.exists,
                       "still loading while the answer is slow")
        shot("slow-library-loading")
        XCTAssertTrue(app.descendants(matching: .any).matching(NSPredicate(format: "identifier BEGINSWITH 'library-row-'")).firstMatch
            .waitForExistence(timeout: 20), "the Library loads")
        XCTAssertFalse(any("libraryLoading").exists, "no spinner left")
        shot("slow-library-loaded")
    }

    func testAFailedLoadShowsRetryAndRetryLoads() {
        launch(["-qaDemoPageLatency", "800", "-qaDemoPageFail", "memory,library"])
        openPage("memory")
        let retry = app.buttons["Retry"].firstMatch
        XCTAssertTrue(retry.waitForExistence(timeout: 15), "an error with Retry, not a spinner")
        XCTAssertTrue(app.staticTexts["Memory didn't load"].exists)
        shot("memory-error-retry")
        retry.tap()
        XCTAssertTrue(any("memoryBudget").waitForExistence(timeout: 15), "Retry loads Memory")
        closeMemory()
        openPage("library")
        let libraryRetry = app.buttons["Retry"].firstMatch
        XCTAssertTrue(libraryRetry.waitForExistence(timeout: 15), "an error with Retry, not a spinner")
        XCTAssertTrue(app.staticTexts["The library didn't load"].exists)
        shot("library-error-retry")
        libraryRetry.tap()
        XCTAssertTrue(app.descendants(matching: .any).matching(NSPredicate(format: "identifier BEGINSWITH 'library-row-'")).firstMatch
            .waitForExistence(timeout: 15), "Retry loads the Library")
    }

    private func shot(_ name: String) {
        guard let folder = ProcessInfo.processInfo.environment["STEP8_OUT"] else { return }
        sleep(1)
        let url = URL(fileURLWithPath: folder)
        try? FileManager.default.createDirectory(at: url, withIntermediateDirectories: true)
        try? XCUIScreen.main.screenshot().pngRepresentation.write(to: url.appendingPathComponent("\(name).png"))
    }
}
