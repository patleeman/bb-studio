import XCTest

/// Opt-in system share-sheet checks. Run only on a fresh simulator whose app
/// and app-group serverURL preferences are already pinned to the staged origin.
final class ShareRuntimeUITests: XCTestCase {
    private let fixture = "http://127.0.0.1:49486"
    private let host = XCUIApplication(bundleIdentifier: "local.bb.qa.ShareRuntimeHost")

    override func setUpWithError() throws {
        continueAfterFailure = false
        guard ProcessInfo.processInfo.environment["BB_SHARE_QA_SERVER_URL"] == fixture,
              ProcessInfo.processInfo.environment["BB_SHARE_QA_PRIVATE_SIM"] == "YES" else {
            throw XCTSkip("Use the documented isolated Share runtime harness. Both server preference domains must be staged before launch.")
        }
        let app = XCUIApplication()
        app.launchArguments = ["-serverURL", fixture, "-skipPushPrompt", "YES"]
        app.launch()
        XCTAssertTrue(app.buttons["Settings"].waitForExistence(timeout: 20))
        app.buttons["Settings"].tap()
        let server = app.descendants(matching: .any)["settingsServerURL"]
        XCTAssertTrue(server.waitForExistence(timeout: 10))
        XCTAssertEqual(server.value as? String, fixture)
        app.terminate()
    }

    func testURLAndTextFromSystemShareSheet() {
        openFixture("Share URL and text")
        let message = host.textFields.firstMatch
        XCTAssertTrue(message.waitForExistence(timeout: 10), host.debugDescription)
        let value = message.value as? String ?? ""
        XCTAssertTrue(value.contains("BB Share runtime URL and text fixture"), value)
        XCTAssertTrue(value.contains("https://example.com/bb-share-runtime"), value)
        verifyDestinationAndCancel("url-and-text")
    }

    func testImageFromSystemShareSheet() {
        openFixture("Share image")
        let thumbnail = host.images.matching(NSPredicate(format: "label BEGINSWITH %@", "Shared image: ")).firstMatch
        XCTAssertTrue(thumbnail.waitForExistence(timeout: 10), host.debugDescription)
        verifyDestinationAndCancel("image")
    }

    func testFileFromSystemShareSheet() {
        openFixture("Share file")
        XCTAssertTrue(host.descendants(matching: .any)["Shared file: bb-share-runtime-fixture.txt"].waitForExistence(timeout: 10), host.debugDescription)
        verifyDestinationAndCancel("file")
    }

    func testFailedItemFromSystemShareSheet() {
        openFixture("Share failed item")
        XCTAssertTrue(host.staticTexts["Some shared items couldn't be loaded"].waitForExistence(timeout: 15), host.debugDescription)
        XCTAssertTrue(host.staticTexts["Close Share and try again. Nothing has been sent."].exists)
        XCTAssertFalse(host.buttons["Send"].isEnabled)
        capture("failed-item")
        host.buttons["Cancel"].tap()
    }

    func testSendFileToDedicatedStagedProject() throws {
        guard ProcessInfo.processInfo.environment["BB_SHARE_QA_SEND_PROJECT_ID"] == "proj_4a8meviq3r" else {
            throw XCTSkip("Send needs the explicitly created staged QA project ID. The ordinary runtime harness only cancels.")
        }
        openFixture("Share file")
        XCTAssertTrue(host.descendants(matching: .any)["Shared file: bb-share-runtime-fixture.txt"].waitForExistence(timeout: 10))
        let destination = host.buttons["New thread in Share Runtime QA"]
        XCTAssertTrue(destination.waitForExistence(timeout: 20))
        destination.tap()
        XCTAssertTrue(destination.isSelected)
        let message = host.textFields.firstMatch
        message.tap()
        message.typeText("QA Share runtime attachment delivery. No actions required.")
        capture("file-before-staged-send")
        XCTAssertTrue(host.buttons["Send"].isEnabled)
        host.buttons["Send"].tap()
        let dismissed = NSPredicate(format: "exists == false")
        expectation(for: dismissed, evaluatedWith: host.navigationBars["Send to BB"])
        waitForExpectations(timeout: 30)
        capture("file-after-staged-send")
    }

    private func openFixture(_ label: String) {
        host.launch()
        XCTAssertTrue(host.buttons[label].waitForExistence(timeout: 15), host.debugDescription)
        host.buttons[label].tap()
        let bb = host.cells["BB Studio"]
        if !bb.waitForExistence(timeout: 5) {
            let more = host.cells["More"]
            XCTAssertTrue(more.waitForExistence(timeout: 10), host.debugDescription)
            more.tap()
        }
        XCTAssertTrue(bb.waitForExistence(timeout: 10), host.debugDescription)
        capture("system-sheet-" + label)
        bb.tap()
        XCTAssertTrue(host.navigationBars["Send to BB"].waitForExistence(timeout: 15), host.debugDescription)
    }

    private func verifyDestinationAndCancel(_ name: String) {
        let destination = host.buttons["New thread in Share Runtime QA"]
        XCTAssertTrue(destination.waitForExistence(timeout: 20), host.debugDescription)
        destination.tap()
        XCTAssertTrue(destination.isSelected)
        XCTAssertTrue(host.buttons["Send"].isEnabled)
        capture(name)
        host.buttons["Cancel"].tap()
        XCTAssertFalse(host.navigationBars["Send to BB"].exists)
    }

    private func capture(_ name: String) {
        let screenshot = XCTAttachment(screenshot: host.screenshot())
        screenshot.name = name; screenshot.lifetime = .keepAlways; add(screenshot)
        let tree = XCTAttachment(string: host.debugDescription)
        tree.name = name + "-accessibility-tree"; tree.lifetime = .keepAlways; add(tree)
    }
}
