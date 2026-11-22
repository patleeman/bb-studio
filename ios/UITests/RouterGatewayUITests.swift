import XCTest

/// Slice 5, offline (`-qaSpacesDemo list -qaBotDemo chat
/// -qaRouterDemo`; `BotSpacesDemo.State` answers `router.notice.get`,
/// `router.handoff`, `router.notice.dismiss` and `toolGateway.overview`): the
/// usage-limit notice above the composer with Hand off, and the Tool Gateway,
/// view-only, in Settings. `TEST_RUNNER_ROUTER_OUT` keeps PNGs.
final class RouterGatewayUITests: ServerIsolatedUITestCase {
    private let app = XCUIApplication()

    private func launch() {
        app.launchArguments = ["-skipPushPrompt", "YES", "-qaBotDemo", "chat", "-qaSpacesDemo", "list", "-qaRouterDemo",
                               "-qaRoomConversation", "thr_botdemo01"]
        app.launchOffline()
        XCTAssertTrue(app.textViews["Message"].waitForExistence(timeout: 30))
    }

    private func any(_ id: String) -> XCUIElement { app.descendants(matching: .any)[id].firstMatch }

    func testTheUsageLimitNoticeHandsOff() {
        launch()
        let notice = any("routerNotice")
        XCTAssertTrue(notice.waitForExistence(timeout: 20), "the router's notice above the composer")
        let handOff = app.buttons["routerHandOff"]
        XCTAssertTrue(handOff.exists)
        XCTAssertTrue(handOff.label.contains("GPT-5.2"), handOff.label)
        shot("1-notice")
        handOff.tap()
        let moved = XCTNSPredicateExpectation(predicate: NSPredicate(format: "NOT (label BEGINSWITH 'Conversation 1 of')"), object: any("conversationPageDots"))
        XCTAssertEqual(XCTWaiter.wait(for: [moved], timeout: 10), .completed, "it opens the thread that continues")
    }

    func testTheToolGatewayIsViewOnly() {
        launch()
        app.buttons["roomList"].tap()
        app.swipeUp()
        let settings = app.buttons["roomSettings"]
        XCTAssertTrue(settings.waitForExistence(timeout: 10))
        settings.tap()
        let gateway = app.buttons["settingsToolGateway"]
        XCTAssertTrue(gateway.waitForExistence(timeout: 15))
        gateway.tap()
        XCTAssertTrue(any("gatewayServer").waitForExistence(timeout: 10), "its servers")
        XCTAssertTrue(any("gatewayRequest").exists, "and what waits for approval")
        XCTAssertTrue(app.staticTexts["Approve or decline on the desktop."].exists, "view-only")
        shot("2-gateway")
    }

    private func shot(_ name: String) {
        guard let folder = ProcessInfo.processInfo.environment["ROUTER_OUT"] else { return }
        sleep(1)
        let url = URL(fileURLWithPath: folder)
        try? FileManager.default.createDirectory(at: url, withIntermediateDirectories: true)
        try? XCUIScreen.main.screenshot().pngRepresentation.write(to: url.appendingPathComponent("\(name).png"))
    }
}
