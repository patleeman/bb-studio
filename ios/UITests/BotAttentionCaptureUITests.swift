import XCTest

/// Screenshots of the Bot's attention in the BB status widgets (the app's own
/// needs-you UI went in round 7; the server is a closed local port, so
/// nothing leaves the simulator).
/// Skipped unless `TEST_RUNNER_BBGO_STATES_OUT` names a folder; PNGs land
/// there as `<TEST_RUNNER_BBGO_STATES_TAG><name>.png`.
@MainActor
final class BotAttentionCaptureUITests: ServerIsolatedUITestCase {
    private let app = XCUIApplication()

    override func setUpWithError() throws {
        try super.setUpWithError()
        guard ProcessInfo.processInfo.environment["BBGO_STATES_OUT"] != nil else {
            throw XCTSkip("Set TEST_RUNNER_BBGO_STATES_OUT to a folder")
        }
        continueAfterFailure = false
    }

    /// The BB status widget's view with the Bot's attention (`-qaStateDemo widgets`):
    /// small, medium, large and Lock Screen.
    func testWidgetsPhone() throws {
        guard UIDevice.current.userInterfaceIdiom == .phone else { throw XCTSkip("Phone only") }
        launch(["-qaStateDemo", "widgets"] + widgetState)
        XCTAssertTrue(app.descendants(matching: .any)["widget-systemLarge"].waitForExistence(timeout: 20))
        if widgetState.isEmpty { XCTAssertTrue(text(containing: "Approve deploy to prod").exists) }
        sleep(1)
        shot("widget")
    }

    /// The Bot widget small, medium and large (`-qaStateDemo widgets-bot`).
    func testBotWidgetsPhone() throws {
        guard UIDevice.current.userInterfaceIdiom == .phone else { throw XCTSkip("Phone only") }
        launch(["-qaStateDemo", "widgets-bot"] + widgetState)
        XCTAssertTrue(app.descendants(matching: .any)["widget-bot-systemLarge"].waitForExistence(timeout: 20))
        if widgetState.isEmpty { XCTAssertTrue(text(containing: "Working on").exists) }
        sleep(1)
        shot("widget-bot")
    }

    /// The BB work widget medium and large (`-qaStateDemo widgets-work`).
    func testWorkWidgetsPhone() throws {
        guard UIDevice.current.userInterfaceIdiom == .phone else { throw XCTSkip("Phone only") }
        launch(["-qaStateDemo", "widgets-work"] + widgetState)
        XCTAssertTrue(app.descendants(matching: .any)["widget-work-systemLarge"].waitForExistence(timeout: 20))
        sleep(1)
        shot("widget-work")
    }

    /// All three widgets extra large, on the iPad.
    func testWidgetsExtraLargePad() throws {
        guard UIDevice.current.userInterfaceIdiom == .pad else { throw XCTSkip("iPad only") }
        launch(["-qaStateDemo", "widgets"] + widgetState)
        XCTAssertTrue(app.descendants(matching: .any)["widget-work-systemExtraLarge"].waitForExistence(timeout: 20))
        if widgetState.isEmpty { XCTAssertTrue(text(containing: "Approve deploy to prod").exists) }
        sleep(1)
        shot("widget-xl")
    }

    /// `TEST_RUNNER_BBGO_WIDGET_STATE=empty|placeholder` draws the widgets empty or redacted.
    private var widgetState: [String] {
        ProcessInfo.processInfo.environment["BBGO_WIDGET_STATE"].map { ["-qaWidgetState", $0] } ?? []
    }

    private func launch(_ arguments: [String]) {
        app.launchArguments = ["-skipPushPrompt", "YES"] + arguments
        app.launchOffline()
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
