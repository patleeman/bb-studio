import XCTest

final class ComposerUITests: ServerIsolatedUITestCase {
    /// A tap on the composer's mic dictates inline, in New thread against a
    /// server that has Studio (`TEST_RUNNER_BBGO_QA_SERVER`; nothing is sent):
    /// no sheet, the mic turns active, Listening with ✓ and ✕ over the
    /// composer. ✕ puts back what was typed; ✓ transcribes into the field.
    func testMicTapDictatesInline() throws {
        try requireQAServer()
        let server = qaServer
        let app = XCUIApplication()
        app.launchArguments += ["-skipPushPrompt", "YES", "-serverURL", server, "-openURL", "bbstudio://new"]
        app.launchStaged(server: qaServer)
        let field = app.textViews.firstMatch
        XCTAssertTrue(field.waitForExistence(timeout: 20))
        field.tap()
        field.typeText("Typed first")
        let mic = app.descendants(matching: .any)["composerMic"].firstMatch
        XCTAssertTrue(mic.waitForExistence(timeout: 5))

        // ✕ cancels and puts back what was typed.
        mic.tap()
        let listening = app.descendants(matching: .any)["talkListening"].firstMatch
        XCTAssertTrue(listening.waitForExistence(timeout: 5), "Listening shows over the composer")
        XCTAssertTrue(app.buttons["dictationFinish"].waitForExistence(timeout: 5), "✓")
        XCTAssertEqual(mic.label, "Finish dictation", "the mic finishes the dictation now")
        XCTAssertFalse(app.navigationBars["Dictation"].exists, "no dictation sheet")
        sleep(2)
        let shot = XCUIScreen.main.screenshot()
        try? shot.pngRepresentation.write(to: URL(fileURLWithPath: "/tmp/qa-composer-dictation.png"))
        app.buttons["dictationCancel"].tap()
        XCTAssertTrue(waitGone(listening, 30), "✕ ends it")
        XCTAssertEqual(field.value as? String, "Typed first", "what was typed is back")

        // ✓ finishes: Transcribing… until Talk has it, then the field is the typed text and any words.
        mic.tap()
        XCTAssertTrue(app.buttons["dictationFinish"].waitForExistence(timeout: 5))
        sleep(3)
        app.buttons["dictationFinish"].tap()
        XCTAssertTrue(waitGone(listening, 120), "the dictation finishes")
        XCTAssertTrue((field.value as? String)?.hasPrefix("Typed first") == true, "it stays in the field, unsent")
        XCTAssertTrue(app.navigationBars["New conversation"].exists || app.navigationBars["New thread"].exists
            || app.staticTexts["New conversation"].exists || app.staticTexts["New thread"].exists, "nothing was sent")
    }

    /// Holding the mic talks; letting go doesn't also count as a tap, and doesn't dictate inline.
    func testMicHoldDoesNotOpenDictation() throws {
        let app = XCUIApplication()
        app.launchArguments += ["-skipPushPrompt", "YES", "-qaBotDemo", "chat", "-openURL", "bbstudio://bot"]
        app.launchOffline()
        let mic = app.descendants(matching: .any)["composerMic"].firstMatch
        XCTAssertTrue(mic.waitForExistence(timeout: 20))
        mic.press(forDuration: 1.2)
        XCTAssertFalse(app.navigationBars["Dictation"].waitForExistence(timeout: 2), "A hold opened dictation")
        XCTAssertFalse(app.buttons["dictationFinish"].exists, "A hold started an inline dictation")
    }

    private func waitGone(_ element: XCUIElement, _ timeout: TimeInterval) -> Bool {
        let end = Date().addingTimeInterval(timeout)
        while Date() < end {
            if !element.exists { return true }
            RunLoop.current.run(until: Date().addingTimeInterval(0.2))
        }
        return !element.exists
    }

    func testCommandsAndContextMenu() throws {
        try requireQAServer()
        let threadId = try XCTUnwrap(scratchThread())
        addTeardownBlock { _ = self.api("DELETE", "/threads/\(threadId)", ["childThreadsConfirmed": false]) }
        let app = XCUIApplication()
        app.launchArguments += ["-skipPushPrompt", "YES"]
        app.launchStaged(server: qaServer)
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

        XCTAssertTrue(app.conversationMore.waitForExistence(timeout: 5))
        app.conversationMore.tap()
        let contextMenu = app.buttons["Context"].firstMatch
        if contextMenu.waitForExistence(timeout: 3) { contextMenu.tap() }
        let contextUsage = app.buttons["Context usage"].firstMatch
        XCTAssertTrue(contextUsage.waitForExistence(timeout: 5))
        contextUsage.tap()
        XCTAssertTrue(app.navigationBars["Context usage"].waitForExistence(timeout: 5))
        snapshot("context")
        app.buttons["Done"].tap()

        app.conversationMore.tap()
        if app.buttons["Context"].firstMatch.waitForExistence(timeout: 3) { app.buttons["Context"].firstMatch.tap() }
        app.buttons["Clear context"].firstMatch.tap()
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

    private func firstProjectId() -> String? {
        var request = URLRequest(url: URL(string: "\(qaServer)/api/v1/projects")!)
        request.httpMethod = "GET"
        let done = expectation(description: "projects")
        var projectId: String?
        URLSession.shared.dataTask(with: request) { data, _, _ in
            if let data, let list = try? JSONSerialization.jsonObject(with: data) as? [[String: Any]] {
                projectId = list.first(where: { ($0["id"] as? String) != "proj_personal" })?["id"] as? String
                    ?? list.first?["id"] as? String
            }
            done.fulfill()
        }.resume()
        wait(for: [done], timeout: 15)
        return projectId
    }

    private func scratchThread() -> String? {
        guard let projectId = firstProjectId() else { return nil }
        let json = api("POST", "/threads", [
            "projectId": projectId, "origin": "app", "title": "QA iOS1 composer",
            "environment": ["type": "project-default"], "sendAt": 1_924_992_000_000,
            "input": [["type": "text", "text": "Scratch composer thread. Do nothing.", "mentions": [String]()]],
        ])
        return json?["id"] as? String ?? (json?["thread"] as? [String: Any])?["id"] as? String
    }

    private func api(_ method: String, _ path: String, _ body: [String: Any]) -> [String: Any]? {
        var request = URLRequest(url: URL(string: "\(qaServer)/api/v1\(path)")!)
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
