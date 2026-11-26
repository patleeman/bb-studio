import XCTest

/// The app shell (round 7), offline: Home as the root, one bar on the
/// iPhone with the Workbench button and the tab menu, the sideways flip, and
/// on the Duo the rail in every posture (folded, book, flat, vertical).
/// Window sizes come from the app's own resize (`bbstudio://qa-duo/…`); the
/// simulator has no hinge, so `-qaPosture` names book or flat. With
/// `SHELL_CAPTURE` set, `qa-duo/capture` keeps window PNGs in the app's Documents.
final class ShellUITests: ServerIsolatedUITestCase {
    private let app = XCUIApplication()
    private var isDuo: Bool { UIDevice.current.name.lowercased().contains("duo") }

    private func launch(_ extra: [String] = [], bot: String = "chat") {
        app.launchArguments = ["-skipPushPrompt", "YES", "-qaBotDemo", bot, "-qaSpacesDemo", "list", "-qaWorkbenchDemo"] + extra
        app.launchOffline()
    }

    private func launchConversation(_ extra: [String] = []) {
        launch(["-qaConversation", "thr_botdemo01"] + extra)
        XCTAssertTrue(app.textViews["Message"].waitForExistence(timeout: 30), "the conversation")
    }

    private func command(_ path: String) {
        XCUIDevice.shared.system.open(URL(string: "bbstudio://qa-duo/" + path)!)
        sleep(2)
    }

    private func resize(_ name: String, _ size: CGSize) {
        command(name)
        let window = app.windows.firstMatch
        let sized = NSPredicate { _, _ in abs(window.frame.width - size.width) < 1 && abs(window.frame.height - size.height) < 1 }
        expectation(for: sized, evaluatedWith: nil)
        waitForExpectations(timeout: 10)
        sleep(1)
    }

    private func capture(_ name: String) {
        guard ProcessInfo.processInfo.environment["SHELL_CAPTURE"] != nil else { return }
        command("capture?" + name)
    }

    /// The inner screen is wider than the simulator's: controls off it are activated as VoiceOver does.
    private func activate(_ id: String) {
        command("activate?" + id)
    }

    private func element(_ id: String) -> XCUIElement { app.descendants(matching: .any)[id] }

    // MARK: Idle

    /// A conversation at rest runs no animation forever (phone heat; XCUITest
    /// waited 60 s a step on the folded Duo): every repeating animation left
    /// after it settles, other than the text caret's blink, is a bug.
    func testTheConversationGoesIdle() { expectIdle(["-qaConversation", "thr_botdemo01"]) }
    func testTheConversationWithChipsGoesIdle() { expectIdle(["-qaConversation", "thr_botdemo01", "-qaShelfDemo"]) }
    /// While the Bot works (its turn, a running worker on Home, background
    /// work): still marks, not spinners that would run for hours.
    func testAWorkingBotGoesIdle() { expectIdle(["-qaShelfDemo", "-openURL", "bbstudio://bot"], bot: "working") }
    func testHomeWithARunningWorkerGoesIdle() { expectIdle([], home: true) }
    /// Live scene on: the shell's backdrop stays a still (no scene web view).
    func testTheBackdropStaysStillWithLiveSceneOn() {
        expectIdle(["-qaConversation", "thr_botdemo01", "-qaLiveScene", "-qaBotTheme", "tonights-sky"])
        XCTAssertFalse((app.windows.firstMatch.value as? String ?? "").contains("webview"), "no live scene behind the shell")
    }
    func testTheBotChatGoesIdleAfterAStream() {
        expectIdle(["-qaDemoLatency", "300", "-qaDemoColdCache", "-qaDemoStream", "-openURL", "bbstudio://bot"])
    }

    private func expectIdle(_ variant: [String], bot: String = "chat", home: Bool = false, file: StaticString = #filePath, line: UInt = #line) {
        launch(variant, bot: bot)
        let shown = home ? app.buttons["homeWorker-thr_demo_w2"] : app.textViews["Message"]
        XCTAssertTrue(shown.waitForExistence(timeout: 30), home ? "Home with its running worker" : "the conversation", file: file, line: line)
        sleep(8)
        command("animations")
        let running = (app.windows.firstMatch.value as? String ?? "").split(separator: "\n").map(String.init)
        print("IDLE \(variant): \(running.count)\n" + running.joined(separator: "\n"))
        // Repeating for good (repeatCount is HUGE_VALF or Float.greatestFiniteMagnitude-like); the caret's blink is the system's.
        let forever = running.filter { row in
            let counts = row.components(separatedBy: "repeat=").dropFirst().compactMap { Double($0.prefix { !" ,".contains($0) }) }
            return counts.contains { $0 > 1000 } && !row.contains("UITextSelectionView") && !row.contains("Caret")
        }
        XCTAssertEqual(forever, [], "repeating animations at rest", file: file, line: line)
    }

    // MARK: iPhone

    func testHomeIsTheRootAndPushesItsPlaces() throws {
        try XCTSkipIf(isDuo, "the iPhone")
        launch()
        XCTAssertTrue(element("home").waitForExistence(timeout: 30), "the app opens on Home")
        XCTAssertTrue(app.navigationBars["Home"].exists, "one bar titled Home")
        XCTAssertTrue(app.buttons["homeSearchButton"].exists && app.buttons["homeNew"].exists, "Search and New in the bar")
        XCTAssertTrue(element("homeMemory").exists && element("homeLibrary").exists, "Memory and Library rows")
        XCTAssertTrue(element("homeConversation-thr_botdemo01").exists, "the conversations")
        XCTAssertFalse(element("strands-toggle").exists, "no strands")
        capture("iphone-home")

        element("homeMemory").tap()
        XCTAssertTrue(app.navigationBars.buttons.firstMatch.waitForExistence(timeout: 10))
        XCTAssertFalse(element("home").isHittable, "Memory is pushed over Home, not a sheet")
        app.navigationBars.buttons.firstMatch.tap()
        XCTAssertTrue(element("home").waitForExistence(timeout: 10), "Back returns to Home")
    }

    func testConversationHasOneBarWithTheWorkbenchButton() throws {
        try XCTSkipIf(isDuo, "the iPhone")
        launch()
        XCTAssertTrue(element("homeConversation-thr_botdemo01").waitForExistence(timeout: 30))
        element("homeConversation-thr_botdemo01").tap()
        XCTAssertTrue(app.textViews["Message"].waitForExistence(timeout: 20), "the conversation is pushed")
        let button = app.buttons["workbenchButton"]
        XCTAssertTrue(button.exists, "the Workbench button")
        XCTAssertEqual(button.label, "Workbench, 4 tabs", "with the tab count")
        XCTAssertTrue(app.buttons["conversationMore"].exists, "and ⋯")
        XCTAssertFalse(element("conversationHandsFree").exists, "no Live button in the chrome")
        XCTAssertFalse(element("shellRail").exists, "no rail on the iPhone")
        capture("iphone-chat")

        button.tap()
        XCTAssertTrue(app.buttons["workbenchTitle"].waitForExistence(timeout: 10), "the tab is the title")
        XCTAssertEqual(app.buttons["workbenchButton"].label, "Show chat", "the button flips back")
        XCTAssertTrue(app.textViews["Message"].exists, "the composer stays")
        capture("iphone-workbench")

        app.buttons["workbenchButton"].tap()
        XCTAssertTrue(element("conversationTitle").waitForExistence(timeout: 10), "back in the chat")
    }

    func testASidewaysSwipeFlipsChatAndWorkbench() throws {
        try XCTSkipIf(isDuo, "the iPhone")
        launchConversation()
        let rows = app.collectionViews.firstMatch
        XCTAssertTrue(rows.waitForExistence(timeout: 10))
        rows.swipeLeft()
        XCTAssertTrue(app.buttons["workbenchTitle"].waitForExistence(timeout: 10), "a swipe left shows the Workbench")
        element("workbench").swipeRight()
        XCTAssertTrue(element("conversationTitle").waitForExistence(timeout: 10), "a swipe right shows the chat")
    }

    func testTheTitleOpensTheTabMenu() throws {
        try XCTSkipIf(isDuo, "the iPhone")
        launchConversation()
        app.buttons["workbenchButton"].tap()
        let title = app.buttons["workbenchTitle"]
        XCTAssertTrue(title.waitForExistence(timeout: 10))
        title.tap()
        // A system menu: its items keep their labels, not always their identifiers.
        XCTAssertTrue(app.buttons["Theme stills"].waitForExistence(timeout: 5), "the open tabs")
        XCTAssertTrue(app.buttons["New tab…"].exists, "New tab")
        XCTAssertTrue(app.buttons["Close “Lisbon budget”"].exists, "Close the shown tab")
        capture("iphone-tab-menu")
        app.buttons["Theme stills"].tap()
        XCTAssertTrue(title.label.contains("Theme stills"), "the picked tab is shown: \(title.label)")

        title.tap()
        app.buttons["Close “Theme stills”"].tap()
        XCTAssertEqual(app.buttons["workbenchButton"].exists, true)
        app.buttons["workbenchButton"].tap()
        XCTAssertEqual(app.buttons["workbenchButton"].label, "Workbench, 3 tabs", "one tab fewer")
    }

    func testTheMoreMenuHoldsTheConversationsItems() throws {
        try XCTSkipIf(isDuo, "the iPhone")
        launchConversation()
        app.buttons["conversationMore"].tap()
        XCTAssertTrue(app.buttons["Find in conversation"].waitForExistence(timeout: 5), "Find")
        XCTAssertTrue(app.buttons["Model & permissions"].exists, "Model")
        app.buttons["Find in conversation"].tap()
        XCTAssertTrue(app.textFields.firstMatch.waitForExistence(timeout: 5), "Find opens its bar")
    }

    // MARK: Duo

    func testFoldedRailHoldsTheControlsLowestFirst() throws {
        try XCTSkipUnless(isDuo, "an iPhone Duo simulator")
        launchConversation()
        XCTAssertTrue(element("shellRail").exists, "the rail")
        XCTAssertFalse(app.navigationBars.firstMatch.exists, "no bar on top, a title line only")
        let workbench = app.buttons["rail-workbench"], home = app.buttons["rail-home"], more = app.buttons["rail-more"]
        XCTAssertTrue(workbench.exists && home.exists && more.exists)
        XCTAssertGreaterThan(workbench.frame.minY, home.frame.minY, "Workbench lowest")
        XCTAssertGreaterThan(home.frame.minY, more.frame.minY, "then Home, then More")
        XCTAssertGreaterThan(workbench.frame.minX, 466 - 100, "in the right column")
        capture("duo-folded-chat")

        workbench.tap()
        XCTAssertTrue(app.buttons["rail-chat"].waitForExistence(timeout: 10), "Chat takes the lowest slot")
        XCTAssertTrue(app.buttons["rail-tabs"].exists, "Tabs")
        capture("duo-folded-workbench")
        app.buttons["rail-tabs"].tap()
        XCTAssertTrue(app.buttons["Lisbon budget"].waitForExistence(timeout: 5), "the tab menu from the rail")
        capture("duo-folded-tabs")
        app.buttons["Lisbon budget"].tap()

        app.buttons["rail-home"].tap()
        XCTAssertTrue(element("home").waitForExistence(timeout: 10), "Home in the rail goes Home")
        XCTAssertTrue(app.buttons["rail-new"].exists && app.buttons["rail-search"].exists, "Home's rail: New, Search")
        capture("duo-folded-home")
        element("homeMemory").tap()
        XCTAssertTrue(element("memory-page").waitForExistence(timeout: 10), "Memory, pushed")
        XCTAssertTrue(app.buttons["rail-back"].waitForExistence(timeout: 5), "one rail: Back in it")
        XCTAssertFalse(app.navigationBars.firstMatch.exists, "no bar of its own")
        capture("duo-folded-memory")
    }

    /// One rail for every screen on the Duo: a pushed page, design or Memory hides its bar;
    /// its title is the title line, and Back and its actions are in the rail.
    func testPushedScreensUseTheOneRail() throws {
        try XCTSkipUnless(isDuo, "an iPhone Duo simulator")
        launch(["-qaPageDemo", "-qaDesignDemo"])
        XCTAssertTrue(element("home").waitForExistence(timeout: 30))
        element("homeMemory").tap()
        XCTAssertTrue(app.buttons["rail-back"].waitForExistence(timeout: 10), "Back in the rail")
        XCTAssertTrue(app.buttons["rail-action-memorySearch"].exists, "Memory's Search in the rail")
        XCTAssertFalse(app.navigationBars.firstMatch.exists, "no bar of its own")
        capture("duo-folded-memory")
        app.buttons["rail-back"].tap()
        XCTAssertTrue(element("home").waitForExistence(timeout: 10), "Back is Home from one push away")

        for (link, name) in [("page/qa-demo", "page"), ("design/dsn_demo", "design")] {
            XCUIDevice.shared.system.open(URL(string: "bbstudio://" + link)!)
            XCTAssertTrue(app.buttons["rail-back"].waitForExistence(timeout: 15), "\(name): Back in the rail")
            sleep(2)
            XCTAssertFalse(app.navigationBars.firstMatch.exists, "\(name): no bar of its own")
            XCTAssertTrue(element("shellTitle").exists, "\(name): the title line")
            capture("duo-folded-\(name)")
            app.goHome()
        }

        // Review S6: a page made from Library's + New page is pushed on the
        // shell's stack, with the rail's Back and the title line.
        element("homeLibrary").tap()
        let newPage = app.buttons["rail-action-libraryNewPage"]
        XCTAssertTrue(newPage.waitForExistence(timeout: 10), "New page in the rail")
        newPage.tap()
        let title = app.descendants(matching: .any).matching(NSPredicate(format: "identifier == 'shellTitle' AND label != 'Library'")).firstMatch
        XCTAssertTrue(title.waitForExistence(timeout: 15), "the new page under the title line")
        XCTAssertTrue(app.buttons["rail-back"].exists, "and Back in the rail")
        XCTAssertFalse(app.navigationBars.firstMatch.exists, "no bar of its own")
    }

    /// Review B1: in book, a place opened from Home's column shows on the left
    /// page (Home gives it the page), its companion on the right.
    func testBookShowsAPlaceOpenedFromHome() throws {
        try XCTSkipUnless(isDuo, "an iPhone Duo simulator")
        launchConversation(["-qaPosture", "book"])
        resize("landscape", CGSize(width: 951, height: 669))
        activate("rail-home")
        XCTAssertTrue(element("homeColumn").waitForExistence(timeout: 10), "Home on the left page")
        activate("homeMemory")
        XCTAssertTrue(element("memory-page").waitForExistence(timeout: 10), "Memory shows")
        XCTAssertFalse(element("homeColumn").exists, "Home gave the page back")
        capture("duo-book-memory")
        command("outer")
    }

    func testBookShowsConversationAndWorkbenchAndHomeOnRequest() throws {
        try XCTSkipUnless(isDuo, "an iPhone Duo simulator")
        launchConversation(["-qaPosture", "book"])
        resize("landscape", CGSize(width: 951, height: 669))
        XCTAssertTrue(element("conversationColumn").waitForExistence(timeout: 10), "the conversation on the left page")
        XCTAssertTrue(element("workbenchPage").exists, "its Workbench on the right page")
        XCTAssertFalse(element("homeColumn").exists, "Home hidden")
        XCTAssertTrue(element("rail-tabs").exists && element("rail-home").exists && element("rail-more").exists, "Tabs, Home, More")
        capture("duo-book")

        command("counts?reset")
        activate("rail-home")
        XCTAssertTrue(element("homeColumn").waitForExistence(timeout: 10), "Home takes the left page")
        XCTAssertFalse(app.textViews["Message"].exists, "Home replaces the conversation (out of VoiceOver's way)")
        // Review S3: the conversation stays mounted under Home; its thread keeps running.
        command("counts")
        let counts = (try? JSONDecoder().decode([String: Int].self, from: Data((app.windows.firstMatch.value as? String ?? "").utf8))) ?? [:]
        XCTAssertNil(counts["session.detach"], "opening Home detached the conversation: \(counts)")
        XCTAssertTrue(element("rail-new").exists, "More becomes New")
        capture("duo-book-home")
        activate("homeConversation-thr_botdemo01")
        XCTAssertTrue(element("conversationColumn").waitForExistence(timeout: 10), "picking a conversation gives the page back")
        command("outer")
    }

    func testFlatShowsThreePanes() throws {
        try XCTSkipUnless(isDuo, "an iPhone Duo simulator")
        launchConversation(["-qaPosture", "flat"])
        resize("landscape", CGSize(width: 951, height: 669))
        XCTAssertTrue(element("homeColumn").waitForExistence(timeout: 10), "Home")
        XCTAssertTrue(element("conversationColumn").exists, "the conversation")
        XCTAssertTrue(element("workbenchPage").exists, "the Workbench")
        XCTAssertTrue(element("rail-new").exists && element("rail-more").exists, "Tabs, Home, New, More")
        capture("duo-flat")
        activate("homeMemory")
        sleep(2)
        capture("duo-flat-memory")
        activate("rail-home")
        XCTAssertTrue(element("homeColumn").waitForNonExistence(timeout: 10), "Home in the rail hides Home")
        capture("duo-flat-home-hidden")
        command("outer")
    }

    func testVerticalIsABigIPhoneWithTheRail() throws {
        try XCTSkipUnless(isDuo, "an iPhone Duo simulator")
        launchConversation(["-qaPosture", "vertical"])
        resize("portrait", CGSize(width: 669, height: 951))
        XCTAssertTrue(element("shellRail").waitForExistence(timeout: 10), "the rail down the right edge")
        XCTAssertFalse(element("workbenchPage").exists, "one column")
        let workbench = element("rail-workbench")
        XCTAssertTrue(workbench.exists)
        XCTAssertGreaterThan(workbench.frame.minY, 951 * 0.75, "its buttons at the bottom-right")
        capture("duo-vertical-chat")
        activate("rail-workbench")
        XCTAssertTrue(element("rail-chat").waitForExistence(timeout: 10), "the same flip as the iPhone")
        capture("duo-vertical-workbench")
        activate("rail-home")
        XCTAssertTrue(element("home").waitForExistence(timeout: 10))
        capture("duo-vertical-home")
        activate("homeMemory")
        XCTAssertTrue(element("rail-back").waitForExistence(timeout: 10), "one rail: Back in it")
        XCTAssertFalse(app.navigationBars.firstMatch.exists, "no bar of its own")
        capture("duo-vertical-memory")
        command("outer")
    }
}
