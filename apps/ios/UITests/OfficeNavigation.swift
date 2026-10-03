import XCTest

extension XCUIApplication {
    /// Return to the actual Tabs root before opening one of its secondary screens.
    func showOfficeTabs(file: StaticString = #filePath, line: UInt = #line) {
        let tabs = tabBars.buttons["Tabs"]
        XCTAssertTrue(tabs.waitForExistence(timeout: 15), file: file, line: line)
        tabs.tap()
        for _ in 0..<8 {
            if buttons["officeTabsNew"].exists { break }
            let back = navigationBars.buttons.firstMatch
            guard back.exists else { break }
            back.tap()
        }
        XCTAssertTrue(buttons["officeTabsNew"].waitForExistence(timeout: 15), file: file, line: line)
    }

    func openOfficeScreen(_ name: String, file: StaticString = #filePath, line: UInt = #line) {
        showOfficeTabs(file: file, line: line)
        buttons["officeTabsNew"].tap()
        let item = buttons[name].firstMatch
        XCTAssertTrue(item.waitForExistence(timeout: 5), file: file, line: line)
        item.tap()
    }
}
