import XCTest

/// Screenshots of the error and in-progress states that are hard to reach by
/// hand: the outbox's save error, a failed Stop, a failed dictation send, a
/// comment reply that didn't send, and the Bot's skills. Everything is local
/// (`-qaBotDemo`, `-qaStateDemo`) and the server is a closed local port, so
/// nothing leaves the simulator. Skipped unless `TEST_RUNNER_BBGO_STATES_OUT`
/// names a folder; PNGs land there as `<TEST_RUNNER_BBGO_STATES_TAG><name>.png`.
@MainActor
final class ErrorStatesCaptureUITests: XCTestCase {
    private let app = XCUIApplication()
    private let unreachable = "Can't reach BB"

    override func setUpWithError() throws {
        guard ProcessInfo.processInfo.environment["BBGO_STATES_OUT"] != nil else {
            throw XCTSkip("Set TEST_RUNNER_BBGO_STATES_OUT to a folder")
        }
        continueAfterFailure = false
    }

    func testOutboxSaveError() {
        launch("-qaBotDemo", "chat", "-qaOutboxUnreadable")
        XCTAssertTrue(text(containing: "queued messages").waitForExistence(timeout: 20))
        shot("outbox-save-error")
    }

    func testStopFailure() {
        launch("-qaBotDemo", "working")
        let stop = app.buttons["Stop Juniper"]
        XCTAssertTrue(stop.waitForExistence(timeout: 20))
        shot("stop-running")
        stop.tap()
        XCTAssertTrue(text(containing: unreachable).waitForExistence(timeout: 40))
        shot("stop-failed")
    }

    func testDictationSendFailure() {
        launch("-qaStateDemo", "dictation")
        let send = app.buttons.matching(NSPredicate(format: "label CONTAINS 'Send to thread'")).firstMatch
        XCTAssertTrue(send.waitForExistence(timeout: 20))
        shot("dictation-review")
        send.tap()
        XCTAssertTrue(text(containing: unreachable).waitForExistence(timeout: 40))
        shot("dictation-send-failed")
    }

    func testCommentReplyFailure() {
        launch("-qaStateDemo", "related")
        XCTAssertTrue(text(containing: "Can we move the launch review").waitForExistence(timeout: 20))
        shot("related-comments")
        app.buttons.matching(NSPredicate(format: "label == 'Reply'")).element(boundBy: 2).tap()
        let field = app.descendants(matching: .any).matching(NSPredicate(format: "placeholderValue BEGINSWITH 'Reply'")).firstMatch
        XCTAssertTrue(field.waitForExistence(timeout: 5))
        field.tap()
        field.typeText("Updated the tiers on the pricing page.")
        shot("related-reply-draft")
        app.buttons.matching(NSPredicate(format: "label == 'Send' OR label == 'Send Reply'")).firstMatch.tap()
        XCTAssertTrue(text(containing: unreachable).waitForExistence(timeout: 40))
        shot("related-reply-failed")
    }

    func testBotSkills() {
        launch("-qaBotDemo", "chat", "-qaBotSheet", "skills")
        XCTAssertTrue(text(containing: "weekly-digest").waitForExistence(timeout: 20))
        sleep(1)
        shot("bot-skills")
    }

    /// The Bot's Running, Runners and Recurring rows on the phone. Set
    /// `TEST_RUNNER_BBGO_STATES_MOTION=reduced` for the Reduce Motion look and
    /// `TEST_RUNNER_BBGO_STATES_HOLD=<s>` to keep it on screen for a recording.
    func testBotRowsPhone() throws {
        guard UIDevice.current.userInterfaceIdiom == .phone else { throw XCTSkip("Phone only") }
        // A running ring never lets the app idle, so nothing here scrolls:
        // the second launch closes the top groups to bring Runners up.
        for (name, closed) in [("bot-rows-phone", "earlier"), ("bot-rows-phone-runners", "earlier,needs,running")] {
            launch(["-qaBotDemo", "chat", "-qaBotSheet", "activity", "-bot.threads.closed", closed] + motion)
            let runners = app.staticTexts["Runners"]
            XCTAssertTrue(runners.waitForExistence(timeout: 20))
            sleep(1)
            fullHeight()
            shot(name + suffix)
            app.terminate()
        }
        if ProcessInfo.processInfo.environment["BBGO_STATES_HOLD"] != nil {
            launch(["-qaBotDemo", "chat", "-qaBotSheet", "activity", "-bot.threads.closed", "earlier"] + motion)
            XCTAssertTrue(app.staticTexts["Runners"].waitForExistence(timeout: 20))
            sleep(1)
            fullHeight()
            hold()
        }
    }

    /// The same rows in the unfolded Duo's sidebar, a 951×669 window on the iPad simulator.
    func testBotRowsDuo() throws {
        guard UIDevice.current.userInterfaceIdiom == .pad else { throw XCTSkip("iPad only") }
        launch(["-qaBotDemo", "duo", "-qaDuoPhone", "-qaDuoLong", "-qaDuoColdWide", "-openURL", "bbstudio://bot"] + motion)
        XCTAssertTrue(text(containing: "Lisbon offsite options").waitForExistence(timeout: 30))
        sleep(2)
        shot("bot-rows-duo" + suffix)
        let origin = app.windows.firstMatch.coordinate(withNormalizedOffset: .zero)
        origin.withOffset(CGVector(dx: 250, dy: 600)).press(forDuration: 0.05, thenDragTo: origin.withOffset(CGVector(dx: 250, dy: 240)))
        XCTAssertTrue(text(containing: "Metrics digest").waitForExistence(timeout: 10))
        sleep(1)
        shot("bot-rows-duo-runners" + suffix)
        hold()
    }

    /// Drags the sheet's grabber to the top.
    private func fullHeight() {
        let window = app.windows.firstMatch
        window.coordinate(withNormalizedOffset: CGVector(dx: 0.5, dy: 0.485))
            .press(forDuration: 0.1, thenDragTo: window.coordinate(withNormalizedOffset: CGVector(dx: 0.5, dy: 0.05)))
        sleep(2)
    }

    private var motion: [String] { ProcessInfo.processInfo.environment["BBGO_STATES_MOTION"] == "reduced" ? ["-qaReduceMotion"] : [] }
    private var suffix: String { motion.isEmpty ? "" : "-reduced-motion" }
    private func hold() {
        if let seconds = ProcessInfo.processInfo.environment["BBGO_STATES_HOLD"].flatMap(UInt32.init) { sleep(seconds) }
    }

    private func launch(_ arguments: [String]) {
        app.launchArguments = ["-skipPushPrompt", "YES", "-serverURL", "http://127.0.0.1:9"] + arguments
        app.launch()
    }

    private func launch(_ arguments: String...) { launch(arguments) }

    private func text(containing value: String) -> XCUIElement {
        app.descendants(matching: .any).matching(NSPredicate(format: "label CONTAINS %@", value)).firstMatch
    }

    private func shot(_ name: String) {
        sleep(1)
        let env = ProcessInfo.processInfo.environment
        let folder = URL(fileURLWithPath: env["BBGO_STATES_OUT"]!)
        try? FileManager.default.createDirectory(at: folder, withIntermediateDirectories: true)
        let data = XCUIScreen.main.screenshot().pngRepresentation
        try? data.write(to: folder.appendingPathComponent("\(env["BBGO_STATES_TAG"] ?? "")\(name).png"))
    }
}
