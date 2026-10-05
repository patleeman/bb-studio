import XCTest

/// By space Home pages between Spaces with a horizontal swipe, while a thread
/// row's own swipe still reveals its actions. Needs a server in By space mode
/// with at least one Space; changes nothing on the server (a row is only
/// dragged partway open and closed again, never full-swiped).
final class SpacePagingUITests: XCTestCase {
    private let app = XCUIApplication()

    override func setUp() {
        continueAfterFailure = false
        app.launchArguments += ["-skipPushPrompt", "YES"]
        app.launch()
    }

    private var selectedSpace: String {
        // Home's title is the Space shown.
        app.navigationBars.firstMatch.identifier
    }

    private func waitForHome() throws -> XCUIElement {
        guard app.buttons["All"].waitForExistence(timeout: 20) else { throw XCTSkip("Home isn't in By space mode") }
        let header = app.staticTexts["Threads"].firstMatch
        XCTAssertTrue(header.waitForExistence(timeout: 10))
        return header
    }

    func testSwipeBetweenSpaces() throws {
        let header = try waitForHome()
        let start = selectedSpace
        header.swipeLeft()
        sleep(1)
        screenshot("space-paged")
        XCTAssertNotEqual(selectedSpace, start, "a swipe left moves to the next Space")
        app.staticTexts["Threads"].firstMatch.swipeRight()
        sleep(1)
        XCTAssertEqual(selectedSpace, start, "a swipe right comes back")
    }

    func testRowSwipeStillOpensActions() throws {
        let header = try waitForHome()
        let start = selectedSpace
        // The first thread under Threads on the page shown (neighbouring pages are loaded too).
        let row = try XCTUnwrap(app.cells.allElementsBoundByIndex.first { $0.isHittable && $0.frame.minY > header.frame.maxY })
        // Partway open only: a full swipe left would archive the thread.
        row.coordinate(withNormalizedOffset: CGVector(dx: 0.8, dy: 0.5))
            .press(forDuration: 0.05, thenDragTo: row.coordinate(withNormalizedOffset: CGVector(dx: 0.45, dy: 0.5)), withVelocity: .slow, thenHoldForDuration: 0.2)
        let revealed = app.buttons["Rename"].waitForExistence(timeout: 3)
        screenshot("row-actions")
        // Close the actions without running one.
        header.tap()
        XCTAssertTrue(revealed, "the row's own swipe actions still open")
        XCTAssertEqual(selectedSpace, start, "a row swipe doesn't change Space")
    }

    private func screenshot(_ name: String) {
        let attachment = XCTAttachment(screenshot: XCUIScreen.main.screenshot())
        attachment.name = name
        attachment.lifetime = .keepAlways
        add(attachment)
        try? XCUIScreen.main.screenshot().pngRepresentation.write(to: URL(fileURLWithPath: "/tmp/qa-space-paging-\(name).png"))
    }
}
