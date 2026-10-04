import XCTest

final class NewSurfacesUITests: XCTestCase {
    private let projectId = "proj_8ztiq6dkh5"

    func testHomeAndCollection() throws {
        guard rpc("studio", "home", ["periodDays": 7]) != nil else { throw XCTSkip("Updated Studio plugin is not installed") }
        let app = launch()
        app.tabBars.buttons["Studio"].tap()
        XCTAssertTrue(app.navigationBars["Studio"].waitForExistence(timeout: 15))
        XCTAssertTrue(studioSearch(app).exists)
        shot(app, "collection")
        app.buttons["studioToday"].tap()
        XCTAssertTrue(app.navigationBars["Today"].waitForExistence(timeout: 10))
        shot(app, "home")
        app.buttons["studioCollection"].tap()
        XCTAssertTrue(app.navigationBars["Studio"].waitForExistence(timeout: 10))
    }

    func testSearch() throws {
        guard rpcRaw("studio", "searchAll", ["query": "QA iOS7", "limit": 10]) is [[String: Any]] else {
            throw XCTSkip("Updated Studio search is not installed")
        }
        let app = launch()
        app.tabBars.buttons["Studio"].tap()
        let search = studioSearch(app)
        XCTAssertTrue(search.exists)
        search.tap()
        search.typeText("QA iOS7")
        shot(app, "search")
    }

    /// The collection's search field sits in the navigation drawer, hidden until the list is pulled down.
    private func studioSearch(_ app: XCUIApplication) -> XCUIElement {
        let search = app.searchFields["Search Studio"]
        XCTAssertTrue(app.navigationBars["Studio"].waitForExistence(timeout: 10))
        if !search.waitForExistence(timeout: 3) {
            let window = app.windows.firstMatch
            window.coordinate(withNormalizedOffset: CGVector(dx: 0.5, dy: 0.35))
                .press(forDuration: 0.05, thenDragTo: window.coordinate(withNormalizedOffset: CGVector(dx: 0.5, dy: 0.6)))
            _ = search.waitForExistence(timeout: 5)
        }
        return search
    }

    func testTableViews() throws {
        guard rpc("studio-tables", "list", NSNull()) != nil else { throw XCTSkip("Studio Tables is not installed") }
        let created = try XCTUnwrap(rpc("studio-tables", "create", [
            "title": "QA iOS7 table", "projectId": projectId,
        ])?["table"] as? [String: Any])
        let id = try XCTUnwrap(created["id"] as? String)
        addTeardownBlock { _ = self.rpc("studio-tables", "remove", ["id": id]) }
        let app = launch()
        app.open(URL(string: "bbstudio://studio")!)
        app.tabBars.buttons["Studio"].tap()
        XCTAssertTrue(app.staticTexts["QA iOS7 table"].waitForExistence(timeout: 15))
        app.staticTexts["QA iOS7 table"].tap()
        XCTAssertTrue(app.descendants(matching: .any)["studioTable"].waitForExistence(timeout: 10))
        app.buttons["Table"].tap()
        shot(app, "table")
    }

    func testMeetingNotes() throws {
        let recordings = rpc("talk", "recordings_list", ["limit": 200])?["recordings"] as? [[String: Any]] ?? []
        guard let id = recordings.first(where: { $0["meetingNotes"] is [String: Any] })?["id"] as? String else {
            throw XCTSkip("No recording with meeting notes is available for read-only QA")
        }
        let app = launch()
        app.open(URL(string: "bbstudio://recording/\(id)")!)
        XCTAssertTrue(app.descendants(matching: .any)["recordingMeetingNotes"].waitForExistence(timeout: 15))
        shot(app, "meeting-notes")
    }

    private func launch() -> XCUIApplication {
        let app = XCUIApplication()
        app.launchArguments = ["-skipPushPrompt", "YES"]
        app.launch()
        return app
    }

    private func shot(_ app: XCUIApplication, _ name: String) {
        try? app.screenshot().pngRepresentation.write(to: URL(fileURLWithPath: "/tmp/qa-ui-ios7-\(name).png"))
    }

    private func rpc(_ plugin: String, _ method: String, _ input: Any) -> [String: Any]? {
        rpcRaw(plugin, method, input) as? [String: Any]
    }

    private func rpcRaw(_ plugin: String, _ method: String, _ input: Any) -> Any? {
        var request = URLRequest(url: URL(string: "http://127.0.0.1:38886/api/v1/plugins/\(plugin)/rpc/\(method)")!)
        request.httpMethod = "POST"
        request.setValue("application/json", forHTTPHeaderField: "Content-Type")
        request.httpBody = try? JSONSerialization.data(withJSONObject: input, options: .fragmentsAllowed)
        let finished = expectation(description: "\(plugin).\(method)")
        var result: Any?
        URLSession.shared.dataTask(with: request) { data, _, _ in
            let envelope = data.flatMap { try? JSONSerialization.jsonObject(with: $0) as? [String: Any] }
            result = envelope?["result"]
            finished.fulfill()
        }.resume()
        wait(for: [finished], timeout: 20)
        return result
    }
}
