import XCTest

@MainActor
final class DuoSidebarSearchUITests: XCTestCase {
    func testWideSidebarAlignmentAndCaptures() throws {
        let env = ProcessInfo.processInfo.environment
        let device = try XCTUnwrap(env["BBGO_QA_DEVICE"])
        let app = XCUIApplication()
        app.launchArguments = ["-skipPushPrompt", "YES", "-serverURL", try XCTUnwrap(env["BBGO_QA_SERVER"]),
            "-qaBotDemo", "duo", "-qaDuoPhone", "-qaDuoColdWide", "-qaDuoLong", "-qaDark", "-openURL", "bbstudio://bot"]
        app.launch()
        XCTAssertTrue(app.buttons["Chat"].waitForExistence(timeout: 30))
        try assertCard(app, device: device)
        capture("v4-bot-" + device)
        command("tab?studio")
        XCTAssertTrue(app.buttons.matching(identifier: "studioItem").firstMatch.waitForExistence(timeout: 20))
        try assertSearch(app, device: device)
        app.buttons.matching(identifier: "studioItem").firstMatch.tap()
        XCTAssertTrue(app.staticTexts.matching(NSPredicate(format: "label BEGINSWITH %@", "Search and list cards share")).firstMatch.waitForExistence(timeout: 15))
        capture("v4-search-studio-" + device)
        capture("v4-studio-" + device)
        command("tab?threads")
        let thread = app.buttons["inbox-thread-thr_botdemo01"]
        XCTAssertTrue(thread.waitForExistence(timeout: 20))
        thread.tap()
        try assertSearch(app, device: device)
        capture("v4-search-threads-" + device)
        capture("v4-threads-" + device)
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
        app.launchArguments = ["-skipPushPrompt", "YES", "-serverURL", try XCTUnwrap(env["BBGO_QA_SERVER"]),
            "-qaBotDemo", "duo", "-qaDuoPhone", "-qaDuoColdWide", "-openURL", "bbstudio://home"]
        app.launch()
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
        app.launchArguments = ["-skipPushPrompt", "YES", "-serverURL", try XCTUnwrap(env["BBGO_QA_SERVER"]),
            "-qaBotDemo", "duo", "-qaDuoPhone", "-openURL", "bbstudio://home"]
        app.launch()
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
        app.launchArguments = ["-skipPushPrompt", "YES", "-serverURL", try XCTUnwrap(env["BBGO_QA_SERVER"]),
            "-qaBotDemo", "duo", "-qaDuoPhone", "-openURL", "bbstudio://home"]
        app.launch()
        for tab in ["threads", "studio"] {
            command("tab?" + tab)
            if app.buttons["Search"].exists { app.buttons["Search"].tap() }
            XCTAssertTrue(app.searchFields.firstMatch.waitForExistence(timeout: 10))
            XCTAssertFalse(app.textFields["sidebarSearchInput"].exists)
        }
    }

    private func firstCard(_ app: XCUIApplication) throws -> XCUIElement {
        let identifier: String
        if app.buttons.matching(identifier: "studioItem").firstMatch.exists { identifier = "studioItem" }
        else if app.buttons["inbox-thread-thr_botdemo01"].exists { identifier = "inbox-thread-thr_botdemo01" }
        else if app.buttons["Chat"].exists { identifier = "Chat" }
        else { identifier = "Server" }
        // Identify a real item row, excluding pager and section-header cells.
        let candidates = app.cells.containing(.button, identifier: identifier).allElementsBoundByIndex.filter {
            let frame = $0.frame
            return frame.minX >= 64 && frame.maxX <= app.windows.firstMatch.frame.width / 2 + 1 && frame.width > 150 && frame.height < 200
        }
        return try XCTUnwrap(candidates.first)
    }
    private func assertCard(_ app: XCUIApplication, device: String) throws {
        let card = try firstCard(app)
        let crease = app.windows.firstMatch.frame.width / 2
        let trailingInset: CGFloat = device == "duo" ? 0 : 16
        XCTAssertEqual(card.frame.maxX, crease - 16 - trailingInset, accuracy: 1,
            "Duo cards reach the crease gutter; iPad retains its existing 16pt list inset")
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
