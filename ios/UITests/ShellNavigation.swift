import XCTest

/// Round 7: Home is the root and everything is pushed over it. Helpers to
/// reach Home, its places and a conversation, on the iPhone's bar or the
/// Duo's rail.
extension XCUIApplication {
    /// A conversation shows (its composer).
    func waitForRoom(timeout: TimeInterval = 30) -> Bool {
        textViews["Message"].waitForExistence(timeout: timeout)
    }

    private var home: XCUIElement { descendants(matching: .any)["home"].firstMatch }

    /// Home, from wherever: Back on the iPhone, Home in the Duo's rail.
    func goHome(file: StaticString = #filePath, line: UInt = #line) {
        for _ in 0..<4 where !(home.exists && home.isHittable) {
            let rail = buttons.matching(NSPredicate(format: "identifier IN %@", ["rail-home", "rail-back"])).firstMatch
            if rail.exists, rail.isHittable { rail.tap() } else if navigationBars.buttons.firstMatch.exists {
                navigationBars.buttons.element(boundBy: 0).tap()
            }
            _ = home.waitForExistence(timeout: 3)
        }
        XCTAssertTrue(home.waitForExistence(timeout: 10), "Home", file: file, line: line)
    }

    /// One of Home's places: Memory, Library and Archive are rows; Schedules,
    /// Theme and Settings are in the Bot menu. "conversations" is Home itself.
    func openRoomPlace(_ place: String, file: StaticString = #filePath, line: UInt = #line) {
        goHome(file: file, line: line)
        guard place != "conversations" else { return }
        let row = botMenuItem(place)
        // Archive is Home's last row: scroll to it.
        for _ in 0..<4 where place == "archive" && !(row.exists && row.isHittable) { home.swipeUp() }
        if !row.exists { openBotMenu(file: file, line: line) }
        XCTAssertTrue(row.waitForExistence(timeout: 10), "\(place) on Home", file: file, line: line)
        row.tap()
    }

    /// A place on Home or in its Bot menu, by id or by its title.
    func botMenuItem(_ place: String) -> XCUIElement {
        let ids = ["memory": "homeMemory", "library": "homeLibrary", "archive": "homeArchive", "schedules": "homeSchedules",
                   "theme": "homeTheme", "settings": "homeSettings"]
        let titles = ["memory": "Memory", "library": "Library", "schedules": "Schedules", "theme": "Theme", "archive": "Archive",
                      "settings": "Settings"]
        return buttons.matching(NSPredicate(format: "identifier == %@ OR label == %@", ids[place] ?? place, titles[place] ?? place)).firstMatch
    }

    /// Home's Bot menu (switch Bot, Schedules, Theme, Settings), open.
    func openBotMenu(file: StaticString = #filePath, line: UInt = #line) {
        let menu = buttons["botSwitcher"].firstMatch
        XCTAssertTrue(menu.waitForExistence(timeout: 10), "the Bot menu", file: file, line: line)
        menu.tap()
    }

    /// A conversation from Home, pushed over it.
    func pickConversation(_ id: String, file: StaticString = #filePath, line: UInt = #line) {
        goHome(file: file, line: line)
        let row = buttons["homeConversation-\(id)"]
        XCTAssertTrue(row.waitForExistence(timeout: 10), "\(id) on Home", file: file, line: line)
        row.tap()
        XCTAssertTrue(waitForRoom(timeout: 15), "the conversation opens", file: file, line: line)
    }

    /// Back from a pushed screen: the bar's Back, or Home in the Duo's rail.
    func goBack(timeout: TimeInterval = 20, file: StaticString = #filePath, line: UInt = #line) {
        let bar = navigationBars.firstMatch
        let rail = buttons.matching(NSPredicate(format: "identifier IN %@", ["rail-back", "rail-home"])).firstMatch
        let shown = XCTNSPredicateExpectation(predicate: NSPredicate { _, _ in
            bar.buttons.firstMatch.exists || (rail.exists && rail.isHittable)
        }, object: nil)
        XCTAssertEqual(XCTWaiter.wait(for: [shown], timeout: timeout), .completed, "a way back", file: file, line: line)
        if bar.buttons.firstMatch.exists { bar.buttons.element(boundBy: 0).tap() } else { rail.tap() }
    }

    /// The conversation's menu: ⋯ in the iPhone's bar, More in the Duo's rail.
    var conversationMore: XCUIElement {
        buttons.matching(NSPredicate(format: "identifier == 'conversationMore' OR identifier == 'rail-more'")).firstMatch
    }

    /// The conversation's menu, open.
    func openConversationMenu(file: StaticString = #filePath, line: UInt = #line) {
        let more = conversationMore
        XCTAssertTrue(more.waitForExistence(timeout: 15), "the conversation's menu", file: file, line: line)
        more.tap()
        XCTAssertTrue(buttons["Find in conversation"].waitForExistence(timeout: 5), "its items", file: file, line: line)
    }

    /// The conversation's name: the bar's title, or the Duo's title line.
    var conversationTitle: XCUIElement {
        descendants(matching: .any).matching(NSPredicate(format: "identifier == 'conversationTitle' OR identifier == 'shellTitle'")).firstMatch
    }

    /// Which conversation shows: its title.
    var shownConversation: XCUIElement { conversationTitle }

    /// A reply thread or fork is pushed over its conversation: Back.
    func closeReplyThread() {
        goBack()
    }

    /// The Duo: its controls are in the rail.
    var isFoldedDuo: Bool { descendants(matching: .any)["shellRail"].exists }
}
