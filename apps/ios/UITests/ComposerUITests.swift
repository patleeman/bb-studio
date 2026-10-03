import XCTest

final class ComposerUITests: XCTestCase {
    func testCommandsAndContextMenu() throws {
        let threadId = try XCTUnwrap(scratchThread())
        addTeardownBlock { _ = self.api("DELETE", "/threads/\(threadId)", ["childThreadsConfirmed": false]) }
        let app = XCUIApplication()
        app.launchArguments += ["-skipPushPrompt", "YES"]
        app.launch()
        app.open(URL(string: "bbstudio://thread/\(threadId)")!)

        let composer = app.textViews["Message"]
        XCTAssertTrue(composer.waitForExistence(timeout: 15))
        composer.tap()
        composer.typeText("/com")
        let command = app.buttons.matching(identifier: "composerCommand").firstMatch
        XCTAssertTrue(command.waitForExistence(timeout: 10))
        XCTAssertTrue(command.label.contains("compact"))
        snapshot("commands")
        command.tap()
        XCTAssertTrue((composer.value as? String)?.contains("/compact") == true)
        if app.buttons["Continue"].exists { app.buttons["Continue"].tap() }
        snapshot("command-inserted")

        app.buttons["More"].tap()
        XCTAssertTrue(app.buttons["Context usage"].waitForExistence(timeout: 5))
        app.buttons["Context usage"].tap()
        XCTAssertTrue(app.navigationBars["Context usage"].waitForExistence(timeout: 5))
        snapshot("context")
        app.buttons["Done"].tap()

        app.buttons["More"].tap()
        app.buttons["Clear context"].tap()
        XCTAssertTrue(app.buttons["Clear context"].waitForExistence(timeout: 5))
        snapshot("clear-confirmation")
        app.coordinate(withNormalizedOffset: CGVector(dx: 0.1, dy: 0.4)).tap()
    }

    private func snapshot(_ name: String) {
        let data = XCUIScreen.main.screenshot().pngRepresentation
        try? data.write(to: URL(fileURLWithPath: "/tmp/qa-ui-ios1-\(name).png"))
        let attachment = XCTAttachment(data: data, uniformTypeIdentifier: "public.png")
        attachment.name = name
        attachment.lifetime = .keepAlways
        add(attachment)
    }

    private func scratchThread() -> String? {
        let json = api("POST", "/threads", [
            "projectId": StagedFixture.projectId, "origin": "app", "title": "QA iOS1 composer",
            "environment": ["type": "project-default"], "sendAt": 1_924_992_000_000,
            "input": [["type": "text", "text": "Scratch composer thread. Do nothing.", "mentions": [String]()]],
        ])
        return json?["id"] as? String ?? (json?["thread"] as? [String: Any])?["id"] as? String
    }

    private func api(_ method: String, _ path: String, _ body: [String: Any]) -> [String: Any]? {
        var request = URLRequest(url: URL(string: "\(StagedFixture.serverURL)/api/v1\(path)")!)
        request.httpMethod = method
        request.setValue("application/json", forHTTPHeaderField: "Content-Type")
        request.httpBody = try? JSONSerialization.data(withJSONObject: body)
        let done = expectation(description: path)
        var result: [String: Any]?
        URLSession.shared.dataTask(with: request) { data, _, _ in
            result = data.flatMap { try? JSONSerialization.jsonObject(with: $0) as? [String: Any] }
            done.fulfill()
        }.resume()
        wait(for: [done], timeout: 15)
        return result
    }
}
