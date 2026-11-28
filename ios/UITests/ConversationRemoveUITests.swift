import XCTest

/// Archiving and deleting conversations, offline. A swipe or a long press on
/// Home's or the Archive's row only archives or restores; Delete is in the
/// conversation's own menu (and a finished one's page), behind a confirm that
/// starts on Cancel and arms Delete after a pause. Finishing the shown
/// conversation goes back to Home.
final class ConversationRemoveUITests: ServerIsolatedUITestCase {
    private let app = XCUIApplication()

    private func launch() {
        app.launchArguments += ["-skipPushPrompt", "YES", "-qaBotDemo", "chat", "-qaSpacesDemo", "list", "-qaNoDemoApprovals"]
        app.launchOffline()
        XCTAssertTrue(home.waitForExistence(timeout: 60), "the app opens on Home")
    }

    private var home: XCUIElement { app.descendants(matching: .any).matching(NSPredicate(format: "identifier == %@", "home")).firstMatch }

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
        if !row.exists, app.descendants(matching: .any).matching(NSPredicate(format: "identifier == %@", "home")).firstMatch.exists { app.scrollHome(to: row) }
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
        XCTAssertFalse(app.buttons["Delete"].exists, "and never Delete")
        shot("1-swipe")
        archive.tap()
        XCTAssertTrue(interview.waitForNonExistence(timeout: 10), "the row leaves the list")

        openArchive()
        let finished = app.buttons["archive-finished-thr_demo_interview"]
        XCTAssertTrue(finished.waitForExistence(timeout: 15), "it's in the archive")
        finished.swipeLeft()
        let restore = app.buttons["archiveRestore-thr_demo_interview"]
        XCTAssertTrue(restore.waitForExistence(timeout: 5), "Restore behind a swipe")
        XCTAssertFalse(app.buttons["Delete"].exists, "and never Delete")
        shot("2-archive-swipe")
        restore.tap()
        XCTAssertTrue(finished.waitForNonExistence(timeout: 10), "restored, it leaves the archive")
        app.goHome()
        openConversations()
        XCTAssertTrue(interview.waitForExistence(timeout: 15), "and is back in Conversations")
    }

    func testALongPressOffersArchiveButNotDelete() {
        launch()
        openConversations()
        let speech = row("thr_demo_speech")
        XCTAssertTrue(speech.waitForExistence(timeout: 10))
        speech.press(forDuration: 1.2)
        XCTAssertTrue(app.buttons["Archive"].waitForExistence(timeout: 5), "Archive in the context menu")
        XCTAssertFalse(app.buttons["Delete"].exists, "and no Delete")
        shot("3-context-menu")
    }

    func testAFullSwipeArchives() {
        launch()
        openConversations()
        let speech = row("thr_demo_speech")
        XCTAssertTrue(speech.waitForExistence(timeout: 10))
        speech.swipeLeft(velocity: .fast)
        if speech.exists, app.buttons["homeArchive-thr_demo_speech"].exists { speech.swipeLeft(velocity: .fast) }
        XCTAssertTrue(speech.waitForNonExistence(timeout: 10), "a full swipe archives")
        openArchive()
        XCTAssertTrue(app.buttons["archive-finished-thr_demo_speech"].waitForExistence(timeout: 15), "into the archive")
    }

    func testMainAndAWorkingConversationOfferNeither() {
        launch()
        openConversations()
        let main = row("thr_botdemo01")
        XCTAssertTrue(main.waitForExistence(timeout: 10), "Main is listed")
        main.swipeLeft()
        sleep(1)
        XCTAssertFalse(app.buttons["homeArchive-thr_botdemo01"].exists, "Main: no Archive")
        XCTAssertFalse(app.buttons["Delete"].exists, "Main: no Delete")
        // Main's swipe actions close first; then the working one, further down.
        if main.exists { main.swipeRight() }
        var working = row("thr_demo_trunc")
        if !working.exists { openConversations(); working = row("thr_demo_trunc") }
        XCTAssertTrue(working.waitForExistence(timeout: 10))
        working.swipeLeft()
        sleep(1)
        XCTAssertFalse(app.buttons["homeArchive-thr_demo_trunc"].exists, "working: no Archive")
        XCTAssertFalse(app.buttons["Delete"].exists, "working: no Delete")
        if working.exists { working.tap() }
        openMore()
        XCTAssertFalse(app.menuItem("Archive").exists, "a working conversation can't be archived")
        XCTAssertFalse(app.menuItem("Delete conversation…").exists, "or deleted")
    }

    func testMainOffersNoDelete() {
        launch()
        openConversations()
        row("thr_botdemo01").tap()
        openMore()
        XCTAssertFalse(app.menuItem("Delete conversation…").exists, "Main can't be deleted")
        XCTAssertFalse(app.menuItem("Archive").exists, "or archived")
    }

    /// The confirm: it names the conversation and its workers, Cancel keeps
    /// it, and Delete works only after the pause.
    func testTheThreadMenuDeletesAfterASecondStep() {
        launch()
        openConversations()
        row("thr_demo_interview").tap()
        openMore()
        XCTAssertTrue(app.menuItem("Archive").exists, "Archive in ⋯")
        let delete = app.menuItem("Delete conversation…")
        XCTAssertTrue(delete.exists, "Delete conversation… in ⋯")
        shot("5-thread-menu")
        delete.tap()
        let sheet = app.descendants(matching: .any)["deleteSheet"]
        XCTAssertTrue(sheet.waitForExistence(timeout: 5), "it asks first")
        XCTAssertTrue(app.staticTexts["Delete “Launch prep”?"].exists, "naming the conversation")
        let message = app.staticTexts["deleteMessage"]
        XCTAssertTrue(message.waitForLabel(prefix: "Deletes “Launch prep” and its 1 worker."), "and its worker: \(message.label)")
        let confirm = app.buttons["confirmDelete"]
        XCTAssertFalse(confirm.isEnabled, "Delete waits before it works")
        shot("6-thread-confirm")
        app.buttons["cancelDelete"].tap()
        XCTAssertTrue(sheet.waitForNonExistence(timeout: 5))
        XCTAssertTrue(app.conversationTitle.label.contains("Launch prep"), "Cancel keeps the conversation open")

        openMore()
        app.menuItem("Delete conversation…").tap()
        XCTAssertTrue(confirm.waitForExistence(timeout: 5))
        let armed = XCTNSPredicateExpectation(predicate: NSPredicate(format: "isEnabled == true"), object: confirm)
        XCTAssertEqual(XCTWaiter.wait(for: [armed], timeout: 6), .completed, "Delete works after the pause")
        confirm.tap()
        backOnHome("the deleted conversation closes")
        openConversations()
        XCTAssertFalse(row("thr_demo_interview").waitForExistence(timeout: 3), "and is gone from the list")
    }

    func testTheThreadMenuArchives() {
        launch()
        openConversations()
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

    func testTheArchiveSwipesOnlyRestoreOrArchiveAndAFinishedPageDeletes() {
        launch()
        openConversations()
        openArchive()
        let kitchen = app.buttons["archive-conversation-thr_demo_kitchen"]
        XCTAssertTrue(kitchen.waitForExistence(timeout: 10))
        kitchen.swipeLeft()
        XCTAssertTrue(app.buttons["archiveArchive-thr_demo_kitchen"].waitForExistence(timeout: 5), "an older one can be archived")
        XCTAssertFalse(app.buttons["Delete"].exists, "but not deleted from the row")
        kitchen.swipeRight()

        let lisbon = app.buttons["archive-finished-thr_demo_lisbon"]
        XCTAssertTrue(lisbon.waitForExistence(timeout: 15))
        lisbon.tap()
        let delete = app.buttons["archiveDelete"]
        XCTAssertTrue(delete.waitForExistence(timeout: 10), "a finished conversation's page has Delete")
        delete.tap()
        let confirm = app.buttons["confirmDelete"]
        XCTAssertTrue(confirm.waitForExistence(timeout: 5), "it asks first")
        XCTAssertFalse(confirm.isEnabled, "and waits")
        let armed = XCTNSPredicateExpectation(predicate: NSPredicate(format: "isEnabled == true"), object: confirm)
        XCTAssertEqual(XCTWaiter.wait(for: [armed], timeout: 6), .completed)
        confirm.tap()
        XCTAssertTrue(app.descendants(matching: .any)["archive-page"].waitForExistence(timeout: 10), "back on the archive")
        XCTAssertTrue(lisbon.waitForNonExistence(timeout: 10), "without it")
    }
}

private extension XCUIElement {
    func waitForLabel(prefix: String, timeout: TimeInterval = 10) -> Bool {
        let done = XCTNSPredicateExpectation(predicate: NSPredicate(format: "label BEGINSWITH %@", prefix), object: self)
        return XCTWaiter.wait(for: [done], timeout: timeout) == .completed
    }
}
