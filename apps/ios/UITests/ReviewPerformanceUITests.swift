import XCTest

/// Opt-in read-only performance observation. The runner and app must use staged BB.
final class ReviewPerformanceUITests: XCTestCase {
    private var fixture: String { StagedFixture.serverURL }

    override func setUpWithError() throws {
        continueAfterFailure = false
        guard StagedFixture.isIsolated,
              ProcessInfo.processInfo.environment["BBGO_QA_PERFORMANCE_READY"] == "YES" else {
            throw XCTSkip("Use the isolated UI runner with BB_QA_DATA_DIR to seed 24 performance pages.")
        }
    }

    func testRepeatedStudioPageNavigation() {
        let app = XCUIApplication()
        app.launchArguments = ["-serverURL", fixture, "-skipPushPrompt", "YES"]
        app.launch()
        defer { app.terminate() }
        XCTAssertTrue(app.tabBars.buttons["Settings"].waitForExistence(timeout: 20))
        app.tabBars.buttons["Settings"].tap()
        let server = app.descendants(matching: .any)["settingsServerURL"]
        XCTAssertTrue(server.waitForExistence(timeout: 10))
        XCTAssertEqual(server.value as? String, fixture)
        app.tabBars.buttons["Work"].tap()
        app.buttons["All items"].tap()
        XCTAssertTrue(app.navigationBars["Studio"].waitForExistence(timeout: 20))
        app.buttons["Pages"].tap()
        app.swipeUp()
        let rows = app.buttons.matching(identifier: "studioItem")
        XCTAssertTrue(rows.firstMatch.waitForExistence(timeout: 15))
        XCTAssertTrue(visibleFixtureRows(rows).count >= 2, "Seed 24 Native Performance pages before this suite")

        let options = XCTMeasureOptions()
        options.iterationCount = 5
        var completedCycles = 0
        measure(metrics: [XCTMemoryMetric(application: app), XCTCPUMetric(application: app), XCTClockMetric()], options: options) {
            for _ in 0..<2 {
                let before = visibleFixtureRows(rows).map(\.label)
                app.swipeUp()
                let after = visibleFixtureRows(rows).map(\.label)
                XCTAssertFalse(after.isEmpty, "Scroll must retain staged fixture rows")
                XCTAssertNotEqual(before, after, "The list must actually move between visible fixture rows")
                // Resolve by label again: lazy list indexes can be reused after scrolling.
                let pageLabel = visibleFixtureRows(rows).first!.label
                let page = rows.matching(NSPredicate(format: "label == %@", pageLabel)).firstMatch
                page.tap()
                XCTAssertTrue(app.navigationBars.matching(NSPredicate(format: "identifier BEGINSWITH %@", "Native Performance ")).firstMatch.waitForExistence(timeout: 10))
                XCTAssertTrue(app.staticTexts["Navigation fixture"].waitForExistence(timeout: 10), "Wait for page content, not only its navigation title")
                app.swipeUp()
                XCTAssertTrue(app.staticTexts.matching(NSPredicate(format: "label CONTAINS %@", "Paragraph")).firstMatch.exists)
                app.navigationBars.buttons["BackButton"].tap()
                XCTAssertTrue(app.navigationBars["Studio"].waitForExistence(timeout: 10))
                // Return toward the previous list position so repeated samples remain bounded.
                app.swipeDown()
                XCTAssertFalse(visibleFixtureRows(rows).isEmpty)
                completedCycles += 1
                print("NATIVE_PERFORMANCE completed cycle \(completedCycles)")
            }
        }
        // XCTest also runs one warm-up iteration; require every measured cycle.
        XCTAssertGreaterThanOrEqual(completedCycles, 10)
        let tree = XCTAttachment(string: app.debugDescription)
        tree.name = "native-performance-final-studio-tree"
        tree.lifetime = .keepAlways
        add(tree)
    }

    private func visibleFixtureRows(_ rows: XCUIElementQuery) -> [XCUIElement] {
        rows.allElementsBoundByIndex.filter {
            $0.label.contains("Native Performance ") && $0.isHittable &&
                $0.frame.midY > 300 && $0.frame.midY < 700
        }
    }
}
