import XCTest

/// Worker approvals in the Bot's shell, offline (`-qaSpacesDemo needs` with
/// `-qaBotDemo chat`; `BotSpacesDemo.State` answers
/// `bot_conversation_approvals` and `bot_worker_approval_resolve`): the card
/// shows in the owning conversation, Approve resolves it and the worker runs
/// again; the worker marks its pending approval and points at the card.
/// `TEST_RUNNER_STEP7_OUT` keeps PNGs.
final class ApprovalsUITests: ServerIsolatedUITestCase {
    private let app = XCUIApplication()

    private func launch() {
        app.launchArguments += ["-skipPushPrompt", "YES", "-qaBotDemo", "chat", "-qaSpacesDemo", "needs"]
        app.launchOffline()
        XCTAssertTrue(app.textViews["Message"].waitForExistence(timeout: 30), "Main opens")
    }

    private func any(_ id: String) -> XCUIElement { app.descendants(matching: .any)[id].firstMatch }

    private func back() {
        let bar = app.navigationBars.firstMatch
        XCTAssertTrue(bar.waitForExistence(timeout: 20))
        bar.buttons.element(boundBy: 0).tap()
    }

    private func openWorker() {
        let row = app.collectionViews["BotSpaceList"].buttons["worker-thr_demo_w1"]
        XCTAssertTrue(row.waitForExistence(timeout: 15))
        row.tap()
        XCTAssertTrue(any("workerTitle").waitForExistence(timeout: 15), "the worker opens")
    }

    func testApproveInTheConversationResolvesAndTheWorkerRuns() {
        launch()
        let card = any("workerApproval")
        XCTAssertTrue(card.waitForExistence(timeout: 15), "the card shows in Main")
        XCTAssertTrue(any("approvalTitle").label.contains("Push to origin"))
        XCTAssertTrue(any("approvalLines").label.contains("git push origin bb-studio-native"))
        XCTAssertTrue(app.buttons["approvalWorker"].label.contains("Studio-native BB fork"), "the worker it came from")
        XCTAssertTrue(app.buttons["approval-deny"].exists)
        let approve = app.buttons["approval-allow_once"]
        XCTAssertTrue(approve.exists)
        shot("card")

        approve.tap()
        let settled = any("approvalSettled")
        XCTAssertTrue(settled.waitForExistence(timeout: 10), "the card says how it was settled")
        XCTAssertTrue(settled.label.contains("Approved"), settled.label)
        XCTAssertFalse(app.buttons["approval-allow_once"].exists, "no second Approve")
        shot("approved")
        XCTAssertTrue(card.waitForNonExistence(timeout: 15), "then it goes")

        back()
        openWorker()
        XCTAssertEqual(any("workerTitle").value as? String, "running", "the worker runs again")
        XCTAssertFalse(app.buttons["workerPendingOpen"].exists)
    }

    func testTheWorkerPointsAtTheCardInItsConversation() {
        launch()
        XCTAssertTrue(any("workerApproval").waitForExistence(timeout: 15))
        back()
        openWorker()
        XCTAssertEqual(any("workerTitle").value as? String, "needs-you")
        let marker = app.buttons["workerPendingOpen"]
        XCTAssertTrue(marker.waitForExistence(timeout: 15), "the pending approval is marked")
        XCTAssertTrue(marker.label.contains("Main"), marker.label)
        XCTAssertTrue(app.staticTexts["Push to origin"].waitForExistence(timeout: 10), "what it waits on")
        XCTAssertFalse(app.buttons["approval-allow_once"].exists, "not resolved on the worker")
        shot("worker-pending")

        marker.tap()
        XCTAssertTrue(any("workerApproval").waitForExistence(timeout: 15), "the card in the owning conversation")
        XCTAssertTrue(app.textViews["Message"].exists)
    }

    private func shot(_ name: String) {
        guard let folder = ProcessInfo.processInfo.environment["STEP7_OUT"] else { return }
        sleep(1)
        let url = URL(fileURLWithPath: folder)
        try? FileManager.default.createDirectory(at: url, withIntermediateDirectories: true)
        try? XCUIScreen.main.screenshot().pngRepresentation.write(to: url.appendingPathComponent("\(name).png"))
    }
}
