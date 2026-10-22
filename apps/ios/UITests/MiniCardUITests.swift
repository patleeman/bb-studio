import XCTest

/// Mini apps running inline in reply cards, against a staged BB
/// (`TEST_RUNNER_BBGO_QA_MINI_THREAD=thr_…`) whose reply holds, in order,
/// `::mini` cards for a task counter ("Add task", "Count <n>" and "Fetch"
/// buttons), a "Long list" app taller than its card ("Row 1"…), a note app
/// ("Tap note", "Note taps: <n>") and the task counter again. The README
/// describes the setup.
///
/// The thread opens at its end, so it uses the last card first, checks that a
/// drag over it scrolls the thread, that the long list scrolls inside its
/// card, and that the first copy, above, shows the last one's changes. Then it writes `/tmp/qa-mini-cards-ready` and waits
/// for a record named "Server task", which the person running it inserts
/// through Studio's RPC, to arrive by realtime.
final class MiniCardUITests: XCTestCase {
    private let app = XCUIApplication()

    func testMiniCardsRunInline() throws {
        guard let thread = ProcessInfo.processInfo.environment["BBGO_QA_MINI_THREAD"], !thread.isEmpty else {
            throw XCTSkip("Set TEST_RUNNER_BBGO_QA_MINI_THREAD to a staged thread with mini app cards")
        }
        continueAfterFailure = false
        try? FileManager.default.removeItem(atPath: "/tmp/qa-mini-cards-ready")
        app.launchArguments += ["-skipPushPrompt", "YES", "-openURL", "bbstudio://thread/\(thread)"]
        app.launch()

        let add = app.webViews.buttons["Add task"].firstMatch
        XCTAssertTrue(add.waitForExistence(timeout: 30), "the last card runs its app")
        screenshot("top")

        // Shared state, records and the phone's refusal, as full screen.
        let count = app.webViews.buttons.matching(NSPredicate(format: "label BEGINSWITH 'Count '")).firstMatch
        let counted = (Int(count.label.dropFirst(6)) ?? 0) + 1
        count.tap()
        XCTAssertTrue(app.webViews.buttons["Count \(counted)"].waitForExistence(timeout: 5))
        let tasks = app.webViews.staticTexts.matching(NSPredicate(format: "label BEGINSWITH 'Task '")).count
        add.tap()
        XCTAssertTrue(app.webViews.staticTexts["Task \(tasks + 1)"].waitForExistence(timeout: 10), "db.insert went through")
        app.webViews.buttons["Fetch"].firstMatch.tap()
        XCTAssertTrue(app.webViews.staticTexts["Open this mini app in BB on your computer to reach the internet."].waitForExistence(timeout: 10))
        screenshot("used")

        // A drag that starts on the app scrolls the thread, since the app fits its card.
        let before = add.frame.minY
        drag(from: add.frame.midY + 40, by: 300)
        XCTAssertGreaterThan(add.frame.minY, before + 150, "the thread scrolled over the card")

        let note = try XCTUnwrap(scroll(to: app.webViews.buttons.matching(identifier: "Tap note")), "the note card runs")
        let taps = app.webViews.staticTexts.matching(NSPredicate(format: "label BEGINSWITH 'Note taps: '")).firstMatch
        let tapped = (Int(taps.label.dropFirst(11)) ?? 0) + 1
        note.tap()
        XCTAssertTrue(app.webViews.staticTexts["Note taps: \(tapped)"].waitForExistence(timeout: 5))

        // The long list is taller than its card: it scrolls inside, and the thread stays.
        let row = try XCTUnwrap(scroll(to: app.webViews.staticTexts.matching(identifier: "Row 1")), "the long list card runs")
        let header = try XCTUnwrap(app.staticTexts.matching(identifier: "Long list").allElementsBoundByIndex.first { $0.isHittable })
        let (rowAt, headerAt) = (row.frame.minY, header.frame.minY)
        screenshot("long-list-before")
        // Well inside the app, under the card's header row.
        drag(from: header.frame.maxY + 140, by: -150)
        screenshot("long-list")
        XCTAssertEqual(header.frame.minY, headerAt, accuracy: 4, "the thread didn't move")
        XCTAssertTrue(!row.exists || row.frame.minY < rowAt - 60, "the list scrolled inside its card")

        // The first copy of the task counter has the last one's changes.
        _ = try XCTUnwrap(scroll(to: app.webViews.buttons.matching(identifier: "Count \(counted)")), "the first copy shows the shared count")
        XCTAssertTrue(app.webViews.staticTexts["Task \(tasks + 1)"].firstMatch.exists)
        screenshot("first")

        FileManager.default.createFile(atPath: "/tmp/qa-mini-cards-ready", contents: Data())
        XCTAssertTrue(app.webViews.staticTexts["Server task"].waitForExistence(timeout: 60), "a record from elsewhere arrived by realtime")
        screenshot("realtime")
    }

    /// Drags vertically from `y`, over the cards, or `beside` them in the thread's margin.
    private func drag(from y: CGFloat, by distance: CGFloat, beside: Bool = false) {
        let origin = app.coordinate(withNormalizedOffset: .zero)
        let start = origin.withOffset(CGVector(dx: beside ? 6 : app.frame.width / 2, dy: y))
        // Slowly, and held at the end, so the thread doesn't fling on.
        start.press(forDuration: 0.05, thenDragTo: start.withOffset(CGVector(dx: 0, dy: distance)),
                    withVelocity: 300, thenHoldForDuration: 0.3)
    }

    /// Scrolls the thread up, toward the start of the reply, until an element
    /// of `query` is well on screen, and returns it. The prompt above the
    /// reply holds the same cards, clipped, so the query can match more than one.
    private func scroll(to query: XCUIElementQuery) -> XCUIElement? {
        func shown() -> XCUIElement? {
            query.allElementsBoundByIndex.first { element in
                element.exists && element.isHittable && element.frame.minY > app.frame.height * 0.3
                    && element.frame.maxY < app.frame.height * 0.75
            }
        }
        for _ in 0..<12 {
            if let element = shown() { return element }
            drag(from: app.frame.height * 0.3, by: 280, beside: true)
            _ = query.firstMatch.waitForExistence(timeout: 2)
        }
        screenshot("not-found")
        return shown()
    }

    private func screenshot(_ name: String) {
        let shot = XCUIScreen.main.screenshot()
        try? shot.pngRepresentation.write(to: URL(fileURLWithPath: "/tmp/qa-mini-cards-\(name).png"))
    }
}
