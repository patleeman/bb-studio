import XCTest

/// Workers in the Bot's shell, offline (`-qaSpacesDemo` with `-qaBotDemo
/// chat`): a worker opens read-only from the list and from the workers line,
/// with its status in the header and "Ask the Bot about this worker…" where
/// the composer was; Ask sends to the owning conversation and goes there.
/// `TEST_RUNNER_STEP6_OUT` keeps PNGs.
final class WorkersUITests: ServerIsolatedUITestCase {
    private let app = XCUIApplication()

    private func launch(_ variant: String = "needs") {
        app.launchArguments += ["-skipPushPrompt", "YES", "-qaBotDemo", "chat", "-qaSpacesDemo", variant]
        app.launchOffline()
        XCTAssertTrue(app.textViews["Message"].waitForExistence(timeout: 30), "Main opens")
    }

    private func back() {
        let bar = app.navigationBars.firstMatch
        XCTAssertTrue(bar.waitForExistence(timeout: 20))
        bar.buttons.element(boundBy: 0).tap()
    }

    private var askField: XCUIElement { app.textViews["Ask the Bot about this worker…"] }

    private func expectWorker(_ title: String, status: String, file: StaticString = #filePath, line: UInt = #line) {
        let header = app.otherElements["workerTitle"].exists ? app.otherElements["workerTitle"] : app.descendants(matching: .any)["workerTitle"]
        XCTAssertTrue(header.waitForExistence(timeout: 15), "the worker's header", file: file, line: line)
        XCTAssertTrue(header.label.hasPrefix(title), header.label, file: file, line: line)
        XCTAssertEqual(header.value as? String, status, file: file, line: line)
        XCTAssertTrue(askField.waitForExistence(timeout: 10), "Ask replaces the composer", file: file, line: line)
        XCTAssertFalse(app.textViews["Message"].exists, "no composer", file: file, line: line)
        XCTAssertTrue(app.descendants(matching: .any)["workerBot"].firstMatch.label.contains("Juniper"), "the owner Bot's name", file: file, line: line)
    }

    func testOpenFromTheListAndAsk() {
        launch()
        back()
        let list = app.collectionViews["BotSpaceList"]
        let done = list.buttons.matching(NSPredicate(format: "label ENDSWITH ' done'")).firstMatch
        XCTAssertTrue(done.waitForExistence(timeout: 15), "failed workers fold under N done, as on desktop")
        done.tap()
        let failed = list.buttons["worker-thr_demo_w3"]
        XCTAssertTrue(failed.waitForExistence(timeout: 15))
        failed.tap()
        expectWorker("Mock question bank", status: "failed")
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

    func testOpenFromTheWorkersLineAndAskGoesBack() {
        launch()
        let line = app.buttons["conversationWorkers"]
        XCTAssertTrue(line.waitForExistence(timeout: 15))
        line.tap()
        let running = app.buttons["Theme stills renderer"]
        XCTAssertTrue(running.waitForExistence(timeout: 5))
        running.tap()
        expectWorker("Theme stills renderer", status: "running")
        XCTAssertTrue(app.buttons["workerOwner"].label.contains("Main"))
        XCTAssertFalse(app.navigationBars.buttons["Stop"].exists, "read-only: no Stop")
        shot("running-worker")

        askField.tap()
        askField.typeText("How far along is it?")
        app.buttons["workerAskSend"].tap()
        XCTAssertTrue(app.buttons["conversationWorkers"].waitForExistence(timeout: 15), "back on Main")
        XCTAssertTrue(app.textViews["Message"].exists)
        XCTAssertFalse(askField.exists)
    }

    func testWaitingOnAnApprovalShowsItsStatusOnly() {
        launch()
        back()
        let waiting = app.collectionViews["BotSpaceList"].buttons["worker-thr_demo_w1"]
        XCTAssertTrue(waiting.waitForExistence(timeout: 15))
        waiting.tap()
        expectWorker("Studio-native BB fork", status: "needs-you")
        let header = app.descendants(matching: .any)["workerTitle"]
        XCTAssertTrue(header.label.contains("Waiting for your approval") || header.label.contains("Waiting for you"), header.label)
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
