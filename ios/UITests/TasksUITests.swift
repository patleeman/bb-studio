import XCTest

/// What is left of tasks, offline (`-qaLoopsDemo`): the presence screen's
/// rows, In flight (the conversation's bar on a Studio without strands), old
/// `::work` and `::loop` cards in the chat (read-only) and an older Studio's
/// to-do push (it opens its conversation). The Tasks screen is gone; Strands
/// replaced it (StrandsOverviewUITests). `TEST_RUNNER_TASKS_OUT` keeps PNGs.
final class TasksUITests: ServerIsolatedUITestCase {
    private let app = XCUIApplication()

    private func launch(_ extra: [String] = [], ready: String = "roomMic") {
        app.launchArguments += ["-skipPushPrompt", "YES", "-qaBotDemo", "chat", "-qaSpacesDemo", "list", "-qaLoopsDemo",
                                "-qaRoomTheme", ProcessInfo.processInfo.environment["ROOM_THEME"] ?? "aurora-fjord"] + extra
        app.launchOffline()
        if !any(ready).waitForExistence(timeout: 30) {
            app.terminate()
            app.launchOffline()
        }
        XCTAssertTrue(any(ready).waitForExistence(timeout: 60), "the app opens on the room")
    }

    private func shot(_ name: String) {
        guard let folder = ProcessInfo.processInfo.environment["TASKS_OUT"] else { return }
        sleep(1)
        let url = URL(fileURLWithPath: folder)
        try? FileManager.default.createDirectory(at: url, withIntermediateDirectories: true)
        try? XCUIScreen.main.screenshot().pngRepresentation.write(to: url.appendingPathComponent("\(name).png"))
    }

    private func any(_ id: String) -> XCUIElement { app.descendants(matching: .any)[id].firstMatch }

    private func gone(_ element: XCUIElement, _ what: String, timeout: TimeInterval = 10) {
        let predicate = NSPredicate(format: "exists == false")
        let wait = XCTNSPredicateExpectation(predicate: predicate, object: element)
        XCTAssertEqual(XCTWaiter().wait(for: [wait], timeout: timeout), .completed, what)
    }

    private func menuItem(_ label: String) -> XCUIElement {
        app.collectionViews.buttons[label].firstMatch.exists ? app.collectionViews.buttons[label].firstMatch : app.buttons[label].firstMatch
    }

    func testTheRoomsYoursAreTheUsersTasks() {
        launch()
        let quote = app.buttons["roomCard-task_demo_quote"]
        XCTAssertTrue(quote.waitForExistence(timeout: 15), "what an agent handed over is a row under Yours")
        XCTAssertEqual(any("roomTask-task_demo_quote").value as? String, "needs-you", "it needs you")
        XCTAssertTrue(quote.label.contains("Needs you"), "VoiceOver says it needs you")
        XCTAssertFalse(app.buttons["Done: Approve the plumber's quote"].exists, "a decision has no Done; choosing is the Done")
        if app.buttons["roomCard-task_demo_spend"].exists {
            XCTAssertTrue(app.buttons["Done: Spend alert: Claude spend over the daily budget"].exists, "a to-do has its Done")
        }
        XCTAssertFalse(app.staticTexts.matching(NSPredicate(format: "label ENDSWITH 'things today.'")).firstMatch.exists, "no repeated counts")
        shot("1-room-task-rows")

        quote.press(forDuration: 1.2)
        let choice = app.buttons.matching(NSPredicate(format: "label BEGINSWITH 'Ace Plumbing'")).firstMatch
        XCTAssertTrue(choice.waitForExistence(timeout: 5), "its options are in the row's menu")
        choice.tap()
        let moved = XCTNSPredicateExpectation(predicate: NSPredicate(format: "exists == false OR label CONTAINS ' is on it'"), object: quote)
        XCTAssertEqual(XCTWaiter().wait(for: [moved], timeout: 10), .completed, "choosing sends it back to the agent that asked: it leaves Yours")
        XCTAssertFalse(any("roomTask-task_demo_quote").exists, "no longer under Yours")
        shot("2-room-after-choice")
    }

    func testAHandOffFromACardsMenuAndTakeBack() {
        launch()
        let card = app.buttons["roomCard-task_demo_quote"]
        XCTAssertTrue(card.waitForExistence(timeout: 15))
        card.press(forDuration: 1.2)
        XCTAssertTrue(menuItem("Hand off").waitForExistence(timeout: 5), "the card's menu offers Hand off")
        shot("3-card-menu")
        menuItem("Hand off").tap()
        XCTAssertTrue(menuItem("Juniper").waitForExistence(timeout: 5), "to the Bot")
        shot("4-hand-off-targets")
        menuItem("Juniper").tap()
        XCTAssertTrue(app.buttons["roomCard-task_demo_quote"].waitForExistence(timeout: 10))
        let onIt = NSPredicate(format: "label CONTAINS 'Juniper is on it'")
        XCTAssertTrue(app.buttons.matching(onIt).firstMatch.waitForExistence(timeout: 10), "it moves under On it, saying who has it now")
        shot("5-handed-off")

        app.buttons["roomCard-task_demo_quote"].press(forDuration: 1.2)
        XCTAssertTrue(menuItem("Take back").waitForExistence(timeout: 5), "and offers Take back")
        menuItem("Take back").tap()
        gone(app.buttons.matching(onIt).firstMatch, "the card no longer says someone else has it")
    }

    func testInFlightInTheStandingChat() throws {
        launch(["-qaRoomMode", "read"], ready: "roomLayDown")
        let bar = any("in-flight")
        XCTAssertTrue(bar.waitForExistence(timeout: 20), "In flight sits above the composer")
        XCTAssertTrue(any("in-flight-needs").exists, "with what needs you")
        let rows = app.buttons.matching(identifier: "in-flight-row")
        XCTAssertGreaterThanOrEqual(rows.count, 3)
        XCTAssertEqual(rows.element(boundBy: 0).value as? String, "needs-you", "needs you first")
        XCTAssertTrue(app.buttons["in-flight-done"].exists, "finished ones fold into N done")
        XCTAssertTrue(app.buttons["Remove Studio-native BB fork from In flight"].exists, "a card's row has ×")
        shot("9-in-flight")
        try app.performAccessibilityAudit(for: [.sufficientElementDescription]) { issue in
            print("audit issue (in flight):", issue.compactDescription, issue.element?.debugDescription ?? "no element")
            return false
        }

        app.buttons["in-flight-done"].tap()
        XCTAssertTrue(app.buttons.matching(NSPredicate(format: "label BEGINSWITH 'Release notes'")).firstMatch.waitForExistence(timeout: 5))
        shot("10-in-flight-done-open")
        app.buttons["in-flight-clear"].tap()
        gone(app.buttons["in-flight-done"], "Clear done removes the finished ones")
        app.buttons["Remove Studio-native BB fork from In flight"].tap()
        gone(app.buttons["Remove Studio-native BB fork from In flight"], "× removes a row")
        shot("11-in-flight-cleared")

        app.buttons["in-flight-toggle"].tap()
        XCTAssertFalse(app.buttons.matching(identifier: "in-flight-row").firstMatch.exists, "it folds")
        app.buttons["in-flight-toggle"].tap()
    }

    func testInFlightReadsTheFlightFeed() {
        launch(["-qaRoomMode", "read"], ready: "roomLayDown")
        XCTAssertTrue(any("in-flight").waitForExistence(timeout: 20))
        let rows = app.buttons.matching(identifier: "in-flight-row")
        XCTAssertEqual(rows.element(boundBy: 0).value as? String, "needs-you", "needs you first")
        XCTAssertTrue(any("in-flight-running").exists, "the header says how many are running")
        XCTAssertTrue(app.buttons["in-flight-done"].label.contains("done today"), "ended and done rows fold into N done today")
        XCTAssertFalse(rows.matching(NSPredicate(format: "label BEGINSWITH 'Run the UI suite'")).firstMatch.exists, "a subtask is not a row of its own")
        let fold = app.buttons.matching(NSPredicate(format: "identifier == 'in-flight-fold' AND label CONTAINS 'under Studio-native BB fork'")).firstMatch
        XCTAssertTrue(fold.exists, "the fork's subtask and workers fold under it")
        XCTAssertTrue(fold.label.contains("1 subtask · 2 workers"), fold.label)
        shot("20-in-flight-feed")
        fold.tap()
        let sub = app.buttons.matching(identifier: "in-flight-subtask").firstMatch
        XCTAssertTrue(sub.waitForExistence(timeout: 5), "unfolded, the subtask shows under its task")
        XCTAssertTrue(sub.label.hasPrefix("Run the UI suite on the iPad, running, step 2 of 6"), sub.label)
        XCTAssertTrue(app.buttons["Open worker Studio-native BB fork, running"].exists, "with the worker on it, and whether it runs")
        XCTAssertTrue(app.buttons["Open worker iPad UI suite, running"].exists, "and the subtask's worker")
        any("in-flight").swipeUp()
        shot("21-in-flight-folded")
        app.buttons["in-flight-done"].tap()
        let ended = rows.matching(NSPredicate(format: "label BEGINSWITH 'Mock question bank'")).firstMatch
        XCTAssertTrue(ended.waitForExistence(timeout: 5), "the ended worker is with the done ones")
        XCTAssertEqual(ended.value as? String, "ended")
        app.buttons["in-flight-clear"].tap()
        gone(app.buttons["in-flight-done"], "Clear done clears the ended one too")
    }

    func testInFlightFallsBackOnAStudioWithoutTheFlightFeed() {
        launch(["-qaTasksNoBoard", "-qaRoomMode", "read"], ready: "roomLayDown")
        XCTAssertTrue(any("in-flight").waitForExistence(timeout: 20), "In flight still shows, from tasks.inFlight")
        let rows = app.buttons.matching(identifier: "in-flight-row")
        XCTAssertGreaterThanOrEqual(rows.count, 3)
        XCTAssertEqual(rows.element(boundBy: 0).value as? String, "needs-you")
        XCTAssertFalse(app.buttons.matching(identifier: "in-flight-fold").firstMatch.exists, "no rows to fold without the new feed")
        XCTAssertTrue(rows.matching(NSPredicate(format: "label BEGINSWITH 'Run the UI suite'")).firstMatch.exists, "the subtask is a row, as before")
        XCTAssertTrue(app.buttons["Remove Studio-native BB fork from In flight"].exists)
        shot("23-in-flight-fallback")
        app.buttons["in-flight-done"].tap()
        XCTAssertTrue(app.buttons.matching(NSPredicate(format: "label BEGINSWITH 'Release notes'")).firstMatch.waitForExistence(timeout: 5))
        app.buttons["in-flight-clear"].tap()
        gone(app.buttons["in-flight-done"], "Clear done")
    }

    func testTheTaskCardInTheChatIsReadOnly() {
        launch(["-qaRoomMode", "read", "-qaTaskCards"], ready: "roomLayDown")
        let ended = any("task-wc_demo_bank")
        XCTAssertTrue(ended.waitForExistence(timeout: 20))
        XCTAssertTrue(app.staticTexts.matching(NSPredicate(format: "label CONTAINS 'Ended'")).firstMatch.waitForExistence(timeout: 10), "an ended card says Ended")
        XCTAssertFalse(app.buttons["Reopen for its worker"].exists, "and offers no Reopen")
        XCTAssertFalse(any("task-reopen").exists)
        shot("12-ended-card")
        let critical = any("task-severity")
        for _ in 0..<6 where !critical.exists { app.collectionViews.firstMatch.swipeDown() }
        XCTAssertTrue(critical.waitForExistence(timeout: 5), "a finding shows its severity")
        shot("13-finding-card")
        let fork = any("task-wc_demo_fork")
        for _ in 0..<4 where !fork.exists { app.collectionViews.firstMatch.swipeDown() }
        XCTAssertTrue(fork.waitForExistence(timeout: 5), "a worker's card")
        XCTAssertTrue(fork.descendants(matching: .any)["task-state"].exists, "with its state")
        for id in ["task-done", "task-snooze", "task-hand-off", "task-take-back", "task-more", "task-option"] {
            XCTAssertFalse(app.descendants(matching: .any)[id].exists, "no \(id): old cards are read-only")
        }
        XCTAssertFalse(app.buttons["Take over"].exists || app.buttons["Take back"].exists, "nothing to take")
        shot("14-worker-card")
    }

    func testAToDoPushOpensItsConversation() {
        launch(["-qaPushTask", "wc_demo_stills", "-qaPushConversation", "thr_demo_interview"], ready: "composerField")
        XCTAssertTrue(app.staticTexts.matching(NSPredicate(format: "label CONTAINS 'Mock with Sam moved to Friday'")).firstMatch.waitForExistence(timeout: 20),
                      "the push opens the conversation the task lives in")
        XCTAssertFalse(any("task-sheet").exists, "with no card over it")
        shot("15-push-conversation")
    }

    func testAToDoPushWithoutAConversationOpensMain() {
        launch(["-qaPushTask", "loop_tax"], ready: "composerField")
        XCTAssertTrue(app.textViews["composerField"].waitForExistence(timeout: 20), "the push's thread is Main: its chat stands up")
        XCTAssertFalse(any("task-sheet").exists, "with no card over it")
    }

    func testAToDoPushWhileAPlaceIsOpenClosesItAndShowsTheConversation() {
        launch(["-qaRoomMode", "memory", "-qaPushTask", "task_demo_quote", "-qaPushConversation", "thr_demo_interview", "-qaPushDelay", "25"], ready: "RoomSheet-memory")
        XCTAssertTrue(any("RoomSheet-memory").waitForExistence(timeout: 10), "Memory is open")
        XCTAssertTrue(any("RoomSheet-memory").waitForNonExistence(timeout: 40), "the push closes Memory")
        XCTAssertTrue(app.staticTexts["Launch prep"].waitForExistence(timeout: 10), "and opens its conversation")
        XCTAssertFalse(any("task-sheet").exists)
        shot("18-push-over-a-place")
    }

    func testEveryNewControlHasALabel() throws {
        launch()
        let audit = { (where_: String) in
            try self.app.performAccessibilityAudit(for: [.sufficientElementDescription]) { issue in
                print("audit issue (\(where_)):", issue.compactDescription, issue.element?.debugDescription ?? "no element")
                return false
            }
        }
        try audit("room")
        app.buttons["roomCard-task_demo_quote"].tap()
        XCTAssertTrue(any("task-task_demo_quote").waitForExistence(timeout: 10), "a row opens its read-only card")
        try audit("task card")
    }

    func testHandOffForTheRecording() throws {
        guard ProcessInfo.processInfo.environment["TASKS_RECORD"] != nil else { throw XCTSkip("only for the screen recording") }
        launch()
        let card = app.buttons["roomCard-wc_demo_stills"]
        XCTAssertTrue(card.waitForExistence(timeout: 15))
        sleep(3)
        card.tap()
        XCTAssertTrue(any("task-wc_demo_stills").waitForExistence(timeout: 10), "the row opens its task")
        sleep(3)
        app.buttons["task-sheet-close"].tap()
        XCTAssertTrue(card.waitForExistence(timeout: 10))
        sleep(1)
        card.press(forDuration: 1.2)
        XCTAssertTrue(menuItem("Hand off").waitForExistence(timeout: 5))
        sleep(1)
        menuItem("Hand off").tap()
        XCTAssertTrue(menuItem("Juniper").waitForExistence(timeout: 5))
        sleep(1)
        menuItem("Juniper").tap()
        XCTAssertTrue(app.buttons.matching(NSPredicate(format: "label CONTAINS 'Juniper is on it'")).firstMatch.waitForExistence(timeout: 10))
        sleep(3)
        app.standRoomChat()
        XCTAssertTrue(any("in-flight").waitForExistence(timeout: 20))
        let row = app.buttons.matching(NSPredicate(format: "identifier == 'in-flight-row' AND label BEGINSWITH 'Theme stills renderer'")).firstMatch
        XCTAssertTrue(row.waitForExistence(timeout: 10), "In flight shows who has it")
        XCTAssertTrue(row.label.contains("Juniper"))
        sleep(2)
        if !row.isHittable { any("in-flight").swipeUp() }
        sleep(4)
    }
}
