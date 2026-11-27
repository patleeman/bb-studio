import XCTest

final class NewSurfacesUITests: StagedServerUITestCase {
    func testSearch() throws {
        guard rpcRaw("studio", "searchAll", ["query": "QA iOS7", "limit": 10]) is [[String: Any]] else {
            throw XCTSkip("Updated Studio search is not installed")
        }
        let app = launch()
        app.open(URL(string: "bbstudio://studio")!)
        let search = studioSearch(app)
        XCTAssertTrue(search.exists)
        search.tap()
        search.typeText("QA iOS7")
        shot(app, "search")
    }

    /// On Duo, `ShellSearchable` puts `shellSearchField` at the top of the page;
    /// on iPhone, SwiftUI's `.automatic` searchable drawer reveals `Search Studio` when the list is pulled down.
    private func studioSearch(_ app: XCUIApplication) -> XCUIElement {
        let duoField = app.textFields["shellSearchField"].firstMatch
        let navField = app.searchFields.firstMatch
        XCTAssertTrue(app.navigationBars["Studio"].waitForExistence(timeout: 10)
            || app.descendants(matching: .any).matching(NSPredicate(format: "identifier == 'shellTitle' AND label == 'Studio'")).firstMatch.waitForExistence(timeout: 5))
        if duoField.waitForExistence(timeout: 3) { return duoField }
        _ = app.descendants(matching: .any).matching(identifier: "studioItem").firstMatch.waitForExistence(timeout: 10)
        if navField.waitForExistence(timeout: 2) { return navField }
        let list = app.collectionViews.firstMatch
        for _ in 0..<3 where !navField.exists {
            if list.exists {
                list.coordinate(withNormalizedOffset: CGVector(dx: 0.5, dy: 0.35))
                    .press(forDuration: 0.05, thenDragTo: list.coordinate(withNormalizedOffset: CGVector(dx: 0.5, dy: 0.8)), withVelocity: .slow, thenHoldForDuration: 0.1)
            } else {
                app.windows.firstMatch.coordinate(withNormalizedOffset: CGVector(dx: 0.5, dy: 0.4))
                    .press(forDuration: 0.05, thenDragTo: app.windows.firstMatch.coordinate(withNormalizedOffset: CGVector(dx: 0.5, dy: 0.85)), withVelocity: .slow, thenHoldForDuration: 0.1)
            }
            if navField.waitForExistence(timeout: 3) { break }
        }
        return navField
    }

    func testMeetingNotes() throws {
        let recordings = rpc("studio", "recordings.recordings_list", ["limit": 200])?["recordings"] as? [[String: Any]] ?? []
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
        app.launchStaged(server: qaServer)
        return app
    }

    private func shot(_ app: XCUIApplication, _ name: String) {
        try? app.screenshot().pngRepresentation.write(to: URL(fileURLWithPath: "/tmp/qa-ui-ios7-\(name).png"))
    }

    private func rpc(_ plugin: String, _ method: String, _ input: Any) -> [String: Any]? {
        rpcRaw(plugin, method, input) as? [String: Any]
    }

    private func rpcRaw(_ plugin: String, _ method: String, _ input: Any) -> Any? {
        var request = URLRequest(url: URL(string: "\(qaServer)/api/v1/plugins/\(plugin)/rpc/\(method)")!)
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
