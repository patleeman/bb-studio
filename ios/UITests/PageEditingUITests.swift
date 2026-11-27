import XCTest

final class PageEditingUITests: ServerIsolatedUITestCase {
    func testDrawingEditorOpens() throws {
        try requireQAServer()
        let drawing = try XCTUnwrap(rpc("createDrawing", ["name": "QA iOS2 drawing", "projectId": NSNull()])?["drawing"] as? [String: Any])
        let id = try XCTUnwrap(drawing["id"] as? String)
        addTeardownBlock { _ = self.rpc("deleteDrawing", ["id": id]) }
        let app = XCUIApplication()
        app.launchStaged(server: qaServer)
        app.open(URL(string: "bbstudio://drawing/\(id)")!)
        let navTitle = app.navigationBars["QA iOS2 drawing"]
        let shellTitle = app.descendants(matching: .any).matching(NSPredicate(format: "identifier == 'shellTitle' AND label == 'QA iOS2 drawing'")).firstMatch
        let editSheet = app.navigationBars["Edit drawing"]
        let opened = XCTNSPredicateExpectation(predicate: NSPredicate { _, _ in navTitle.exists || shellTitle.exists || editSheet.exists }, object: nil)
        XCTAssertEqual(XCTWaiter.wait(for: [opened], timeout: 15), .completed, "drawing screen opened")
        XCTAssertTrue(editSheet.waitForExistence(timeout: 10), "empty drawings open in Excalidraw")
        XCTAssertTrue(app.webViews.firstMatch.waitForExistence(timeout: 10))
        sleep(12)
        try? app.screenshot().pngRepresentation.write(to: URL(fileURLWithPath: "/tmp/qa-ui-ios2-drawing-editor.png"))
    }

    func testPageEditorIsOneContinuousText() {
        let app = XCUIApplication()
        app.launchArguments = ["-skipPushPrompt", "YES", "-qaBotDemo", "chat", "-qaSpacesDemo", "list",
                               "-qaConversation", "thr_botdemo01", "-qaPageDemo"]
        app.launchOffline()
        XCTAssertTrue(app.textViews["Message"].waitForExistence(timeout: 30))
        XCUIDevice.shared.system.open(URL(string: "bbstudio://page/qa-demo")!)
        let edit = app.screenAction("edit")
        XCTAssertTrue(edit.waitForExistence(timeout: 10))
        edit.tap()
        let editor = app.textViews["pageEditor"]
        XCTAssertTrue(editor.waitForExistence(timeout: 5))
        XCTAssertEqual(editor.value as? String, "# Launch plan\n\nShip it", "the whole page, without block markers")
        // Below the last line, so the cursor lands at the end.
        editor.coordinate(withNormalizedOffset: CGVector(dx: 0.5, dy: 0.8)).tap()
        editor.typeText("\nNext line")
        try? app.screenshot().pngRepresentation.write(to: URL(fileURLWithPath: "/tmp/qa-ui-page-editor-typing.png"))
        XCTAssertTrue((editor.value as? String)?.hasSuffix("Ship it\nNext line") == true, String(describing: editor.value))
        XCTAssertTrue(app.buttons["Checklist"].waitForExistence(timeout: 5), "format bar")
        app.buttons["Checklist"].tap()
        XCTAssertTrue((editor.value as? String)?.hasSuffix("- [ ] Next line") == true)
        editor.typeText("\nThird")
        XCTAssertTrue((editor.value as? String)?.hasSuffix("- [ ] Next line\n- [ ] Third") == true, "Return continues the checklist")
        XCTAssertTrue(app.staticTexts["Saved"].waitForExistence(timeout: 5), "autosaves after typing stops")
        let path = "/tmp/qa-ui-ios2-page-editor.png"
        try? app.screenshot().pngRepresentation.write(to: URL(fileURLWithPath: path))
    }

    private func rpc(_ method: String, _ input: Any) -> [String: Any]? {
        var request = URLRequest(url: URL(string: "\(qaServer)/api/v1/plugins/studio/rpc/drawings.\(method)")!)
        request.httpMethod = "POST"
        request.setValue("application/json", forHTTPHeaderField: "Content-Type")
        request.httpBody = try? JSONSerialization.data(withJSONObject: input)
        let finished = expectation(description: method)
        var result: [String: Any]?
        URLSession.shared.dataTask(with: request) { data, _, _ in
            let json = data.flatMap { try? JSONSerialization.jsonObject(with: $0) as? [String: Any] }
            result = json?["result"] as? [String: Any]
            finished.fulfill()
        }.resume()
        wait(for: [finished], timeout: 20)
        return result
    }
}
