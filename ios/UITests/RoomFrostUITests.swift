import XCTest

/// The room's frost (the blurred scene behind a conversation on the phone and
/// the folded Duo) reaches the bottom of the window whatever the keyboard did:
/// up then away, up while the app goes to the background and comes back, and
/// (on the Duo, with the app's own window resize) up while it unfolds and folds.
/// Offline, in a short conversation. `roomFrost` (Debug) is the frost's frame.
final class RoomFrostUITests: ServerIsolatedUITestCase {
    private let app = XCUIApplication()

    private var frost: XCUIElement { app.descendants(matching: .any)["roomFrost"].firstMatch }
    private var composer: XCUIElement { app.textViews["Message"] }
    private var duo: Bool { UIDevice.current.name.lowercased().contains("duo") }

    private func launch() {
        app.launchArguments = ["-skipPushPrompt", "YES", "-qaBotDemo", "chat", "-qaSpacesDemo", "list", "-qaConversationHome",
                               "-qaRoomConversation", "thr_demo_interview", "-qaRoomTheme", "forest"]
        app.launchOffline()
        XCTAssertTrue(composer.waitForExistence(timeout: 40), "the conversation")
    }

    private func keyboardUp() {
        composer.tap()
        XCTAssertTrue(app.keyboards.firstMatch.waitForExistence(timeout: 10), "the keyboard")
        sleep(1)
    }

    private func keyboardAway() {
        app.coordinate(withNormalizedOffset: CGVector(dx: 0.3, dy: 0.3)).tap()
        let gone = XCTNSPredicateExpectation(predicate: NSPredicate(format: "exists == false"), object: app.keyboards.firstMatch)
        _ = XCTWaiter.wait(for: [gone], timeout: 10)
        sleep(2)
    }

    /// The frost's bottom against the window's, after `step`.
    private func expectFilled(_ step: String, file: StaticString = #filePath, line: UInt = #line) {
        XCTAssertTrue(frost.waitForExistence(timeout: 10), "the frost (\(step))", file: file, line: line)
        let window = app.windows.firstMatch.frame
        XCTAssertGreaterThanOrEqual(frost.frame.maxY, window.maxY - 1,
                                    "\(step): the frost reaches the bottom (\(Int(frost.frame.maxY)) of \(Int(window.maxY)))", file: file, line: line)
        XCTAssertLessThanOrEqual(frost.frame.minY, window.minY + 1, "\(step): and the top", file: file, line: line)
    }

    func testTheFrostFillsTheRoomWhateverTheKeyboardDid() {
        launch()
        expectFilled("opened")

        keyboardUp()
        expectFilled("keyboard up")
        keyboardAway()
        expectFilled("keyboard put away")

        keyboardUp()
        XCUIDevice.shared.press(.home)
        sleep(3)
        app.activate()
        XCTAssertTrue(composer.waitForExistence(timeout: 20))
        sleep(2)
        expectFilled("back from the background with the keyboard up")
        if app.keyboards.firstMatch.exists { keyboardAway(); expectFilled("then put away") }

        if duo {
            keyboardUp()
            for size in ["landscape", "outer"] {
                XCUIDevice.shared.system.open(URL(string: "bbstudio://qa-duo/" + size)!)
                sleep(4)
            }
            expectFilled("unfolded and folded with the keyboard up")
            if app.keyboards.firstMatch.exists { keyboardAway(); expectFilled("then put away") }
        }
    }
}
