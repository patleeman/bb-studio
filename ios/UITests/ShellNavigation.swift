import XCTest

/// Round 8: the native tab bar (Home, Library, Memory, Search) and one
/// stack per tab with native bars, in every posture. Helpers to reach Home,
/// its places and a conversation.
extension XCUIApplication {
    /// A conversation shows (its composer). The app opens on Home: a test that
    /// starts in a conversation opens its Main from there (`-qaConversation`
    /// opens another one directly).
    func waitForRoom(timeout: TimeInterval = 30) -> Bool {
        let composer = textViews["Message"]
        let main = buttons["homeConversation-thr_botdemo01"]
        let either = XCTNSPredicateExpectation(predicate: NSPredicate { _, _ in composer.exists || main.exists }, object: nil)
        guard XCTWaiter.wait(for: [either], timeout: timeout) == .completed else { return false }
        // Home may still be settling: tap Main until its conversation shows.
        let end = Date().addingTimeInterval(timeout)
        while !composer.exists, Date() < end {
            // Not `isHittable`: XCUITest can call the selected row unhittable and still tap it.
            if main.exists { main.tap() }
            _ = composer.waitForExistence(timeout: 3)
        }
        return composer.exists
    }

    /// Home's list, by its identifier alone: the system labels the Home tab's image "home" too.
    var homeList: XCUIElement { descendants(matching: .any).matching(NSPredicate(format: "identifier == %@", "home")).firstMatch }
    private var home: XCUIElement { homeList }

    /// A tap, or where the inner screen's stretched window runs past the
    /// simulator's (outer) screen, the control's action as VoiceOver runs it.
    /// The system's bar buttons stay in the outer screen's right column, so
    /// they're tapped wherever the window is.
    func press(_ element: XCUIElement, id: String) {
        // The simulator's screen is the Duo's outer one, 466 wide: past it, a tap misses.
        if element.exists, element.isHittable, windows.firstMatch.frame.width < 900 || element.frame.maxX <= 466 { return element.tap() }
        XCUIDevice.shared.system.open(URL(string: "bbstudio://qa-duo/activate?" + id)!)
        sleep(1)
    }

    /// Home is the screen on top: its New conversation shows in its bar.
    /// A list never counts as hittable, so not that.
    var homeOnTop: Bool { home.exists && homeNew.exists }

    /// A tab, by its title (Home, Library, Memory, Search): in the tab bar, or
    /// on the folded Duo, in the system's right column (a toolbar to XCUITest).
    func tab(_ title: String) -> XCUIElement {
        tabBars.buttons[title].exists ? tabBars.buttons[title].firstMatch : toolbars.buttons[title].firstMatch
    }

    /// The system's Back: in the bar, or on the folded Duo in its right column.
    var backButton: XCUIElement { buttons["BackButton"].firstMatch }

    /// Home, from wherever: Back while there is one (always in reach, unlike
    /// the tab bar under a keyboard or hidden in a conversation), else Home's tab.
    func goHome(file: StaticString = #filePath, line: UInt = #line) {
        for _ in 0..<6 where !homeOnTop {
            if backButton.exists { backButton.tap() } else if tab("Home").exists { tab("Home").tap() }
            _ = homeNew.waitForExistence(timeout: 3)
        }
        XCTAssertTrue(homeOnTop, "Home", file: file, line: line)
    }

    /// One of the Bot's places: Memory and Library are tabs, Archive is
    /// Home's last row, and Schedules, Theme and Settings are in its Bot menu.
    /// "conversations" is Home itself.
    func openRoomPlace(_ place: String, file: StaticString = #filePath, line: UInt = #line) {
        if place == "memory" || place == "library" {
            let tab = tab(place.capitalized)
            XCTAssertTrue(tab.waitForExistence(timeout: 10), "the \(place) tab", file: file, line: line)
            tab.tap()
            return
        }
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
        let ids = ["archive": "homeArchive", "schedules": "homeSchedules", "theme": "homeTheme", "settings": "homeSettings"]
        let titles = ["schedules": "Schedules", "theme": "Theme", "archive": "Archive", "settings": "Settings"]
        return buttons.matching(NSPredicate(format: "identifier == %@ OR label == %@", ids[place] ?? place, titles[place] ?? place)).firstMatch
    }

    /// Home's Bot menu (switch Bot, Schedules, Theme, Settings), open.
    func openBotMenu(file: StaticString = #filePath, line: UInt = #line) {
        let menu = buttons["botSwitcher"].firstMatch
        XCTAssertTrue(menu.waitForExistence(timeout: 10), "the Bot menu", file: file, line: line)
        menu.tap()
    }

    /// Home's list is lazy: on a short window a row further down exists once scrolled to.
    func scrollHome(to row: XCUIElement) {
        _ = row.waitForExistence(timeout: 5)
        for _ in 0..<4 where !row.exists {
            home.exists ? home.swipeUp() : swipeUp()
            _ = row.waitForExistence(timeout: 2)
        }
    }

    /// A conversation from Home, pushed over it.
    func pickConversation(_ id: String, file: StaticString = #filePath, line: UInt = #line) {
        goHome(file: file, line: line)
        let row = buttons["homeConversation-\(id)"]
        scrollHome(to: row)
        XCTAssertTrue(row.exists, "\(id) on Home", file: file, line: line)
        press(row, id: "homeConversation-\(id)")
        XCTAssertTrue(waitForRoom(timeout: 15), "the conversation opens", file: file, line: line)
    }

    /// Back from a pushed screen: the system's Back in the bar.
    func goBack(timeout: TimeInterval = 20, file: StaticString = #filePath, line: UInt = #line) {
        let back = backButton
        XCTAssertTrue(back.waitForExistence(timeout: timeout), "a way back", file: file, line: line)
        back.tap()
    }

    /// The open Duo's panes as the app lays them out (`ShellPagesReport`):
    /// where the shell starts in the window and each pane's width. The
    /// simulator's stretched window offsets the system's tab view and lets a
    /// stack's bar run into its inset, so element frames can't measure them.
    struct Pages { var minX, home, conversation, side: CGFloat
        /// The conversation's page in the window.
        var conversationX: ClosedRange<CGFloat> { (minX + home)...(minX + home + conversation) }
    }

    func pages(file: StaticString = #filePath, line: UInt = #line) -> Pages {
        XCUIDevice.shared.system.open(URL(string: "bbstudio://qa-duo/counts")!)
        sleep(1)
        let counts = (try? JSONDecoder().decode([String: Int].self, from: Data((windows.firstMatch.value as? String ?? "").utf8))) ?? [:]
        XCTAssertNotNil(counts["pages.conversation"], "the panes reported", file: file, line: line)
        func value(_ key: String) -> CGFloat { CGFloat(counts["pages." + key] ?? 0) }
        return Pages(minX: value("minX"), home: value("home"), conversation: value("conversation"), side: value("side"))
    }

    /// Home's New conversation, in its bar.
    var homeNew: XCUIElement { buttons["homeNew"].firstMatch }

    /// The conversation's ⋯ menu, in its bar.
    var conversationMore: XCUIElement { buttons["conversationMore"].firstMatch }

    /// An item of an open menu, by its title: SwiftUI's menus drop their items' identifiers.
    func menuItem(_ title: String) -> XCUIElement {
        buttons.matching(NSPredicate(format: "label == %@ OR label BEGINSWITH %@", title, title + ",")).firstMatch
    }

    /// The conversation's menu, open.
    func openConversationMenu(file: StaticString = #filePath, line: UInt = #line) {
        let more = conversationMore
        XCTAssertTrue(more.waitForExistence(timeout: 15), "the conversation's menu", file: file, line: line)
        more.tap()
        XCTAssertTrue(buttons["Find in conversation"].waitForExistence(timeout: 5), "its items", file: file, line: line)
    }

    /// The conversation's name, in its bar.
    var conversationTitle: XCUIElement { descendants(matching: .any)["conversationTitle"].firstMatch }

    /// Which conversation shows: its title.
    var shownConversation: XCUIElement { conversationTitle }

    /// A reply thread or fork is pushed over its conversation: Back.
    func closeReplyThread() {
        goBack()
    }

    /// The folded Duo: its outer screen, where the system puts the bar's buttons and the tab bar in the right column.
    var isFoldedDuo: Bool { UIDevice.current.name.lowercased().contains("duo") && windows.firstMatch.frame.width < 500 }
}
