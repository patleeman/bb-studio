import XCTest

@MainActor
final class DuoQuickRepliesUITests: ServerIsolatedUITestCase {
    func testRepliesClipAtComposerAndKeepSystemSafeAreas() throws {
        let app = XCUIApplication()
        app.launchArguments = ["-qaNotesDemo", "draft", "-qaVoice", "idle", "-skipPushPrompt", "YES",
            "-qaBotDemo", "duo", "-qaDuoPhone", "-qaDuoColdWide", "-qaDuoLong", "-qaDark",
            "-openURL", "bbstudio://bot"]
        app.launchOffline()
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
        XCTAssertEqual(detail.contentMaxX, geometry.width - geometry.safeRight, accuracy: 1,
            "Scrolling content stops at the status column, clear of the clock and Now Playing")
        let scroll = try XCTUnwrap(geometry.scrolls.first {
            abs($0.x - replies.frame.minX) < 1 && abs($0.width - replies.frame.width) < 1 && $0.height < 100
        })
        // Where the row borders the status column, SwiftUI stretches its scroll
        // view to the window edge and insets the content by as much; the
        // viewport the replies show in ends at the composer's edge.
        XCTAssertEqual(replies.frame.minX, composer.frame.minX, accuracy: 1)
        XCTAssertEqual(replies.frame.maxX - scroll.adjustedRight, composer.frame.maxX, accuracy: 1)
        // The composer runs under the status column, 12 points from the window's edge.
        XCTAssertEqual(geometry.width - composer.frame.maxX, 12, accuracy: 1)
        // Its 8-point padding from the window's edge: beside two pages the
        // inner screen's home-indicator inset isn't added under it.
        XCTAssertEqual(geometry.height - composer.frame.maxY, 8, accuracy: 1,
            "The existing 8pt composer padding at the window's bottom edge")
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
        app.launchArguments = ["-skipPushPrompt", "YES",
            "-qaBotDemo", "duo", "-qaDuoPhone", "-qaDuoColdWide", "-qaDark", "-openURL", "bbstudio://bot"]
        app.launchOffline()
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
        let adjustedRight: CGFloat
        // SwiftUI lays out the vertical transcript's content inside the
        // safe area while its native scroll-view frame fills the window.
        var contentMaxX: CGFloat { x + contentWidth }
    }
}
