import XCTest

final class ConversationRemoveUITests: ServerIsolatedUITestCase {
    private let app = XCUIApplication()

    private func launch() {
        app.launchArguments += ["-skipPushPrompt", "YES", "-qaBotDemo", "chat", "-qaSpacesDemo", "list", "-qaNoDemoApprovals"]
        app.launchOffline()
        if !app.waitForRoom() {
            app.terminate()
            app.launchOffline()
        }
        XCTAssertTrue(app.waitForRoom(timeout: 60), "the app opens on the room")
    }

    private func shot(_ name: String) {
        guard let folder = ProcessInfo.processInfo.environment["REMOVE_OUT"] else { return }
        sleep(1)
        let url = URL(fileURLWithPath: folder)
        try? FileManager.default.createDirectory(at: url, withIntermediateDirectories: true)
        try? XCUIScreen.main.screenshot().pngRepresentation.write(to: url.appendingPathComponent("\(name).png"))
    }

    private func row(_ id: String) -> XCUIElement { app.buttons["roomConversation-\(id)"] }

    private func openConversations() {
        app.openRoomPlace("conversations")
        XCTAssertTrue(app.buttons["roomNewConversation"].waitForExistence(timeout: 15))
    }

    private func openArchive() {
        let archive = app.buttons["roomArchive"]
        for _ in 0..<4 where !archive.isHittable { app.swipeUp() }
        archive.tap()
        XCTAssertTrue(app.navigationBars["Archive"].waitForExistence(timeout: 15))
    }

    private func backInTheRoom(_ what: String) {
        let title = app.staticTexts["roomTitle"]
        let shown = XCTNSPredicateExpectation(predicate: NSPredicate(format: "exists == true AND isHittable == true"), object: title)
        XCTAssertEqual(XCTWaiter.wait(for: [shown], timeout: 15), .completed, what)
    }

    private func openMore() {
        let more = app.buttons["More"].firstMatch
        XCTAssertTrue(more.waitForExistence(timeout: 15), "the ⋯ menu")
        more.tap()
        XCTAssertTrue(app.buttons["menuModel"].waitForExistence(timeout: 5))
    }

    func testSwipeArchivesAConversationAndTheArchiveRestoresIt() {
        launch()
        openConversations()
        let interview = row("thr_demo_interview")
        XCTAssertTrue(interview.waitForExistence(timeout: 10))
        interview.swipeLeft()
        let archive = app.buttons["roomConversationArchive-thr_demo_interview"]
        XCTAssertTrue(archive.waitForExistence(timeout: 5), "Archive behind a swipe")
        XCTAssertTrue(app.buttons["roomConversationDelete-thr_demo_interview"].exists, "and Delete")
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
        app.closeRoomSheet()
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

        speech.press(forDuration: 1.2)
        XCTAssertTrue(delete.waitForExistence(timeout: 5))
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
        XCTAssertFalse(app.buttons["roomConversationArchive-thr_botdemo01"].exists, "Main: no Archive")
        XCTAssertFalse(app.buttons["roomConversationDelete-thr_botdemo01"].exists, "Main: no Delete")
        let working = row("thr_demo_trunc")
        if !working.exists { openConversations() }
        XCTAssertTrue(working.waitForExistence(timeout: 10))
        working.swipeLeft()
        sleep(1)
        XCTAssertFalse(app.buttons["roomConversationArchive-thr_demo_trunc"].exists, "working: no Archive")
        XCTAssertFalse(app.buttons["roomConversationDelete-thr_demo_trunc"].exists, "working: no Delete")
        if working.exists { working.tap() }
        openMore()
        XCTAssertFalse(app.buttons["menuArchive"].exists, "a working conversation can't be archived")
        XCTAssertFalse(app.buttons["menuDelete"].exists, "or deleted")
    }

    func testTheThreadMenuArchivesAndDeletes() {
        launch()
        openConversations()
        row("thr_demo_interview").tap()
        openMore()
        XCTAssertTrue(app.buttons["menuArchive"].exists, "Archive in ⋯")
        let delete = app.buttons["menuDelete"]
        XCTAssertTrue(delete.exists, "Delete conversation… in ⋯")
        shot("5-thread-menu")
        delete.tap()
        XCTAssertTrue(app.staticTexts["Delete “Launch prep”?"].waitForExistence(timeout: 5), "it asks first")
        shot("6-thread-confirm")
        app.buttons["confirmDelete"].firstMatch.tap()
        backInTheRoom("the deleted conversation closes")
        openConversations()
        XCTAssertFalse(row("thr_demo_interview").waitForExistence(timeout: 3), "and is gone from the list")

        row("thr_demo_speech").tap()
        openMore()
        app.buttons["menuArchive"].tap()
        backInTheRoom("the archived conversation closes")
        openConversations()
        XCTAssertFalse(row("thr_demo_speech").waitForExistence(timeout: 3), "and leaves the list")
        openArchive()
        XCTAssertTrue(app.buttons["archive-finished-thr_demo_speech"].waitForExistence(timeout: 15), "for the archive")
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
