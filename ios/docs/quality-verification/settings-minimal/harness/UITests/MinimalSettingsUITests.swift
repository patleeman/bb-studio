import XCTest

final class MinimalSettingsUITests: XCTestCase {
    override func setUpWithError() throws {
        continueAfterFailure = false
    }

    func testBaselineDetection() throws { try audit("baseline") }
    func testPlainStepperDetection() throws { try audit("stepper") }
    func testPlainHostDetection() throws { try audit("host") }
    func testBothPlainDetection() throws { try audit("both") }
    func testToggleOnlyDetection() throws { try audit("toggle-only") }
    func testStepperOnlyDetection() throws { try audit("stepper-only") }
    func testHostOnlyDetection() throws { try audit("host-only") }
    func testEmptyControlsDetection() throws { try audit("empty") }
    func testStandardStepperDetection() throws { try audit("standard-stepper-only") }
    func testSeparateStepperValueDetection() throws { try audit("separate-stepper-only") }

    private func audit(_ variant: String) throws {
        let app = XCUIApplication()
        app.launchArguments = ["-controlCase", variant]
        app.launch()
        defer { app.terminate() }
        XCTAssertTrue(app.descendants(matching: .any)["minimal-\(variant)"].waitForExistence(timeout: 10))
        let screenshot = XCTAttachment(screenshot: app.screenshot())
        screenshot.name = "minimal-\(variant)"
        screenshot.lifetime = .keepAlways
        add(screenshot)
        let tree = XCTAttachment(string: app.debugDescription)
        tree.name = "minimal-\(variant)-accessibility-tree"
        tree.lifetime = .keepAlways
        add(tree)
        try app.performAccessibilityAudit(for: [.elementDetection])
    }
}
