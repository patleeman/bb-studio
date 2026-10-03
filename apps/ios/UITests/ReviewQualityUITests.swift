import XCTest
import UIKit

/// Opt-in, read-only UI review. Never inherit BB's production/default server.
final class ReviewQualityUITests: XCTestCase {
    private var fixture: String { StagedFixture.serverURL }
    private var auditFindings: [String] = []
    private var capturePixelProof: Set<String> = []
    private var largeContentProof: Set<String> = []
    private var glyphHeights: [String: CGFloat] = [:]
    private var settingsScaleProof: Set<String> = []
    private let captureTextControls = ["capture-voice": "Record voice", "capture-dictate": "Dictate", "capture-file": "Photo or file", "capture-thread": "New thread", "captureNoteSave": "Save note"]

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
        try verifyFixedControlViewers()
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

    func testCaptureLargeContentViewer() throws { try verifyFixedControlViewers() }

    private func verifyFixedControlViewers() throws {
        let app = try diagnosticApplication(largeText: true)
        defer { app.terminate() }
        app.open(URL(string: "bbstudio://capture")!)
        let note = app.buttons["capture-note"]
        XCTAssertTrue(note.waitForExistence(timeout: 10))
        reveal(note, in: app)
        note.tap()
        try verifyLargeContentViewer(app.buttons["captureBack"], title: "Back", app: app)
        if app.buttons["captureBack"].exists { app.buttons["captureBack"].tap() }
        try verifyLargeContentViewer(app.buttons["captureClose"], title: "Close", app: app)
        if app.buttons["captureClose"].exists { app.buttons["captureClose"].tap() }
        app.open(URL(string: "bbstudio://studio")!)
        try verifyLargeContentViewer(app.buttons["studioSelect"], title: "Select", app: app)
        app.tabBars.buttons["Home"].tap()
        let space = app.buttons["officeSpaceSwitcher"]
        XCTAssertTrue(space.waitForExistence(timeout: 10))
        let title = space.label.replacingOccurrences(of: "Space: ", with: "").replacingOccurrences(of: ". Switch space", with: "")
        try verifyLargeContentViewer(space, title: title, app: app)
    }

    private func verifyLargeContentViewer(_ control: XCUIElement, title: String, app: XCUIApplication) throws {
        XCTAssertTrue(control.waitForExistence(timeout: 10))
        let identifier = control.identifier
        let before = app.screenshot()
        let beforeLines = try RenderedText.lines(in: before.image).filter { line in
            let frame = CGRect(x: line.bounds.minX * app.frame.width, y: (1 - line.bounds.maxY) * app.frame.height,
                               width: line.bounds.width * app.frame.width, height: line.bounds.height * app.frame.height)
            return line.text.contains(title) && line.confidence >= 0.95 && control.frame.intersects(frame)
        }
        XCTAssertFalse(beforeLines.isEmpty, "Original toolbar title must be readable")
        let captured = expectation(description: "Screenshot during Large Content Viewer gesture")
        var held: XCUIScreenshot?
        DispatchQueue.global().asyncAfter(deadline: .now() + 1.5) {
            held = XCUIScreen.main.screenshot()
            captured.fulfill()
        }
        control.press(forDuration: 4)
        wait(for: [captured], timeout: 10)
        let during = try XCTUnwrap(held)
        for (name, shot) in [("before", before), ("held", during)] {
            let attachment = XCTAttachment(screenshot: shot)
            attachment.name = "lcv-\(identifier)-\(name)"
            attachment.lifetime = .keepAlways
            add(attachment)
        }
        let afterLines = try RenderedText.lines(in: during.image).filter { $0.text == title && $0.confidence >= 0.95 }
        let originalHeight = beforeLines.map { $0.bounds.height }.max() ?? 0
        let enlargedHeight = afterLines.map { $0.bounds.height }.max() ?? 0
        let passed = originalHeight > 0 && enlargedHeight > originalHeight * 1.25
        let evidence = "\(identifier): title=\(title); original=\(originalHeight); held=\(enlargedHeight); passed=\(passed); observations=\(afterLines)"
        print("AUDIT-LCV: \(evidence)")
        let record = XCTAttachment(string: evidence)
        record.name = "lcv-\(identifier)-results"
        record.lifetime = .keepAlways
        add(record)
        XCTAssertTrue(passed, "Long press must show an independently readable enlarged label: \(title)")
        if passed { largeContentProof.insert(identifier) }
    }

    private func proveFixedControlDynamicType(_ finding: AuditFinding, app: XCUIApplication, name: String) -> Bool {
        guard finding.type == .dynamicType, let element = finding.element else { return false }
        for identifier in largeContentProof {
            let control = app.buttons[identifier]
            guard control.exists else { continue }
            let sameControl = element.identifier == identifier || control.frame.insetBy(dx: -0.001, dy: -0.001).contains(element.frame)
            guard sameControl else { continue }
            print("AUDIT-EXCLUSION: \(name): fixed toolbar control \(identifier) has a verified enlarged label during long press; original=\(finding.description)")
            return true
        }
        return false
    }

    func testSettingsTextActuallyScales() throws { try verifySettingsTextScaling() }

    private func verifySettingsTextScaling() throws {
        var labels = ["Keep Mac awake", "Threads at once", "Configured limit"]
        for large in [false, true] {
            let app = try diagnosticApplication(largeText: large)
            defer { app.terminate() }
            if !large {
                for text in app.staticTexts.allElementsBoundByIndex.map(\.label) where text.contains(", ") && text.hasSuffix(" at once") {
                    labels.append(text.components(separatedBy: ", ").dropLast().joined(separator: ", "))
                }
                labels = labels.reduce(into: [String]()) { if !$0.contains($1) { $0.append($1) } }
            }
            let size = large ? "accessibility-xxxl" : "default"
            for label in labels {
                let cell = app.cells.containing(.staticText, identifier: label).firstMatch
                reveal(cell, in: app)
                XCTAssertTrue(try captureTextPixels(cell, text: label, app: app, name: "settings-scale-\(label)-\(size)"))
            }
        }
        for label in labels {
            let normal = try XCTUnwrap(glyphHeights["settings-scale-\(label)-default"])
            let large = try XCTUnwrap(glyphHeights["settings-scale-\(label)-accessibility-xxxl"])
            print("AUDIT-FONT-SCALE: \(label): default glyph height=\(normal), XXXL=\(large)")
            XCTAssertGreaterThanOrEqual(large, normal * 1.25, "The rendered glyphs must grow: \(label)")
            if normal > 0, large >= normal * 1.25 { settingsScaleProof.insert(label) }
        }
    }

    func testCaptureTextPixelEvidenceAtBothSizes() throws { try verifyCapturePixelsAtBothSizes() }

    private func verifyCapturePixelsAtBothSizes() throws {
        var proven = Set(captureTextControls.keys)
        for large in [false, true] {
            let app = try diagnosticApplication(largeText: large)
            defer { app.terminate() }
            app.open(URL(string: "bbstudio://capture")!)
            XCTAssertTrue(app.navigationBars["Capture to BB"].waitForExistence(timeout: 10))
            let size = large ? "accessibility-xxxl" : "default"
            for id in ["capture-voice", "capture-dictate", "capture-file", "capture-thread"] {
                let control = app.buttons[id]
                reveal(control, in: app)
                let passed = try captureTextPixels(control, text: captureTextControls[id]!, app: app, name: "ocr-\(id)-\(size)")
                XCTAssertTrue(passed, "Exact OCR proof failed for \(id) at \(size)")
                if !passed { proven.remove(id) }
            }
            let note = app.buttons["capture-note"]
            reveal(note, in: app)
            note.tap()
            let save = app.buttons["captureNoteSave"]
            XCTAssertTrue(save.waitForExistence(timeout: 10))
            let passed = try captureTextPixels(save, text: "Save note", app: app, name: "ocr-captureNoteSave-\(size)")
            XCTAssertTrue(passed, "Exact OCR proof failed for Save note at \(size)")
            if !passed { proven.remove("captureNoteSave") }
        }
        capturePixelProof = proven
    }

    private func captureTextPixels(_ control: XCUIElement, text: String, app: XCUIApplication, name: String) throws -> Bool {
        print("OCR-SOURCE: \(name) exists=\(control.exists); frame=\(control.exists ? control.frame : .zero)")
        guard control.exists, app.frame.contains(control.frame) else { return false }
        let textLabel = control.staticTexts[text].firstMatch
        let label = textLabel.exists ? textLabel : control
        guard label.exists, label.label == text else { return false }
        // AX mixes Float32 and CGFloat rectangles; allow only conversion noise.
        // The independently recognized glyph bounds still use the exact frame.
        guard control.frame.insetBy(dx: -1.0 / 1024, dy: -1.0 / 1024).contains(label.frame) else { return false }
        let wholeControl = XCTAttachment(screenshot: control.screenshot())
        wholeControl.name = name + "-control"
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
        crop.name = name
        crop.lifetime = .keepAlways
        add(crop)
        let passed = RenderedText.proves(text, lines: lines, inside: control.frame)
        if passed { glyphHeights[name] = lines.map { $0.bounds.height }.sorted()[lines.count / 2] }
        let detail = "expected=\(text); control=\(control.frame); passed=\(passed); observations=\(lines.map { "\($0.text) confidence=\($0.confidence) bounds=\($0.bounds)" })"
        let record = XCTAttachment(string: detail)
        record.name = name + "-results"
        record.lifetime = .keepAlways
        add(record)
        print("AUDIT-OCR: \(detail)")
        return passed
    }

    private func proveCaptureClipping(_ finding: AuditFinding, app: XCUIApplication, name: String) throws -> Bool {
        guard finding.type == .textClipped, let element = finding.element,
              let pair = captureTextControls.first(where: { $0.value == element.label }),
              capturePixelProof.contains(pair.key) else { return false }
        let control = app.buttons[pair.key]
        guard control.exists, control.frame.insetBy(dx: -1.0 / 1024, dy: -1.0 / 1024).contains(element.frame) else { return false }
        retainScreen(app, name + "-clipping-before-" + pair.key)
        reveal(control, in: app)
        guard try captureTextPixels(control, text: pair.value, app: app, name: name + "-clipping-proof-" + pair.key) else { return false }
        print("AUDIT-EXCLUSION: \(name): clipping OCR exact text verified at both default and accessibility XXXL and in current control \(pair.key); original=\(finding.description)")
        return true
    }

    func testCaptureClippingAtAccessibilityText() throws {
        try verifyCapturePixelsAtBothSizes()
        let app = try diagnosticApplication(largeText: true)
        defer { app.terminate() }
        app.open(URL(string: "bbstudio://capture")!)
        XCTAssertTrue(app.navigationBars["Capture to BB"].waitForExistence(timeout: 10))
        retainScreen(app, "capture-clipping-accessibility-xxxl")
        try captureNativeDiagnostic(app, "capture-clipping-accessibility-xxxl", audit: [.textClipped])
    }

    func testHomeClippingAtDefaultText() throws {
        let app = try diagnosticApplication(largeText: false)
        defer { app.terminate() }
        app.tabBars.buttons["Home"].tap()
        XCTAssertTrue(app.buttons["Hand Off to a Bot"].waitForExistence(timeout: 20))
        retainScreen(app, "home-clipping-native-default")
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
            let request = app.cells.containing(NSPredicate(format: "identifier == %@ AND label CONTAINS %@", "officeRequestOpen", "Native approval card QA")).firstMatch
            let action = request.buttons[label].firstMatch
            XCTAssertTrue(action.waitForExistence(timeout: 10))
            reveal(action, in: app)
            checkTarget(action)
            XCTAssertGreaterThanOrEqual(action.frame.width, 44 - 0.001)
            XCTAssertGreaterThanOrEqual(action.frame.height, 44 - 0.001)
            retainScreen(app, "inbox-approval-" + (largeText ? "accessibility-xxxl" : "default") + "-action-" + label.lowercased().replacingOccurrences(of: " ", with: "-"))
        }
        let request = app.cells.containing(NSPredicate(format: "identifier == %@ AND label CONTAINS %@", "officeRequestOpen", "Native approval card QA")).firstMatch
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
        let request = app.cells.containing(NSPredicate(format: "identifier == %@ AND label CONTAINS %@", "officeRequestOpen", "Native approval card QA")).firstMatch
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
        let element: XCUIElement?
        let nativeBars: [CGRect]
        let label: String
        let identifier: String
        let elementType: XCUIElement.ElementType?
        let originalFrame: CGRect?
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
            } ?? false
            findings.append(AuditFinding(type: issue.auditType, description: detail + " nativeBars=\(barFrames)",
                key: "\(issue.auditType.rawValue)|\(identifier)|\(label)",
                scrollEdgeContrast: issue.auditType == .contrast && atMaterialEdge,
                element: element, nativeBars: barFrames, label: label, identifier: identifier,
                elementType: element?.elementType, originalFrame: element?.frame))
            return true
        }
        return findings
    }

    private func freshElement(for finding: AuditFinding, app: XCUIApplication) -> XCUIElement? {
        guard finding.element != nil else { return nil }
        if let original = finding.element, original.exists,
           original.label == finding.label, original.identifier == finding.identifier { return original }
        if let type = finding.elementType {
            let matches = app.descendants(matching: type).matching(NSPredicate(format: "label == %@ AND identifier == %@", finding.label, finding.identifier))
            if matches.count == 1 { return matches.firstMatch }
        }
        // Combined request content remains one explicitly identified button.
        // Its exact body text identifies the parent when the inner text node is
        // rebuilt by a Dynamic Type audit and no longer independently exposed.
        if finding.label.count > 10 {
            let parents = app.buttons.matching(identifier: "officeRequestOpen").matching(NSPredicate(format: "label CONTAINS %@", finding.label))
            if parents.count == 1 { return parents.firstMatch }
        }
        return nil
    }

    private func auditedFindings(_ app: XCUIApplication, name: String, types: XCUIAccessibilityAuditType) throws -> [AuditFinding] {
        let collected = try collectAudit(app, name: name, types: types)
        return try resolveFindings(collected, app: app, name: name)
    }

    private func resolveFindings(_ collected: [AuditFinding], app: XCUIApplication, name: String) throws -> [AuditFinding] {
        var initial: [AuditFinding] = []
        for finding in collected {
            if finding.type == .dynamicType, finding.element != nil, settingsScaleProof.contains(finding.label), app.navigationBars["Settings"].exists {
                print("AUDIT-EXCLUSION: \(name): Settings rendered text \(finding.label) has exact OCR proof, contained bounds, and >=1.25x glyph growth at accessibility XXXL")
                continue
            }
            if proveFixedControlDynamicType(finding, app: app, name: name) { continue }
            if try !proveCaptureClipping(finding, app: app, name: name) { initial.append(finding) }
        }
        guard initial.contains(where: \.scrollEdgeContrast) else { return initial }
        var remaining = initial.filter { !$0.scrollEdgeContrast }
        for (index, finding) in initial.filter(\.scrollEdgeContrast).enumerated() {
            guard let element = freshElement(for: finding, app: app) else {
                remaining.append(finding)
                continue
            }
            let proofIdentity = "\(element.identifier)|\(element.label)"
            let originalFrame = finding.originalFrame ?? element.frame
            let proofName = "\(name)-material-\(index)"
            retainScreen(app, proofName + "-before")
            let collection = app.collectionViews.firstMatch
            let scroll = collection.exists ? collection : app.scrollViews.firstMatch
            guard scroll.exists, scroll.isHittable else {
                remaining.append(finding)
                continue
            }
            var clear = false
            for _ in 0..<6 {
                let bars = app.tabBars.allElementsBoundByIndex + app.toolbars.allElementsBoundByIndex + app.navigationBars.allElementsBoundByIndex
                let frames = bars.filter { $0.exists && $0.isHittable }.map(\.frame)
                let top = frames.filter { $0.midY < app.frame.midY }.map(\.maxY).max() ?? app.frame.minY
                let bottom = frames.filter { $0.midY > app.frame.midY }.map(\.minY).min() ?? app.frame.maxY
                let frame = element.frame
                if frame.minY > top + 8, frame.maxY < bottom - 8, element.isHittable {
                    clear = true
                    break
                }
                let distance = min(220, max(-220, (top + bottom) / 2 - frame.midY))
                let start = app.coordinate(withNormalizedOffset: CGVector(dx: 0.5, dy: 0.5))
                start.press(forDuration: 0.05, thenDragTo: start.withOffset(CGVector(dx: 0, dy: distance)))
            }
            retainScreen(app, proofName + "-after")
            guard clear else { remaining.append(finding); continue }
            let retry = try collectAudit(app, name: proofName + "-reaudit", types: [.contrast])
            // This gate covers only the same resolved element after it clears
            // the queried native bar. Unresolved findings are never eligible.
            let sameElement = element.exists && "\(element.identifier)|\(element.label)" == proofIdentity
            let resolved = sameElement && !retry.contains {
                $0.key == finding.key || "\($0.identifier)|\($0.label)" == proofIdentity || $0.element == nil
            }
            let evidence = "policy 2: key=\(finding.key); original=\(originalFrame); bars=\(finding.nativeBars); clear=\(element.frame); resolved=\(resolved); initial=\(finding.description); retry=\(retry.map(\.description))"
            print("AUDIT-MATERIAL-RETRY: \(evidence)")
            let record = XCTAttachment(string: evidence)
            record.name = proofName + "-results"
            record.lifetime = .keepAlways
            add(record)
            if !resolved { remaining.append(finding) }
        }
        return remaining
    }

    /// Coordinator policy: identified disabled controls or independently sampled
    /// readable text on a resolved element may override native contrast findings.
    /// Insufficient foreground/background pixel samples still fail closed.
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
        } else if element.label.count == 1,
                  element.label.unicodeScalars.contains(where: { $0.properties.isEmojiPresentation }),
                  !element.frame.isEmpty,
                  let face = app.images.matching(identifier: "officeFace").allElementsBoundByIndex.first(where: {
                      !$0.label.isEmpty && $0.frame.contains(element.frame)
                  }) {
            reason = "decorative emoji: glyph=\(element.label), labeled Face image=\(face.label), image frame=\(face.frame)"
            let crop = XCTAttachment(screenshot: face.screenshot())
            crop.name = name + "-decorative-face"
            crop.lifetime = .keepAlways
            add(crop)
        } else if !element.label.isEmpty, !element.frame.isEmpty,
                  app.frame.contains(element.frame) {
            let screenshot = element.screenshot()
            if let sample = RenderedContrast.sampleColor(screenshot.image), sample.ratio >= 4.5 {
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

    func testColoredContrastSampler() throws {
        func swatch(_ background: CGFloat, sparse: Bool = false) -> UIImage {
            UIGraphicsImageRenderer(size: CGSize(width: 100, height: 50)).image { context in
                UIColor(white: background / 255, alpha: 1).setFill()
                context.fill(CGRect(x: 0, y: 0, width: 100, height: 50))
                UIColor(red: 199.0 / 255, green: 67.0 / 255, blue: 26.0 / 255, alpha: 1).setFill()
                context.fill(CGRect(x: 30, y: 15, width: sparse ? 1 : 40, height: sparse ? 1 : 20))
            }
        }
        XCTAssertGreaterThan(try XCTUnwrap(RenderedContrast.sampleColor(swatch(255))).ratio, 4.5)
        XCTAssertEqual(try XCTUnwrap(RenderedContrast.sampleColor(swatch(233))).ratio, 4.0818, accuracy: 0.02)
        XCTAssertNil(RenderedContrast.sampleColor(swatch(255, sparse: true)))
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
        try verifySettingsTextScaling()
        try verifyCapturePixelsAtBothSizes()
        try verifyFixedControlViewers()
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
        var collected: [AuditFinding] = []
        for type: XCUIAccessibilityAuditType in [.contrast, .elementDetection, .hitRegion, .sufficientElementDescription, .dynamicType, .textClipped] {
            collected += try collectAudit(app, name: name, types: type)
        }
        // Gather every category on the original viewport before proof gestures
        // or scrolling can change which controls the next category would audit.
        let findings = try resolveFindings(collected, app: app, name: name)
        auditFindings.append(contentsOf: findings.map(\.description))
    }
}
