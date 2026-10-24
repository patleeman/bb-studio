import XCTest

/// Screenshots of the Bot's Needs you group with reasons and Mark handled:
/// an urgent runner report, an approval and a question (`-qaNeedsYou`, on
/// the local `-qaBotDemo` Bot; the server is a closed local port, so nothing
/// leaves the simulator). Skipped unless `TEST_RUNNER_BBGO_STATES_OUT` names a
/// folder; PNGs land there as `<TEST_RUNNER_BBGO_STATES_TAG><name>.png`.
/// `TEST_RUNNER_BBGO_STATES_HOLD=<s>` slows Mark handled and Undo down for
/// `simctl io recordVideo`.
@MainActor
final class NeedsYouCaptureUITests: XCTestCase {
    private let app = XCUIApplication()
    private let runner = "Security · Runner"

    override func setUpWithError() throws {
        guard ProcessInfo.processInfo.environment["BBGO_STATES_OUT"] != nil else {
            throw XCTSkip("Set TEST_RUNNER_BBGO_STATES_OUT to a folder")
        }
        continueAfterFailure = false
    }

    /// The Activity sheet on the phone.
    func testNeedsYouPhone() throws {
        guard UIDevice.current.userInterfaceIdiom == .phone else { throw XCTSkip("Phone only") }
        launchPhone()
        shot("phone")
    }

    /// The same group in the unfolded Duo's sidebar, a 951×669 window on the iPad simulator.
    func testNeedsYouDuo() throws {
        guard UIDevice.current.userInterfaceIdiom == .pad else { throw XCTSkip("iPad only") }
        launch(["-qaBotDemo", "duo", "-qaDuoPhone", "-qaDuoLong", "-qaDuoColdWide", "-qaReduceMotion", "-qaNeedsYou", "-openURL", "bbstudio://bot"])
        XCTAssertTrue(text(containing: runner).waitForExistence(timeout: 30))
        sleep(2)
        shot("duo")
    }

    /// Swipe for Mark handled, mark it, then Undo it.
    func testNeedsYouPhoneMarkHandled() throws {
        guard UIDevice.current.userInterfaceIdiom == .phone else { throw XCTSkip("Phone only") }
        launchPhone()
        pause()
        let row = app.buttons.matching(NSPredicate(format: "label BEGINSWITH %@", runner)).firstMatch
        XCTAssertTrue(row.waitForExistence(timeout: 10))
        row.swipeLeft()
        let mark = app.buttons["Mark handled"]
        XCTAssertTrue(mark.waitForExistence(timeout: 5))
        sleep(1)
        shot("phone-swipe")
        pause()
        mark.tap()
        XCTAssertTrue(text(containing: "Marked handled").waitForExistence(timeout: 5))
        XCTAssertFalse(row.exists)
        shot("phone-marked")
        // Undo is offered for five seconds.
        app.buttons["Undo"].tap()
        XCTAssertTrue(row.waitForExistence(timeout: 10))
        pause()
        shot("phone-undone")
    }

    private func launchPhone() {
        launch(["-qaBotDemo", "chat", "-qaBotSheet", "activity", "-qaNeedsYou", "-qaReduceMotion", "-bot.threads.closed", "earlier"])
        XCTAssertTrue(text(containing: runner).waitForExistence(timeout: 20))
        sleep(1)
        fullHeight()
    }

    /// Drags the sheet's grabber to the top.
    private func fullHeight() {
        let window = app.windows.firstMatch
        window.coordinate(withNormalizedOffset: CGVector(dx: 0.5, dy: 0.485))
            .press(forDuration: 0.1, thenDragTo: window.coordinate(withNormalizedOffset: CGVector(dx: 0.5, dy: 0.05)))
        sleep(2)
    }

    private func pause() {
        if let seconds = ProcessInfo.processInfo.environment["BBGO_STATES_HOLD"].flatMap(UInt32.init) { sleep(seconds) }
    }

    private func launch(_ arguments: [String]) {
        app.launchArguments = ["-skipPushPrompt", "YES", "-serverURL", "http://127.0.0.1:9"] + arguments
        app.launch()
    }

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
