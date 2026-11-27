import XCTest

extension XCUIApplication {
    /// A screen's action button, in its bar (`screenAction-<id>`).
    func screenAction(_ id: String) -> XCUIElement { buttons["screenAction-\(id)"].firstMatch }

    /// A screen's More: the ⋯ in its bar.
    var screenMore: XCUIElement { buttons["screenMore"].firstMatch }

    /// An action under More, opening More first.
    func screenMoreAction(_ id: String) {
        screenMore.tap()
        let item = buttons["screenAction-\(id)"].firstMatch
        _ = item.waitForExistence(timeout: 5)
        item.tap()
    }
}
