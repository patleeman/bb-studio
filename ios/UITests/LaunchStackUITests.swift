import XCTest

/// TestFlight 20261126.0313 crashed on every launch: building the type
/// metadata of `ThreadView`'s deeply nested view type overflowed the device's
/// 1 MB main-thread stack on the first frame. Simulator builds now link with
/// the same 1 MB (project.yml), so opening a conversation here crashes the
/// same way if a view type grows that deep again. Offline: a Bot
/// conversation pushed over Home, and a worker's thread from Home.
final class LaunchStackUITests: ServerIsolatedUITestCase {
    private let app = XCUIApplication()

    private func launchConversation(_ extra: [String] = []) {
        app.launchArguments = ["-skipPushPrompt", "YES", "-qaBotDemo", "chat", "-qaSpacesDemo", "list", "-qaStrandsDemo",
                               "-qaRoomConversation", "thr_botdemo01"] + extra
        app.launchOffline()
    }

    func testOpensTheConversationOnTheDeviceStack() {
        launchConversation()
        XCTAssertTrue(app.textViews["Message"].waitForExistence(timeout: 30), "the conversation drew its first frame")
        XCTAssertEqual(app.state, .runningForeground, "no stack overflow on launch")
    }

    func testOpensAWorkerThreadOnTheDeviceStack() {
        launchConversation()
        XCTAssertTrue(app.textViews["Message"].waitForExistence(timeout: 30))
        app.goHome()
        let worker = app.buttons["homeWorker-thr_demo_w2"]
        XCTAssertTrue(worker.waitForExistence(timeout: 10))
        worker.tap()
        XCTAssertTrue(app.textViews.firstMatch.waitForExistence(timeout: 20), "a plain thread's header and actions drew")
        XCTAssertEqual(app.state, .runningForeground, "no stack overflow opening a thread")
    }
}
