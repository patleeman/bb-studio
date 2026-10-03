import XCTest

/// Opt-in, read-only UI review. Never inherit BB's production/default server.
final class ReviewQualityUITests: XCTestCase {
    private let fixture = "http://127.0.0.1:49486"
    private var auditFindings: [String] = []

    override func setUpWithError() throws {
        continueAfterFailure = false
        guard ProcessInfo.processInfo.environment["BB_QA_SERVER_URL"] == fixture else {
            throw XCTSkip("Set BB_QA_SERVER_URL=http://127.0.0.1:49486 in this test target's xctestrun EnvironmentVariables. Only the isolated review fixture is allowed.")
        }
    }

    func testNavigationAtDefaultText() throws { try navigation(largeText: false) }
    func testNavigationAtAccessibilityText() throws { try navigation(largeText: true) }

    /// Let XCTest retain its native issue attachments for an unidentified finding.
    func testSettingsElementDetectionAtDefaultText() throws {
        let app = application(largeText: false)
        app.launch()
        defer { app.terminate() }
        XCTAssertTrue(app.tabBars.buttons["Settings"].waitForExistence(timeout: 20))
        app.tabBars.buttons["Settings"].tap()
        let server = app.descendants(matching: .any)["settingsServerURL"]
        XCTAssertTrue(server.waitForExistence(timeout: 10))
        XCTAssertEqual(server.value as? String, fixture)
        let screenshot = XCTAttachment(screenshot: app.screenshot())
        screenshot.name = "settings-detection-default"
        screenshot.lifetime = .keepAlways
        add(screenshot)
        let tree = XCTAttachment(string: app.debugDescription)
        tree.name = "settings-detection-default-accessibility-tree"
        tree.lifetime = .keepAlways
        add(tree)
        if #available(iOS 17.0, *) {
            // No handler: retain Apple's original failure and diagnostic attachments.
            try app.performAccessibilityAudit(for: [.elementDetection])
        }
    }

    /// Localize unidentified OCR findings without changing Settings or its data.
    func testSettingsDetectionAtScrollPositions() throws {
        let app = application(largeText: false)
        app.launch()
        defer { app.terminate() }
        XCTAssertTrue(app.tabBars.buttons["Settings"].waitForExistence(timeout: 20))
        app.tabBars.buttons["Settings"].tap()
        let server = app.descendants(matching: .any)["settingsServerURL"]
        XCTAssertTrue(server.waitForExistence(timeout: 10))
        XCTAssertEqual(server.value as? String, fixture)
        for position in 0..<5 {
            let name = "settings-detection-position-\(position)"
            let screenshot = XCTAttachment(screenshot: app.screenshot())
            screenshot.name = name
            screenshot.lifetime = .keepAlways
            add(screenshot)
            let tree = XCTAttachment(string: app.debugDescription)
            tree.name = name + "-accessibility-tree"
            tree.lifetime = .keepAlways
            add(tree)
            if #available(iOS 17.0, *) {
                try app.performAccessibilityAudit(for: [.elementDetection]) { issue in
                    let finding = "\(name): \(issue.auditType) \(issue.compactDescription); \(issue.detailedDescription) [\(issue.element?.label ?? "unknown element")]"
                    self.auditFindings.append(finding)
                    print("QUALITY: \(finding)")
                    return true // Collect positions; the final assertion stays strict.
                }
            }
            if position < 4 {
                app.coordinate(withNormalizedOffset: CGVector(dx: 0.5, dy: 0.74))
                    .press(forDuration: 0.05, thenDragTo: app.coordinate(withNormalizedOffset: CGVector(dx: 0.5, dy: 0.58)))
            }
        }
        XCTAssertTrue(auditFindings.isEmpty, auditFindings.joined(separator: "\n"))
    }

    func testStudioRowsAtAccessibilityText() throws {
        let app = application(largeText: true)
        app.launch()
        defer { app.terminate() }
        XCTAssertTrue(app.tabBars.buttons["Settings"].waitForExistence(timeout: 20))
        app.tabBars.buttons["Settings"].tap()
        let server = app.descendants(matching: .any)["settingsServerURL"]
        XCTAssertTrue(server.waitForExistence(timeout: 10))
        XCTAssertEqual(server.value as? String, fixture)
        app.open(URL(string: "bbstudio://studio")!)
        XCTAssertTrue(app.navigationBars["Studio"].waitForExistence(timeout: 20))
        app.swipeUp()
        XCTAssertTrue(app.descendants(matching: .any)["studioItem"].firstMatch.waitForExistence(timeout: 10))
        try captureAndAudit(app, "studio-rows-accessibility-xxxl")
        XCTAssertTrue(auditFindings.isEmpty, auditFindings.joined(separator: "\n"))
    }

    /// Diagnostics retain Apple's native region attachments. The aggregate
    /// navigation/row audits above remain strict and collect every finding.
    func testSettingsContrastNativeDiagnostic() throws {
        let app = try diagnosticApplication(largeText: false)
        defer { app.terminate() }
        try captureNativeDiagnostic(app, "settings-contrast-native-default", audit: [.contrast])
    }

    /// Select the second reported Settings contrast issue for localization only.
    func testSettingsSecondContrastNativeDiagnostic() throws {
        let app = try diagnosticApplication(largeText: false)
        defer { app.terminate() }
        try captureNativeDiagnostic(app, "settings-second-contrast-native-default", audit: [.contrast], skipIssues: 1)
    }

    func testHomeContrastNativeDiagnosticAtAccessibilityText() throws {
        let app = try diagnosticApplication(largeText: true)
        defer { app.terminate() }
        app.tabBars.buttons["Home"].tap()
        XCTAssertTrue(app.buttons["Hand Off to a Bot"].waitForExistence(timeout: 20))
        try captureNativeDiagnostic(app, "home-contrast-native-accessibility-xxxl", audit: [.contrast])
    }

    func testHomeClippingNativeDiagnosticAtAccessibilityText() throws {
        let app = try diagnosticApplication(largeText: true)
        defer { app.terminate() }
        app.tabBars.buttons["Home"].tap()
        XCTAssertTrue(app.buttons["Hand Off to a Bot"].waitForExistence(timeout: 20))
        try captureNativeDiagnostic(app, "home-clipping-native-accessibility-xxxl", audit: [.textClipped])
    }

    func testStudioRowContrastNativeDiagnosticAtAccessibilityText() throws {
        let app = try diagnosticApplication(largeText: true)
        defer { app.terminate() }
        app.open(URL(string: "bbstudio://studio")!)
        XCTAssertTrue(app.navigationBars["Studio"].waitForExistence(timeout: 20))
        app.swipeUp()
        XCTAssertTrue(app.descendants(matching: .any)["studioItem"].firstMatch.waitForExistence(timeout: 10))
        try captureNativeDiagnostic(app, "studio-row-contrast-native-accessibility-xxxl", audit: [.contrast])
    }

    /// Skip the already captured Select issue to retain the next original region.
    func testStudioRowSecondContrastNativeDiagnosticAtAccessibilityText() throws {
        let app = try diagnosticApplication(largeText: true)
        defer { app.terminate() }
        app.open(URL(string: "bbstudio://studio")!)
        XCTAssertTrue(app.navigationBars["Studio"].waitForExistence(timeout: 20))
        app.swipeUp()
        XCTAssertTrue(app.descendants(matching: .any)["studioItem"].firstMatch.waitForExistence(timeout: 10))
        try captureNativeDiagnostic(app, "studio-row-second-contrast-native-accessibility-xxxl", audit: [.contrast], skipIssues: 1)
    }

    /// Read-only approval-row review; opening its thread must not decide it.
    func testInboxApprovalActionsAtAccessibilityText() throws {
        try inboxApprovalActions(largeText: true)
    }

    func testInboxApprovalActionsAtDefaultText() throws {
        try inboxApprovalActions(largeText: false)
    }

    private func inboxApprovalActions(largeText: Bool) throws {
        let app = try diagnosticApplication(largeText: largeText, tab: "inbox")
        defer { app.terminate() }
        XCTAssertTrue(app.navigationBars["Inbox"].waitForExistence(timeout: 20))
        for label in ["Approve", "Deny"] {
            let action = app.buttons[label].firstMatch
            XCTAssertTrue(action.waitForExistence(timeout: 10))
            reveal(action, in: app)
            checkTarget(action)
            XCTAssertGreaterThanOrEqual(action.frame.width, 44 - 0.001)
            XCTAssertGreaterThanOrEqual(action.frame.height, 44 - 0.001)
            retainScreen(app, "inbox-approval-" + (largeText ? "accessibility-xxxl" : "default") + "-action-" + label.lowercased().replacingOccurrences(of: " ", with: "-"))
        }
        let request = app.cells.containing(.button, identifier: "Approve").firstMatch
        let open = request.staticTexts.firstMatch
        for _ in 0..<5 {
            if open.isHittable { break }
            app.swipeDown()
        }
        XCTAssertTrue(open.isHittable)
        open.tap()
        let thread = app.navigationBars["Watch approval QA 0700"]
        XCTAssertTrue(thread.waitForExistence(timeout: 10), "Opening the Inbox request must show the held fixture's thread")
        XCTAssertTrue(thread.isHittable, "Destination thread must be visible")
        retainScreen(app, "inbox-approval-" + (largeText ? "accessibility-xxxl" : "default") + "-open-thread")
    }

    private func retainScreen(_ app: XCUIApplication, _ name: String) {
        let screenshot = XCTAttachment(screenshot: app.screenshot())
        screenshot.name = name
        screenshot.lifetime = .keepAlways
        add(screenshot)
        let tree = XCTAttachment(string: app.debugDescription)
        tree.name = name + "-accessibility-tree"
        tree.lifetime = .keepAlways
        add(tree)
    }

    func testPlanApprovalActionsAtAccessibilityText() throws {
        try planApprovalActions(largeText: true)
    }

    func testPlanApprovalActionsAtDefaultText() throws {
        try planApprovalActions(largeText: false)
    }

    private func planApprovalActions(largeText: Bool) throws {
        guard let title = ProcessInfo.processInfo.environment["BB_QA_PLAN_THREAD_TITLE"],
              title == "Native approval card QA" else {
            throw XCTSkip("Requires the isolated held inert plan fixture")
        }
        let app = try diagnosticApplication(largeText: largeText, tab: "inbox")
        defer { app.terminate() }
        XCTAssertTrue(app.navigationBars["Inbox"].waitForExistence(timeout: 20))
        let request = app.cells.containing(.button, identifier: "Approve").firstMatch
        let open = request.staticTexts.firstMatch
        XCTAssertTrue(open.waitForExistence(timeout: 20))
        reveal(open, in: app)
        open.tap()
        XCTAssertTrue(app.navigationBars[title].waitForExistence(timeout: 10))
        for label in ["Approve plan", "Keep planning"] {
            let action = app.buttons[label].firstMatch
            XCTAssertTrue(action.waitForExistence(timeout: 15))
            reveal(action, in: app)
            XCTAssertTrue(action.isHittable)
            XCTAssertGreaterThanOrEqual(action.frame.width, 44 - 0.001)
            XCTAssertGreaterThanOrEqual(action.frame.height, 44 - 0.001)
            retainScreen(app, "plan-approval-" + (largeText ? "accessibility-xxxl" : "default") + "-" + label.lowercased().replacingOccurrences(of: " ", with: "-"))
        }
        try app.performAccessibilityAudit(for: [.hitRegion])
    }

    private func diagnosticApplication(largeText: Bool, tab: String = "settings") throws -> XCUIApplication {
        let app = application(largeText: largeText, tab: tab)
        app.launch()
        XCTAssertTrue(app.tabBars.buttons["Settings"].waitForExistence(timeout: 20))
        app.tabBars.buttons["Settings"].tap()
        let server = app.descendants(matching: .any)["settingsServerURL"]
        XCTAssertTrue(server.waitForExistence(timeout: 10))
        XCTAssertEqual(server.value as? String, fixture)
        if tab != "settings" { app.tabBars.buttons[tab.capitalized].tap() }
        return app
    }

    private func captureNativeDiagnostic(_ app: XCUIApplication, _ name: String, audit: XCUIAccessibilityAuditType, skipIssues: Int = 0) throws {
        let screenshot = XCTAttachment(screenshot: app.screenshot())
        screenshot.name = name
        screenshot.lifetime = .keepAlways
        add(screenshot)
        let tree = XCTAttachment(string: app.debugDescription)
        tree.name = name + "-accessibility-tree"
        tree.lifetime = .keepAlways
        add(tree)
        if #available(iOS 17.0, *) {
            if skipIssues == 0 {
                // No handler: Apple records the original finding and highlighted region.
                try app.performAccessibilityAudit(for: audit)
            } else {
                // Diagnostic selection only; the strict aggregate tests never use this.
                var seen = 0
                try app.performAccessibilityAudit(for: audit) { issue in
                    seen += 1
                    print("NATIVE-DIAGNOSTIC: \(name) issue \(seen): \(issue.detailedDescription) [\(issue.element?.label ?? "unknown element")]")
                    return seen <= skipIssues
                }
                XCTAssertGreaterThan(seen, skipIssues, "Requested diagnostic issue was not reported")
            }
        }
    }

    func testIsolatedLaunchMeasurement() {
        let app = application(largeText: false)
        let options = XCTMeasureOptions()
        options.iterationCount = 3
        measure(metrics: [XCTApplicationLaunchMetric()], options: options) {
            app.launch()
            app.terminate()
        }
    }

    private func application(largeText: Bool, tab: String = "settings") -> XCUIApplication {
        let app = XCUIApplication()
        app.launchArguments = ["-serverURL", fixture, "-skipPushPrompt", "YES", "-officeTab", tab]
        if largeText {
            app.launchArguments += ["-UIPreferredContentSizeCategoryName", "UICTContentSizeCategoryAccessibilityXXXL"]
        }
        return app
    }

    private func navigation(largeText: Bool) throws {
        let app = application(largeText: largeText)
        app.launch()
        defer { app.terminate() }
        let size = largeText ? "accessibility-xxxl" : "default"
        let settings = app.tabBars.buttons["Settings"]
        XCTAssertTrue(settings.waitForExistence(timeout: 20))
        settings.tap()
        let server = app.descendants(matching: .any)["settingsServerURL"]
        XCTAssertTrue(server.waitForExistence(timeout: 10))
        XCTAssertEqual(server.value as? String, fixture, "Abort before further UI work if origin is wrong")
        checkTarget(app.buttons["Save and test"])
        try captureAndAudit(app, "settings-\(size)")

        app.open(URL(string: "bbstudio://studio")!)
        XCTAssertTrue(app.navigationBars["Studio"].waitForExistence(timeout: 20))
        try captureAndAudit(app, "studio-\(size)")
        app.tabBars.buttons["Home"].tap()
        let handoff = app.buttons["Hand Off to a Bot"]
        XCTAssertTrue(handoff.waitForExistence(timeout: 20))
        checkTarget(handoff)
        try captureAndAudit(app, "home-\(size)")
        app.tabBars.buttons["Inbox"].tap()
        XCTAssertTrue(app.navigationBars["Inbox"].waitForExistence(timeout: 10))
        try captureAndAudit(app, "inbox-\(size)")

        app.open(URL(string: "bbstudio://capture")!)
        XCTAssertTrue(app.navigationBars["Capture to BB"].waitForExistence(timeout: 10))
        for id in ["voice", "dictate", "note", "task", "file", "thread"] {
            let button = app.buttons["capture-\(id)"]
            reveal(button, in: app)
            checkTarget(button)
        }
        app.swipeDown()
        try captureAndAudit(app, "capture-\(size)")
        let note = app.buttons["capture-note"]
        reveal(note, in: app)
        note.tap()
        XCTAssertTrue(app.descendants(matching: .any)["captureNoteText"].waitForExistence(timeout: 10))
        XCTAssertTrue(app.buttons["captureNoteSave"].exists)
        XCTAssertFalse(app.buttons["captureNoteSave"].isEnabled, "Empty note cannot be submitted")
        try captureAndAudit(app, "note-\(size)")
        app.buttons["Back"].tap()
        app.buttons["Close"].tap()
        XCTAssertFalse(app.navigationBars["Capture to BB"].exists)
        XCTAssertTrue(auditFindings.isEmpty, auditFindings.joined(separator: "\n"))
    }

    private func reveal(_ element: XCUIElement, in app: XCUIApplication) {
        for _ in 0..<5 {
            if element.exists && element.isHittable { return }
            app.swipeUp()
        }
    }

    private func checkTarget(_ element: XCUIElement, requireMinimumFrame: Bool = true, file: StaticString = #filePath, line: UInt = #line) {
        XCTAssertTrue(element.exists, "Missing \(element)", file: file, line: line)
        XCTAssertFalse(element.label.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty, "Unnamed action", file: file, line: line)
        XCTAssertTrue(element.isHittable, "Unreachable action: \(element.label)", file: file, line: line)
        if requireMinimumFrame && (element.frame.width < 44 || element.frame.height < 44) {
            let finding = "Target below 44 points: \(element.label) \(element.frame.size)"
            auditFindings.append(finding)
            print("QUALITY: \(finding)")
        }
    }

    private func captureAndAudit(_ app: XCUIApplication, _ name: String) throws {
        let screenshot = XCTAttachment(screenshot: app.screenshot())
        screenshot.name = name
        screenshot.lifetime = .keepAlways
        add(screenshot)
        let tree = XCTAttachment(string: app.debugDescription)
        tree.name = name + "-accessibility-tree"
        tree.lifetime = .keepAlways
        add(tree)
        if #available(iOS 17.0, *) {
            try app.performAccessibilityAudit(for: [.contrast, .elementDetection, .hitRegion, .sufficientElementDescription, .dynamicType, .textClipped]) { issue in
                let finding = "\(name): \(issue.auditType) \(issue.detailedDescription) [\(issue.element?.label ?? "unknown element")]"
                self.auditFindings.append(finding)
                print("QUALITY: \(finding)")
                return true // Collect every screen; the final assertion fails on any finding.
            }
        }
    }
}
