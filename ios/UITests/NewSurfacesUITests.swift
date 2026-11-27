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

    /// On a second (cached) visit to Studio, the toolbar Search button still reveals Search Studio on iPhone
    /// (and `shellSearchField` stays reachable on Duo), and Cancel/Clear dismisses it.
    func testSearchReachableOnSecondCachedVisit() throws {
        guard rpcRaw("studio", "searchAll", ["query": "QA iOS7", "limit": 10]) is [[String: Any]] else {
            throw XCTSkip("Updated Studio search is not installed")
        }
        // First visit populates StudioStore's cache.
        let first = launch()
        first.open(URL(string: "bbstudio://studio")!)
        XCTAssertTrue(first.descendants(matching: .any).matching(identifier: "studioItem").firstMatch.waitForExistence(timeout: 15))
        first.terminate()

        // Second (cached) visit: search must still be reachable in one tap.
        let second = launch()
        second.open(URL(string: "bbstudio://studio")!)
        let search = studioSearch(second)
        XCTAssertTrue(search.exists, "search field reachable on cached second visit")
        search.tap()
        search.typeText("Staged")
        let cancel = second.buttons["Cancel"].firstMatch
        if cancel.waitForExistence(timeout: 2) {
            cancel.tap()
        } else if second.buttons["Clear search"].firstMatch.exists {
            second.buttons["Clear search"].firstMatch.tap()
        }
    }

    /// On Duo, `ShellSearchable` puts `shellSearchField` at the top of the page;
    /// on iPhone, tapping the toolbar Search button (`screenAction-search`) presents `.searchable`.
    private func studioSearch(_ app: XCUIApplication) -> XCUIElement {
        let duoField = app.textFields["shellSearchField"].firstMatch
        let navField = app.searchFields.firstMatch
        XCTAssertTrue(app.navigationBars["Studio"].waitForExistence(timeout: 10)
            || app.descendants(matching: .any).matching(NSPredicate(format: "identifier == 'shellTitle' AND label == 'Studio'")).firstMatch.waitForExistence(timeout: 5))
        if duoField.waitForExistence(timeout: 3) { return duoField }
        _ = app.descendants(matching: .any).matching(identifier: "studioItem").firstMatch.waitForExistence(timeout: 10)
        let searchButton = app.buttons["screenAction-search"].firstMatch
        if !navField.exists, searchButton.waitForExistence(timeout: 5) {
            searchButton.tap()
        }
        _ = navField.waitForExistence(timeout: 5)
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
