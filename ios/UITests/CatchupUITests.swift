import XCTest

/// Slice 1 of the phone catching up with the desktop, offline
/// (`-qaSpacesDemo list -qaBotDemo chat -qaStrandsDemo`; `BotSpacesDemo.State`
/// answers `strands.list` and a nested `bot_threads_view`): the strands box in
/// In flight's place, an approval answered from it, the one conversation list
/// with workers under their conversation, and swiping between conversations
/// on the conversation screen. `TEST_RUNNER_CATCHUP_OUT` keeps PNGs.
final class CatchupUITests: ServerIsolatedUITestCase {
    private let app = XCUIApplication()

    private func launch(_ extra: [String] = []) {
        app.launchArguments += ["-skipPushPrompt", "YES", "-qaBotDemo", "chat", "-qaSpacesDemo", "list", "-qaStrandsDemo"] + extra
        app.launchOffline()
        XCTAssertTrue(app.waitForRoom(), "the app opens on the room")
    }

    private func any(_ id: String) -> XCUIElement { app.descendants(matching: .any)[id].firstMatch }

    private func stand() {
        XCTAssertTrue(app.textViews["Message"].waitForExistence(timeout: 30), "Main stands up")
    }

    func testTheStrandsBoxReplacesInFlightAndAnswersAnApproval() {
        launch()
        stand()
        let toggle = app.buttons["strands-toggle"]
        XCTAssertTrue(toggle.waitForExistence(timeout: 20), "the strands box is above the composer")
        XCTAssertTrue(toggle.label.contains("2 need you"), toggle.label)
        XCTAssertFalse(any("in-flight").exists, "no In flight")
        XCTAssertFalse(any("conversationWorkers").exists, "no worker chip")
        shot("1-box")

        toggle.tap()
        XCTAssertTrue(app.buttons["strand-str_fork"].waitForExistence(timeout: 10), "opened: the strand that needs you")
        XCTAssertTrue(app.staticTexts["Approve on the desktop"].exists, "a Tool Gateway ask is view-only")
        XCTAssertTrue(app.buttons["strand-worker-thr_demo_w2"].exists, "a running strand lists its worker")
        XCTAssertTrue(app.buttons["strand-worker-thr_demo_w9"].exists, "a worker no strand holds")
        shot("2-box-open")

        app.buttons["strand-decide-allow_once"].firstMatch.tap()
        XCTAssertTrue(app.buttons["strand-decide-allow_once"].waitForNonExistence(timeout: 10), "the approval is answered")
        XCTAssertTrue(toggle.label.contains("1 needs you"), toggle.label)
    }

    func testTheConversationListNestsWorkersUnderTheirConversation() {
        launch()
        app.openRoomPlace("conversations")
        XCTAssertTrue(app.buttons["roomConversation-thr_demo_bot"].waitForExistence(timeout: 15) || app.buttons.matching(NSPredicate(format: "identifier BEGINSWITH 'roomConversation-'")).firstMatch.waitForExistence(timeout: 15))
        let running = app.buttons["roomWorker-thr_demo_w2"]
        XCTAssertTrue(running.waitForExistence(timeout: 10), "Main's running worker shows under it")
        XCTAssertTrue(app.buttons["roomWorker-thr_demo_w6"].exists)
        XCTAssertFalse(app.staticTexts["Working now"].exists, "no separate workers list")
        XCTAssertFalse(app.staticTexts["Finished today"].exists)
        let fold = app.buttons.matching(NSPredicate(format: "identifier BEGINSWITH 'roomFold-'")).firstMatch
        XCTAssertTrue(fold.exists, "finished workers fold into N done")
        shot("3-list")
        for _ in 0..<3 where !fold.isHittable { app.swipeUp() }
        fold.tap()
        let runner = app.buttons["roomWorker-thr_demo_r1"]
        for _ in 0..<3 where !runner.exists { app.swipeUp() }
        XCTAssertTrue(runner.waitForExistence(timeout: 5), "a runner's thread sits under Main")
        shot("4-list-open")
    }

    func testSwipingTheConversationPagesToTheNext() {
        launch()
        stand()
        // The dots under the name; the folded Duo, which has none, shows the name.
        let dots = app.shownConversation
        XCTAssertTrue(dots.waitForExistence(timeout: 20), "dots under the name")
        let first = dots.label
        if !app.isFoldedDuo { XCTAssertTrue(first.hasPrefix("Conversation 1 of"), first) }
        let middle = app.coordinate(withNormalizedOffset: CGVector(dx: 0.7, dy: 0.45))
        middle.press(forDuration: 0.02, thenDragTo: app.coordinate(withNormalizedOffset: CGVector(dx: 0.1, dy: 0.46)), withVelocity: .fast, thenHoldForDuration: 0)
        let moved = XCTNSPredicateExpectation(predicate: app.isFoldedDuo ? NSPredicate(format: "label != %@", first)
            : NSPredicate(format: "label BEGINSWITH 'Conversation 2 of'"), object: dots)
        XCTAssertEqual(XCTWaiter.wait(for: [moved], timeout: 10), .completed, "it pages to the next conversation")
        shot("5-swiped")
        app.coordinate(withNormalizedOffset: CGVector(dx: 0.3, dy: 0.45))
            .press(forDuration: 0.02, thenDragTo: app.coordinate(withNormalizedOffset: CGVector(dx: 0.9, dy: 0.46)), withVelocity: .fast, thenHoldForDuration: 0)
        let back = XCTNSPredicateExpectation(predicate: NSPredicate(format: "label == %@", first), object: dots)
        XCTAssertEqual(XCTWaiter.wait(for: [back], timeout: 10), .completed, "and back")
    }

    private func shot(_ name: String) {
        guard let folder = ProcessInfo.processInfo.environment["CATCHUP_OUT"] else { return }
        sleep(1)
        let url = URL(fileURLWithPath: folder)
        try? FileManager.default.createDirectory(at: url, withIntermediateDirectories: true)
        try? XCUIScreen.main.screenshot().pngRepresentation.write(to: url.appendingPathComponent("\(name).png"))
    }
}
