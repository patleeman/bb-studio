import XCTest

extension XCUIApplication {
    /// A screen's action button: the iPhone bar's (`screenAction-<id>`) or the Duo rail's (`rail-action-<id>`).
    func screenAction(_ id: String) -> XCUIElement {
        buttons.matching(NSPredicate(format: "identifier IN %@", ["screenAction-\(id)", "rail-action-\(id)"])).firstMatch
    }

    /// A screen's More: the bar's ⋯ or the rail's.
    var screenMore: XCUIElement {
        buttons.matching(NSPredicate(format: "identifier IN %@", ["screenMore", "rail-more"])).firstMatch
    }

    /// An action under More, opening More first.
    func screenMoreAction(_ id: String) {
        screenMore.tap()
        let item = buttons["screenAction-\(id)"].firstMatch
        _ = item.waitForExistence(timeout: 5)
        item.tap()
    }
}
