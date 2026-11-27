import XCTest

/// Round 2 on the phone, offline (`-qaSpacesDemo list
/// -qaBotDemo chat`; the demo has three Bots: Juniper on Opus 5.5, Home on
/// Auto, Research with no default model). New conversation says who it is
/// with and lets you pick another Bot or none, the project, the workspace and
/// the model, defaulting as the desktop does; the list has a "+ New
/// conversation" button in Home's bar and a Bot switcher on the Bot's name.
/// `TEST_RUNNER_ROUND2_OUT` keeps PNGs;
/// `TEST_RUNNER_ROUND2_DUO` runs the Duo tests.
final class NewConversationUITests: ServerIsolatedUITestCase {
    private let app = XCUIApplication()
    private var duo: Bool { ProcessInfo.processInfo.environment["ROUND2_DUO"] != nil }

    private func launch(_ extra: [String] = []) {
        app.launchArguments = ["-skipPushPrompt", "YES", "-qaBotDemo", "chat", "-qaSpacesDemo", "list",
                               "-qaConversation", "thr_botdemo01"] + extra
        app.launchOffline()
        XCTAssertTrue(app.textViews["Message"].waitForExistence(timeout: 30), "the conversation")
    }

    private func any(_ id: String) -> XCUIElement { app.descendants(matching: .any).matching(NSPredicate(format: "identifier == %@", id)).firstMatch }

    private func waitFor(_ element: XCUIElement, label contains: String, timeout: TimeInterval = 15) -> Bool {
        let expectation = XCTNSPredicateExpectation(predicate: NSPredicate(format: "label CONTAINS %@", contains), object: element)
        return XCTWaiter.wait(for: [expectation], timeout: timeout) == .completed
    }

    private func openNewConversation() {
        app.goHome()
        // New: in Home's bar.
        let row = app.homeNew
        XCTAssertTrue(row.waitForExistence(timeout: 10), "New conversation")
        shot("1-list")
        row.tap()
        XCTAssertTrue(any("newConversationWith").waitForExistence(timeout: 10), "the New conversation sheet")
    }

    /// The phone's, and the folded Duo's (the main device) too.
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
        app.goHome()
        let started = app.buttons["homeConversation-thr_demo_new1"]
        XCTAssertTrue(started.waitForExistence(timeout: 15), "it's Juniper's conversation")
    }

    func testANewConversationWithAnotherBotStartsOnItsAuto() throws {
        try XCTSkipIf(duo, "the phone's test")
        launch()
        openNewConversation()
        app.buttons["newConversationBot"].tap()
        // The Bot named Home, not Home's pane toggle (round 5).
        let home = app.buttons.matching(NSPredicate(format: "label == 'Home' AND identifier != 'homePane'")).firstMatch
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
        app.goHome()
        XCTAssertTrue(waitFor(app.buttons["botSwitcher"], label: "Home"), "the list is Home's now")
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
        app.goHome()
        let switcher = app.buttons["botSwitcher"]
        XCTAssertTrue(switcher.waitForExistence(timeout: 10), "the Bot's name is a menu")
        switcher.tap()
        let research = app.buttons["Research"]
        XCTAssertTrue(research.waitForExistence(timeout: 5), "with every Bot")
        shot("7-switcher")
        research.tap()
        // Another Bot opens on its Home.
        XCTAssertTrue(waitFor(app.buttons["botSwitcher"], label: "Research"), "Research's list")
        shot("8-research")
    }

    func testTheFlatDuoSwitchesBotsAndStartsConversationsFromHomesColumn() throws {
        try XCTSkipUnless(duo, "needs the iPhone Duo simulator")
        launch(["-qaPosture", "flat"])
        XCUIDevice.shared.system.open(URL(string: "bbstudio://qa-duo/landscape")!)
        sleep(3)
        XCTAssertTrue(any("homeColumn").waitForExistence(timeout: 15), "Home's column on the left screen")
        XCTAssertTrue(app.buttons["botSwitcher"].exists, "with the Bot switcher")
        shot("10-duo")
        XCUIDevice.shared.system.open(URL(string: "bbstudio://qa-duo/activate?homeNew")!)
        XCTAssertTrue(waitFor(any("newConversationWith"), label: "Juniper"), "New conversation with Juniper, from Home's bar")
        app.buttons["Cancel"].tap()
        app.buttons["botSwitcher"].tap()
        let home = app.buttons["Home"]
        XCTAssertTrue(home.waitForExistence(timeout: 5))
        home.tap()
        XCTAssertTrue(waitFor(app.buttons["botSwitcher"], label: "Home"), "Home's column is Home's")
        XCUIDevice.shared.system.open(URL(string: "bbstudio://qa-duo/outer")!)
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
