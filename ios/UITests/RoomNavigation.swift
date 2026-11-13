import XCTest

extension XCUIApplication {
    func waitForRoom(timeout: TimeInterval = 30) -> Bool {
        buttons["roomInput"].waitForExistence(timeout: timeout)
    }

    func openRoomPlace(_ place: String, file: StaticString = #filePath, line: UInt = #line) {
        let row = buttons["roomPlace-\(place)"]
        if !row.exists {
            let menu = buttons["roomMenuButton"]
            XCTAssertTrue(menu.waitForExistence(timeout: 15), "the room's menu button", file: file, line: line)
            menu.tap()
        }
        XCTAssertTrue(row.waitForExistence(timeout: 10), "\(place) in the menu", file: file, line: line)
        row.tap()
    }

    func standRoomChat() {
        buttons["RoomFloor"].coordinate(withNormalizedOffset: CGVector(dx: 0.5, dy: 0.92)).tap()
    }

    func closeRoomSheet() {
        let top = coordinate(withNormalizedOffset: CGVector(dx: 0.5, dy: 0.075))
        top.press(forDuration: 0.05, thenDragTo: coordinate(withNormalizedOffset: CGVector(dx: 0.5, dy: 0.95)))
    }
}
