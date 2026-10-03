import XCTest
import UIKit

/// Opt-in, read-only UI review. Never inherit BB's production/default server.
final class ReviewQualityUITests: XCTestCase {
    private var fixture: String { StagedFixture.serverURL }
    private var auditFindings: [String] = []

    override func setUpWithError() throws {
        continueAfterFailure = false
        guard StagedFixture.isIsolated else {
            throw XCTSkip("Use the isolated UI runner and its private simulator.")
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
                    if self.excludeVerifiedContrast(issue, in: app, name: name) { return true }
                let finding = "\(name): \(issue.auditType) \(issue.compactDescription); \(issue.detailedDescription) [\(issue.element?.label ?? "unknown element")] frame=\(String(describing: issue.element?.frame)) id=\(issue.element?.identifier ?? "nil")"
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

    /// Retain an additional Settings capture with the same strict contrast gate.
    func testSettingsSecondContrastNativeDiagnostic() throws {
        let app = try diagnosticApplication(largeText: false)
        defer { app.terminate() }
        try captureNativeDiagnostic(app, "settings-second-contrast-native-default", audit: [.contrast])
    }

    func testHomeContrastNativeDiagnosticAtAccessibilityText() throws {
        let app = try diagnosticApplication(largeText: true)
        defer { app.terminate() }
        app.tabBars.buttons["Home"].tap()
        XCTAssertTrue(app.buttons["Hand Off to a Bot"].waitForExistence(timeout: 20))
        try captureNativeDiagnostic(app, "home-contrast-native-accessibility-xxxl", audit: [.contrast])
    }

    func testCaptureTextPixelEvidenceAtBothSizes() throws {
        for large in [false, true] {
            let app = try diagnosticApplication(largeText: large)
            app.open(URL(string: "bbstudio://capture")!)
            XCTAssertTrue(app.navigationBars["Capture to BB"].waitForExistence(timeout: 10))
            let size = large ? "accessibility-xxxl" : "default"
            for (id, text) in [("voice", "Record voice"), ("dictate", "Dictate"), ("file", "Photo or file"), ("thread", "New thread")] {
                let control = app.buttons["capture-\(id)"]
                reveal(control, in: app)
                let label = control.staticTexts[text].firstMatch
                XCTAssertTrue(label.exists)
                // AX mixes Float32 and CGFloat rectangles; allow only subpixel conversion noise.
                // The independently recognized glyph bounds below still use the exact control frame.
                XCTAssertTrue(control.frame.insetBy(dx: -1.0 / 1024, dy: -1.0 / 1024).contains(label.frame), "Label \(label.frame) must fit inside control \(control.frame) for \(text)")
                let wholeControl = XCTAttachment(screenshot: control.screenshot())
                wholeControl.name = "ocr-\(id)-\(size)-control"
                wholeControl.lifetime = .keepAlways
                add(wholeControl)
                let screenshot = label.screenshot()
                let labelFrame = label.frame
                let lines = try RenderedText.lines(in: screenshot.image).map { line in
                    RenderedText.Line(text: line.text, confidence: line.confidence,
                        bounds: CGRect(x: labelFrame.minX + line.bounds.minX * labelFrame.width,
                                       y: labelFrame.maxY - line.bounds.maxY * labelFrame.height,
                                       width: line.bounds.width * labelFrame.width,
                                       height: line.bounds.height * labelFrame.height))
                }
                let crop = XCTAttachment(screenshot: screenshot)
                crop.name = "ocr-\(id)-\(size)"
                crop.lifetime = .keepAlways
                add(crop)
                let detail = "expected=\(text); control=\(control.frame); observations=\(lines.map { "\($0.text) confidence=\($0.confidence) bounds=\($0.bounds)" })"
                let record = XCTAttachment(string: detail)
                record.name = "ocr-\(id)-\(size)-results"
                record.lifetime = .keepAlways
                add(record)
                print("AUDIT-OCR: \(detail)")
                XCTAssertTrue(RenderedText.proves(text, lines: lines, inside: control.frame), detail)
            }
            app.terminate()
        }
    }

    func testCaptureClippingAtAccessibilityText() throws {
        let app = try diagnosticApplication(largeText: true)
        defer { app.terminate() }
        app.open(URL(string: "bbstudio://capture")!)
        XCTAssertTrue(app.navigationBars["Capture to BB"].waitForExistence(timeout: 10))
        retainScreen(app, "capture-clipping-accessibility-xxxl")
        // Keep Apple's original highlighted crop while diagnosing clipped text.
        try app.performAccessibilityAudit(for: [.textClipped])
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

    /// Retain an additional Studio-row capture with the same strict contrast gate.
    func testStudioRowSecondContrastNativeDiagnosticAtAccessibilityText() throws {
        let app = try diagnosticApplication(largeText: true)
        defer { app.terminate() }
        app.open(URL(string: "bbstudio://studio")!)
        XCTAssertTrue(app.navigationBars["Studio"].waitForExistence(timeout: 20))
        app.swipeUp()
        XCTAssertTrue(app.descendants(matching: .any)["studioItem"].firstMatch.waitForExistence(timeout: 10))
        try captureNativeDiagnostic(app, "studio-row-second-contrast-native-accessibility-xxxl", audit: [.contrast])
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
            let request = app.cells.containing(.staticText, identifier: "Native approval card QA").firstMatch
            let action = request.buttons[label].firstMatch
            XCTAssertTrue(action.waitForExistence(timeout: 10))
            reveal(action, in: app)
            checkTarget(action)
            XCTAssertGreaterThanOrEqual(action.frame.width, 44 - 0.001)
            XCTAssertGreaterThanOrEqual(action.frame.height, 44 - 0.001)
            retainScreen(app, "inbox-approval-" + (largeText ? "accessibility-xxxl" : "default") + "-action-" + label.lowercased().replacingOccurrences(of: " ", with: "-"))
        }
        let request = app.cells.containing(.staticText, identifier: "Native approval card QA").firstMatch
        let open = request.buttons["officeRequestOpen"]
        for _ in 0..<5 {
            if open.isHittable { break }
            app.swipeDown()
        }
        XCTAssertTrue(open.isHittable)
        open.tap()
        let thread = app.navigationBars["Native approval card QA"]
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
        guard let title = ProcessInfo.processInfo.environment["BBGO_QA_PLAN_THREAD_TITLE"],
              title == "Native approval card QA" else {
            throw XCTSkip("Requires the isolated held inert plan fixture")
        }
        let app = try diagnosticApplication(largeText: largeText, tab: "inbox")
        defer { app.terminate() }
        XCTAssertTrue(app.navigationBars["Inbox"].waitForExistence(timeout: 20))
        let request = app.cells.containing(.staticText, identifier: "Native approval card QA").firstMatch
        let open = request.buttons["officeRequestOpen"]
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

    private func captureNativeDiagnostic(_ app: XCUIApplication, _ name: String, audit: XCUIAccessibilityAuditType) throws {
        let screenshot = XCTAttachment(screenshot: app.screenshot())
        screenshot.name = name
        screenshot.lifetime = .keepAlways
        add(screenshot)
        let tree = XCTAttachment(string: app.debugDescription)
        tree.name = name + "-accessibility-tree"
        tree.lifetime = .keepAlways
        add(tree)
        let findings = try auditedFindings(app, name: name, types: audit)
        XCTAssertTrue(findings.isEmpty, findings.map(\.description).joined(separator: "\n"))
    }

    private struct AuditFinding {
        let type: XCUIAccessibilityAuditType
        let description: String
        let key: String
        let scrollEdgeContrast: Bool
    }

    private func collectAudit(_ app: XCUIApplication, name: String, types: XCUIAccessibilityAuditType) throws -> [AuditFinding] {
        var findings: [AuditFinding] = []
        try app.performAccessibilityAudit(for: types) { issue in
            if self.excludeVerifiedContrast(issue, in: app, name: name) { return true }
            let element = issue.element
            let label = element?.label ?? "unknown element"
            let identifier = element?.identifier ?? "nil"
            let detail = "\(name): \(issue.auditType) \(issue.detailedDescription) [\(label)] frame=\(String(describing: element?.frame)) id=\(identifier)"
            print("QUALITY: \(detail)")
            let bars = app.tabBars.allElementsBoundByIndex + app.toolbars.allElementsBoundByIndex + app.navigationBars.allElementsBoundByIndex
            let barFrames = bars.filter { $0.exists && $0.isHittable }.map(\.frame)
            let atMaterialEdge = element.map { element in
                barFrames.contains { bar in
                    bar.intersects(element.frame) || (bar.midY > app.frame.midY && element.frame.minY >= bar.minY)
                }
            } ?? true
            findings.append(AuditFinding(type: issue.auditType, description: detail + " nativeBars=\(barFrames)",
                key: "\(issue.auditType.rawValue)|\(identifier)|\(label)",
                scrollEdgeContrast: issue.auditType == .contrast && atMaterialEdge))
            return true
        }
        return findings
    }

    private func auditedFindings(_ app: XCUIApplication, name: String, types: XCUIAccessibilityAuditType) throws -> [AuditFinding] {
        let initial = try collectAudit(app, name: name, types: types)
        guard initial.contains(where: \.scrollEdgeContrast) else { return initial }
        retainScreen(app, name + "-material-before-scroll")
        let collection = app.collectionViews.firstMatch
        let scroll = collection.exists ? collection : app.scrollViews.firstMatch
        guard scroll.exists, scroll.isHittable else { return initial }
        var reachedEnd = false
        for _ in 0..<30 {
            let before = scroll.staticTexts.allElementsBoundByIndex.suffix(3).map { "\($0.label)|\($0.frame)" }
            scroll.swipeUp(velocity: .fast)
            let after = scroll.staticTexts.allElementsBoundByIndex.suffix(3).map { "\($0.label)|\($0.frame)" }
            let bottom = app.tabBars.allElementsBoundByIndex.filter { $0.isHittable }.map { $0.frame.minY }.min() ?? app.frame.maxY
            if !before.isEmpty && before == after,
               let last = scroll.staticTexts.allElementsBoundByIndex.last,
               last.isHittable, last.frame.maxY <= bottom {
                reachedEnd = true
                break
            }
        }
        retainScreen(app, name + "-material-after-scroll")
        guard reachedEnd else { return initial }
        let retry = try collectAudit(app, name: name + "-material-retry", types: [.contrast])
        let knownContrast = Set(initial.filter { $0.type == .contrast && !$0.scrollEdgeContrast }.map(\.key))
        let originalEdgeKeys = Set(initial.filter(\.scrollEdgeContrast).map(\.key))
        let resolved = !retry.contains(where: \.scrollEdgeContrast)
            && !retry.contains { originalEdgeKeys.contains($0.key) }
            && retry.allSatisfy { knownContrast.contains($0.key) }
        let evidence = "\(name): policy 2 scroll/reaudit: initial=\(initial.filter { $0.type == .contrast }.map(\.description)); retry=\(retry.map(\.description)); reachedEnd=\(reachedEnd); resolved=\(resolved)"
        print("AUDIT-MATERIAL-RETRY: \(evidence)")
        let record = XCTAttachment(string: evidence)
        record.name = name + "-material-reaudit-results"
        record.lifetime = .keepAlways
        add(record)
        if resolved { return initial.filter { !$0.scrollEdgeContrast } }
        return initial + retry.filter { !knownContrast.contains($0.key) }
    }

    /// Coordinator policy: identified disabled controls or independently sampled
    /// readable text on a resolved element may override native contrast findings.
    /// Non-monochrome or insufficient pixel samples still fail closed.
    private func excludeVerifiedContrast(_ issue: XCUIAccessibilityAuditIssue, in app: XCUIApplication, name: String) -> Bool {
        guard issue.auditType == .contrast else { return false }
        guard let element = issue.element else {
            print("AUDIT-UNRESOLVED: \(name): contrast issue has no element or queryable frame")
            return false
        }
        let identifier = element.identifier
        print("AUDIT-CONTRAST: \(name): id=\(identifier) label=\(element.label) enabled=\(element.isEnabled) frame=\(element.frame)")
        var reason: String?
        if identifier == "captureNoteSave", !element.isEnabled {
            reason = "policy 1: captureNoteSave is disabled (inactive control)"
        } else if !element.label.isEmpty, !element.frame.isEmpty,
                  app.frame.contains(element.frame) {
            let screenshot = element.screenshot()
            if let sample = RenderedContrast.sample(screenshot.image), sample.ratio >= 4.5 {
                reason = "policy 3: resolved element id=\(identifier) label=\(element.label) sRGB foreground=\(sample.foreground), background=\(sample.background), contrast=\(sample.ratio):1"
                let crop = XCTAttachment(screenshot: screenshot)
                crop.name = name + "-verified-element-contrast"
                crop.lifetime = .keepAlways
                add(crop)
            }
        }
        guard let reason else { return false }
        let evidence = "\(name): \(reason); element frame=\(element.frame)"
        print("AUDIT-EXCLUSION: \(evidence)")
        let record = XCTAttachment(string: evidence)
        record.name = name + "-contrast-exclusion"
        record.lifetime = .keepAlways
        add(record)
        retainScreen(app, name + "-contrast-exclusion-screen")
        return true
    }

    func testContrastSamplerRejectsLowContrastAndSparseDarkPixels() throws {
        func swatch(_ foreground: CGFloat, sparse: Bool = false) -> UIImage {
            UIGraphicsImageRenderer(size: CGSize(width: 100, height: 50)).image { context in
                UIColor.white.setFill()
                context.fill(CGRect(x: 0, y: 0, width: 100, height: 50))
                UIColor(white: foreground, alpha: 1).setFill()
                context.fill(CGRect(x: 30, y: 15, width: sparse ? 1 : 40, height: sparse ? 1 : 20))
            }
        }
        XCTAssertEqual(RenderedContrast.sample(swatch(0))?.ratio ?? 0, 21, accuracy: 0.01)
        let lowContrast = try XCTUnwrap(RenderedContrast.sample(swatch(120.0 / 255)))
        XCTAssertLessThan(lowContrast.ratio, 4.5)
        XCTAssertNil(RenderedContrast.sample(swatch(0, sparse: true)))
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
        for _ in 0..<8 {
            let top = app.navigationBars.allElementsBoundByIndex.filter { $0.isHittable }.map { $0.frame.maxY }.max() ?? app.frame.minY
            let bottom = app.frame.maxY - 20
            if element.exists && element.isHittable,
               element.frame.minY >= top, element.frame.maxY <= bottom { return }
            let scroll = app.scrollViews.firstMatch
            if element.exists && element.frame.minY < top {
                if scroll.exists { scroll.swipeDown() } else { app.swipeDown() }
            } else {
                if scroll.exists { scroll.swipeUp() } else { app.swipeUp() }
            }
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
        let findings = try auditedFindings(app, name: name, types: [.contrast, .elementDetection, .hitRegion, .sufficientElementDescription, .dynamicType, .textClipped])
        auditFindings.append(contentsOf: findings.map(\.description))
    }
}
