import XCTest

/// Strands in the timeline (slice 4), offline (`-qaSpacesDemo list -qaBotDemo chat -qaStrandsDemo`; the demo answers
/// `strands.tags` for Main): dividers where the strand changes, a divider or
/// a strand tapped shows only that strand with "N other messages" in place of
/// the rest, and ✕ shows everything again. `TEST_RUNNER_FILTER_OUT` keeps PNGs.
final class StrandFilterUITests: ServerIsolatedUITestCase {
    private let app = XCUIApplication()

    private func any(_ id: String) -> XCUIElement { app.descendants(matching: .any)[id].firstMatch }

    func testDividersAndOnlyThisStrand() {
        app.launchArguments = ["-skipPushPrompt", "YES", "-qaBotDemo", "chat", "-qaSpacesDemo", "list", "-qaStrandsDemo",
                               "-qaRoomConversation", "thr_botdemo01"]
        app.launchOffline()
        XCTAssertTrue(app.textViews["Message"].waitForExistence(timeout: 30))
        let divider = app.buttons.matching(identifier: "strandDivider").firstMatch
        XCTAssertTrue(divider.waitForExistence(timeout: 20), "a divider where the strand changes")
        shot("1-dividers")

        app.buttons["strands-toggle"].tap()
        let stills = app.buttons["strand-str_stills"]
        XCTAssertTrue(stills.waitForExistence(timeout: 10))
        stills.tap()
        let bar = any("strandFilter")
        XCTAssertTrue(bar.waitForExistence(timeout: 10), "only this strand")
        XCTAssertTrue(bar.label.contains("Theme stills") || app.staticTexts["Only: Theme stills"].exists)
        XCTAssertTrue(any("strandGap").waitForExistence(timeout: 10), "the other messages fold into a gap")
        XCTAssertFalse(app.buttons.matching(identifier: "strandDivider").firstMatch.exists, "no dividers while filtered")
        shot("2-only")

        app.buttons["strandFilterClear"].tap()
        XCTAssertTrue(bar.waitForNonExistence(timeout: 10))
        XCTAssertTrue(app.buttons.matching(identifier: "strandDivider").firstMatch.waitForExistence(timeout: 10), "everything again")
    }

    private func shot(_ name: String) {
        guard let folder = ProcessInfo.processInfo.environment["FILTER_OUT"] else { return }
        sleep(1)
        let url = URL(fileURLWithPath: folder)
        try? FileManager.default.createDirectory(at: url, withIntermediateDirectories: true)
        try? XCUIScreen.main.screenshot().pngRepresentation.write(to: url.appendingPathComponent("\(name).png"))
    }
}
