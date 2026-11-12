import XCTest

@MainActor
final class DuoSidebarSearchUITests: ServerIsolatedUITestCase {
    func testWideSidebarAlignmentAndCaptures() throws {
        let env = ProcessInfo.processInfo.environment
        // Only names the captures.
        let device = env["BBGO_QA_DEVICE"] ?? "duo"
        let app = XCUIApplication()
        app.launchArguments = ["-skipPushPrompt", "YES",
            "-qaBotDemo", "duo", "-qaDuoPhone", "-qaDuoColdWide", "-qaDuoLong", "-qaDark", "-qaStudioDemo", "-openURL", "bbstudio://bot"]
        app.launchOffline()
        XCTAssertTrue(botChatRow(app).waitForExistence(timeout: 30))
        try assertCard(app, device: device)
        capture("v5-bot-" + device)
        command("tab?studio")
        XCTAssertTrue(app.buttons.matching(identifier: "studioItem").firstMatch.waitForExistence(timeout: 20))
        try assertSearch(app, device: device)
        XCTAssertTrue(app.buttons["studio-kind-all"].exists)
        XCTAssertTrue(app.buttons["studio-kind-page"].exists)
        XCTAssertTrue(app.buttons["studio-kind-mini"].exists)
        XCTAssertTrue(app.staticTexts["Folders"].exists)
        XCTAssertTrue(app.buttons.matching(identifier: "studio-folder").firstMatch.exists)
        XCTAssertFalse(app.buttons["Dictate"].exists)
        app.buttons.matching(identifier: "studioItem").matching(NSPredicate(format: "label CONTAINS %@", "Review checklist")).firstMatch.tap()
        XCTAssertTrue(app.staticTexts.matching(NSPredicate(format: "label BEGINSWITH %@", "Search and list cards share")).firstMatch.waitForExistence(timeout: 15))
        capture("v5-search-studio-" + device)
        capture("v5-studio-" + device)
        command("tab?threads")
        let thread = app.buttons["inbox-thread-thr_botdemo01"]
        XCTAssertTrue(thread.waitForExistence(timeout: 20))
        thread.tap()
        try assertSearch(app, device: device)
        capture("v5-search-threads-" + device)
        capture("v5-threads-" + device)
        command("tab?settings")
        XCTAssertTrue(app.buttons["Server"].waitForExistence(timeout: 10))
        try assertCard(app, device: device)
    }

    func testLightSearchClearKeepsAlignment() throws {
        let env = ProcessInfo.processInfo.environment
        guard env["BBGO_QA_DEVICE"] == "ipad" else {
            throw XCTSkip("Wide clear-button interaction uses iPad's full touch surface; phone search is checked separately")
        }
        let app = XCUIApplication()
        app.launchArguments = ["-skipPushPrompt", "YES",
            "-qaBotDemo", "duo", "-qaDuoPhone", "-qaDuoColdWide", "-qaStudioDemo", "-openURL", "bbstudio://home"]
        app.launchOffline()
        command("tab?studio")
        let input = app.textFields["sidebarSearchInput"]
        XCTAssertTrue(input.waitForExistence(timeout: 20))
        let field = app.otherElements["sidebarSearchField"].firstMatch
        let before = field.frame
        input.tap()
        input.typeText("Duo")
        XCTAssertTrue(app.buttons["Clear search"].waitForExistence(timeout: 5))
        XCTAssertEqual(field.frame.minX, before.minX, accuracy: 1)
        XCTAssertEqual(field.frame.maxX, before.maxX, accuracy: 1)
        app.buttons["Clear search"].tap()
        XCTAssertEqual(input.value as? String, "Search Studio")
        XCTAssertFalse(app.buttons["Clear search"].exists)
        capture("qa-v4-search-light-" + (env["BBGO_QA_DEVICE"] ?? "device"))
    }

    func testNativeIPadSidebarAlignment() throws {
        let env = ProcessInfo.processInfo.environment
        guard env["BBGO_QA_DEVICE"] == "ipad" else { throw XCTSkip("Native iPad size check") }
        XCUIDevice.shared.orientation = .landscapeLeft
        defer { XCUIDevice.shared.orientation = .portrait }
        let app = XCUIApplication()
        app.launchArguments = ["-skipPushPrompt", "YES",
            "-qaBotDemo", "duo", "-qaDuoPhone", "-qaStudioDemo", "-openURL", "bbstudio://home"]
        app.launchOffline()
        for tab in ["studio", "threads"] {
            command("tab?" + tab)
            XCTAssertTrue(app.textFields["sidebarSearchInput"].waitForExistence(timeout: 20))
            try assertSearch(app, device: "ipad")
        }
    }

    func testPhoneKeepsNativeSearch() throws {
        let env = ProcessInfo.processInfo.environment
        guard env["BBGO_QA_DEVICE"] == "duo" else { throw XCTSkip("Phone-only native search check") }
        let app = XCUIApplication()
        app.launchArguments = ["-skipPushPrompt", "YES",
            "-qaBotDemo", "duo", "-qaDuoPhone", "-qaStudioDemo", "-openURL", "bbstudio://home"]
        app.launchOffline()
        for tab in ["threads", "studio"] {
            command("tab?" + tab)
            if app.buttons["Search"].exists { app.buttons["Search"].tap() }
            XCTAssertTrue(app.searchFields.firstMatch.waitForExistence(timeout: 10))
            XCTAssertFalse(app.textFields["sidebarSearchInput"].exists)
        }
    }

    /// The Bot's chat row: "Chat", with its state after it ("Chat, Waiting for approval").
    private static let chatRow = NSPredicate(format: "label == 'Chat' OR label BEGINSWITH 'Chat,'")
    private func botChatRow(_ app: XCUIApplication) -> XCUIElement { app.buttons.matching(Self.chatRow).firstMatch }

    private func firstCard(_ app: XCUIApplication) throws -> XCUIElement {
        func id(_ identifier: String) -> NSPredicate { NSPredicate(format: "identifier == %@ OR label == %@", identifier, identifier) }
        let button: NSPredicate
        if app.buttons.matching(identifier: "studioItem").firstMatch.exists { button = id("studioItem") }
        else if app.buttons["inbox-thread-thr_botdemo01"].exists { button = id("inbox-thread-thr_botdemo01") }
        else if botChatRow(app).exists { button = Self.chatRow }
        else { button = id("Server") }
        // Identify a real item row, excluding pager and section-header cells.
        let rows = app.cells.containing(NSCompoundPredicate(andPredicateWithSubpredicates: [
            NSPredicate(format: "elementType == %d", XCUIElement.ElementType.button.rawValue), button]))
        let candidates = rows.allElementsBoundByIndex.filter {
            let frame = $0.frame
            return frame.minX >= 64 && frame.maxX <= app.windows.firstMatch.frame.width / 2 + 1 && frame.width > 150 && frame.height < 200
        }
        return try XCTUnwrap(candidates.first)
    }
    private func assertCard(_ app: XCUIApplication, device: String) throws {
        let card = try firstCard(app)
        let crease = app.windows.firstMatch.frame.width / 2
        let sidebarTrailing = crease - 16
        XCTAssertEqual(card.frame.minX - 64, sidebarTrailing - card.frame.maxX, accuracy: 1,
            "Cards have matching margins inside the sidebar, clear of the crease gutter")
    }
    private func assertSearch(_ app: XCUIApplication, device: String) throws {
        let field = app.otherElements["sidebarSearchField"].firstMatch
        XCTAssertTrue(field.waitForExistence(timeout: 10))
        let card = try firstCard(app)
        print("SEARCH \(field.frame) CARD \(card.frame)")
        XCTAssertEqual(field.frame.minX, card.frame.minX, accuracy: 1)
        XCTAssertEqual(field.frame.maxX, card.frame.maxX, accuracy: 1)
        try assertCard(app, device: device)
        XCTAssertEqual(app.buttons.matching(identifier: "Clear search").count, 0)
    }
    private func command(_ path: String) { XCUIDevice.shared.system.open(URL(string: "bbstudio://qa-duo/" + path)!) }
    private func capture(_ name: String) { command("capture?" + name) }
}
