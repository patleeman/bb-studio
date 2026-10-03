import XCTest

/// System share-sheet checks. Run only on an owned private simulator whose app
/// and app-group serverURL preferences are already pinned to the staged origin.
final class ShareRuntimeUITests: XCTestCase {
    private var fixture: String { StagedFixture.serverURL }
    private var projectName: String { ProcessInfo.processInfo.environment["BBGO_QA_SHARE_PROJECT_NAME"] ?? "missing-staged-project" }
    private let host = XCUIApplication(bundleIdentifier: "local.bb.qa.ShareRuntimeHost")

    override func setUpWithError() throws {
        continueAfterFailure = false
        guard StagedFixture.isIsolated,
              ProcessInfo.processInfo.environment["BBGO_QA_SHARE_READY"] == "YES" else {
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
        let failure = host.staticTexts["Some shared items couldn't be loaded"]
        // The staged project has real threads; the error section follows its destinations.
        for _ in 0..<10 where !failure.exists { host.swipeUp() }
        XCTAssertTrue(failure.waitForExistence(timeout: 15), host.debugDescription)
        XCTAssertTrue(host.staticTexts["Close Share and try again. Nothing has been sent."].exists)
        XCTAssertFalse(host.buttons["Send"].isEnabled)
        capture("failed-item")
        host.buttons["Cancel"].tap()
    }

    func testSendFileToDedicatedStagedProject() throws {
        XCTAssertEqual(ProcessInfo.processInfo.environment["BBGO_QA_SHARE_PROJECT_ID"], StagedFixture.projectId, "Send only to the runner-verified staged project")
        let before = Set(try threads().compactMap { $0["id"] as? String })
        openFixture("Share file")
        XCTAssertTrue(host.descendants(matching: .any)["Shared file: bb-share-runtime-fixture.txt"].waitForExistence(timeout: 10))
        let destination = host.buttons["New thread in \(projectName)"]
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
        let created = try threads().filter {
            $0["projectId"] as? String == StagedFixture.projectId && !before.contains($0["id"] as? String ?? "")
        }
        XCTAssertEqual(created.count, 1, "One new thread in the verified staged project")
        let id = try XCTUnwrap(created.first?["id"] as? String)
        addTeardownBlock { _ = try self.request("/threads/\(id)", method: "DELETE", body: ["childThreadsConfirmed": false]) }
        let timeline = try XCTUnwrap(try request("/threads/\(id)/timeline") as? [String: Any])
        let rows = try XCTUnwrap(timeline["rows"] as? [[String: Any]])
        let sent = try XCTUnwrap(rows.first { $0["role"] as? String == "user" })
        XCTAssertEqual(sent["text"] as? String, "QA Share runtime attachment delivery. No actions required.")
        let files = (sent["attachments"] as? [String: Any])?["localFilePaths"] as? [String]
        XCTAssertEqual(files?.count, 1, "The shared file reached the server")
        XCTAssertTrue(files?.first?.hasPrefix("bb-share-runtime-fixture-") == true)
    }

    private func threads() throws -> [[String: Any]] {
        try XCTUnwrap(try request("/threads?limit=200") as? [[String: Any]])
    }

    private func request(_ path: String, method: String = "GET", body: [String: Any]? = nil) throws -> Any {
        var request = URLRequest(url: URL(string: "\(fixture)/api/v1\(path)")!)
        request.httpMethod = method
        if let body {
            request.setValue("application/json", forHTTPHeaderField: "Content-Type")
            request.httpBody = try JSONSerialization.data(withJSONObject: body)
        }
        let done = expectation(description: path)
        var result: Data?
        var status: Int?
        URLSession.shared.dataTask(with: request) { data, response, _ in
            result = data
            status = (response as? HTTPURLResponse)?.statusCode
            done.fulfill()
        }.resume()
        wait(for: [done], timeout: 15)
        XCTAssertTrue((200..<300).contains(status ?? 0), "Staged request \(path): \(status ?? 0)")
        return try JSONSerialization.jsonObject(with: XCTUnwrap(result))
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
        let destination = host.buttons["New thread in \(projectName)"]
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
