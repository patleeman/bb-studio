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

    /// Back from a pushed screen: the rail's Back on the folded Duo, the navigation bar's elsewhere.
    func goBack() {
        let folded = buttons["folded-back"]
        if folded.exists, folded.isHittable { return folded.tap() }
        let back = navigationBars.buttons["BackButton"]
        if back.exists { return back.tap() }
        navigationBars.firstMatch.buttons.element(boundBy: 0).tap()
    }

    func closeRoomSheet() {
        let top = coordinate(withNormalizedOffset: CGVector(dx: 0.5, dy: 0.075))
        top.press(forDuration: 0.05, thenDragTo: coordinate(withNormalizedOffset: CGVector(dx: 0.5, dy: 0.95)))
    }
}
