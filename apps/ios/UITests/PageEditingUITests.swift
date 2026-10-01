import XCTest

final class PageEditingUITests: XCTestCase {
    func testDrawingEditorOpens() throws {
        let drawing = try XCTUnwrap(rpc("createDrawing", ["name": "QA iOS2 drawing", "projectId": NSNull()])?["drawing"] as? [String: Any])
        let id = try XCTUnwrap(drawing["id"] as? String)
        addTeardownBlock { _ = self.rpc("deleteDrawing", ["id": id]) }
        let app = XCUIApplication()
        app.launch()
        app.open(URL(string: "bbstudio://drawing/\(id)")!)
        XCTAssertTrue(app.navigationBars["QA iOS2 drawing"].waitForExistence(timeout: 15))
        XCTAssertTrue(app.navigationBars["Edit drawing"].waitForExistence(timeout: 10), "empty drawings open in Excalidraw")
        XCTAssertTrue(app.webViews.firstMatch.waitForExistence(timeout: 10))
        sleep(12)
        try? app.screenshot().pngRepresentation.write(to: URL(fileURLWithPath: "/tmp/qa-ui-ios2-drawing-editor.png"))
    }

    func testPageEditorIsOneContinuousText() {
        let app = XCUIApplication()
        app.launchArguments = ["-qaPageDemo"]
        app.launch()
        app.open(URL(string: "bbstudio://page/qa-demo")!)
        let edit = app.buttons["Edit page"]
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
        var request = URLRequest(url: URL(string: "http://127.0.0.1:38886/api/v1/plugins/excalidraw/rpc/\(method)")!)
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
