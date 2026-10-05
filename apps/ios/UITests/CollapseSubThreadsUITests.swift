import XCTest

/// A thread with sub-threads collapses and expands from its long-press menu.
/// Set TEST_RUNNER_BBGO_PARENT_TITLE to the title of a thread on Home that has
/// sub-threads. It's left as it was: expanded again if it started expanded.
final class CollapseSubThreadsUITests: XCTestCase {
    private let app = XCUIApplication()

    func testCollapseFromLongPress() throws {
        guard let title = ProcessInfo.processInfo.environment["BBGO_PARENT_TITLE"] else {
            throw XCTSkip("set TEST_RUNNER_BBGO_PARENT_TITLE")
        }
        app.launchArguments += ["-skipPushPrompt", "YES"]
        app.launch()
        let row = app.staticTexts[title].firstMatch
        XCTAssertTrue(row.waitForExistence(timeout: 20))

        row.press(forDuration: 1)
        let collapse = app.buttons.matching(NSPredicate(format: "label BEGINSWITH 'Collapse '")).firstMatch
        let expand = app.buttons["Expand Sub-threads"]
        if expand.waitForExistence(timeout: 3) {
            // Already collapsed: open it, so the test starts expanded and ends that way.
            expand.tap()
            sleep(1)
            row.press(forDuration: 1)
        }
        XCTAssertTrue(collapse.waitForExistence(timeout: 5), "a thread with sub-threads offers Collapse")
        collapse.tap()
        let mark = app.descendants(matching: .any).matching(NSPredicate(format: "label ENDSWITH 'collapsed'")).firstMatch
        XCTAssertTrue(mark.waitForExistence(timeout: 5), "the row shows how many sub-threads it folds away")
        screenshot("collapsed")

        row.press(forDuration: 1)
        XCTAssertTrue(expand.waitForExistence(timeout: 5))
        expand.tap()
        XCTAssertTrue(mark.waitForNonExistence(timeout: 5), "Expand shows them again")
        screenshot("expanded")
    }

    private func screenshot(_ name: String) {
        let attachment = XCTAttachment(screenshot: XCUIScreen.main.screenshot())
        attachment.name = name
        attachment.lifetime = .keepAlways
        add(attachment)
        try? XCUIScreen.main.screenshot().pngRepresentation.write(to: URL(fileURLWithPath: "/tmp/qa-collapse-\(name).png"))
    }
}
