import XCTest

/// Opt-in read-only performance observation. The runner and app must use staged BB.
final class ReviewPerformanceUITests: XCTestCase {
    private let fixture = "http://127.0.0.1:49486"

    override func setUpWithError() throws {
        continueAfterFailure = false
        guard ProcessInfo.processInfo.environment["BB_PERFORMANCE_QA_SERVER_URL"] == fixture,
              ProcessInfo.processInfo.environment["BB_PERFORMANCE_QA_PRIVATE_SIM"] == "YES" else {
            throw XCTSkip("Requires exact staged origin and fresh private simulator opt-in before app launch.")
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
        app.tabBars.buttons["Studio"].tap()
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
