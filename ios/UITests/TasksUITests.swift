import XCTest

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
        app.openRoomPlace("tasks")
        let row = app.buttons["task-row-task_demo_quote"]
        XCTAssertTrue(any("tasks-screen").waitForExistence(timeout: 15))
        sleep(1)
        for _ in 0..<5 where !row.exists { app.swipeUp() }
        XCTAssertTrue(row.waitForExistence(timeout: 5))
        XCTAssertNotEqual(row.value as? String, "running", "it's yours again")
        XCTAssertFalse(row.label.contains("Juniper"), "not on the Bot")
    }

    func testTheTasksPage() {
        launch()
        app.openRoomPlace("tasks")
        XCTAssertTrue(any("tasks-screen").waitForExistence(timeout: 15), "the menu's Tasks opens the Tasks page")
        XCTAssertTrue(app.navigationBars["Tasks"].exists || app.staticTexts["Tasks"].exists)
        XCTAssertTrue(app.staticTexts["Mine, Today"].exists || app.otherElements["Mine, Today"].exists || app.staticTexts["Today"].exists, "Mine, Today first")
        XCTAssertTrue(app.buttons["task-row-task_demo_quote"].waitForExistence(timeout: 10))
        XCTAssertEqual(app.buttons["task-row-task_demo_quote"].value as? String, "needs-you")
        let field = app.textFields["tasks-add"]
        XCTAssertTrue(field.exists)
        XCTAssertEqual(field.placeholderValue, "Add a task for yourself", "no promise that the Bot fills it in")
        shot("6-tasks-page")

        field.tap()
        field.typeText("Buy stamps\n")
        let typed = app.buttons.matching(NSPredicate(format: "label BEGINSWITH 'Buy stamps'")).firstMatch
        sleep(2)
        for _ in 0..<5 where !typed.exists { app.swipeUp() }
        XCTAssertTrue(typed.waitForExistence(timeout: 10), "a typed task is yours at once")
        XCTAssertEqual(typed.value as? String, "todo", "in To do, not on the Bot")

        for _ in 0..<5 where !app.staticTexts["Agents on it"].exists { app.swipeUp() }
        XCTAssertTrue(app.staticTexts["Agents on it"].waitForExistence(timeout: 5))
        let scheduled = app.staticTexts.matching(NSPredicate(format: "label ==[c] 'Scheduled & recurring'")).firstMatch
        for _ in 0..<5 where !scheduled.exists { app.swipeUp() }
        XCTAssertTrue(scheduled.exists, "Scheduled & recurring")
        let done = app.buttons["tasks-done-toggle"]
        for _ in 0..<5 where !done.exists { app.swipeUp() }
        XCTAssertTrue(done.waitForExistence(timeout: 5), "done tasks fold away")
        XCTAssertTrue(done.label.contains("done"))
        shot("7-tasks-page-lower")

        let agents = app.buttons["tasks-owner-agents"]
        for _ in 0..<12 where !(agents.exists && agents.isHittable) {
            let start = app.coordinate(withNormalizedOffset: CGVector(dx: 0.5, dy: 0.4))
            start.press(forDuration: 0.05, thenDragTo: start.withOffset(CGVector(dx: 0, dy: 150)))
        }
        sleep(1)
        agents.tap()
        let on = XCTNSPredicateExpectation(predicate: NSPredicate(format: "isSelected == true"), object: agents)
        if XCTWaiter.wait(for: [on], timeout: 3) != .completed {
            sleep(2)
            agents.tap()
        }
        let again = XCTNSPredicateExpectation(predicate: NSPredicate(format: "isSelected == true"), object: agents)
        XCTAssertEqual(XCTWaiter.wait(for: [again], timeout: 5), .completed, "the Agents filter is on")
        let fork = app.buttons["task-row-wc_demo_fork"]
        for _ in 0..<4 where !fork.exists { app.swipeUp() }
        XCTAssertTrue(fork.waitForExistence(timeout: 5), "the Agents filter")
        XCTAssertFalse(app.buttons["task-row-task_demo_quote"].exists)
        for _ in 0..<8 where !app.buttons["tasks-owner-all"].isHittable { app.swipeDown() }
        app.buttons["tasks-owner-all"].tap()

        app.buttons["task-row-task_demo_quote"].tap()
        XCTAssertTrue(any("task-task_demo_quote").waitForExistence(timeout: 10), "a row opens its card")
        XCTAssertTrue(app.buttons["Choose Second quote"].exists)
        XCTAssertFalse(any("task-task_demo_quote").descendants(matching: .any)["task-done"].exists, "no Done on a decision")
        shot("8-tasks-decide-card")
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

    func testTheTaskCardInTheChat() {
        launch(["-qaRoomMode", "read", "-qaTaskCards"], ready: "roomLayDown")
        let ended = any("task-wc_demo_bank")
        XCTAssertTrue(ended.waitForExistence(timeout: 20))
        XCTAssertTrue(app.buttons["Reopen for its worker"].waitForExistence(timeout: 10), "an ended card offers Reopen")
        XCTAssertTrue(app.staticTexts.matching(NSPredicate(format: "label CONTAINS 'Ended'")).firstMatch.exists, "and says Ended")
        shot("12-ended-card")
        let critical = any("task-severity")
        for _ in 0..<6 where !critical.exists { app.collectionViews.firstMatch.swipeDown() }
        XCTAssertTrue(critical.waitForExistence(timeout: 5), "a finding shows its severity")
        shot("13-finding-card")
        let fork = any("task-wc_demo_fork")
        for _ in 0..<4 where !fork.exists { app.collectionViews.firstMatch.swipeDown() }
        XCTAssertTrue(fork.waitForExistence(timeout: 5), "a worker's card")
        XCTAssertTrue(app.buttons["Take over"].exists || app.buttons["Take back"].exists, "it can be taken")
        shot("14-worker-card")
    }

    func testATaskPushOpensItsCardInItsConversation() {
        launch(["-qaPushTask", "wc_demo_stills", "-qaPushConversation", "thr_demo_interview"], ready: "task-sheet")
        XCTAssertTrue(any("task-sheet").waitForExistence(timeout: 15), "the push opens the task card")
        XCTAssertTrue(any("task-wc_demo_stills").waitForExistence(timeout: 10))
        shot("15-push-card")
        app.buttons["task-sheet-close"].tap()
        sleep(1)
        shot("15b-push-conversation")
        XCTAssertTrue(app.staticTexts.matching(NSPredicate(format: "label CONTAINS 'Mock with Sam moved to Friday'")).firstMatch.waitForExistence(timeout: 10),
                      "over the conversation the task lives in")
    }

    func testATaskPushWithoutAConversationOpensOverTheRoom() {
        launch(["-qaPushTask", "loop_tax"], ready: "task-sheet")
        XCTAssertTrue(any("task-sheet").waitForExistence(timeout: 15))
        XCTAssertTrue(any("task-loop_tax").waitForExistence(timeout: 10))
        app.buttons["task-sheet-close"].tap()
        XCTAssertTrue(app.buttons["roomInput"].waitForExistence(timeout: 10), "the room stays")
    }

    func testAnOlderStudioKeepsTodos() {
        launch(["-qaTasksOld"])
        XCTAssertTrue(app.buttons.matching(NSPredicate(format: "identifier BEGINSWITH 'roomCard-'")).firstMatch.waitForExistence(timeout: 15), "the morning list still fills the room")
        app.openRoomPlace("tasks")
        XCTAssertTrue(any("loops-screen").waitForExistence(timeout: 15), "an older Studio shows the old list")
    }

    func testNoTasks() {
        launch(["-qaLoopsEmpty"])
        XCTAssertFalse(app.buttons.matching(NSPredicate(format: "identifier BEGINSWITH 'roomCard-'")).firstMatch.exists, "no cards")
        app.openRoomPlace("tasks")
        XCTAssertTrue(app.staticTexts["No tasks yet"].waitForExistence(timeout: 15), "Tasks says there are none yet")
        shot("16-empty")
    }

    func testOfflineThenRetry() {
        launch(["-qaTasksOffline"])
        app.openRoomPlace("tasks")
        XCTAssertTrue(app.buttons["tasks-retry"].waitForExistence(timeout: 10), "offline shows Retry")
        shot("17-offline")
        let row = app.buttons["task-row-task_demo_quote"]
        for _ in 0..<12 where !row.exists {
            if app.buttons["tasks-retry"].exists { app.buttons["tasks-retry"].tap() }
            _ = row.waitForExistence(timeout: 5)
        }
        XCTAssertTrue(row.exists, "Retry loads the tasks once the connection is back")
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
        app.openRoomPlace("tasks")
        XCTAssertTrue(app.buttons["task-row-task_demo_quote"].waitForExistence(timeout: 15))
        app.buttons["task-row-task_demo_quote"].tap()
        XCTAssertTrue(any("task-task_demo_quote").waitForExistence(timeout: 10))
        try audit("tasks")
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
