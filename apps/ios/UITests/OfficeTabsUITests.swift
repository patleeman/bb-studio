import XCTest

final class OfficeTabsUITests: XCTestCase {
    override func setUpWithError() throws {
        continueAfterFailure = false
        guard StagedFixture.isIsolated else { throw XCTSkip("Requires the isolated UI runner") }
    }

    func testDragReordersPinnedAndSwipePinsToday() throws {
        let spaces = try XCTUnwrap(rpc("spaces_list", [:])["spaces"] as? [[String: Any]])
        let space = try XCTUnwrap(spaces.first { ($0["projectIds"] as? [String])?.contains(StagedFixture.projectId) == true })
        let spaceID = try XCTUnwrap(space["id"] as? String)
        let stamp = String(UUID().uuidString.prefix(6))
        var refs: [String] = []
        for suffix in ["A", "B", "C"] {
            let thread = try request("POST", "/threads", [
                "projectId": StagedFixture.projectId, "origin": "app", "title": "QA drag \(stamp) \(suffix)",
                "environment": ["type": "project-default"], "sendAt": 1_924_992_000_000,
                "input": [["type": "text", "text": "Inert drag fixture; do nothing.", "mentions": [String]()]],
            ])
            let id = try XCTUnwrap(thread["id"] as? String ?? (thread["thread"] as? [String: Any])?["id"] as? String)
            let ref = "thread:\(id)"
            refs.append(ref)
            addTeardownBlock {
                _ = try self.rpc("tabs_move", ["spaceId": spaceID, "ref": ref, "zone": "archived"])
                _ = try self.request("DELETE", "/threads/\(id)", ["childThreadsConfirmed": false])
            }
            _ = try rpc("tabs_open", ["spaceId": spaceID, "ref": ref])
            _ = try rpc("tabs_move", ["spaceId": spaceID, "ref": ref, "zone": suffix == "C" ? "today" : "pinned", "index": suffix == "B" ? 1 : 0])
        }
        let app = XCUIApplication()
        app.launchArguments = ["-skipPushPrompt", "YES", "-officeTab", "tabs"]
        app.launch()
        defer { app.terminate() }
        func row(_ suffix: String) -> XCUIElement {
            app.buttons.matching(identifier: "officeTab").matching(NSPredicate(format: "label CONTAINS %@", "QA drag \(stamp) \(suffix)")).firstMatch
        }
        for suffix in ["A", "B", "C"] { XCTAssertTrue(row(suffix).waitForExistence(timeout: 15)) }
        let before = XCTAttachment(screenshot: app.screenshot())
        before.name = "tabs-drag-before"
        before.lifetime = .keepAlways
        add(before)
        row("B").press(forDuration: 0.6, thenDragTo: row("A"), withVelocity: .slow, thenHoldForDuration: 1)
        let reordered = XCTAttachment(screenshot: app.screenshot())
        reordered.name = "tabs-drag-after-reorder"
        reordered.lifetime = .keepAlways
        add(reordered)
        XCTAssertTrue(try waitForPinned([refs[1], refs[0]], in: spaceID), "A real drag must persist the new pinned order")
        row("C").swipeRight()
        let pin = app.buttons["Pin"].firstMatch
        XCTAssertTrue(pin.waitForExistence(timeout: 5))
        pin.tap()
        XCTAssertTrue(try waitForPinned([refs[1], refs[0], refs[2]], in: spaceID), "The swipe Pin action must persist the Today tab in Pinned")
        let screenshot = XCTAttachment(screenshot: app.screenshot())
        screenshot.name = "tabs-drag-reorder-and-swipe-pin"
        screenshot.lifetime = .keepAlways
        add(screenshot)
    }

    private func waitForPinned(_ expected: [String], in spaceID: String) throws -> Bool {
        for _ in 0..<20 {
            let tabs = try rpc("tabs_get", ["spaceId": spaceID])["pinned"] as? [[String: Any]] ?? []
            let refs = tabs.compactMap { $0["ref"] as? String }.filter { expected.contains($0) }
            if refs == expected { return true }
            RunLoop.current.run(until: Date().addingTimeInterval(0.2))
        }
        let result = try rpc("tabs_get", ["spaceId": spaceID])
        let evidence = XCTAttachment(string: String(describing: result))
        evidence.name = "tabs-drag-unexpected-server-state"
        evidence.lifetime = .keepAlways
        add(evidence)
        return false
    }

    private func rpc(_ method: String, _ input: [String: Any]) throws -> [String: Any] {
        try XCTUnwrap(request("POST", "/plugins/studio/rpc/\(method)", input)["result"] as? [String: Any])
    }

    private func request(_ method: String, _ path: String, _ body: [String: Any]) throws -> [String: Any] {
        var request = URLRequest(url: try XCTUnwrap(URL(string: StagedFixture.serverURL + "/api/v1" + path)))
        request.httpMethod = method
        request.setValue("application/json", forHTTPHeaderField: "Content-Type")
        request.httpBody = try JSONSerialization.data(withJSONObject: body)
        var result: [String: Any]?
        let done = expectation(description: path)
        URLSession.shared.dataTask(with: request) { data, response, error in
            XCTAssertNil(error)
            XCTAssertTrue((200..<300).contains((response as? HTTPURLResponse)?.statusCode ?? 0))
            result = data.flatMap { $0.isEmpty ? [:] : try? JSONSerialization.jsonObject(with: $0) as? [String: Any] }
            done.fulfill()
        }.resume()
        wait(for: [done], timeout: 20)
        return try XCTUnwrap(result)
    }

    func testSearchOpenClearCancelAndNewThread() throws {
        let app = XCUIApplication()
        app.launchArguments = ["-skipPushPrompt", "YES", "-officeTab", "tabs"]
        app.launch()
        defer { app.terminate() }
        let field = app.textFields["officeTabsSearch"]
        XCTAssertTrue(field.waitForExistence(timeout: 20))
        field.tap()
        field.typeText("Native approval card QA")
        let result = try planResult(app)
        XCTAssertTrue(result.waitForExistence(timeout: 15))
        result.tap()
        XCTAssertTrue(app.navigationBars["Native approval card QA"].waitForExistence(timeout: 10))
        app.showOfficeTabs()
        XCTAssertFalse(app.buttons["Cancel search"].exists)
        field.tap()
        field.typeText("Native approval card QA")
        XCTAssertTrue(result.waitForExistence(timeout: 15))
        app.buttons["Clear search"].tap()
        XCTAssertFalse(app.buttons["Clear search"].exists)
        app.buttons["Cancel search"].tap()
        XCTAssertTrue(app.buttons["officeEssential"].firstMatch.waitForExistence(timeout: 10))
        field.tap()
        field.typeText("Scratch search draft")
        app.buttons.matching(NSPredicate(format: "label BEGINSWITH %@", "New Thread:")).firstMatch.tap()
        XCTAssertTrue(app.navigationBars["New thread"].waitForExistence(timeout: 10))
        app.buttons["Cancel"].tap()
        XCTAssertTrue(field.waitForExistence(timeout: 10))
        XCTAssertFalse(app.buttons["Cancel search"].exists)
    }

    func testKeyboardSearchOpensFirstResult() throws {
        let app = XCUIApplication()
        app.launchArguments = ["-skipPushPrompt", "YES", "-officeTab", "tabs"]
        app.launch()
        defer { app.terminate() }
        let field = app.textFields["officeTabsSearch"]
        XCTAssertTrue(field.waitForExistence(timeout: 20))
        field.tap()
        field.typeText("Native approval card QA")
        XCTAssertTrue(try planResult(app).waitForExistence(timeout: 15))
        app.keyboards.buttons["Search"].tap()
        XCTAssertTrue(app.navigationBars["Native approval card QA"].waitForExistence(timeout: 10))
        app.showOfficeTabs()
        XCTAssertFalse(app.buttons["Cancel search"].exists)
    }

    private func planResult(_ app: XCUIApplication) throws -> XCUIElement {
        let id = try XCTUnwrap(ProcessInfo.processInfo.environment["BBGO_QA_PLAN_THREAD"])
        return app.buttons["officeSearchResult:thread:\(id)"]
    }
}
