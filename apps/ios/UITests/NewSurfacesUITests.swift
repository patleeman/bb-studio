import XCTest

final class NewSurfacesUITests: XCTestCase {
    private let projectId = StagedFixture.projectId

    func testHomeAndCollection() throws {
        guard let spaces = rpc("studio", "spaces_list", [:])?["spaces"] as? [[String: Any]],
              let spaceId = spaces.first?["id"] as? String,
              rpc("studio", "home", ["spaceId": spaceId]) != nil else {
            throw XCTSkip("Office RPCs are not installed")
        }
        let app = launch(tab: "inbox")
        XCTAssertTrue(app.navigationBars["Inbox"].waitForExistence(timeout: 15))
        shot(app, "inbox")
        app.tabBars.buttons["Home"].tap()
        XCTAssertTrue(app.buttons["Hand Off to a Bot"].waitForExistence(timeout: 15))
        shot(app, "home")
        openCollection(app)
        XCTAssertTrue(studioSearch(app).exists)
        shot(app, "collection")
    }

    func testSearch() throws {
        guard rpcRaw("studio", "searchAll", ["query": "QA iOS7", "limit": 10]) is [[String: Any]] else {
            throw XCTSkip("Updated Studio search is not installed")
        }
        let app = launch()
        openCollection(app)
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

    func testTaskFieldsAndRelated() throws {
        let task = try XCTUnwrap(rpc("studio", "tasks_create", [
            "title": "QA iOS7 task", "description": "Search and task fields", "projectId": projectId,
        ])?["task"] as? [String: Any])
        let id = try XCTUnwrap(task["id"] as? String)
        addTeardownBlock {
            let tasks = self.rpc("studio", "tasks_board", ["includeArchived": true])?["tasks"] as? [[String: Any]] ?? []
            for child in tasks where child["parentId"] as? String == id || child["title"] as? String == "QA iOS7 subtask" {
                if let childId = child["id"] as? String { _ = self.rpc("studio", "tasks_delete", ["id": childId]) }
            }
            _ = self.rpc("studio", "tasks_delete", ["id": id])
        }
        let app = launch()
        app.open(URL(string: "bbstudio://task/\(id)")!)
        XCTAssertTrue(app.navigationBars["QA iOS7 task"].waitForExistence(timeout: 15))
        XCTAssertTrue(app.staticTexts["Related"].waitForExistence(timeout: 10))
        app.buttons["More"].tap()
        app.buttons["Priority, labels and reminders"].tap()
        XCTAssertTrue(app.navigationBars["Task details"].waitForExistence(timeout: 10))
        let subtask = app.textFields["New subtask"]
        subtask.tap()
        subtask.typeText("QA iOS7 subtask")
        app.buttons["Add"].tap()
        if !app.staticTexts["QA iOS7 subtask"].waitForExistence(timeout: 10) {
            let tasks = rpc("studio", "tasks_board", ["includeArchived": false])?["tasks"] as? [[String: Any]] ?? []
            XCTAssertTrue(tasks.contains { $0["title"] as? String == "QA iOS7 subtask" && $0["parentId"] == nil },
                "The subtask should appear when the updated Tasks plugin is installed")
        }
        shot(app, "task-fields")
    }

    func testTableViews() throws {
        guard rpc("studio-tables", "list", NSNull()) != nil else { throw XCTSkip("Studio Tables is not installed") }
        let created = try XCTUnwrap(rpc("studio-tables", "create", [
            "title": "QA iOS7 table", "projectId": projectId,
        ])?["table"] as? [String: Any])
        let id = try XCTUnwrap(created["id"] as? String)
        addTeardownBlock { _ = self.rpc("studio-tables", "remove", ["id": id]) }
        let app = launch()
        openCollection(app)
        XCTAssertTrue(app.staticTexts["QA iOS7 table"].waitForExistence(timeout: 15))
        app.staticTexts["QA iOS7 table"].tap()
        XCTAssertTrue(app.descendants(matching: .any)["studioTable"].waitForExistence(timeout: 10))
        app.buttons["Table"].tap()
        shot(app, "table")
    }

    func testMeetingNotes() throws {
        let recordings = rpc("studio", "talk_recordings_list", ["limit": 200])?["recordings"] as? [[String: Any]] ?? []
        guard let id = recordings.first(where: { $0["meetingNotes"] is [String: Any] })?["id"] as? String else {
            throw XCTSkip("No recording with meeting notes is available for read-only QA")
        }
        let app = launch()
        app.open(URL(string: "bbstudio://recording/\(id)")!)
        XCTAssertTrue(app.descendants(matching: .any)["recordingMeetingNotes"].waitForExistence(timeout: 15))
        shot(app, "meeting-notes")
    }

    private func launch(tab: String = "work") -> XCUIApplication {
        let app = XCUIApplication()
        app.launchArguments = ["-skipPushPrompt", "YES", "-officeTab", tab]
        app.launch()
        return app
    }

    private func openCollection(_ app: XCUIApplication) {
        app.open(URL(string: "bbstudio://studio")!)
        XCTAssertTrue(app.navigationBars["Studio"].waitForExistence(timeout: 15))
    }

    private func shot(_ app: XCUIApplication, _ name: String) {
        try? app.screenshot().pngRepresentation.write(to: URL(fileURLWithPath: "/tmp/qa-ui-ios7-\(name).png"))
    }

    private func rpc(_ plugin: String, _ method: String, _ input: Any) -> [String: Any]? {
        rpcRaw(plugin, method, input) as? [String: Any]
    }

    private func rpcRaw(_ plugin: String, _ method: String, _ input: Any) -> Any? {
        var request = URLRequest(url: URL(string: "\(StagedFixture.serverURL)/api/v1/plugins/\(plugin)/rpc/\(method)")!)
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
