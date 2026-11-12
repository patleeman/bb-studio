import XCTest
final class NoteVisibilityUITests: XCTestCase {
    func testLongNoteAtAccessibilityXXXL() throws {
        continueAfterFailure = false
        let app = XCUIApplication()
        app.launchArguments = ["-serverURL", "http://127.0.0.1:49486", "-skipPushPrompt", "YES", "-UIPreferredContentSizeCategoryName", "UICTContentSizeCategoryAccessibilityXXXL"]
        app.launch()
        defer { app.terminate() }
        XCTAssertTrue(app.tabBars.buttons["Settings"].waitForExistence(timeout: 30))
        app.tabBars.buttons["Settings"].tap()
        let server = app.descendants(matching: .any)["settingsServerURL"]
        XCTAssertTrue(server.waitForExistence(timeout: 10))
        XCTAssertEqual(server.value as? String, "http://127.0.0.1:49486")
        app.open(URL(string: "bbstudio://capture")!)
        XCTAssertTrue(app.navigationBars["Capture to BB"].waitForExistence(timeout: 10))
        let note = app.buttons["capture-note"]
        for _ in 0..<5 { if note.exists && note.isHittable { break }; app.swipeUp() }
        XCTAssertTrue(note.isHittable)
        note.tap()
        let field = app.descendants(matching: .any)["captureNoteText"].firstMatch
        XCTAssertTrue(field.waitForExistence(timeout: 10))
        field.tap()
        let content = "Review note visibility\nSecond line\nThird line\nFourth line\nFifth line\nSixth line\nSeventh line\nEighth line\nNinth line\nTenth line\nEleventh line\nTwelfth line"
        field.typeText(content)
        XCTAssertEqual(field.value as? String, content, "The entire note remains in the editor")
        let save = app.buttons["captureNoteSave"]
        capture(app, "note-keyboard-before-scroll")
        func fullyVisible() -> Bool {
            let keyboard = app.keyboards.firstMatch
            let bottom = keyboard.exists ? keyboard.frame.minY : app.frame.maxY
            return save.exists && save.isEnabled && save.isHittable && save.frame.minY >= app.navigationBars.firstMatch.frame.maxY && save.frame.maxY <= bottom && save.frame.minX >= app.frame.minX && save.frame.maxX <= app.frame.maxX
        }
        for _ in 0..<5 {
            if fullyVisible() { break }
            app.coordinate(withNormalizedOffset: CGVector(dx: 0.96, dy: 0.55)).press(forDuration: 0.05, thenDragTo: app.coordinate(withNormalizedOffset: CGVector(dx: 0.96, dy: 0.28)))
        }
        capture(app, "note-keyboard-after-scroll")
        print("NOTE_VISIBILITY: save=\(save.frame) keyboard=\(app.keyboards.firstMatch.frame) nav=\(app.navigationBars.firstMatch.frame) hittable=\(save.isHittable)")
        XCTAssertTrue(fullyVisible(), "Save note must be fully reachable above the keyboard after ordinary scrolling at accessibility XXXL")
    }
    private func capture(_ app: XCUIApplication, _ name: String) {
        let shot = XCTAttachment(screenshot: app.screenshot());shot.name=name;shot.lifetime = .keepAlways;add(shot)
        let tree = XCTAttachment(string: app.debugDescription);tree.name=name+"-tree";tree.lifetime = .keepAlways;add(tree)
    }
}
