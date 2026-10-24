import XCTest

@MainActor
final class DuoQuickRepliesUITests: XCTestCase {
    func testRepliesClipAtComposerAndKeepSystemSafeAreas() throws {
        let app = XCUIApplication()
        app.launchArguments = ["-qaNotesDemo", "draft", "-qaVoice", "idle", "-skipPushPrompt", "YES", "-serverURL", "http://127.0.0.1:9",
            "-qaBotDemo", "duo", "-qaDuoPhone", "-qaDuoColdWide", "-qaDuoLong", "-qaDark",
            "-openURL", "bbstudio://bot"]
        app.launch()
        let replies = app.scrollViews["botQuickReplies"]
        XCTAssertTrue(replies.waitForExistence(timeout: 30))
        let composer = app.otherElements["threadComposer"].firstMatch
        XCTAssertTrue(composer.exists)
        XCTAssertTrue(app.buttons["composerExpandToPage"].exists)
        XCTAssertTrue(app.buttons["Voice mode"].exists)
        waitForValue("More replies to the right", on: replies)
        command("layout")
        let value = try XCTUnwrap(app.windows.firstMatch.value as? String)
        print("DUO LAYOUT \(value)")
        let geometry = try JSONDecoder().decode(Geometry.self, from: Data(value.utf8))
        let detail = try XCTUnwrap(geometry.scrolls.first {
            $0.x > geometry.width / 2 && $0.height > 200 && $0.contentHeight > $0.height
        })
        XCTAssertEqual(detail.contentMaxX, geometry.width, accuracy: 1,
            "Scrolling content reaches the window edge beneath the status column")
        XCTAssertEqual(replies.frame.minX, composer.frame.minX, accuracy: 1)
        XCTAssertEqual(replies.frame.maxX, composer.frame.maxX, accuracy: 1)
        XCTAssertEqual(detail.contentMaxX - composer.frame.maxX, geometry.safeRight + 12, accuracy: 1)
        XCTAssertEqual(geometry.height - geometry.safeBottom - composer.frame.maxY, 8, accuracy: 1,
            "Keep the system home-indicator inset plus the existing 8pt composer padding")
        let scroll = try XCTUnwrap(geometry.scrolls.first {
            abs($0.x - replies.frame.minX) < 1 && abs($0.width - replies.frame.width) < 1 && $0.height < 100
        })
        XCTAssertTrue(scroll.clips, "Quick replies must clip horizontally at the composer edge")
        command("capture?v6-bot-duo")
        command("portrait")
        waitForValue("No more replies to the right", on: replies)
        command("landscape")
        waitForValue("More replies to the right", on: replies)
        command("replies-end")
        waitForValue("No more replies to the right", on: replies)
    }

    func testOfflineFixtureHidesUnavailableComposerCapabilities() {
        let app = XCUIApplication()
        app.launchArguments = ["-skipPushPrompt", "YES", "-serverURL", "http://127.0.0.1:9",
            "-qaBotDemo", "duo", "-qaDuoPhone", "-qaDuoColdWide", "-qaDark", "-openURL", "bbstudio://bot"]
        app.launch()
        XCTAssertTrue(app.otherElements["threadComposer"].firstMatch.waitForExistence(timeout: 30))
        XCTAssertFalse(app.buttons["composerExpandToPage"].exists)
        XCTAssertFalse(app.buttons["Voice mode"].exists)
    }

    private func waitForValue(_ value: String, on element: XCUIElement) {
        expectation(for: NSPredicate(format: "value == %@", value), evaluatedWith: element)
        waitForExpectations(timeout: 10)
    }

    private func command(_ path: String) {
        XCUIDevice.shared.system.open(URL(string: "bbstudio://qa-duo/" + path)!)
    }
    private struct Geometry: Decodable {
        let width: CGFloat
        let height: CGFloat
        let safeRight: CGFloat
        let safeBottom: CGFloat
        let scrolls: [Scroll]
    }
    private struct Scroll: Decodable {
        let x: CGFloat
        let y: CGFloat
        let width: CGFloat
        let height: CGFloat
        let contentHeight: CGFloat
        let clips: Bool
        let contentWidth: CGFloat
        // SwiftUI lays out the vertical transcript's content inside the
        // safe area while its native scroll-view frame fills the window.
        var contentMaxX: CGFloat { x + contentWidth }
    }
}
