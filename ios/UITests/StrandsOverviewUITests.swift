import XCTest

/// The Strands screen, offline (`-qaSpacesDemo list
/// -qaBotDemo chat -qaStrandsDemo`; the demo answers `strands.overview` for
/// Juniper): from the home conversation, the conversation list's Strands
/// shows every conversation with open strands, needs you first; a chip or an
/// ask opens its conversation showing only that strand.
/// `TEST_RUNNER_STRANDS_OUT` keeps PNGs.
final class StrandsOverviewUITests: ServerIsolatedUITestCase {
    private let app = XCUIApplication()

    private func any(_ id: String) -> XCUIElement { app.descendants(matching: .any)[id].firstMatch }

    private func launch(strands: Bool = true) {
        app.launchArguments = ["-skipPushPrompt", "YES", "-qaBotDemo", "chat", "-qaSpacesDemo", "list", "-qaReduceMotion"]
            + (strands ? ["-qaStrandsDemo"] : [])
        app.launchOffline()
        XCTAssertTrue(app.textViews["Message"].waitForExistence(timeout: 30), "the app opens on the conversation")
    }

    /// The conversation list over the conversation, then Strands at its foot.
    private func openStrands() {
        let list = app.buttons["roomList"]
        XCTAssertTrue(list.waitForExistence(timeout: 15), "the header's Bot mark")
        list.tap()
        let row = app.botMenuItem("strands")
        XCTAssertTrue(any("RoomSheet-conversations").waitForExistence(timeout: 10), "the conversation list")
        app.openBotMenu()
        XCTAssertTrue(row.waitForExistence(timeout: 5), "Strands is in the Bot menu")
        shot("2-list-with-strands")
        row.tap()
        XCTAssertTrue(any("strands-overview").waitForExistence(timeout: 10), "the Strands screen")
    }

    func testTheListOpensStrandsAndAChipOpensItsConversationFiltered() {
        launch()
        let list = app.buttons["roomList"]
        XCTAssertTrue(list.waitForExistence(timeout: 15))
        list.tap()
        let row = app.botMenuItem("strands")
        XCTAssertTrue(any("RoomSheet-conversations").waitForExistence(timeout: 10))
        app.openBotMenu()
        XCTAssertTrue(row.waitForExistence(timeout: 5), "Strands is in the Bot menu")
        let memory = app.botMenuItem("memory")
        if memory.exists && row.exists {
            XCTAssertLessThan(row.frame.minY, memory.frame.minY, "Strands comes before Memory")
        }
        shot("2-list-with-strands")
        row.tap()
        XCTAssertTrue(any("strands-overview").waitForExistence(timeout: 10), "the Strands screen")

        let line = any("strands-line")
        XCTAssertTrue(line.waitForExistence(timeout: 15), "the overview loads")
        XCTAssertEqual(line.label, "3 need you · 2 running")
        let launchPrep = any("strands-card-thr_demo_interview")
        let main = any("strands-card-thr_botdemo01")
        let budget = any("strands-card-thr_demo_thread")
        XCTAssertTrue(launchPrep.exists && main.exists && budget.exists, "one card per conversation with open strands")
        XCTAssertLessThan(main.frame.minY, launchPrep.frame.minY, "needs you first, Main first among them")
        XCTAssertLessThan(launchPrep.frame.minY, budget.frame.minY, "a quiet conversation last")
        XCTAssertTrue(app.buttons["strands-ask-str_fork"].exists, "Main's asks are rows")
        XCTAssertTrue(app.buttons["strands-ask-str_gateway"].exists)
        XCTAssertTrue(app.buttons["strands-ask-str_fork"].label.hasPrefix("Studio-native BB fork · Push to origin"), app.buttons["strands-ask-str_fork"].label)
        XCTAssertTrue(app.buttons["strands-ask-str_notes"].exists, "Launch prep's question")
        XCTAssertTrue(app.buttons["strands-chip-str_stills"].label.hasPrefix("Theme stills, running"), app.buttons["strands-chip-str_stills"].label)
        XCTAssertTrue(app.buttons["strands-chip-str_budget"].label.hasSuffix("quiet"), "a quiet strand is a chip too")
        shot("3-strands")

        app.buttons["strands-chip-str_stills"].tap()
        XCTAssertTrue(app.textViews["Message"].waitForExistence(timeout: 15), "the conversation opens")
        let bar = any("strandFilter")
        XCTAssertTrue(bar.waitForExistence(timeout: 15), "showing only that strand")
        XCTAssertTrue(app.staticTexts["Only: Theme stills"].waitForExistence(timeout: 10))
        XCTAssertFalse(any("strands-overview").exists, "the Strands screen closed")
        // Main opens with the keyboard up; put it (and the simulator's first-run keyboard tip) away for the picture.
        if app.buttons["Continue"].waitForExistence(timeout: 2) { app.buttons["Continue"].tap() }
        app.collectionViews.firstMatch.swipeDown()
        shot("4-conversation-filtered")
        app.buttons["strandFilterClear"].tap()
        XCTAssertTrue(bar.waitForNonExistence(timeout: 10), "✕ shows everything")
    }

    func testAnAskOpensItsConversationAndOpenShowsEverything() {
        launch()
        openStrands()
        let ask = app.buttons["strands-ask-str_notes"]
        XCTAssertTrue(ask.waitForExistence(timeout: 15))
        ask.tap()
        XCTAssertTrue(app.staticTexts["Only: Release notes"].waitForExistence(timeout: 15), "Launch prep, only its Release notes strand")

        openStrands()
        let open = app.buttons["strands-open-thr_demo_interview"]
        XCTAssertTrue(open.waitForExistence(timeout: 15))
        open.tap()
        XCTAssertTrue(app.textViews["Message"].waitForExistence(timeout: 15))
        XCTAssertTrue(any("strandFilter").waitForNonExistence(timeout: 10), "Open shows the whole conversation")
    }

    func testEveryControlHasALabel() throws {
        launch()
        openStrands()
        XCTAssertTrue(any("strands-line").waitForExistence(timeout: 15))
        try app.performAccessibilityAudit(for: [.sufficientElementDescription]) { issue in
            print("audit issue (strands):", issue.compactDescription, issue.element?.debugDescription ?? "no element")
            return false
        }
    }

    private func shot(_ name: String) {
        guard let folder = ProcessInfo.processInfo.environment["STRANDS_OUT"] else { return }
        sleep(1)
        let url = URL(fileURLWithPath: folder)
        try? FileManager.default.createDirectory(at: url, withIntermediateDirectories: true)
        try? XCUIScreen.main.screenshot().pngRepresentation.write(to: url.appendingPathComponent("\(name).png"))
    }
}
