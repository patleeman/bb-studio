import XCTest
import UIKit

/// Opt-in native previews against the isolated staged BB; never launch on a default origin.
final class ArtifactRuntimeUITests: XCTestCase {
    private var origin: String {
        ProcessInfo.processInfo.environment["BB_ARTIFACT_QA_EDGE"] == "YES"
            ? "http://127.0.0.1:49626" : "http://127.0.0.1:49486"
    }
    private var fixtures: [String: [String: Any]] = [:]
    private var baseline: Bool { ProcessInfo.processInfo.environment["BB_ARTIFACT_QA_BASELINE"] == "YES" }

    override func setUpWithError() throws {
        continueAfterFailure = false
        let env = ProcessInfo.processInfo.environment
        guard env["BB_ARTIFACT_QA_SERVER_URL"] == origin, env["BB_ARTIFACT_QA_PRIVATE_SIM"] == "YES",
              let json = env["BB_ARTIFACT_QA_FIXTURES"] else {
            throw XCTSkip("Requires exact staged origin, private simulator, and owned artifact fixtures before launch.")
        }
        fixtures = try XCTUnwrap(JSONSerialization.jsonObject(with: Data(json.utf8)) as? [String: [String: Any]])
    }

    func testHealthyNativePreviews() throws {
        let app = try launch()
        defer { app.terminate() }
        for (kind, marker) in [("text", "Artifact Runtime Text 20261003"), ("markdown", "Artifact Runtime Markdown"), ("html", "Artifact Runtime HTML")] {
            try open(kind, in: app)
            XCTAssertTrue(app.staticTexts.containing(NSPredicate(format: "label CONTAINS %@", marker)).firstMatch.waitForExistence(timeout: 15), kind)
            capture(app, kind)
            if kind == "markdown" {
                app.buttons["Show source"].tap()
                XCTAssertTrue(app.staticTexts.containing(NSPredicate(format: "label CONTAINS %@", "# Artifact Runtime Markdown")).firstMatch.waitForExistence(timeout: 5))
                app.buttons["Show rendered"].tap()
            }
        }
        for kind in ["image", "pdf"] {
            try open(kind, in: app)
            Thread.sleep(forTimeInterval: 3)
            capture(app, kind) // PDF and image pixels also require visual inspection of attachments.
            XCTAssertFalse(app.staticTexts["Couldn't load the image"].exists)
        }
    }

    func testUnavailableHTMLCanRecover() throws {
        let app = try launch()
        defer { app.terminate() }
        try open("missingHTML", in: app)
        XCTAssertTrue(app.staticTexts["Couldn't load the preview"].waitForExistence(timeout: 15))
        XCTAssertTrue(app.buttons["Retry"].isHittable)
        XCTAssertTrue(app.buttons["Share File"].isHittable)
        capture(app, "missing-html-error")
        try restore("missingHTML")
        app.buttons["Retry"].tap()
        XCTAssertTrue(app.staticTexts["Artifact Runtime recovered HTML 20261003"].waitForExistence(timeout: 15))
        capture(app, "recovered-html")
    }

    func testCorruptPDFShowsRecoveryAction() throws {
        let app = try launch()
        defer { app.terminate() }
        try open("corruptPDF", in: app)
        if baseline {
            Thread.sleep(forTimeInterval: 3)
            capture(app, "baseline-corrupt-pdf-blank")
            return
        }
        XCTAssertTrue(app.staticTexts["Couldn't load the preview"].waitForExistence(timeout: 15))
        XCTAssertTrue(app.buttons["Retry"].isHittable)
        XCTAssertTrue(app.buttons["Share File"].isHittable)
        capture(app, "corrupt-pdf-error")
        app.buttons["Retry"].tap()
        XCTAssertTrue(app.staticTexts["Couldn't load the preview"].waitForExistence(timeout: 15))
    }

    func testEmptyTextRemainsValid() throws {
        let app = try launch()
        defer { app.terminate() }
        try open("emptyText", in: app)
        Thread.sleep(forTimeInterval: 2)
        XCTAssertFalse(app.staticTexts["Couldn't load the text"].exists)
        app.buttons["More"].tap()
        XCTAssertTrue(app.buttons["Copy Text"].waitForExistence(timeout: 5))
        capture(app, "empty-text-copy-action")
    }

    func testUnavailableTextCanRecover() throws {
        let app = try launch()
        defer { app.terminate() }
        try open("missingText", in: app)
        if baseline {
            XCTAssertTrue(app.buttons["Share File"].waitForExistence(timeout: 15))
            XCTAssertFalse(app.buttons["Retry"].exists)
            capture(app, "baseline-missing-text-binary-fallback")
            return
        }
        XCTAssertTrue(app.staticTexts["Couldn't load the text"].waitForExistence(timeout: 15))
        XCTAssertTrue(app.buttons["Retry"].isHittable)
        XCTAssertTrue(app.buttons["Share File"].isHittable)
        capture(app, "missing-text-error")
        try restore("missingText")
        app.buttons["Retry"].tap()
        XCTAssertTrue(app.staticTexts["Artifact Runtime recovered text 20261003"].waitForExistence(timeout: 15))
        capture(app, "recovered-text")
    }

    func testUnavailableImageCanRecover() throws {
        let app = try launch()
        defer { app.terminate() }
        try open("missingImage", in: app)
        XCTAssertTrue(app.staticTexts["Couldn't load the image"].waitForExistence(timeout: 15))
        capture(app, baseline ? "baseline-missing-image-no-retry" : "missing-image-error")
        if baseline {
            XCTAssertFalse(app.buttons["Retry"].exists)
            return
        }
        XCTAssertTrue(app.buttons["Retry"].isHittable)
        XCTAssertTrue(app.buttons["Share File"].isHittable)
        try restore("missingImage")
        app.buttons["Retry"].tap()
        let cleared = XCTNSPredicateExpectation(predicate: NSPredicate(format: "exists == false"), object: app.staticTexts["Couldn't load the image"])
        XCTAssertEqual(XCTWaiter.wait(for: [cleared], timeout: 15), .completed)
        capture(app, "recovered-image")
        XCTAssertTrue(hasFixtureBluePixels(app.screenshot().image), "The restored PNG must render its distinctive blue rectangle")
        XCTAssertTrue(app.descendants(matching: .any)["artifactPreviewImage"].exists)
    }

    func testCorruptImageShowsRecoveryAction() throws {
        let app = try launch()
        defer { app.terminate() }
        try open("corruptImage", in: app)
        XCTAssertTrue(app.staticTexts["Couldn't load the image"].waitForExistence(timeout: 15))
        XCTAssertEqual(app.buttons["Retry"].exists, !baseline)
        capture(app, baseline ? "baseline-corrupt-image" : "corrupt-image")
    }

    func testReadablePDFRendersPages() throws {
        let app = try launch()
        defer { app.terminate() }
        try open("pdf", in: app)
        let pdf = app.descendants(matching: .any)["artifactPDFDocument"]
        XCTAssertTrue(pdf.waitForExistence(timeout: 15))
        XCTAssertFalse(app.staticTexts["Couldn't load the preview"].exists)
        capture(app, "readable-pdf-pages")
        pdf.pinch(withScale: 2, velocity: 1)
        capture(app, "readable-pdf-zoomed")
    }

    func testCorruptHeaderPDFShowsRecoveryAction() throws {
        guard origin == "http://127.0.0.1:49626" else { throw XCTSkip("Requires isolated edge-case proxy") }
        let app = try launch()
        defer { app.terminate() }
        try open("headerPDF", in: app)
        capture(app, "header-pdf-opened")
        XCTAssertTrue(app.staticTexts["Couldn't load the preview"].waitForExistence(timeout: 15))
        XCTAssertTrue(app.buttons["Retry"].isHittable)
        XCTAssertTrue(app.buttons["Share File"].isHittable)
        capture(app, "header-pdf-error")
        app.buttons["Retry"].tap()
        XCTAssertTrue(app.staticTexts["Couldn't load the preview"].waitForExistence(timeout: 15))
        app.buttons["Share File"].tap()
        XCTAssertTrue(app.otherElements["ActivityListView"].waitForExistence(timeout: 15), "Corrupt bytes remain available in the system share sheet")
        XCTAssertTrue(app.buttons["Close"].waitForExistence(timeout: 15), "Wait for the native share sheet to finish presenting")
        capture(app, "header-pdf-share")
    }

    func testInitialLookupCanRetry() throws {
        guard origin == "http://127.0.0.1:49626" else { throw XCTSkip("Requires isolated edge-case proxy") }
        let app = try launch()
        defer { app.terminate() }
        try control("arm-lookup")
        let id = try XCTUnwrap(fixtures["lookup"]?["id"] as? String)
        app.open(URL(string: "bbstudio://artifact/\(id)")!)
        XCTAssertTrue(app.staticTexts["Couldn't open the artifact"].waitForExistence(timeout: 15))
        XCTAssertTrue(app.buttons["Retry"].isHittable)
        capture(app, "lookup-error")
        app.buttons["Retry"].tap()
        XCTAssertTrue(app.staticTexts["Edge lookup recovered"].waitForExistence(timeout: 15))
        XCTAssertTrue(try control("status")["lookupFailed", default: false])
        XCTAssertTrue(try control("status")["lookupRecovered", default: false])
        capture(app, "lookup-recovered")
    }

    func testDelayedVersionCannotReplaceSelection() throws {
        guard origin == "http://127.0.0.1:49626" else { throw XCTSkip("Requires isolated edge-case proxy") }
        let app = try launch()
        defer { app.terminate() }
        try control("arm-delay")
        try open("race", in: app)
        XCTAssertTrue(app.staticTexts["Edge newest selected version"].waitForExistence(timeout: 15))
        try selectVersion(1, in: app)
        let deadline = Date().addingTimeInterval(10)
        while Date() < deadline, try !control("status")["delayed", default: false] { Thread.sleep(forTimeInterval: 0.1) }
        XCTAssertTrue(try control("status")["delayed", default: false], "Old-version response must be held by the proxy")
        try selectVersion(2, in: app)
        XCTAssertTrue(app.staticTexts["Edge newest selected version"].waitForExistence(timeout: 15))
        try control("release")
        Thread.sleep(forTimeInterval: 2)
        XCTAssertTrue(try control("status")["completed", default: false], "The old response must complete after the version switch")
        XCTAssertTrue(app.staticTexts["Edge newest selected version"].exists)
        XCTAssertFalse(app.staticTexts["Edge old delayed version"].exists)
        app.buttons["More"].tap()
        XCTAssertTrue(app.buttons["Copy Text"].exists)
        app.buttons["Copy Text"].tap()
        XCTAssertTrue(try control("check-copy")["copiedNewest", default: false], "Copy Text must put the selected version in the private simulator clipboard")
        capture(app, "delayed-old-response-keeps-newest")
        app.buttons["Share"].tap()
        XCTAssertTrue(app.otherElements["ActivityListView"].waitForExistence(timeout: 15))
        XCTAssertTrue(app.otherElements["LP.CaptionBar.BottomCaption"].label.contains("28 bytes"))
        XCTAssertTrue(try control("status")["sharedNewest", default: false])
        capture(app, "selected-version-share")
    }

    func testLockedPDFOffersShare() throws {
        guard origin == "http://127.0.0.1:49626" else { throw XCTSkip("Requires isolated edge-case proxy") }
        let app = try launch()
        defer { app.terminate() }
        try open("lockedPDF", in: app)
        XCTAssertTrue(app.staticTexts["Couldn't load the preview"].waitForExistence(timeout: 15))
        XCTAssertTrue(app.staticTexts["This PDF needs a password. Share the file to open it in an app that can unlock it."].exists)
        XCTAssertTrue(app.buttons["Share File"].isHittable)
        capture(app, "locked-pdf-error")
        app.buttons["Share File"].tap()
        XCTAssertTrue(app.otherElements["ActivityListView"].waitForExistence(timeout: 15))
        XCTAssertTrue(app.buttons["Close"].waitForExistence(timeout: 15))
        capture(app, "locked-pdf-share")
    }

    private func selectVersion(_ number: Int, in app: XCUIApplication) throws {
        app.buttons["More"].tap()
        app.buttons["Versions"].tap()
        let option = app.buttons.containing(NSPredicate(format: "label BEGINSWITH %@", "v\(number) ·")).firstMatch
        XCTAssertTrue(option.waitForExistence(timeout: 5))
        option.tap()
    }

    @discardableResult
    private func control(_ action: String) throws -> [String: Bool] {
        guard origin == "http://127.0.0.1:49626" else { throw XCTSkip("Requires isolated edge-case proxy") }
        let done = expectation(description: "Controlled edge response")
        var result: [String: Bool] = [:]
        URLSession.shared.dataTask(with: URL(string: origin + "/__edge/" + action)!) { data, response, error in
            XCTAssertNil(error)
            XCTAssertEqual((response as? HTTPURLResponse)?.statusCode, 200)
            if let data { result = (try? JSONSerialization.jsonObject(with: data) as? [String: Bool]) ?? [:] }
            done.fulfill()
        }.resume()
        wait(for: [done], timeout: 10)
        return result
    }

    private func launch() throws -> XCUIApplication {
        let app = XCUIApplication()
        app.launchArguments = ["-serverURL", origin, "-skipPushPrompt", "YES"]
        app.launch()
        XCTAssertTrue(app.tabBars.buttons["Settings"].waitForExistence(timeout: 20))
        app.tabBars.buttons["Settings"].tap()
        let setting = app.descendants(matching: .any)["settingsServerURL"]
        XCTAssertTrue(setting.waitForExistence(timeout: 10))
        XCTAssertEqual(setting.value as? String, origin, "Stop before opening an artifact if origin is wrong")
        return app
    }

    private func open(_ kind: String, in app: XCUIApplication) throws {
        let id = try XCTUnwrap(fixtures[kind]?["id"] as? String)
        XCTAssertTrue(id.hasPrefix("art_"))
        app.open(URL(string: "bbstudio://artifact/\(id)")!)
        let title = (try XCTUnwrap(fixtures[kind]?["payload"] as? [String: Any]))["name"] as! String
        let stem = (title as NSString).deletingPathExtension.replacingOccurrences(of: "-", with: " ")
        let displayTitle = stem.prefix(1).uppercased() + stem.dropFirst()
        XCTAssertTrue(app.navigationBars[displayTitle].waitForExistence(timeout: 15))
    }

    private func restore(_ kind: String) throws {
        let payload = try XCTUnwrap(fixtures[kind]?["payload"] as? [String: Any])
        var request = URLRequest(url: URL(string: origin + "/api/v1/plugins/studio/rpc/artifacts_importFile")!)
        request.httpMethod = "POST"
        request.setValue("application/json", forHTTPHeaderField: "Content-Type")
        request.httpBody = try JSONSerialization.data(withJSONObject: payload)
        let done = expectation(description: "Restore only owned content")
        var createdID: String?
        URLSession.shared.dataTask(with: request) { data, response, error in
            XCTAssertNil(error)
            XCTAssertEqual((response as? HTTPURLResponse)?.statusCode, 200)
            if let data, let json = try? JSONSerialization.jsonObject(with: data) as? [String: Any],
               let result = json["result"] as? [String: Any] { createdID = result["id"] as? String }
            done.fulfill()
        }.resume()
        wait(for: [done], timeout: 15)
        let id = try XCTUnwrap(createdID)
        request.url = URL(string: origin + "/api/v1/plugins/studio/rpc/artifacts_delete")!
        request.httpBody = try JSONSerialization.data(withJSONObject: ["id": id])
        let deleted = expectation(description: "Delete owned restore artifact")
        URLSession.shared.dataTask(with: request) { _, _, error in XCTAssertNil(error); deleted.fulfill() }.resume()
        wait(for: [deleted], timeout: 15)
    }

    private func hasFixtureBluePixels(_ image: UIImage) -> Bool {
        guard let cg = image.cgImage else { return false }
        let width = cg.width, height = cg.height
        var pixels = [UInt8](repeating: 0, count: width * height * 4)
        let matches = pixels.withUnsafeMutableBytes { bytes -> Int in
            guard let context = CGContext(data: bytes.baseAddress, width: width, height: height,
                bitsPerComponent: 8, bytesPerRow: width * 4, space: CGColorSpaceCreateDeviceRGB(),
                bitmapInfo: CGImageAlphaInfo.premultipliedLast.rawValue | CGBitmapInfo.byteOrder32Big.rawValue) else { return 0 }
            context.draw(cg, in: CGRect(x: 0, y: 0, width: width, height: height))
            let rgba = bytes.bindMemory(to: UInt8.self)
            return stride(from: 0, to: rgba.count, by: 16).reduce(0) { count, index in
                count + ((18...30).contains(Int(rgba[index])) && (139...151).contains(Int(rgba[index + 1])) && (188...200).contains(Int(rgba[index + 2])) ? 1 : 0)
            }
        }
        return matches > 200
    }

    private func capture(_ app: XCUIApplication, _ name: String) {
        let shot = XCTAttachment(screenshot: app.screenshot())
        shot.name = name; shot.lifetime = .keepAlways; add(shot)
        let tree = XCTAttachment(string: app.debugDescription)
        tree.name = name + "-tree"; tree.lifetime = .keepAlways; add(tree)
    }
}
