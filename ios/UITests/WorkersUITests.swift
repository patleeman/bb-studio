import XCTest

/// Workers in the Bot's shell, offline (`-qaSpacesDemo` with `-qaBotDemo
/// chat`): a worker opens read-only from Home, its row saying its state and
/// its title line its name, with "Ask the Bot about this worker…" where the
/// composer was; Ask sends to the owning conversation and goes there.
/// `TEST_RUNNER_STEP6_OUT` keeps PNGs.
final class WorkersUITests: ServerIsolatedUITestCase {
    private let app = XCUIApplication()

    private func launch(_ variant: String = "needs") {
        app.launchArguments += ["-skipPushPrompt", "YES", "-qaBotDemo", "chat", "-qaSpacesDemo", variant]
        app.launchOffline()
        XCTAssertTrue(app.waitForRoom(), "Main opens from Home")
        XCTAssertTrue(app.textViews["Message"].waitForExistence(timeout: 30), "Main stands up")
    }

    private func back() { app.goBack() }

    private var askField: XCUIElement { app.textViews["Ask the Bot about this worker…"] }

    /// Opens a worker from its Home row, which says its state first.
    private func open(_ row: XCUIElement, state: String, file: StaticString = #filePath, line: UInt = #line) {
        XCTAssertTrue(row.label.hasPrefix(state), "the row says \(state): \(row.label)", file: file, line: line)
        row.tap()
    }

    private func expectWorker(_ title: String, file: StaticString = #filePath, line: UInt = #line) {
        let header = app.conversationTitle
        XCTAssertTrue(header.waitForExistence(timeout: 15), "the worker's title", file: file, line: line)
        XCTAssertTrue(header.label.hasPrefix(title), header.label, file: file, line: line)
        XCTAssertTrue(askField.waitForExistence(timeout: 10), "Ask replaces the composer", file: file, line: line)
        XCTAssertFalse(app.textViews["Message"].exists, "no composer", file: file, line: line)
        XCTAssertTrue(app.descendants(matching: .any)["workerBot"].firstMatch.label.contains("Juniper"), "the owner Bot's name", file: file, line: line)
    }

    func testOpenFromTheListAndAsk() {
        launch()
        app.openRoomPlace("conversations")
        // The failed worker sits under the conversation that started it, maybe behind its fold.
        let fold = app.buttons["homeFold-thr_demo_interview"]
        let failed = app.buttons["homeWorker-thr_demo_w3"]
        app.scrollHome(to: failed)
        XCTAssertTrue(failed.waitForExistence(timeout: 10) || fold.exists, "Launch prep's workers")
        if !failed.exists { fold.tap() }
        XCTAssertTrue(failed.waitForExistence(timeout: 15))
        open(failed, state: "Failed")
        expectWorker("Mock question bank")
        XCTAssertTrue(app.staticTexts.matching(NSPredicate(format: "label CONTAINS 'Stopping here'")).firstMatch.waitForExistence(timeout: 15),
                      "the worker's transcript")
        XCTAssertTrue(app.buttons["workerOwner"].label.contains("Launch prep"))
        shot("failed-worker")

        askField.tap()
        askField.typeText("Why did it stop?")
        let send = app.buttons["workerAskSend"]
        XCTAssertTrue(send.waitForExistence(timeout: 5))
        XCTAssertEqual(send.label, "Sends to Juniper in Launch prep")
        shot("ask-box")
        send.tap()
        XCTAssertTrue(app.staticTexts.matching(NSPredicate(format: "label CONTAINS 'Why did it stop?'")).firstMatch.waitForExistence(timeout: 15),
                      "the question lands in the owning conversation")
        XCTAssertTrue(app.textViews["Message"].waitForExistence(timeout: 10), "the conversation, with its composer")
        XCTAssertFalse(askField.exists)
        shot("asked")
    }

    /// From the conversation list (the "N workers from here" line went with In flight).
    func testOpenFromTheListAndAskGoesBack() {
        launch()
        app.openRoomPlace("conversations")
        let running = app.buttons["homeWorker-thr_demo_w2"]
        XCTAssertTrue(running.waitForExistence(timeout: 15))
        open(running, state: "Running")
        expectWorker("Theme stills renderer")
        XCTAssertTrue(app.buttons["workerOwner"].label.contains("Main"))
        XCTAssertFalse(app.navigationBars.buttons["Stop"].exists, "read-only: no Stop")
        shot("running-worker")

        askField.tap()
        askField.typeText("How far along is it?")
        app.buttons["workerAskSend"].tap()
        XCTAssertTrue(app.textViews["Message"].waitForExistence(timeout: 15), "back on Main")
        XCTAssertFalse(askField.exists)
    }

    func testWaitingOnAnApprovalShowsItsStatusOnly() {
        launch()
        app.openRoomPlace("conversations")
        let waiting = app.buttons["homeWorker-thr_demo_w1"]
        XCTAssertTrue(waiting.waitForExistence(timeout: 15))
        open(waiting, state: "Waiting")
        expectWorker("Studio-native BB fork")
        XCTAssertFalse(app.buttons["workerAnswerHere"].exists)
        shot("waiting-worker")
        app.buttons["workerOwner"].tap()
        XCTAssertTrue(app.textViews["Message"].waitForExistence(timeout: 15), "the owner chip opens the conversation")
    }

    private func shot(_ name: String) {
        guard let folder = ProcessInfo.processInfo.environment["STEP6_OUT"] else { return }
        sleep(1)
        let url = URL(fileURLWithPath: folder)
        try? FileManager.default.createDirectory(at: url, withIntermediateDirectories: true)
        try? XCUIScreen.main.screenshot().pngRepresentation.write(to: url.appendingPathComponent("\(name).png"))
    }
}
