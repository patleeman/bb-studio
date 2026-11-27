import XCTest

/// A reply that needs the user, marked in the transcript, offline
/// (`-qaConversationHome -qaSpacesDemo list -qaBotDemo chat -qaStrandsDemo
/// -qaReplyAskDemo`: Main's newest reply is tagged needs-you with its asking
/// sentence, and a strand waits on it first). The reply is an ordinary message:
/// no standing highlight (round 5). The long-press says Done is on the Mac;
/// Show in the strands box brings the reply into view and flashes it briefly.
/// `TEST_RUNNER_ASK_OUT` keeps PNGs.
final class ReplyAskUITests: ServerIsolatedUITestCase {
    private let app = XCUIApplication()

    private func launch() {
        app.launchArguments = ["-skipPushPrompt", "YES", "-qaBotDemo", "chat", "-qaSpacesDemo", "list", "-qaConversationHome",
                               "-qaRoomConversation", "thr_botdemo01", "-qaStrandsDemo", "-qaReplyAskDemo"]
        app.launchOffline()
        XCTAssertTrue(app.textViews["Message"].waitForExistence(timeout: 30), "the conversation")
    }

    private var mark: XCUIElement { app.descendants(matching: .any)["replyAsk"].firstMatch }

    private func waitForValue(_ value: String, timeout: TimeInterval = 10) -> Bool {
        let expectation = XCTNSPredicateExpectation(predicate: NSPredicate(format: "value == %@", value), object: mark)
        return XCTWaiter.wait(for: [expectation], timeout: timeout) == .completed
    }

    func testTheAskIsAnOrdinaryMessageAndShowFlashesIt() {
        launch()
        let sentence = app.staticTexts.containing(NSPredicate(format: "label CONTAINS %@", "Want me to draft")).firstMatch
        XCTAssertTrue(sentence.waitForExistence(timeout: 20), "the reply that asks")
        XCTAssertFalse(mark.exists, "no standing needs-you highlight")
        shot("1-ordinary")

        sentence.press(forDuration: 1.2)
        let done = app.descendants(matching: .any).matching(NSPredicate(format: "label == %@", "Mark done in BB Studio on your Mac")).firstMatch
        XCTAssertTrue(done.waitForExistence(timeout: 5), "the long-press says where Done is")
        XCTAssertFalse(done.isEnabled, "the phone doesn't mark it done itself")
        shot("2-long-press")
        app.coordinate(withNormalizedOffset: CGVector(dx: 0.95, dy: 0.5)).tap()
        XCTAssertTrue(done.waitForNonExistence(timeout: 5))

        // Scrolled away, Show in the strands box brings it back and flashes it.
        app.swipeDown(velocity: .fast)
        app.swipeDown(velocity: .fast)
        let toggle = app.buttons["strands-toggle"]
        XCTAssertTrue(toggle.waitForExistence(timeout: 10))
        toggle.tap()
        let show = app.buttons["strand-reply-7"]
        XCTAssertTrue(show.waitForExistence(timeout: 10), "the strand that waits on the reply has Show")
        shot("3-strands-box")
        show.tap()
        XCTAssertTrue(waitForValue("flash", timeout: 5), "it flashes")
        XCTAssertTrue(mark.isHittable || sentence.isHittable, "and is in view")
        shot("4-flash")
        XCTAssertTrue(mark.waitForNonExistence(timeout: 8), "then the flash goes, with no mark left behind")
    }

    private func shot(_ name: String) {
        guard let folder = ProcessInfo.processInfo.environment["ASK_OUT"] else { return }
        let url = URL(fileURLWithPath: folder)
        try? FileManager.default.createDirectory(at: url, withIntermediateDirectories: true)
        try? XCUIScreen.main.screenshot().pngRepresentation.write(to: url.appendingPathComponent("\(name).png"))
    }
}
