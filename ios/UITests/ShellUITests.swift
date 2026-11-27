import XCTest

/// The app shell (round 8), offline: the native tab bar (Home, Library,
/// Memory, Search), one stack per tab with native bars in every posture
/// (iPhone; Duo folded, book, flat, vertical): the system's Back, the
/// Workbench button and ⋯, the tab menu as the Workbench's title, the sideways flip.
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
        app.press(element(id), id: id)
        sleep(1)
    }

    private func element(_ id: String) -> XCUIElement { app.descendants(matching: .any).matching(identifier: id).firstMatch }

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
    /// A long chat with a question waiting (TranscriptHang's): settles too.
    func testALongChatWithAQuestionGoesIdle() {
        expectIdle(["-qaDemoQuestion", "-qaDemoMessages", "1000", "-qaDark", "-openURL", "bbstudio://bot"])
    }
    /// A conversation closed while it scrolls to its end (just opened): its
    /// scroll's display link stops too. One left ticking kept the app awake
    /// and never idle for the rest of the launch.
    func testClosingAConversationMidScrollLeavesNoDisplayLink() {
        launch(["-qaConversation", "thr_botdemo01", "-qaDemoLatency", "300", "-qaDemoColdCache"])
        XCTAssertTrue(app.textViews["Message"].waitForExistence(timeout: 30), "the conversation")
        for _ in 0..<3 {
            app.goHome()
            XCTAssertTrue(app.waitForRoom(timeout: 15), "Main again")
        }
        app.goHome()
        sleep(2)
        command("counts")
        let counts = (try? JSONDecoder().decode([String: Int].self, from: Data((app.windows.firstMatch.value as? String ?? "").utf8))) ?? [:]
        XCTAssertEqual(counts["transcript.links"], 0, "display links left running: \(counts)")
    }

    /// Back to Home from a conversation: Home settles too.
    func testHomeGoesIdleAfterAConversation() {
        launch(["-qaConversation", "thr_botdemo01"])
        XCTAssertTrue(app.textViews["Message"].waitForExistence(timeout: 30), "the conversation")
        app.goHome()
        sleep(8)
        command("animations")
        let running = (app.windows.firstMatch.value as? String ?? "").split(separator: "\n").map(String.init)
        print("IDLE home-after: \(running.count)\n" + running.joined(separator: "\n"))
        XCTAssertEqual(Self.forever(running), [], "repeating animations at rest on Home")
    }
    /// Live scene on: the shell's backdrop stays a still (no scene web view).
    func testTheBackdropStaysStillWithLiveSceneOn() {
        expectIdle(["-qaConversation", "thr_botdemo01", "-qaLiveScene", "-qaBotTheme", "tonights-sky"])
        XCTAssertFalse((app.windows.firstMatch.value as? String ?? "").contains("webview"), "no live scene behind the shell")
    }
    func testTheBotChatGoesIdleAfterAStream() {
        expectIdle(["-qaDemoLatency", "300", "-qaDemoColdCache", "-qaDemoStream", "-openURL", "bbstudio://bot"])
    }

    /// The system's Liquid Glass keeping its lens on what's under it (the tab bar's and the bar's
    /// glass): `match-…` animations that last for good and never restart; the system's, as the caret is.
    private static func systemGlass(_ row: String) -> Bool {
        let animations = (row.components(separatedBy: "): ").last ?? "").components(separatedBy: ", ")
        return !animations.isEmpty && animations.allSatisfy { $0.hasPrefix("match-") || $0.contains(".match") }
    }

    /// Repeating for good (a huge repeatCount); the caret's blink is the system's.
    private static func forever(_ running: [String]) -> [String] {
        running.filter { row in
            let counts = row.components(separatedBy: "repeat=").dropFirst().compactMap { Double($0.prefix { !" ,".contains($0) }) }
            return counts.contains { $0 > 1000 } && !row.contains("UITextSelectionView") && !row.contains("Caret")
        }
    }

    private func expectIdle(_ variant: [String], bot: String = "chat", home: Bool = false, file: StaticString = #filePath, line: UInt = #line) {
        launch(variant, bot: bot)
        let shown = home ? app.buttons["homeWorker-thr_demo_w2"] : app.textViews["Message"]
        XCTAssertTrue(shown.waitForExistence(timeout: 30), home ? "Home with its running worker" : "the conversation", file: file, line: line)
        sleep(8)
        command("animations")
        let running = (app.windows.firstMatch.value as? String ?? "").split(separator: "\n").map(String.init)
        print("IDLE \(variant): \(running.count)\n" + running.joined(separator: "\n"))
        XCTAssertEqual(Self.forever(running), [], "repeating animations at rest", file: file, line: line)
        // And no short animation started over and over (one a second keeps the app from idling too).
        var seen: [String] = []
        for _ in 0..<20 {
            XCUIDevice.shared.system.open(URL(string: "bbstudio://qa-duo/animations")!)
            Thread.sleep(forTimeInterval: 0.3)
            seen += (app.windows.firstMatch.value as? String ?? "").split(separator: "\n").map(String.init)
                .filter { !$0.contains("UITextSelectionView") && !$0.contains("Caret") && $0.hasPrefix("webview") == false && !Self.systemGlass($0) }
                // Only animations still running: a layer can keep a finished or paused one.
                .filter { row in (row.components(separatedBy: "): ").last ?? row).components(separatedBy: ", ").contains { !$0.hasSuffix(" done") } }
        }
        print("IDLE-SAMPLES \(variant): \(seen.count)\n" + Array(Set(seen)).joined(separator: "\n"))
        XCTAssertLessThanOrEqual(seen.count, 2, "animations keep starting at rest: \(Array(Set(seen)).prefix(3))", file: file, line: line)
    }

    // MARK: iPhone

    func testHomeIsTheRootAndTheTabsHoldThePlaces() throws {
        try XCTSkipIf(isDuo, "the iPhone")
        launch()
        XCTAssertTrue(element("home").waitForExistence(timeout: 30), "the app opens on Home")
        XCTAssertTrue(app.navigationBars["Home"].exists, "a native bar titled Home")
        XCTAssertTrue(app.buttons["homeNew"].exists, "New in the bar")
        for title in ["Home", "Library", "Memory", "Search"] { XCTAssertTrue(app.tab(title).exists, "the \(title) tab") }
        XCTAssertTrue(element("homeConversation-thr_botdemo01").exists, "the conversations")
        XCTAssertFalse(element("strands-toggle").exists, "no strands")
        capture("iphone-home")

        app.tab("Memory").tap()
        XCTAssertTrue(element("memory-page").waitForExistence(timeout: 10), "Memory is a tab")
        XCTAssertTrue(app.navigationBars["Memory"].exists, "under its own bar")
        capture("iphone-memory")
        app.tab("Library").tap()
        XCTAssertTrue(element("library-page").waitForExistence(timeout: 10), "Library is a tab")
        capture("iphone-library")
        app.tab("Home").tap()
        XCTAssertTrue(element("home").waitForExistence(timeout: 10), "and back to Home")

        element("homeConversation-thr_botdemo01").tap()
        app.goBack()
        XCTAssertTrue(app.homeNew.waitForExistence(timeout: 10), "the system's Back returns to Home")
    }

    func testSearchIsATab() throws {
        try XCTSkipIf(isDuo, "the iPhone")
        launch()
        XCTAssertTrue(element("home").waitForExistence(timeout: 30))
        app.tab("Search").tap()
        let field = app.searchFields.firstMatch
        XCTAssertTrue(field.waitForExistence(timeout: 10), "the native search field")
        field.tap()
        field.typeText("Launch")
        let row = app.buttons.matching(NSPredicate(format: "identifier BEGINSWITH 'homeConversation-' AND label CONTAINS 'Launch prep'")).firstMatch
        XCTAssertTrue(row.waitForExistence(timeout: 10), "the conversation found")
        capture("iphone-search")
        row.tap()
        XCTAssertTrue(app.textViews["Message"].waitForExistence(timeout: 15), "it opens on Home's tab")
        XCTAssertTrue(app.tab("Home").isSelected, "Home's tab")
    }

    func testConversationHasNativeBarWithTheWorkbenchButton() throws {
        try XCTSkipIf(isDuo, "the iPhone")
        launch()
        XCTAssertTrue(element("homeConversation-thr_botdemo01").waitForExistence(timeout: 30))
        element("homeConversation-thr_botdemo01").tap()
        XCTAssertTrue(app.textViews["Message"].waitForExistence(timeout: 20), "the conversation is pushed")
        let button = app.buttons["workbenchButton"]
        XCTAssertTrue(button.exists, "the Workbench button")
        XCTAssertEqual(button.label, "Workbench, 3 tabs", "the tabs the phone can show (not the VS Code one)")
        XCTAssertTrue(app.buttons["conversationMore"].exists, "and ⋯")
        XCTAssertTrue(app.backButton.exists, "the system's Back")
        XCTAssertFalse(element("conversationHandsFree").exists, "no Live button in the chrome")
        capture("iphone-chat")

        button.tap()
        XCTAssertTrue(app.buttons["workbenchTitle"].waitForExistence(timeout: 10), "the tab is the title")
        XCTAssertEqual(app.buttons["workbenchButton"].label, "Show chat", "the button flips back")
        XCTAssertTrue(app.textViews["Message"].exists, "the composer stays")
        capture("iphone-workbench")

        app.buttons["workbenchButton"].tap()
        XCTAssertTrue(element("conversationTitle").waitForExistence(timeout: 10), "back in the chat")
    }
    /// Review SF5: a conversation whose only tab is Mac-only: "0 tabs" on
    /// the Workbench button, and the Workbench says "No tabs", as the count does.
    func testAMacOnlyTabCountsAsNoTab() throws {
        try XCTSkipIf(isDuo, "the iPhone")
        launchConversation(["-qaWorkbenchMacOnly"])
        let button = app.buttons["workbenchButton"]
        XCTAssertTrue(button.waitForExistence(timeout: 10))
        XCTAssertEqual(button.label, "Workbench, 0 tabs")
        button.tap()
        XCTAssertTrue(element("workbenchEmpty").waitForExistence(timeout: 10), "No tabs")
        app.buttons["workbenchTitle"].tap()
        XCTAssertTrue(app.buttons["README.md"].waitForExistence(timeout: 5) || element("workbenchTab-tab-code").exists,
                      "the tab menu still lists the Mac-only tab")
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
        XCTAssertEqual(app.buttons["workbenchButton"].label, "Workbench, 2 tabs", "one tab fewer")
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

    /// The folded Duo (Patrick's "more native, as Kensico"): the system puts
    /// the bar's buttons and the tab bar in the reserved right column.
    func testFoldedUsesTheNativeBarAndTabBar() throws {
        try XCTSkipUnless(isDuo, "an iPhone Duo simulator")
        launchConversation()
        let back = app.backButton, workbench = app.buttons["workbenchButton"], more = app.buttons["conversationMore"]
        XCTAssertTrue(back.exists && workbench.exists && more.exists, "Back, Workbench and ⋯ in the native bar")
        XCTAssertEqual(workbench.label, "Workbench, 3 tabs")
        XCTAssertGreaterThan(workbench.frame.minX, 466 - 100, "the system puts them in the right column")
        XCTAssertTrue(app.tab("Home").exists && app.tab("Memory").exists, "the tab bar")
        XCTAssertGreaterThan(app.tab("Home").frame.minX, 466 - 100, "in the right column too")
        capture("duo-folded-chat")

        workbench.tap()
        XCTAssertEqual(app.buttons["workbenchButton"].label, "Show chat", "the same flip as the iPhone")
        let title = app.buttons["workbenchTitle"]
        XCTAssertTrue(title.waitForExistence(timeout: 10), "the tab is the title")
        capture("duo-folded-workbench")
        title.tap()
        XCTAssertTrue(app.buttons["Lisbon budget"].waitForExistence(timeout: 5), "the tab menu from the title")
        capture("duo-folded-tabs")
        app.buttons["Lisbon budget"].tap()

        back.tap()
        XCTAssertTrue(app.homeNew.waitForExistence(timeout: 10), "Back is Home")
        XCTAssertTrue(app.navigationBars["Home"].exists, "Home's large title")
        capture("duo-folded-home")
        app.tab("Memory").tap()
        XCTAssertTrue(element("memory-page").waitForExistence(timeout: 10), "Memory's tab")
        XCTAssertTrue(app.buttons["memorySearch"].exists, "its Search in its bar")
        capture("duo-folded-memory")
        app.tab("Library").tap()
        XCTAssertTrue(element("library-page").waitForExistence(timeout: 10), "Library's tab")
        capture("duo-folded-library")
        app.tab("Search").tap()
        XCTAssertTrue(app.searchFields.firstMatch.waitForExistence(timeout: 10), "Search's tab")
        capture("duo-folded-search")
    }

    /// A pushed page or design on the folded Duo: its native bar, Back and
    /// its actions the system places; Library's + New page pushes on its tab.
    func testPushedScreensUseTheNativeBar() throws {
        try XCTSkipUnless(isDuo, "an iPhone Duo simulator")
        launch(["-qaPageDemo", "-qaDesignDemo"])
        XCTAssertTrue(element("home").waitForExistence(timeout: 30))
        for (link, name) in [("page/qa-demo", "page"), ("design/dsn_demo", "design")] {
            XCUIDevice.shared.system.open(URL(string: "bbstudio://" + link)!)
            XCTAssertTrue(app.backButton.waitForExistence(timeout: 15), "\(name): the system's Back")
            sleep(2)
            capture("duo-folded-\(name)")
            app.goHome()
        }

        app.tab("Library").tap()
        let newPage = app.buttons["libraryNewPage"]
        XCTAssertTrue(newPage.waitForExistence(timeout: 10), "New page in Library's bar")
        newPage.tap()
        XCTAssertTrue(app.backButton.waitForExistence(timeout: 15), "the new page, pushed on Library's tab")
        app.goBack()
        XCTAssertTrue(element("library-page").waitForExistence(timeout: 10), "Back is Library")
    }

    /// Book: the conversation and its Workbench, each under its own bar;
    /// Home over the conversation from the bar's Home button.
    func testBookShowsConversationAndWorkbenchAndHomeOnRequest() throws {
        try XCTSkipUnless(isDuo, "an iPhone Duo simulator")
        launchConversation(["-qaPosture", "book"])
        resize("landscape", CGSize(width: 951, height: 669))
        XCTAssertTrue(element("conversationColumn").waitForExistence(timeout: 10), "the conversation")
        XCTAssertTrue(element("workbenchPage").exists, "its Workbench beside it")
        XCTAssertFalse(element("homeColumn").exists, "Home doesn't fit beside both")
        XCTAssertTrue(element("homePane").exists && element("conversationMore").exists && element("workbenchTitle").exists,
                      "Home and ⋯ in the conversation's bar, the tab menu as the Workbench's title")
        XCTAssertFalse(app.backButton.exists, "the conversation is its page's root: no Back")
        capture("duo-book")

        command("counts?reset")
        activate("homePane")
        XCTAssertTrue(element("homeColumn").waitForExistence(timeout: 10), "Home over the conversation")
        // Review S3: the conversation stays mounted under Home; its thread keeps running.
        command("counts")
        let counts = (try? JSONDecoder().decode([String: Int].self, from: Data((app.windows.firstMatch.value as? String ?? "").utf8))) ?? [:]
        XCTAssertNil(counts["session.detach"], "opening Home detached the conversation: \(counts)")
        capture("duo-book-home")
        activate("homeConversation-thr_botdemo01")
        XCTAssertTrue(element("homeColumn").waitForNonExistence(timeout: 10), "picking a conversation closes Home")
        command("outer")
    }

    /// Flat: as book; Memory's tab is two pages, Core and Skills | History.
    func testFlatShowsTheConversationAndItsWorkbench() throws {
        try XCTSkipUnless(isDuo, "an iPhone Duo simulator")
        launchConversation(["-qaPosture", "flat"])
        resize("landscape", CGSize(width: 951, height: 669))
        XCTAssertTrue(element("conversationColumn").waitForExistence(timeout: 10), "the conversation")
        XCTAssertTrue(element("workbenchPage").exists, "the Workbench")
        XCTAssertTrue(element("conversationMore").exists, "⋯ in the conversation's bar")
        capture("duo-flat")
        command("tab?memory")
        XCTAssertTrue(element("memory-page").waitForExistence(timeout: 10), "Memory's tab")
        XCTAssertTrue(element("memory-browse").exists, "Skills | History on page two")
        XCTAssertGreaterThan(element("memory-browse").frame.minX, element("memory-page").frame.minX, "beside Core")
        capture("duo-flat-memory")
        command("tab?library")
        XCTAssertTrue(element("library-page").waitForExistence(timeout: 10), "Library's tab")
        capture("duo-flat-library")
        command("tab?bot")
        XCTAssertTrue(element("conversationColumn").waitForExistence(timeout: 10), "Home's tab: the conversation again")
        command("outer")
    }

    /// Vertical: a big iPhone, the native bar and tab bar.
    func testVerticalIsABigIPhone() throws {
        try XCTSkipUnless(isDuo, "an iPhone Duo simulator")
        launchConversation(["-qaPosture", "vertical"])
        resize("portrait", CGSize(width: 669, height: 951))
        XCTAssertFalse(element("workbenchPage").exists, "one column")
        let workbench = element("workbenchButton")
        XCTAssertTrue(workbench.waitForExistence(timeout: 10), "the Workbench button in the bar")
        capture("duo-vertical-chat")
        activate("workbenchButton")
        XCTAssertTrue(element("workbenchTitle").waitForExistence(timeout: 10), "the same flip as the iPhone")
        capture("duo-vertical-workbench")
        activate("BackButton")
        XCTAssertTrue(element("home").waitForExistence(timeout: 10), "the system's Back is Home")
        capture("duo-vertical-home")
        command("tab?memory")
        XCTAssertTrue(element("memoryLayer").waitForExistence(timeout: 10), "Memory's tab, one page with its layers")
        capture("duo-vertical-memory")
        command("outer")
    }
}
