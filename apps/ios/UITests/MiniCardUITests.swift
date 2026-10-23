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
@MainActor
final class MiniCardUITests: XCTestCase {
    private let app = XCUIApplication()

    func testMiniCardsRunInline() async throws {
        XCUIDevice.shared.orientation = .portrait
        guard let thread = ProcessInfo.processInfo.environment["BBGO_QA_MINI_THREAD"], !thread.isEmpty else {
            throw XCTSkip("Set TEST_RUNNER_BBGO_QA_MINI_THREAD to a staged thread with mini app cards")
        }
        continueAfterFailure = false
        try? FileManager.default.removeItem(atPath: "/tmp/qa-mini-cards-ready")
        launch(thread)

        let add = app.webViews.buttons["Add task"].firstMatch
        XCTAssertTrue(add.waitForExistence(timeout: 30), "the last card runs its app")
        // Card heights arrive asynchronously. Establish the test's newest-copy
        // starting point before testing a downward transcript drag.
        let latest = app.buttons["Jump to latest"]
        if latest.exists { latest.tap() }
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
        // Content and measured card heights have changed during the actions
        // above. Establish the newest-copy starting point after those changes.
        if app.buttons["Jump to latest"].exists { app.buttons["Jump to latest"].tap() }
        Thread.sleep(forTimeInterval: 3)
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
        if let ids = ProcessInfo.processInfo.environment["BBGO_QA_MINI_IDS"],
           let server = ProcessInfo.processInfo.environment["BBGO_QA_SERVER"], let id = ids.split(separator: ",").first {
            var request = URLRequest(url: URL(string: server + "/api/v1/plugins/studio/rpc/minis.db.insert")!)
            request.httpMethod = "POST"
            request.setValue("application/json", forHTTPHeaderField: "Content-Type")
            request.httpBody = try JSONSerialization.data(withJSONObject: ["id": String(id), "clientId": "duo-ui-test",
                "collection": "tasks", "data": ["title": "Server task"]])
            let (_, response) = try await URLSession.shared.data(for: request)
            XCTAssertEqual((response as? HTTPURLResponse)?.statusCode, 200)
        }
        XCTAssertTrue(app.webViews.staticTexts["Server task"].waitForExistence(timeout: 60), "a record from elsewhere arrived by realtime")
        screenshot("realtime")
    }

    /// Production cards on native outer and iPad landscape scenes. The latter
    /// uses the same split decision as Duo, with reliable physical touch bounds.
    func testScrollOwnershipInOuterAndLandscape() throws {
        let env = ProcessInfo.processInfo.environment
        guard let thread = env["BBGO_QA_MINI_THREAD"], env["BBGO_QA_MINI_IDS"] != nil else {
            throw XCTSkip("Set the staged Duo mini fixture IDs and server")
        }
        let sizes = [("outer", CGSize(width: 466, height: 678)), ("landscape", CGSize(width: 951, height: 669))]
        // A forced window may exceed the simulator's physical touch surface.
        // Run each size on a simulator whose screen can receive its gestures.
        guard let requested = env["BBGO_QA_MINI_LAYOUT"], ["outer", "landscape"].contains(requested) else {
            throw XCTSkip("Set TEST_RUNNER_BBGO_QA_MINI_LAYOUT to the native simulator size: outer or landscape")
        }
        defer { XCUIDevice.shared.orientation = .portrait }
        for (name, _) in sizes where requested == name {
            XCUIDevice.shared.orientation = name == "landscape" ? .landscapeLeft : .portrait
            launch(thread)
            XCTAssertTrue(app.textViews["Message"].waitForExistence(timeout: 20))
            let window = app.windows.firstMatch
            expectation(for: NSPredicate { _, _ in
                name == "landscape" ? window.frame.width >= 900 && window.frame.width > window.frame.height
                    : window.frame.width < 900 && window.frame.height > window.frame.width
            }, evaluatedWith: nil)
            waitForExpectations(timeout: 10)
            let size = window.frame.size
            let short = app.webViews.buttons["Add task"].firstMatch
            XCTAssertTrue(short.waitForExistence(timeout: 30))
            // Materialize the reply's early cards once. Their initial 240pt
            // estimates otherwise change as the first drag brings them near,
            // masking that drag with a simultaneous content-size correction.
            XCUIDevice.shared.system.open(URL(string: "bbstudio://qa-duo/mid")!)
            let early = app.webViews.staticTexts["Row 1"].firstMatch
            XCTAssertTrue(early.waitForExistence(timeout: 20))
            Thread.sleep(forTimeInterval: 3)
            XCUIDevice.shared.system.open(URL(string: "bbstudio://qa-duo/bottom")!)
            Thread.sleep(forTimeInterval: 1)
            // WebKit can retain a stale accessibility frame after a large
            // programmatic jump. Measure the native card header, and start
            // the drag inside its preview, rather than following that frame.
            let shortHeader = try XCTUnwrap(app.staticTexts.matching(identifier: "Task counter").allElementsBoundByIndex.first {
                $0.isHittable && $0.frame.minY > 100 && $0.frame.maxY < size.height - 250
            })
            let before = shortHeader.frame.minY
            cardDrag(x: shortHeader.frame.midX, y: shortHeader.frame.maxY + 60, distance: 270)
            XCTAssertGreaterThan(shortHeader.frame.minY, before + 80, "\(name): a short app passes the drag to the transcript")
            let detailLeft: CGFloat = name == "landscape" ? size.width / 2 + 16 : 0
            var header: XCUIElement?
            for _ in 0..<14 {
                header = app.staticTexts.matching(identifier: "Long list").allElementsBoundByIndex.first {
                    $0.isHittable && $0.frame.minY > 130 && $0.frame.minY < 300
                }
                if header != nil { break }
                cardDrag(x: detailLeft + 5, y: 170, distance: 240)
            }
            let title = try XCTUnwrap(header, "\(name): tall card is positioned inside the transcript")
            let row = app.webViews.staticTexts["Row 1"].firstMatch
            XCTAssertTrue(row.waitForExistence(timeout: 10))
            let (rowY, titleY) = (row.frame.minY, title.frame.minY)
            cardDrag(x: title.frame.midX, y: title.frame.maxY + 110, distance: -150)
            XCTAssertEqual(title.frame.minY, titleY, accuracy: 4, "\(name): the transcript stays still over a tall app")
            XCTAssertTrue(!row.exists || row.frame.minY < rowY - 60, "\(name): the app scrolls internally past its maximum height")
            let image = window.screenshot()
            let attachment = XCTAttachment(screenshot: image)
            attachment.name = "mini-scroll-\(name)"
            attachment.lifetime = .keepAlways
            add(attachment)
            app.terminate()
        }
    }

    private func launch(_ thread: String) {
        app.launchArguments = ["-skipPushPrompt", "YES", "-openURL", "bbstudio://thread/\(thread)"]
        let env = ProcessInfo.processInfo.environment
        if let server = env["BBGO_QA_SERVER"] { app.launchArguments += ["-serverURL", server] }
        if let ids = env["BBGO_QA_MINI_IDS"] { app.launchArguments += ["-qaBotDemo", "duo", "-qaDuoMinis", ids] }
        app.launch()
    }

    private func cardDrag(x: CGFloat, y: CGFloat, distance: CGFloat) {
        let origin = app.windows.firstMatch.coordinate(withNormalizedOffset: .zero)
        let from = origin.withOffset(CGVector(dx: x, dy: y))
        from.press(forDuration: 0.05, thenDragTo: origin.withOffset(CGVector(dx: x, dy: y + distance)),
                   withVelocity: 300, thenHoldForDuration: 0.3)
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
