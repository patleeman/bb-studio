import XCTest

/// Round 2 on the phone, offline (`-qaSpacesDemo list
/// -qaBotDemo chat`; the demo has three Bots: Juniper on Opus 5.5, Home on
/// Auto, Research with no default model). New conversation says who it is
/// with and lets you pick another Bot or none, the project, the workspace and
/// the model, defaulting as the desktop does; the list has a "+ New
/// conversation" row and a Bot switcher on the Bot's name; the folded Duo's
/// ↓ is one of the rail's round buttons. `TEST_RUNNER_ROUND2_OUT` keeps PNGs;
/// `TEST_RUNNER_ROUND2_DUO` runs the Duo tests.
final class NewConversationUITests: ServerIsolatedUITestCase {
    private let app = XCUIApplication()
    private var duo: Bool { ProcessInfo.processInfo.environment["ROUND2_DUO"] != nil }

    private func launch() {
        app.launchArguments = ["-skipPushPrompt", "YES", "-qaBotDemo", "chat", "-qaSpacesDemo", "list",
                               "-qaRoomConversation", "thr_botdemo01"]
        app.launchOffline()
        XCTAssertTrue(app.textViews["Message"].waitForExistence(timeout: 30), "the conversation")
    }

    private func any(_ id: String) -> XCUIElement { app.descendants(matching: .any)[id].firstMatch }

    private func waitFor(_ element: XCUIElement, label contains: String, timeout: TimeInterval = 15) -> Bool {
        let expectation = XCTNSPredicateExpectation(predicate: NSPredicate(format: "label CONTAINS %@", contains), object: element)
        return XCTWaiter.wait(for: [expectation], timeout: timeout) == .completed
    }

    private func openNewConversation() {
        app.buttons["roomList"].tap()
        // Round 5: Home's composer is the one way in (no "+ New conversation" row).
        let row = app.buttons["roomNewConversation"]
        XCTAssertTrue(row.waitForExistence(timeout: 10), "Home's composer")
        shot("1-list")
        row.tap()
        XCTAssertTrue(any("newConversationWith").waitForExistence(timeout: 10), "the New conversation sheet")
    }

    /// The phone's, and the folded Duo's (Patrick's) too.
    func testNewConversationSaysWhoItIsWithAndStartsOnThePickedModel() throws {
        launch()
        openNewConversation()
        XCTAssertEqual(any("newConversationWith").label, "New conversation with Juniper", "it says who it's with")
        XCTAssertTrue(app.buttons["newConversationBot"].exists, "the Bot can be changed")
        XCTAssertTrue(app.buttons["newThreadProject"].exists, "the project")
        XCTAssertTrue(app.buttons["newThreadWorkspace"].exists, "the workspace")
        let agent = app.buttons["newThreadAgent"]
        XCTAssertTrue(waitFor(agent, label: "Opus 5.5"), "Juniper's default model: \(agent.label)")
        shot("2-new-juniper")

        agent.tap()
        let provider = app.buttons["Provider"]
        XCTAssertTrue(provider.waitForExistence(timeout: 5), "the provider picker")
        XCTAssertTrue(app.buttons["Model"].exists && app.buttons["Reasoning"].exists && app.buttons["Permissions"].exists,
                      "model, reasoning and permissions")
        shot("3-model-menu")
        provider.tap()
        XCTAssertTrue(app.buttons["Auto"].waitForExistence(timeout: 5), "Auto, the model router, is a choice")
        app.buttons["Codex"].tap()
        XCTAssertTrue(waitFor(agent, label: "GPT-5.2"), "Codex's model: \(agent.label)")

        type("Plan the Lisbon dinner", in: "Message Juniper")
        app.buttons["newConversationStart"].tap()
        XCTAssertTrue(app.staticTexts["Plan the Lisbon dinner"].waitForExistence(timeout: 15), "the new conversation opens")
        app.buttons["roomList"].tap()
        let started = app.buttons["roomConversation-thr_demo_new1"]
        XCTAssertTrue(started.waitForExistence(timeout: 15), "it's Juniper's conversation")
    }

    func testANewConversationWithAnotherBotStartsOnItsAuto() throws {
        try XCTSkipIf(duo, "the phone's test")
        launch()
        openNewConversation()
        app.buttons["newConversationBot"].tap()
        // The Bot named Home, not the header's Home button (round 5).
        let home = app.buttons.matching(NSPredicate(format: "label == 'Home' AND identifier != 'roomList'")).firstMatch
        XCTAssertTrue(home.waitForExistence(timeout: 5), "every Bot, to pick from")
        XCTAssertTrue(app.buttons["No Bot: a thread in a project"].exists, "or a plain thread")
        shot("4-bots")
        home.tap()
        XCTAssertTrue(waitFor(any("newConversationWith"), label: "Home"), "it says Home now")
        XCTAssertTrue(waitFor(app.buttons["newThreadAgent"], label: "Auto"), "Home's default is Auto: \(app.buttons["newThreadAgent"].label)")
        shot("5-new-home-auto")
        type("Water the plants on Friday", in: "Message Home")
        app.buttons["newConversationStart"].tap()
        XCTAssertTrue(app.staticTexts["Water the plants on Friday"].waitForExistence(timeout: 15), "it opens, in Home")
        app.buttons["roomList"].tap()
        XCTAssertTrue(waitFor(any("roomListHeader"), label: "Home"), "the list is Home's now")
    }

    func testNoBotStartsAPlainThread() throws {
        try XCTSkipIf(duo, "the phone's test")
        launch()
        openNewConversation()
        app.buttons["newConversationBot"].tap()
        let none = app.buttons["No Bot: a thread in a project"]
        XCTAssertTrue(none.waitForExistence(timeout: 5))
        none.tap()
        XCTAssertTrue(app.navigationBars["New thread"].waitForExistence(timeout: 5), "a plain thread")
        XCTAssertTrue(waitFor(app.buttons["newConversationBot"], label: "no Bot"))
        app.buttons["newThreadProject"].tap()
        XCTAssertTrue(app.buttons["BB Studio"].waitForExistence(timeout: 5), "in any project")
        app.buttons["BB Studio"].tap()
        XCTAssertTrue(waitFor(app.buttons["newThreadProject"], label: "BB Studio"))
        shot("6-plain-thread")
    }

    func testTheBotsNameSwitchesBots() throws {
        try XCTSkipIf(duo, "the phone's test")
        launch()
        app.buttons["roomList"].tap()
        let switcher = app.buttons["botSwitcher"]
        XCTAssertTrue(switcher.waitForExistence(timeout: 10), "the Bot's name is a menu")
        switcher.tap()
        let research = app.buttons["Research"]
        XCTAssertTrue(research.waitForExistence(timeout: 5), "with every Bot")
        shot("7-switcher")
        research.tap()
        XCTAssertTrue(any("RoomSheet-conversations").waitForNonExistence(timeout: 10), "the list closes")
        XCTAssertTrue(app.textViews["Message"].waitForExistence(timeout: 20), "on Research's conversation")
        app.buttons["roomList"].tap()
        XCTAssertTrue(waitFor(any("roomListHeader"), label: "Research"), "Research's list")
        shot("8-research")
    }

    func testTheFoldedDuosJumpButtonIsOnTheRail() throws {
        try XCTSkipUnless(duo, "needs the iPhone Duo simulator")
        launch()
        let list = app.buttons["roomList"]
        XCTAssertTrue(list.waitForExistence(timeout: 10))
        let window = app.windows.firstMatch.frame
        let start = app.coordinate(withNormalizedOffset: .zero).withOffset(CGVector(dx: window.width * 0.4, dy: window.height * 0.25))
        let jump = app.buttons["jumpToLatest"]
        for _ in 0..<6 where !jump.exists {
            start.press(forDuration: 0.05, thenDragTo: start.withOffset(CGVector(dx: 0, dy: window.height * 0.3)), withVelocity: .slow, thenHoldForDuration: 0.2)
            sleep(1)
        }
        XCTAssertTrue(jump.waitForExistence(timeout: 5), "reading up shows the ↓")
        let composer = any("threadComposer").frame
        XCTAssertEqual(jump.frame.midX, list.frame.midX, accuracy: 2, "the ↓ is on the rail, under the list button")
        XCTAssertGreaterThan(jump.frame.minY, list.frame.maxY, "below the rail's other buttons")
        XCTAssertEqual(jump.frame.intersection(composer).width, 0, "and never over the composer")
        XCTAssertLessThan(composer.maxX, jump.frame.minX, "the composer ends before the rail")
        shot("9-duo-rail")
        XCUIDevice.shared.system.open(URL(string: "bbstudio://qa-duo/capture?round2-rail")!)
        sleep(3)
        jump.tap()
        XCTAssertTrue(jump.waitForNonExistence(timeout: 10), "it jumps to the end")
    }

    func testTheUnfoldedDuoSwitchesBotsAndStartsConversationsOnTheLeft() throws {
        try XCTSkipUnless(duo, "needs the iPhone Duo simulator")
        launch()
        XCUIDevice.shared.system.open(URL(string: "bbstudio://qa-duo/landscape")!)
        sleep(3)
        XCTAssertTrue(any("roomContext").waitForExistence(timeout: 15), "the left screen")
        XCTAssertTrue(app.buttons["contextNewConversation"].waitForExistence(timeout: 10), "+ New conversation on the left")
        XCTAssertTrue(app.buttons["botSwitcher"].exists, "and the Bot switcher")
        shot("10-duo")
        XCUIDevice.shared.system.open(URL(string: "bbstudio://qa-duo/capture?round2-duo")!)
        sleep(3)
        app.buttons["contextNewConversation"].tap()
        XCTAssertTrue(waitFor(any("newConversationWith"), label: "Juniper"), "New conversation with Juniper")
        app.buttons["Cancel"].tap()
        app.buttons["botSwitcher"].tap()
        let home = app.buttons["Home"]
        XCTAssertTrue(home.waitForExistence(timeout: 5))
        home.tap()
        XCTAssertTrue(waitFor(any("roomListHeader"), label: "Home"), "the left screen is Home's")
    }

    /// The sheet's field (its placeholder names the Bot), not the conversation's under it.
    private func type(_ text: String, in field: String) {
        let tip = app.buttons["Continue"]
        if tip.exists { tip.tap() }
        let input = app.textViews[field]
        XCTAssertTrue(input.waitForExistence(timeout: 5), field)
        input.tap()
        if tip.waitForExistence(timeout: 1) { tip.tap() }
        input.typeText(text)
    }

    private func shot(_ name: String) {
        guard let folder = ProcessInfo.processInfo.environment["ROUND2_OUT"] else { return }
        sleep(1)
        let url = URL(fileURLWithPath: folder)
        try? FileManager.default.createDirectory(at: url, withIntermediateDirectories: true)
        try? XCUIScreen.main.screenshot().pngRepresentation.write(to: url.appendingPathComponent("\(duo ? "duo-" : "")\(name).png"))
    }
}
