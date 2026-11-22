import XCTest

/// The conversation is home: helpers to reach the room's places.
extension XCUIApplication {
    /// The conversation shows (its composer).
    func waitForRoom(timeout: TimeInterval = 30) -> Bool {
        textViews["Message"].waitForExistence(timeout: timeout)
    }

    /// A place from the one conversation list (the header's Bot mark).
    /// "conversations" is the list itself.
    func openRoomPlace(_ place: String, file: StaticString = #filePath, line: UInt = #line) {
        let row = buttons["roomPlace-\(place)"]
        let list = descendants(matching: .any)["RoomSheet-conversations"].firstMatch
        if place == "conversations" {
            if !list.exists {
                XCTAssertTrue(buttons["roomList"].waitForExistence(timeout: 15), "the header's Bot mark", file: file, line: line)
                buttons["roomList"].tap()
            }
            XCTAssertTrue(list.waitForExistence(timeout: 10), "the conversation list", file: file, line: line)
            return
        }
        if !row.exists {
            let list = buttons["roomList"]
            XCTAssertTrue(list.waitForExistence(timeout: 15), "the header's Bot mark", file: file, line: line)
            list.tap()
            XCTAssertTrue(descendants(matching: .any)["RoomSheet-conversations"].firstMatch.waitForExistence(timeout: 10),
                          "the conversation list", file: file, line: line)
        }
        for _ in 0..<4 where !row.isHittable { swipeUp() }
        XCTAssertTrue(row.waitForExistence(timeout: 10), "\(place) in the list", file: file, line: line)
        row.tap()
    }

    /// A conversation from the one list, which closes over it.
    func pickConversation(_ id: String, file: StaticString = #filePath, line: UInt = #line) {
        openRoomPlace("conversations", file: file, line: line)
        let row = buttons["roomConversation-\(id)"]
        XCTAssertTrue(row.waitForExistence(timeout: 10), "\(id) in the list", file: file, line: line)
        row.tap()
        XCTAssertTrue(descendants(matching: .any)["RoomSheet-conversations"].firstMatch.waitForNonExistence(timeout: 10),
                      "the list closes", file: file, line: line)
    }

    /// Back from a pushed screen: the rail's Back on the folded Duo, the
    /// navigation bar's elsewhere. Waits for either to show.
    func goBack(timeout: TimeInterval = 20, file: StaticString = #filePath, line: UInt = #line) {
        // The folded Duo's conversation rail, or a pushed screen's own side
        // column there (its BackButton sits outside a navigation bar).
        let folded = buttons["folded-back"]
        let back = buttons["BackButton"].firstMatch
        let bar = navigationBars.firstMatch
        let shown = XCTNSPredicateExpectation(predicate: NSPredicate { _, _ in
            (folded.exists && folded.isHittable) || (back.exists && back.isHittable) || bar.buttons.firstMatch.exists
        }, object: nil)
        XCTAssertEqual(XCTWaiter.wait(for: [shown], timeout: timeout), .completed, "a Back button", file: file, line: line)
        // A pushed screen's own Back first: the conversation's can still show beside it.
        if back.exists, back.isHittable { return back.tap() }
        if folded.exists, folded.isHittable { return folded.tap() }
        bar.buttons.element(boundBy: 0).tap()
    }

    /// The conversation's ⋯: in the header, or in the folded Duo's side column.
    var conversationMore: XCUIElement { buttons["conversationMore"].firstMatch }

    /// The conversation's name: the header's title button, or the folded
    /// Duo's title (the side column's Bot mark opens the list there).
    var conversationTitle: XCUIElement {
        let folded = staticTexts["foldedChatTitle"]
        return folded.exists ? folded : buttons["conversationTitleList"]
    }

    /// Which conversation shows: the page dots ("Conversation 2 of 4") on
    /// the phone, the conversation's title on the folded Duo, which has none.
    var shownConversation: XCUIElement {
        isFoldedDuo ? staticTexts["foldedChatTitle"] : descendants(matching: .any)["conversationPageDots"].firstMatch
    }

    /// A reply thread or fork: Done on its sheet, Back where it's pushed.
    func closeReplyThread() {
        let done = buttons["replyThreadDone"]
        if done.waitForExistence(timeout: 3) { done.tap() } else { goBack() }
    }

    /// True on the folded Duo, whose header is a title over the messages and a side column.
    var isFoldedDuo: Bool { staticTexts["foldedChatTitle"].exists }

    func closeRoomSheet() {
        let top = coordinate(withNormalizedOffset: CGVector(dx: 0.5, dy: 0.075))
        top.press(forDuration: 0.05, thenDragTo: coordinate(withNormalizedOffset: CGVector(dx: 0.5, dy: 0.95)))
    }
}
