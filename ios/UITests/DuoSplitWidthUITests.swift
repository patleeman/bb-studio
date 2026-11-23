import XCTest

/// The Duo inner screen (951×669, phone idiom): the room's conversation, a
/// worker and another conversation on the right page all fit that page,
/// however long the title. Runs on an iPhone, emulating the inner screen.
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

        // Main, whose title is long; a worker from the left page; another
        // conversation; then Main again.
        try assertFits("bot-chat", text: "Duo message 80")
        try open("contextWorker-thr_demo_w2", name: "worker", text: "Theme stills renderer: work on it", composer: "workerAsk")
        try open("contextConversation-thr_demo_interview", name: "conversation", text: "Mock with Sam moved to Friday 10:00. I asked")
        try open("contextConversation-thr_botdemo01", name: "bot-chat-again", text: "Duo message 80")
    }

    private func open(_ row: String, name: String, text: String, composer: String = "threadComposer") throws {
        let button = app.buttons[row]
        XCTAssertTrue(button.waitForExistence(timeout: 15), "Left page row \(row)")
        XCTAssertLessThan(button.frame.midX, 951 / 2)
        button.tap()
        try assertFits(name, text: text, composer: composer)
    }

    private func assertFits(_ name: String, text: String, composer composerId: String = "threadComposer") throws {
        let message = app.staticTexts.matching(NSPredicate(format: "label BEGINSWITH %@", text)).firstMatch
        XCTAssertTrue(message.waitForExistence(timeout: 15), "\(name): transcript loads")
        let composer = app.otherElements[composerId].firstMatch
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
        // The header's title, the first text at the top of the right page.
        let title = app.staticTexts.allElementsBoundByIndex.first { $0.frame.minX >= pageMinX - 1 && $0.frame.minY > 20 && $0.frame.maxY < 160 }
        let header = try XCTUnwrap(title, "\(name): a title in the right page's header")
        XCTAssertLessThanOrEqual(header.frame.maxX, 951 - geometry.safeRight + 1, "\(name): title ends before the status column")
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
