import XCTest

/// Archiving and deleting conversations, offline: a swipe or a long press on
/// Home's row, the conversation's menu, and the Archive page. Finishing the
/// shown conversation goes back to Home.
final class ConversationRemoveUITests: ServerIsolatedUITestCase {
    private let app = XCUIApplication()

    private func launch() {
        app.launchArguments += ["-skipPushPrompt", "YES", "-qaBotDemo", "chat", "-qaSpacesDemo", "list", "-qaNoDemoApprovals"]
        app.launchOffline()
        XCTAssertTrue(home.waitForExistence(timeout: 60), "the app opens on Home")
    }

    private var home: XCUIElement { app.descendants(matching: .any)["home"].firstMatch }

    private func shot(_ name: String) {
        guard let folder = ProcessInfo.processInfo.environment["REMOVE_OUT"] else { return }
        sleep(1)
        let url = URL(fileURLWithPath: folder)
        try? FileManager.default.createDirectory(at: url, withIntermediateDirectories: true)
        try? XCUIScreen.main.screenshot().pngRepresentation.write(to: url.appendingPathComponent("\(name).png"))
    }

    /// Home's row, scrolled to: the list is lazy and the folded Duo short.
    private func row(_ id: String) -> XCUIElement {
        let row = app.buttons["homeConversation-\(id)"]
        if !row.exists, app.descendants(matching: .any)["home"].exists { app.scrollHome(to: row) }
        return row
    }

    private func openConversations() {
        app.openRoomPlace("conversations")
        XCTAssertTrue(app.homeNew.waitForExistence(timeout: 15))
    }

    private func openArchive() {
        app.openRoomPlace("archive")
        XCTAssertTrue(app.descendants(matching: .any)["archive-page"].waitForExistence(timeout: 15))
    }

    /// The menu is gone and Home shows: a finished conversation closes.
    private func backOnHome(_ what: String) {
        let composer = app.textViews["Message"]
        let shown = XCTNSPredicateExpectation(predicate: NSPredicate { _, _ in self.home.exists && !composer.exists }, object: nil)
        if XCTWaiter.wait(for: [shown], timeout: 15) != .completed {
            XCTFail("\(what): home \(home.exists), composer \(composer.exists)\n\(app.debugDescription)")
        }
    }

    private func openMore() {
        app.openConversationMenu()
        XCTAssertTrue(app.menuItem("Model & permissions").waitForExistence(timeout: 5))
    }

    func testSwipeArchivesAConversationAndTheArchiveRestoresIt() {
        launch()
        openConversations()
        let interview = row("thr_demo_interview")
        XCTAssertTrue(interview.waitForExistence(timeout: 10))
        interview.swipeLeft()
        if !app.buttons["homeArchive-thr_demo_interview"].waitForExistence(timeout: 2) { print("SWIPE\n\(app.debugDescription)"); interview.swipeLeft() }
        let archive = app.buttons["homeArchive-thr_demo_interview"]
        XCTAssertTrue(archive.waitForExistence(timeout: 5), "Archive behind a swipe")
        XCTAssertTrue(app.buttons["homeDelete-thr_demo_interview"].exists, "and Delete")
        shot("1-swipe")
        archive.tap()
        XCTAssertTrue(interview.waitForNonExistence(timeout: 10), "the row leaves the list")

        openArchive()
        let finished = app.buttons["archive-finished-thr_demo_interview"]
        XCTAssertTrue(finished.waitForExistence(timeout: 15), "it's in the archive")
        finished.swipeLeft()
        let restore = app.buttons["archiveRestore-thr_demo_interview"]
        XCTAssertTrue(restore.waitForExistence(timeout: 5), "Restore behind a swipe")
        XCTAssertTrue(app.buttons["archiveDelete-thr_demo_interview"].exists, "and Delete")
        shot("2-archive-swipe")
        restore.tap()
        XCTAssertTrue(finished.waitForNonExistence(timeout: 10), "restored, it leaves the archive")
        app.goHome()
        openConversations()
        XCTAssertTrue(interview.waitForExistence(timeout: 15), "and is back in Conversations")
    }

    func testLongPressDeletesAfterAConfirm() {
        launch()
        openConversations()
        let speech = row("thr_demo_speech")
        XCTAssertTrue(speech.waitForExistence(timeout: 10))
        speech.press(forDuration: 1.2)
        let delete = app.buttons["Delete"].firstMatch
        XCTAssertTrue(delete.waitForExistence(timeout: 5), "Delete in the context menu")
        XCTAssertTrue(app.buttons["Archive"].exists, "with Archive")
        shot("3-context-menu")
        delete.tap()
        let title = app.staticTexts["Delete “Train a model for silent speech”?"]
        XCTAssertTrue(title.waitForExistence(timeout: 5), "it asks first")
        XCTAssertTrue(app.staticTexts["This can't be undone. Its workers and side threads are deleted with it."].exists)
        shot("4-confirm")
        let cancel = app.alerts.buttons["Cancel"].firstMatch
        XCTAssertTrue(cancel.exists, "with Cancel")
        cancel.tap()
        XCTAssertTrue(title.waitForNonExistence(timeout: 5))
        XCTAssertTrue(speech.exists, "cancel keeps it")

        // The first menu's dismissal can still be running: press again if it doesn't open.
        for _ in 0..<3 where !delete.exists {
            speech.press(forDuration: 1.2)
            _ = delete.waitForExistence(timeout: 3)
        }
        XCTAssertTrue(delete.exists, "Delete in the context menu again")
        delete.tap()
        XCTAssertTrue(app.buttons["confirmDelete"].firstMatch.waitForExistence(timeout: 5))
        app.buttons["confirmDelete"].firstMatch.tap()
        XCTAssertTrue(speech.waitForNonExistence(timeout: 10), "deleted")
    }

    func testMainAndAWorkingConversationOfferNeither() {
        launch()
        openConversations()
        let main = row("thr_botdemo01")
        XCTAssertTrue(main.waitForExistence(timeout: 10), "Main is listed")
        main.swipeLeft()
        sleep(1)
        XCTAssertFalse(app.buttons["homeArchive-thr_botdemo01"].exists, "Main: no Archive")
        XCTAssertFalse(app.buttons["homeDelete-thr_botdemo01"].exists, "Main: no Delete")
        // Main's swipe actions close first; then the working one, further down.
        if main.exists { main.swipeRight() }
        var working = row("thr_demo_trunc")
        if !working.exists { openConversations(); working = row("thr_demo_trunc") }
        XCTAssertTrue(working.waitForExistence(timeout: 10))
        working.swipeLeft()
        sleep(1)
        XCTAssertFalse(app.buttons["homeArchive-thr_demo_trunc"].exists, "working: no Archive")
        XCTAssertFalse(app.buttons["homeDelete-thr_demo_trunc"].exists, "working: no Delete")
        if working.exists { working.tap() }
        openMore()
        XCTAssertFalse(app.menuItem("Archive").exists, "a working conversation can't be archived")
        XCTAssertFalse(app.menuItem("Delete conversation…").exists, "or deleted")
    }

    func testTheThreadMenuArchivesAndDeletes() {
        launch()
        openConversations()
        row("thr_demo_interview").tap()
        openMore()
        XCTAssertTrue(app.menuItem("Archive").exists, "Archive in ⋯")
        let delete = app.menuItem("Delete conversation…")
        XCTAssertTrue(delete.exists, "Delete conversation… in ⋯")
        shot("5-thread-menu")
        delete.tap()
        XCTAssertTrue(app.staticTexts["Delete “Launch prep”?"].waitForExistence(timeout: 5), "it asks first")
        shot("6-thread-confirm")
        app.buttons["confirmDelete"].firstMatch.tap()
        backOnHome("the deleted conversation closes")
        openConversations()
        XCTAssertFalse(row("thr_demo_interview").waitForExistence(timeout: 3), "and is gone from the list")

        row("thr_demo_speech").tap()
        openMore()
        app.menuItem("Archive").tap()
        backOnHome("the archived conversation closes")
        openConversations()
        XCTAssertFalse(row("thr_demo_speech").waitForExistence(timeout: 3), "and leaves the list")
        openArchive()
        XCTAssertTrue(app.buttons["archive-finished-thr_demo_speech"].waitForExistence(timeout: 15), "for the archive")
    }

    func testArchivingTheShownConversationGoesHome() {
        launch()
        openConversations()
        row("thr_demo_interview").tap()
        XCTAssertTrue(app.conversationTitle.waitForExistence(timeout: 10))
        XCTAssertTrue(app.conversationTitle.label.contains("Launch prep"), "on Launch prep: \(app.conversationTitle.label)")
        openMore()
        app.menuItem("Archive").tap()
        backOnHome("the archived conversation closes")
        XCTAssertFalse(row("thr_demo_interview").waitForExistence(timeout: 3), "and leaves Home")
        shot("7-archived-shown")

        let speech = row("thr_demo_speech")
        speech.swipeLeft()
        app.buttons["homeArchive-thr_demo_speech"].tap()
        XCTAssertTrue(speech.waitForNonExistence(timeout: 10), "archived from Home's row")
        row("thr_botdemo01").tap()
        XCTAssertTrue(app.textViews["Message"].waitForExistence(timeout: 15), "Main opens")
    }

    func testTheArchiveDeletesAndArchivesItsRows() {
        launch()
        openConversations()
        openArchive()
        let lisbon = app.buttons["archive-finished-thr_demo_lisbon"]
        XCTAssertTrue(lisbon.waitForExistence(timeout: 15))
        lisbon.swipeLeft()
        app.buttons["archiveDelete-thr_demo_lisbon"].tap()
        XCTAssertTrue(app.buttons["confirmDelete"].firstMatch.waitForExistence(timeout: 5), "it asks first")
        app.buttons["confirmDelete"].firstMatch.tap()
        XCTAssertTrue(lisbon.waitForNonExistence(timeout: 10), "deleted from the archive")

        let kitchen = app.buttons["archive-conversation-thr_demo_kitchen"]
        XCTAssertTrue(kitchen.waitForExistence(timeout: 10))
        kitchen.swipeLeft()
        XCTAssertTrue(app.buttons["archiveArchive-thr_demo_kitchen"].waitForExistence(timeout: 5), "an older one can be archived")
        app.buttons["archiveDelete-thr_demo_kitchen"].tap()
        app.buttons["confirmDelete"].firstMatch.tap()
        XCTAssertTrue(kitchen.waitForNonExistence(timeout: 10), "or deleted")
    }
}

private extension XCUIElement {
    func waitForLabel(prefix: String, timeout: TimeInterval = 10) -> Bool {
        let done = XCTNSPredicateExpectation(predicate: NSPredicate(format: "label BEGINSWITH %@", prefix), object: self)
        return XCTWaiter.wait(for: [done], timeout: timeout) == .completed
    }
}
