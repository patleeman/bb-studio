import XCTest

/// Studio pages between kinds (All, Pages, Recordings, …) with a horizontal
/// swipe, while an item row's own swipe still reveals its actions. Needs a
/// server whose Studio has at least two kinds; changes nothing (a row is only
/// dragged partway open and closed again).
final class StudioPagingUITests: XCTestCase {
    private let app = XCUIApplication()

    override func setUp() {
        continueAfterFailure = false
        app.launchArguments += ["-skipPushPrompt", "YES"]
        app.launch()
    }

    /// The selected kind chip (the tab bar's selected tab aside).
    private var selectedKind: String {
        app.buttons.matching(NSPredicate(format: "isSelected == true AND NOT (label IN %@)", ["Home", "Studio", "Chief of Staff", "Settings"]))
            .firstMatch.label
    }

    private func openStudio() throws -> XCUIElement {
        app.buttons["Studio"].firstMatch.tap()
        guard app.buttons["All"].waitForExistence(timeout: 20) else { throw XCTSkip("Studio has one kind") }
        if !app.buttons["All"].isSelected { app.buttons["All"].tap() }
        // A day header on the page shown, not a row.
        let header = app.staticTexts.matching(NSPredicate(format: "label IN %@", ["Today", "Yesterday", "Previous 7 Days"]))
            .allElementsBoundByIndex.first { $0.isHittable }
        return try XCTUnwrap(header, "a day header")
    }

    func testSwipeBetweenKinds() throws {
        let header = try openStudio()
        XCTAssertEqual(selectedKind, "All")
        header.swipeLeft()
        sleep(1)
        screenshot("kind-paged")
        let next = selectedKind
        XCTAssertNotEqual(next, "All", "a swipe left moves to the next kind")
        XCTAssertTrue(app.navigationBars["Studio"].exists)
        let back = app.staticTexts.matching(NSPredicate(format: "label IN %@", ["Today", "Yesterday", "Previous 7 Days"]))
            .allElementsBoundByIndex.first { $0.isHittable }
        try XCTUnwrap(back).swipeRight()
        sleep(1)
        XCTAssertEqual(selectedKind, "All", "a swipe right comes back")
    }

    func testRowSwipeStillOpensActions() throws {
        let header = try openStudio()
        // An item row on the page shown (neighbouring pages are loaded too).
        let row = try XCTUnwrap(app.buttons.matching(identifier: "studioItem").allElementsBoundByIndex.first { $0.isHittable })
        // Partway open only.
        row.coordinate(withNormalizedOffset: CGVector(dx: 0.8, dy: 0.5))
            .press(forDuration: 0.05, thenDragTo: row.coordinate(withNormalizedOffset: CGVector(dx: 0.45, dy: 0.5)), withVelocity: .slow, thenHoldForDuration: 0.2)
        let revealed = app.buttons["Delete"].waitForExistence(timeout: 3) || app.buttons["Archive"].exists
        screenshot("row-actions")
        // Close the actions without running one.
        header.tap()
        XCTAssertTrue(revealed, "the row's own swipe actions still open")
        XCTAssertEqual(selectedKind, "All", "a row swipe doesn't change kind")
    }

    private func screenshot(_ name: String) {
        let attachment = XCTAttachment(screenshot: XCUIScreen.main.screenshot())
        attachment.name = name
        attachment.lifetime = .keepAlways
        add(attachment)
        try? XCUIScreen.main.screenshot().pngRepresentation.write(to: URL(fileURLWithPath: "/tmp/qa-studio-paging-\(name).png"))
    }
}
