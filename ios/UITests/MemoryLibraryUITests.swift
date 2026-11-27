import XCTest

/// Memory (Core | Skills | History) and the Library as full pages, offline on
/// the demo Bot (`MemoryDemo` answers Memory's RPCs, `BotSpacesDemo.State`
/// the Library's). `TEST_RUNNER_MEMLIB_OUT` keeps PNGs.
final class MemoryLibraryUITests: ServerIsolatedUITestCase {
    private let app = XCUIApplication()

    /// A screen's control, in its bar.
    private func control(_ id: String) -> XCUIElement {
        app.buttons.matching(NSPredicate(format: "identifier IN %@", [id, "screenAction-" + id])).firstMatch
    }

    private func launch(_ extra: [String] = []) {
        app.launchArguments += ["-skipPushPrompt", "YES", "-qaBotDemo", "chat", "-qaSpacesDemo", "list"] + extra
        app.launchOffline()
        XCTAssertTrue(any("home").waitForExistence(timeout: 30), "the app opens on Home")
    }

    private func any(_ id: String) -> XCUIElement { app.descendants(matching: .any)[id].firstMatch }

    private func text(_ contains: String) -> XCUIElement {
        app.staticTexts.matching(NSPredicate(format: "label CONTAINS %@", contains)).firstMatch
    }

    /// A place's tab (Memory and Library are tabs).
    private func open(_ place: String, shows id: String) {
        app.openRoomPlace(place)
        XCTAssertTrue(any(id).waitForExistence(timeout: 15), place)
    }

    /// Search, in Memory's bar.
    private var searchButton: XCUIElement { app.buttons["memorySearch"].firstMatch }

    private func openMemory() {
        open("memory", shows: "memory-page")
        XCTAssertTrue(any("memoryBudget").waitForExistence(timeout: 15), "Core first, with its budget")
    }

    private func layer(_ name: String) {
        let button = app.segmentedControls["memoryLayer"].buttons[name]
        XCTAssertTrue(button.waitForExistence(timeout: 10), "the \(name) layer")
        button.tap()
    }

    private func field(_ id: String) -> XCUIElement {
        app.textFields[id].exists ? app.textFields[id] : app.textViews[id]
    }

    /// Edits one Core section and saves it.
    private func editSection(_ heading: String, add line: String) {
        let section = any("memorySection-\(heading)")
        XCTAssertTrue(section.waitForExistence(timeout: 10), heading)
        section.buttons["memorySectionEdit"].tap()
        let input = field("memorySectionInput")
        XCTAssertTrue(input.waitForExistence(timeout: 10), "the section opens in an editor in place")
        input.coordinate(withNormalizedOffset: CGVector(dx: 0.95, dy: 0.95)).tap()
        input.typeText("\n" + line)
        app.buttons["memorySectionSave"].tap()
    }

    func testCoreEditsASectionInPlace() {
        launch()
        openMemory()
        XCTAssertTrue(text("/ 2,000 chars").exists, "the shared budget")
        XCTAssertTrue(any("memorySection-Right now").exists && any("memorySection-Check-in").exists, "the three sections")
        XCTAssertTrue(text("/ 25 lines").exists, "Preferences' line cap")
        shot("core")
        editSection("Preferences", add: "- Plain dates.")
        XCTAssertTrue(app.buttons["memorySectionSave"].waitForNonExistence(timeout: 10), "saved, the editor closes")
        XCTAssertTrue(text("Plain dates.").waitForExistence(timeout: 10), "the new line shows")
        XCTAssertTrue(text("4 / 25 lines").exists, "and counts")
        shot("core-saved")
    }

    func testCoreNeverOverwritesTheBotsEditToTheSameSection() {
        launch(["-qaMemoryBotEdit", "Right now"])
        openMemory()
        editSection("Right now", add: "- Mine.")
        XCTAssertTrue(any("memoryConflict").waitForExistence(timeout: 10), "the Bot changed it meanwhile: a conflict, nothing saved")
        XCTAssertTrue(any("memoryConflict").label.contains("Kitchen quotes"), "with the Bot's newer text")
        shot("core-conflict")
        // The folded Duo's keyboard covers it: scroll it up into view.
        let replace = app.buttons["memorySectionSave"]
        for _ in 0..<3 where !replace.isHittable { app.collectionViews.firstMatch.swipeUp() }
        replace.tap()
        XCTAssertTrue(app.buttons["memorySectionSave"].waitForNonExistence(timeout: 10), "Replace saves yours")
        XCTAssertTrue(text("Mine.").waitForExistence(timeout: 10))
    }

    func testCoreKeepsTheBotsEditToAnotherSection() {
        launch(["-qaMemoryBotEdit", "Check-in"])
        openMemory()
        editSection("Preferences", add: "- Plain dates.")
        XCTAssertTrue(app.buttons["memorySectionSave"].waitForNonExistence(timeout: 10), "saved without a conflict")
        XCTAssertTrue(text("Plain dates.").waitForExistence(timeout: 10), "your line")
        XCTAssertTrue(text("Kitchen quotes").waitForExistence(timeout: 10), "and the Bot's, in Check-in")
    }

    func testSkillsOpenEditAndAutoLearn() {
        launch()
        openMemory()
        layer("Skills")
        let toggle = app.switches["memoryAutoLearn"]
        XCTAssertTrue(toggle.waitForExistence(timeout: 15), "Auto-learn on top")
        XCTAssertTrue(text("Daily + on archive").exists)
        XCTAssertEqual(toggle.value as? String, "1")
        XCTAssertTrue(app.buttons["memorySkill-weekly-review"].exists, "the skills")
        XCTAssertFalse(app.buttons["memorySkill-core-profile"].exists, "the always-on skill is Core's")
        shot("skills")
        toggle.switches.firstMatch.tap()
        XCTAssertTrue(toggle.waitForValue("0"), "Auto-learn off")
        XCTAssertFalse(app.buttons["memoryAutoLearnRun"].isEnabled, "Run now needs Auto-learn")
        toggle.switches.firstMatch.tap()
        XCTAssertTrue(toggle.waitForValue("1"), "on again")
        app.buttons["memoryAutoLearnRun"].tap()
        XCTAssertTrue(text("No new skills").waitForExistence(timeout: 10), "Run now reports")

        app.buttons["memorySkill-weekly-review"].tap()
        XCTAssertTrue(any("skillBody").waitForExistence(timeout: 10), "the skill opens pushed")
        XCTAssertTrue(any("skillBody").label.contains("Weekly review"))
        XCTAssertTrue(any("skillVersion-2").exists, "with its versions")
        // Every posture: the skill's own native bar, with Back and Edit.
        XCTAssertTrue(app.backButton.exists && control("skillEdit").exists, "Back and Edit in the skill's bar")
        shot("skill")
        control("skillEdit").tap()
        let body = field("skillBodyField")
        XCTAssertTrue(body.waitForExistence(timeout: 10))
        body.tap()
        body.coordinate(withNormalizedOffset: CGVector(dx: 0.95, dy: 0.95)).tap()
        body.typeText("\n4. Share the page.")
        control("skillSave").tap()
        XCTAssertTrue(any("skillBody").waitForExistence(timeout: 10))
        XCTAssertTrue(text("Share the page.").waitForExistence(timeout: 10), "the edit saved")
        app.goBack()

        app.buttons["memorySkillNew"].tap()
        let name = app.textFields["newSkillName"]
        XCTAssertTrue(name.waitForExistence(timeout: 10))
        name.tap()
        name.typeText("garden-log")
        field("newSkillDescription").tap()
        field("newSkillDescription").typeText("Records planting by bed.")
        field("newSkillBody").tap()
        field("newSkillBody").typeText("1. Note the bed and the date.")
        control("newSkillSave").tap()
        XCTAssertTrue(app.buttons["memorySkill-garden-log"].waitForExistence(timeout: 10), "the new skill is listed")
    }

    func testHistorySearchesSummariesAndConversations() {
        launch()
        openMemory()
        layer("History")
        XCTAssertTrue(app.buttons["memorySummary-thr_demo_lisbon"].waitForExistence(timeout: 15), "the archived conversation's summary")
        XCTAssertTrue(text("Decisions").exists, "in its sections")
        shot("history")
        let search = app.textFields["memoryHistorySearch"]
        search.tap()
        search.typeText("taxes")
        XCTAssertTrue(app.buttons["memorySummary-thr_demo_lisbon"].waitForNonExistence(timeout: 10), "no summary matches")
        app.buttons["Clear search"].firstMatch.tap()
        app.buttons["chip-Past conversations"].tap()
        XCTAssertTrue(app.buttons["memoryConversation-thr_demo_interview"].waitForExistence(timeout: 10), "every conversation")
        search.tap()
        search.typeText("question bank")
        XCTAssertTrue(app.buttons["memoryConversation-thr_demo_interview"].waitForExistence(timeout: 10), "full-text: a match in its messages")
        XCTAssertFalse(app.buttons["memoryConversation-thr_demo_lisbon"].exists, "others drop out")
        shot("history-search")
        app.buttons["memoryConversation-thr_demo_interview"].tap()
        XCTAssertTrue(app.textViews["Message"].waitForExistence(timeout: 15), "tapping opens the conversation")
    }

    func testSearchAcrossMemory() {
        launch()
        openMemory()
        searchButton.tap()
        let field = app.textFields["memorySearchField"]
        XCTAssertTrue(field.waitForExistence(timeout: 10))
        field.typeText("review")
        XCTAssertTrue(app.buttons["memorySkill-weekly-review"].waitForExistence(timeout: 10), "a skill")
        shot("search")
    }

    func testLibraryFiltersByKindAndOpensAnItem() {
        launch()
        open("library", shows: "library-page")
        XCTAssertTrue(app.buttons["library-row-pg_demo_trip"].waitForExistence(timeout: 15), "the Bot's things")
        XCTAssertTrue(app.staticTexts["Today"].exists, "in date sections")
        XCTAssertTrue(app.buttons["chip-Recordings"].exists && app.buttons["chip-Drawings"].exists, "the kinds")
        shot("library")
        app.buttons["chip-Drawings"].tap()
        XCTAssertTrue(app.buttons["library-row-drw_demo_arch"].waitForExistence(timeout: 10))
        XCTAssertFalse(app.buttons["library-row-pg_demo_trip"].exists, "the kind filters")
        app.buttons["chip-All"].tap()
        app.buttons["library-row-dsn_demo_home"].tap()
        XCTAssertTrue(any("library-page").waitForNonExistence(timeout: 10), "the design opens pushed, in its viewer")
    }

    /// The unfolded Duo (8g): Core on the left page, Skills | History on the right.
    func testTheUnfoldedDuoSplitsCoreFromSkillsAndHistory() throws {
        try XCTSkipUnless(UIDevice.current.name.lowercased().contains("duo"), "an iPhone Duo simulator")
        launch(["-qaPosture", "flat"])
        XCUIDevice.shared.system.open(URL(string: "bbstudio://qa-duo/landscape")!)
        sleep(3)
        // The tab bar may run past the simulator's screen: switch tabs by command.
        XCUIDevice.shared.system.open(URL(string: "bbstudio://qa-duo/tab?memory")!)
        XCTAssertTrue(any("memoryBudget").waitForExistence(timeout: 15), "Core on the left page")
        XCTAssertTrue(any("memory-browse").waitForExistence(timeout: 15), "Skills | History on the right")
        XCTAssertTrue(app.buttons["memorySkill-weekly-review"].waitForExistence(timeout: 15), "Skills first")
        XCTAssertFalse(app.segmentedControls["memoryLayer"].buttons["Core"].exists, "no Core in the right page's switch")
        shot("unfolded-left")
        XCUIDevice.shared.system.open(URL(string: "bbstudio://qa-duo/split-right")!)
        sleep(2)
        shot("unfolded-right")
        app.segmentedControls["memoryLayer"].buttons["History"].tap()
        XCTAssertTrue(app.buttons["memorySummary-thr_demo_lisbon"].waitForExistence(timeout: 10), "History on the right")
        shot("unfolded-right-history")
    }

    private func shot(_ name: String) {
        guard let folder = ProcessInfo.processInfo.environment["MEMLIB_OUT"] else { return }
        sleep(1)
        let url = URL(fileURLWithPath: folder)
        try? FileManager.default.createDirectory(at: url, withIntermediateDirectories: true)
        let device = UIDevice.current.name.lowercased().contains("duo") ? "duo" : "iphone"
        try? XCUIScreen.main.screenshot().pngRepresentation.write(to: url.appendingPathComponent("\(device)-\(name).png"))
    }
}

private extension XCUIElement {
    func waitForValue(_ value: String, timeout: TimeInterval = 10) -> Bool {
        let done = XCTNSPredicateExpectation(predicate: NSPredicate(format: "value == %@", value), object: self)
        return XCTWaiter.wait(for: [done], timeout: timeout) == .completed
    }
}
