import XCTest

/// The Bot's pages from the list header, offline (`-qaSpacesDemo list` with
/// `-qaBotDemo chat`; `BotSpacesDemo.State` answers `memory.*`,
/// `bot_library`, `bot_threads_older`, `bot_finished` and `bot_reopen`, and
/// `-qaLoopsDemo` answers `loops.*`). `TEST_RUNNER_STEP8_OUT` keeps PNGs.
final class BotPagesUITests: ServerIsolatedUITestCase {
    private let app = XCUIApplication()

    private func launch(_ extra: [String] = []) {
        app.launchArguments += ["-skipPushPrompt", "YES", "-qaBotDemo", "chat", "-qaSpacesDemo", "list"] + extra
        app.launchOffline()
        XCTAssertTrue(app.textViews["Message"].waitForExistence(timeout: 30), "Main opens")
        let bar = app.navigationBars.firstMatch
        XCTAssertTrue(bar.waitForExistence(timeout: 20))
        bar.buttons.element(boundBy: 0).tap()
        XCTAssertTrue(app.collectionViews["BotSpaceList"].waitForExistence(timeout: 15), "the list")
    }

    private func openPage(_ page: String) {
        let button = app.buttons["BotPage-\(page)"]
        XCTAssertTrue(button.waitForExistence(timeout: 15), "the \(page) button in the header")
        button.tap()
    }

    private func any(_ id: String) -> XCUIElement { app.descendants(matching: .any)[id].firstMatch }

    private func text(_ contains: String) -> XCUIElement {
        app.staticTexts.matching(NSPredicate(format: "label CONTAINS %@", contains)).firstMatch
    }

    func testMemoryShowsTheProfileAndRecordsAndEdits() {
        launch()
        openPage("memory")
        XCTAssertTrue(app.navigationBars["Memory"].waitForExistence(timeout: 15))
        XCTAssertTrue(any("memoryProfile").waitForExistence(timeout: 15), "the core profile")
        XCTAssertTrue(text("of 2,500 characters").exists, "its length against the cap")
        XCTAssertTrue(app.buttons["memory-record-mem_3"].waitForExistence(timeout: 15), "records")
        XCTAssertFalse(app.buttons["memory-record-mem_0"].exists, "replaced records fold away")
        shot("memory")

        any("memoryProfile").tap()
        XCTAssertTrue(text("Who I work for").waitForExistence(timeout: 10), "the profile opens in place")
        XCTAssertTrue(app.staticTexts["Edit the core profile"].exists, "and edits in Pages")
        shot("memory-profile")
        any("memoryProfile").tap()

        app.buttons["chip-Home"].tap()
        XCTAssertTrue(app.buttons["memory-record-mem_4"].waitForExistence(timeout: 10))
        XCTAssertTrue(app.buttons["memory-record-mem_3"].waitForNonExistence(timeout: 10), "the topic filters")
        app.buttons["chip-All"].tap()

        app.buttons["memory-record-mem_3"].tap()
        XCTAssertTrue(any("memoryRecordText").waitForExistence(timeout: 10))
        XCTAssertTrue(text("replaces “Interview with Sam is Thursday 15:00.”").exists, "what it replaced")
        XCTAssertTrue(any("memorySource").label.contains("from “Launch prep”"), "where it came from")
        shot("memory-record")
        app.buttons["memoryEdit"].tap()
        let field = app.textFields["memoryTextField"].exists ? app.textFields["memoryTextField"] : app.textViews["memoryTextField"]
        XCTAssertTrue(field.waitForExistence(timeout: 10))
        field.tap()
        field.typeText(" Bring the laptop.")
        app.buttons["memorySave"].tap()
        XCTAssertTrue(text("Bring the laptop.").waitForExistence(timeout: 10), "the new record replaces it")
        XCTAssertTrue(text("replaces “Interview with Sam is Friday 10:00.”").exists)

        app.navigationBars.firstMatch.buttons.element(boundBy: 0).tap()
        app.buttons["memoryAdd"].tap()
        let topic = app.textFields["memoryTopicField"]
        XCTAssertTrue(topic.waitForExistence(timeout: 10))
        topic.tap()
        topic.typeText("Food")
        let record = app.textFields["memoryTextField"].exists ? app.textFields["memoryTextField"] : app.textViews["memoryTextField"]
        record.tap()
        record.typeText("No cilantro.")
        app.buttons["memorySave"].tap()
        XCTAssertTrue(text("No cilantro.").waitForExistence(timeout: 10), "the new record is listed")
        XCTAssertTrue(app.buttons["chip-Food"].exists, "with its topic as a chip")
    }

    func testLibraryGroupsFilesAndOpensThem() {
        launch()
        openPage("library")
        XCTAssertTrue(app.navigationBars["Library"].waitForExistence(timeout: 15))
        XCTAssertTrue(app.buttons["library-row-pg_demo_trip"].waitForExistence(timeout: 15), "files")
        XCTAssertTrue(app.buttons["Launch prep"].exists, "grouped by conversation, the group opens it")
        XCTAssertTrue(app.staticTexts["Made by you"].exists)
        XCTAssertTrue(app.descendants(matching: .any)["3 like it"].firstMatch.exists, "near-identical files fold into one row")
        shot("library")

        app.buttons["chip-Whiteboard"].tap()
        XCTAssertTrue(app.buttons["library-row-drw_demo_arch"].waitForExistence(timeout: 10))
        XCTAssertFalse(app.buttons["library-row-pg_demo_trip"].exists, "the kind filters")
        app.buttons["chip-All"].tap()

        app.buttons["library-row-dsn_demo_home"].tap()
        XCTAssertTrue(app.navigationBars["Library"].waitForNonExistence(timeout: 10), "the design opens in its viewer")
    }

    func testTodosAndAutomationsOpen() {
        launch(["-qaLoopsDemo"])
        openPage("todos")
        XCTAssertTrue(app.navigationBars["Todos"].waitForExistence(timeout: 15))
        XCTAssertTrue(any("loops-screen").waitForExistence(timeout: 15), "the existing Todos screen")
        XCTAssertTrue(app.textFields["loops-add"].waitForExistence(timeout: 15))
        shot("todos")
        app.navigationBars.firstMatch.buttons.element(boundBy: 0).tap()

        openPage("automations")
        XCTAssertTrue(app.navigationBars["Automations"].waitForExistence(timeout: 15))
        XCTAssertTrue(app.staticTexts["Check-in"].waitForExistence(timeout: 15), "the Bot's automations")
        XCTAssertFalse(app.buttons["Done"].exists, "pushed, not a sheet")
        shot("automations")
    }

    func testArchiveReopensAFinishedConversation() {
        launch()
        XCTAssertFalse(app.collectionViews["BotSpaceList"].buttons["conversation-thr_demo_lisbon"].exists)
        openPage("archive")
        XCTAssertTrue(app.navigationBars["Archive"].waitForExistence(timeout: 15))
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
        app.navigationBars.firstMatch.buttons.element(boundBy: 0).tap()
        XCTAssertTrue(app.collectionViews["BotSpaceList"].buttons["conversation-thr_demo_lisbon"].waitForExistence(timeout: 15), "back in the list")
    }

    func testSlowMemoryAndLibraryLoadThroughTheBotFlip() {
        launch(["-qaDemoPageLatency", "2500", "-qaDemoCachedBot"])
        openPage("memory")
        XCTAssertTrue(app.navigationBars["Memory"].waitForExistence(timeout: 5))
        XCTAssertFalse(any("memoryProfile").exists, "still loading while the answer is slow")
        shot("slow-memory-loading")
        XCTAssertTrue(any("memoryProfile").waitForExistence(timeout: 20), "Memory loads after the Bot's id changes under it")
        XCTAssertTrue(app.buttons["memory-record-mem_3"].waitForExistence(timeout: 20), "and its records")
        XCTAssertFalse(app.activityIndicators.firstMatch.exists, "no spinner left")
        shot("slow-memory-loaded")
        app.navigationBars["Memory"].buttons.element(boundBy: 0).tap()
        openPage("library")
        XCTAssertTrue(app.navigationBars["Library"].waitForExistence(timeout: 5))
        XCTAssertFalse(app.descendants(matching: .any).matching(NSPredicate(format: "identifier BEGINSWITH 'library-row-'")).firstMatch.exists,
                       "still loading while the answer is slow")
        shot("slow-library-loading")
        XCTAssertTrue(app.descendants(matching: .any).matching(NSPredicate(format: "identifier BEGINSWITH 'library-row-'")).firstMatch
            .waitForExistence(timeout: 20), "the Library loads")
        XCTAssertFalse(app.activityIndicators.firstMatch.exists, "no spinner left")
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
        XCTAssertTrue(any("memoryProfile").waitForExistence(timeout: 15), "Retry loads Memory")
        app.navigationBars["Memory"].buttons.element(boundBy: 0).tap()
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
