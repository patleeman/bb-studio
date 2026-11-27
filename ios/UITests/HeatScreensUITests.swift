import XCTest

/// What each screen costs while it sits open, offline, with the energy probe
/// on (`-qaEnergyProbe`). Each test opens one screen, then holds still for
/// `TEST_RUNNER_HEAT_SECONDS` (150 by default) so a sampler outside the
/// simulator can read the app's processor time; the probe logs wakeups and
/// requests by path to stderr and `Documents/energy-probe.txt`. Markers
/// (`<epoch> start|end <screen>`) go to `TEST_RUNNER_HEAT_OUT/markers.txt`.
/// Without `TEST_RUNNER_HEAT_OUT` every test skips: it only measures.
final class HeatScreensUITests: ServerIsolatedUITestCase {
    private let app = XCUIApplication()
    private var out: URL? { ProcessInfo.processInfo.environment["HEAT_OUT"].map { URL(fileURLWithPath: $0) } }
    private var seconds: Double { ProcessInfo.processInfo.environment["HEAT_SECONDS"].flatMap(Double.init) ?? 150 }

    override func setUpWithError() throws {
        try super.setUpWithError()
        try XCTSkipIf(out == nil, "measures only with TEST_RUNNER_HEAT_OUT")
    }

    /// `TEST_RUNNER_HEAT_SERVER`: an isolated staged BB instead of the offline demo (home and conversation only).
    private var server: String? { ProcessInfo.processInfo.environment["HEAT_SERVER"] }

    /// As TestFlight opens: on Home (round 7).
    private func launch(_ extra: [String], variant: String = "list") {
        if let server {
            app.launchArguments = ["-skipPushPrompt", "YES", "-qaEnergyProbe"] + extra
            app.launchStaged(server: server)
            return
        }
        app.launchArguments = ["-skipPushPrompt", "YES", "-qaBotDemo", "chat", "-qaSpacesDemo", variant, "-qaEnergyProbe"] + extra
        app.launchOffline()
    }

    private func any(_ id: String) -> XCUIElement { app.descendants(matching: .any).matching(identifier: id).firstMatch }

    private func mark(_ what: String) {
        guard let out else { return }
        try? FileManager.default.createDirectory(at: out, withIntermediateDirectories: true)
        let line = String(format: "%.0f %@\n", Date().timeIntervalSince1970, what)
        let file = out.appendingPathComponent("markers.txt")
        if let handle = try? FileHandle(forWritingTo: file) {
            handle.seekToEndOfFile()
            handle.write(Data(line.utf8))
            try? handle.close()
        } else {
            try? Data(line.utf8).write(to: file)
        }
    }

    /// Holds still on the screen: nothing touches the app, so after 30 s the energy gate counts it idle.
    private func hold(_ screen: String) {
        sleep(3)
        if let out {
            try? XCUIScreen.main.screenshot().pngRepresentation.write(to: out.appendingPathComponent("\(screen).png"))
        }
        mark("start \(screen)")
        Thread.sleep(forTimeInterval: seconds)
        mark("end \(screen)")
    }

    func test1Home() {
        launch([])
        XCTAssertTrue(any("home").waitForExistence(timeout: 40), "Home")
        hold("home")
    }

    func test2Conversation() {
        launch(["-qaConversation", ProcessInfo.processInfo.environment["HEAT_THREAD"] ?? "thr_botdemo01"])
        XCTAssertTrue(app.textViews["Message"].waitForExistence(timeout: 40), "the conversation")
        hold("conversation")
    }

    func test4DesignPlayer() {
        guard server == nil else { return }
        launch(["-qaConversation", "thr_botdemo01", "-qaDesignDemo"])
        XCTAssertTrue(app.textViews["Message"].waitForExistence(timeout: 40))
        XCUIDevice.shared.system.open(URL(string: "bbstudio://design/dsn_demo")!)
        let screen = app.buttons["designScreen-1b"]
        XCTAssertTrue(screen.waitForExistence(timeout: 20))
        screen.coordinate(withNormalizedOffset: CGVector(dx: 0.15, dy: 0.5)).tap()
        XCTAssertTrue(any("designStill").waitForExistence(timeout: 15), "the design player")
        hold("design")
    }

    func test5PendingApproval() {
        guard server == nil else { return }
        launch(["-qaConversation", "thr_botdemo01"], variant: "needs")
        // No assertion: on a build where a waiting approval hangs the app, nothing ever shows.
        _ = app.textViews["Message"].waitForExistence(timeout: 40)
        hold("approval")
    }
}
