import XCTest

@MainActor
final class DuoLongTranscriptUITests: ServerIsolatedUITestCase {
    private let app = XCUIApplication()

    func testColdWideBotAndBottomWidthChangesNeverBlank() {
        launch(coldWide: true)
        let newest = app.staticTexts.matching(NSPredicate(format: "label CONTAINS %@", "History turn 299.")).firstMatch
        XCTAssertTrue(newest.waitForExistence(timeout: 30))
        Thread.sleep(forTimeInterval: 3)
        assertVisible(newest)
        for size in ["outer", "landscape", "outer", "landscape"] {
            command(size)
            // Check after the bounded restore has finished, not during a retry
            // that could temporarily show the expected row before drifting.
            Thread.sleep(forTimeInterval: 3)
            let visible = NSPredicate { _, _ in self.visible(newest) }
            expectation(for: visible, evaluatedWith: nil)
            waitForExpectations(timeout: 10)
        }
    }

    func testMiddleWidthChangesKeepReadingMessageAndDraft() throws {
        launch(coldWide: false)
        let composer = app.textViews.matching(NSPredicate(format: "label BEGINSWITH 'Message'")).firstMatch
        XCTAssertTrue(composer.waitForExistence(timeout: 30))
        composer.tap()
        composer.typeText("Keep this long-history draft")
        let draft = composer.value as? String
        command("mid")
        Thread.sleep(forTimeInterval: 3)
        let query = app.staticTexts.matching(NSPredicate(format: "label CONTAINS %@", "History turn "))
        expectation(for: NSPredicate { _, _ in query.allElementsBoundByIndex.contains { self.visible($0) } }, evaluatedWith: nil)
        waitForExpectations(timeout: 15)
        let marker = try XCTUnwrap(query.allElementsBoundByIndex.first { visible($0) && $0.frame.minY > 80 })
        let label = marker.label
        command("inspect")
        let identity = (app.windows.firstMatch.value as? String)?.components(separatedBy: "#").first
        print("BEFORE \(app.windows.firstMatch.value ?? "nil")")
        let y = marker.frame.minY
        for size in ["landscape", "outer", "landscape"] {
            command(size)
            // Check after the bounded restore has finished, not during a retry
            // that could temporarily show the expected row before drifting.
            Thread.sleep(forTimeInterval: 3)
            command("inspect")
            print("AFTER \(size) \(app.windows.firstMatch.value ?? "nil")")
            XCTAssertEqual((app.windows.firstMatch.value as? String)?.components(separatedBy: "#").first, identity, "The live thread model must not reload during folding")
            let retained = app.staticTexts[label].firstMatch
            expectation(for: NSPredicate { _, _ in retained.exists && abs(retained.frame.minY - y) < 100 }, evaluatedWith: nil)
            waitForExpectations(timeout: 10)
            assertVisible(retained)
            XCTAssertEqual(composer.value as? String, draft)
        }
    }

    private func launch(coldWide: Bool) {
        app.launchArguments = ["-skipPushPrompt", "YES", "-qaBotDemo", "duo", "-qaDuoPhone", "-qaDuoLong", "-qaDark", "-openURL", "bbstudio://bot"]
        if coldWide { app.launchArguments += ["-qaDuoColdWide"] }
        app.launchOffline()
    }
    private func command(_ path: String) { XCUIDevice.shared.system.open(URL(string: "bbstudio://qa-duo/" + path)!) }
    private func visible(_ element: XCUIElement) -> Bool {
        guard element.exists else { return false }
        let frame = element.frame
        return frame.height > 0 && frame.maxY > 65 && frame.minY < app.windows.firstMatch.frame.height - 150
    }
    private func assertVisible(_ element: XCUIElement, file: StaticString = #filePath, line: UInt = #line) {
        XCTAssertTrue(visible(element), "The Bot transcript must have visible messages, not blank lazy-stack space", file: file, line: line)
    }
}
