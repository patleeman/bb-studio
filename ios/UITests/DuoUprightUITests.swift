import XCTest

/// The unfolded Duo upright (its two screens one above the other, the hinge
/// across) is one tall phone: the conversation fills the height in one column,
/// never a page split by the hinge. On its side it keeps two pages. Window
/// sizes come from the app's own resize (`bbstudio://qa-duo/…`), never the
/// simulator's. Offline (`-qaStrandsDemo -qaReplyAskDemo`): the strands box's
/// reply ask is one row you tap, no Show under it. On an iPhone Duo simulator.
/// `qa-duo/capture` keeps window PNGs in the app's Documents when
/// `TEST_RUNNER_UPRIGHT_CAPTURE` is set.
final class DuoUprightUITests: ServerIsolatedUITestCase {
    private let app = XCUIApplication()

    private func launch() {
        app.launchArguments = ["-skipPushPrompt", "YES", "-qaBotDemo", "chat", "-qaSpacesDemo", "list", "-qaConversationHome",
                               "-qaStrandsDemo", "-qaReplyAskDemo", "-qaRoomConversation", "thr_botdemo01"]
        app.launchOffline()
        XCTAssertTrue(app.textViews["Message"].waitForExistence(timeout: 40), "the conversation")
    }

    private func command(_ path: String) {
        XCUIDevice.shared.system.open(URL(string: "bbstudio://qa-duo/" + path)!)
        sleep(3)
    }

    private func resize(_ name: String, _ size: CGSize) {
        command(name)
        let window = app.windows.firstMatch
        let sized = NSPredicate { _, _ in abs(window.frame.width - size.width) < 1 && abs(window.frame.height - size.height) < 1 }
        expectation(for: sized, evaluatedWith: nil)
        waitForExpectations(timeout: 10)
        sleep(2)
    }

    private func capture(_ name: String) {
        guard ProcessInfo.processInfo.environment["UPRIGHT_CAPTURE"] != nil else { return }
        command("capture?" + name)
    }

    /// The conversation's header: its title (round 5), in every layout.
    private var title: XCUIElement { app.buttons["conversationMore"] }

    func testUprightIsOneColumnAndOnItsSideTwoPages() throws {
        try XCTSkipUnless(UIDevice.current.name.lowercased().contains("duo") || ProcessInfo.processInfo.environment["UPRIGHT_ANY"] != nil,
                          "an iPhone Duo simulator")
        launch()
        let marker = app.staticTexts.matching(NSPredicate(format: "label CONTAINS %@", "Lisbon offsite budget")).firstMatch
        XCTAssertTrue(marker.waitForExistence(timeout: 15), "a message in view")

        // Unfolded on its side first, as the Duo opens; then turned upright.
        resize("landscape", CGSize(width: 951, height: 669))
        capture("side-first")
        resize("portrait", CGSize(width: 669, height: 951))
        capture("upright")
        XCTAssertTrue(title.waitForExistence(timeout: 10))
        XCTAssertLessThan(title.frame.minY, 951 * 0.25, "upright: the conversation's header at the top, not on the lower screen")
        let composer = app.textViews["Message"]
        XCTAssertGreaterThan(composer.frame.minY, 951 * 0.75, "and its composer at the bottom: one column, full height")
        XCTAssertTrue(marker.exists, "the same message is still there")

        resize("landscape", CGSize(width: 951, height: 669))
        capture("side")
        XCTAssertTrue(title.waitForExistence(timeout: 10))
        XCTAssertGreaterThan(title.frame.minX, 951 / 2, "on its side: two pages, the conversation on the right")

        resize("portrait", CGSize(width: 669, height: 951))
        capture("upright-again")
        XCTAssertLessThan(title.frame.minY, 951 * 0.25, "upright again: one column")
        XCTAssertGreaterThan(composer.frame.minY, 951 * 0.75, "its composer at the bottom again")
        XCTAssertTrue(marker.exists, "the message you were reading survives both switches")

        // The bottom of the upright window, where the strands box sits, onto the simulator's screen.
        command("shift-portrait?0,476")
        let toggle = app.buttons["strands-toggle"]
        XCTAssertTrue(toggle.waitForExistence(timeout: 10))
        toggle.tap()
        let ask = app.buttons["strand-reply-7"]
        XCTAssertTrue(ask.waitForExistence(timeout: 10), "the reply ask is a row you tap")
        XCTAssertFalse(app.buttons["Show"].exists, "no Show button under each ask")
        command("portrait")
        capture("upright-strands")
        command("shift-portrait?0,476")
        ask.tap()
        let mark = app.descendants(matching: .any)["replyAsk"].firstMatch
        let flashing = XCTNSPredicateExpectation(predicate: NSPredicate(format: "value == %@", "flash"), object: mark)
        XCTAssertEqual(XCTWaiter.wait(for: [flashing], timeout: 5), .completed, "tapping it brings the reply up and flashes it")
        command("portrait")
        capture("upright-flash")
    }
}
