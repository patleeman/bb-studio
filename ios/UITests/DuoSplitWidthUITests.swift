import XCTest

/// The Duo inner screen (951×669, phone idiom): every thread in the right page
/// fits that page, however long its title. Run on an owned iPhone Duo simulator.
@MainActor
final class DuoSplitWidthUITests: ServerIsolatedUITestCase {
    private let app = XCUIApplication()
    /// The crease's right edge: the window midpoint plus half the gutter.
    private let pageMinX: CGFloat = 951 / 2 + 16

    func testEveryDetailFitsTheRightPage() throws {
        app.launchArguments = ["-skipPushPrompt", "YES",
            "-qaBotDemo", "duo", "-qaDuoPhone", "-qaDuoColdWide", "-qaDuoWideTitles", "-qaDark",
            "-openURL", "bbstudio://bot"]
        app.launchOffline()
        XCTAssertTrue(app.otherElements["threadComposer"].firstMatch.waitForExistence(timeout: 30))

        // The Bot's chat, then threads from its Running and Waiting groups.
        try assertFits("bot-chat", text: "Duo message 80")
        try open(row: "iOS: black on reopen", name: "bot-running")
        try open(row: "Summarize inbox", name: "bot-waiting")
        try open(row: "Chat", name: "bot-chat-again", text: "Duo message 80")

        // A normal thread from the Threads list.
        command("tab?threads")
        let conversation = app.buttons["inbox-thread-thr_botdemo01"]
        XCTAssertTrue(conversation.waitForExistence(timeout: 15))
        conversation.tap()
        XCTAssertTrue(app.staticTexts["duoThreadTitle"].waitForExistence(timeout: 15))
        try assertFits("thread", text: "Duo message 80")
    }

    private func open(row label: String, name: String, text: String = "Wide 12") throws {
        let row = app.buttons.matching(NSPredicate(format: "label BEGINSWITH %@", label)).firstMatch
        XCTAssertTrue(row.waitForExistence(timeout: 15), "Sidebar row \(label)")
        XCTAssertLessThan(row.frame.midX, 951 / 2)
        row.tap()
        try assertFits(name, text: text)
    }

    private func assertFits(_ name: String, text: String) throws {
        let message = app.staticTexts.matching(NSPredicate(format: "label BEGINSWITH %@", text)).firstMatch
        XCTAssertTrue(message.waitForExistence(timeout: 15), "\(name): transcript loads")
        let composer = app.otherElements["threadComposer"].firstMatch
        XCTAssertTrue(composer.waitForExistence(timeout: 10))
        // Let the push transition settle before measuring.
        expectation(for: NSPredicate { _, _ in message.frame.minX >= self.pageMinX - 1 && composer.frame.minX >= self.pageMinX - 1 },
                    evaluatedWith: nil)
        waitForExpectations(timeout: 5) { _ in }
        command("capture?split-width-" + name)
        command("layout")
        let value = try XCTUnwrap(app.windows.firstMatch.value as? String)
        let geometry = try JSONDecoder().decode(Geometry.self, from: Data(value.utf8))
        XCTAssertEqual(geometry.width, 951, accuracy: 1)

        XCTAssertGreaterThanOrEqual(composer.frame.minX, pageMinX - 1, "\(name): composer starts in the right page")
        // Like the transcript, the composer runs under the status column, keeping its margin.
        XCTAssertLessThanOrEqual(composer.frame.maxX, 951 - 12 + 1, "\(name): composer ends inside the page")
        XCTAssertGreaterThanOrEqual(message.frame.minX, pageMinX - 1, "\(name): transcript text is not cut at the crease")
        XCTAssertLessThanOrEqual(message.frame.maxX, 951 + 1, "\(name): transcript text is not cut at the window edge")
        let title = app.staticTexts["duoThreadTitle"]
        if title.exists {
            XCTAssertGreaterThanOrEqual(title.frame.minX, pageMinX - 1, "\(name): title starts in the right page")
            XCTAssertLessThanOrEqual(title.frame.maxX, 951 + 1, "\(name): title ends in the window")
        }
        let jump = app.buttons["Jump to latest"]
        if jump.exists { XCTAssertLessThanOrEqual(jump.frame.maxX, 951 - 12 + 1, "\(name): jump button is on screen") }
        let detail = try XCTUnwrap(geometry.scrolls.first { $0.x + $0.width > 951 / 2 + 100 && $0.height > 200 && $0.contentHeight > 0 },
                                   "\(name): the transcript scroll view")
        XCTAssertGreaterThanOrEqual(detail.x, pageMinX - 1, "\(name): transcript starts at the crease")
        XCTAssertLessThanOrEqual(detail.x + detail.width, 951 + 1, "\(name): transcript ends at the window edge")
    }

    private func command(_ path: String) {
        XCUIDevice.shared.system.open(URL(string: "bbstudio://qa-duo/" + path)!)
    }

    private struct Geometry: Decodable {
        let width: CGFloat
        let safeRight: CGFloat
        let scrolls: [Scroll]
        struct Scroll: Decodable {
            let x: CGFloat
            let width: CGFloat
            let height: CGFloat
            let contentHeight: CGFloat
        }
    }
}
