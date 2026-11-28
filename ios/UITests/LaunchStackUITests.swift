import XCTest

/// TestFlight 20261126.0313 crashed on every launch: building the type
/// metadata of `ThreadView`'s deeply nested view type overflowed the device's
/// 1 MB main-thread stack on the first frame. Simulator builds now link with
/// the same 1 MB (project.yml), so opening a conversation here crashes the
/// same way if a view type grows that deep again.
///
/// The staged tests use only what ships: deep links to a staged BB's Bot
/// and one of its threads, so they run on a Release build too
/// (scripts/test-release-launch.sh), where the crash was. Offline, a Release
/// build has nothing to open: it waits on its server. The demo tests open the
/// Debug demo's Bot conversation over Home, and a worker's thread from Home.
final class LaunchStackUITests: ServerIsolatedUITestCase {
    private let app = XCUIApplication()
    /// scripts/test-release-launch.sh: the app is a Release build, without the `-qa…` demos.
    private var releaseBuild: Bool { ProcessInfo.processInfo.environment["BB_RELEASE_BUILD"] == "1" }

    func testOpensTheStagedBotOnTheDeviceStack() throws {
        try openStaged("bbstudio://bot")
    }

    func testOpensAStagedThreadOnTheDeviceStack() throws {
        try requireQAServer()
        let thread = try XCTUnwrap(ProcessInfo.processInfo.environment["BBGO_QA_THREAD"], "the staged thread (scripts/test-staged.sh)")
        try openStaged("bbstudio://reply/" + thread)
    }

    /// Without a staged BB (a Debug run of the offline suites) these skip;
    /// a Release run always has one.
    private func openStaged(_ link: String) throws {
        if releaseBuild { XCTAssertNotNil(ProcessInfo.processInfo.environment["BBGO_QA_SERVER"], "a Release run needs its staged BB") }
        try requireQAServer()
        app.launchArguments = ["-skipPushPrompt", "YES", "-openURL", link]
        app.launchStaged(server: qaServer)
        XCTAssertTrue(app.otherElements["threadComposer"].firstMatch.waitForExistence(timeout: 30),
                      "\(link): the conversation drew its first frame")
        XCTAssertEqual(app.state, .runningForeground, "\(link): no stack overflow on launch")
    }

    private func launchDemoConversation() throws {
        try XCTSkipIf(releaseBuild, "the Bot demo is Debug-only")
        app.launchArguments = ["-skipPushPrompt", "YES", "-qaBotDemo", "chat", "-qaSpacesDemo", "list", "-qaStrandsDemo",
                               "-qaConversation", "thr_botdemo01"]
        app.launchOffline()
    }

    func testOpensTheConversationOnTheDeviceStack() throws {
        try launchDemoConversation()
        XCTAssertTrue(app.textViews["Message"].waitForExistence(timeout: 30), "the conversation drew its first frame")
        XCTAssertEqual(app.state, .runningForeground, "no stack overflow on launch")
    }

    func testOpensAWorkerThreadOnTheDeviceStack() throws {
        try launchDemoConversation()
        XCTAssertTrue(app.textViews["Message"].waitForExistence(timeout: 30))
        app.goHome()
        let worker = app.buttons["homeWorker-thr_demo_w2"]
        XCTAssertTrue(worker.waitForExistence(timeout: 10))
        worker.tap()
        XCTAssertTrue(app.textViews.firstMatch.waitForExistence(timeout: 20), "a plain thread's header and actions drew")
        XCTAssertEqual(app.state, .runningForeground, "no stack overflow opening a thread")
    }
}
