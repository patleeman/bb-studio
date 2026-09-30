import XCTest

/// Clicks through the thread screen against the live BB server the simulator
/// app is signed in to. Set `BBGO_QA_THREAD` to a throwaway thread whose last
/// assistant message ends with a `::reactions` directive.
final class ThreadUITests: XCTestCase {
    private let app = XCUIApplication()
    private var threadId: String { ProcessInfo.processInfo.environment["BBGO_QA_THREAD"] ?? "thr_rnqmnycvy4" }

    override func setUp() {
        continueAfterFailure = true
        app.launch()
    }

    func testHome() {
        XCTAssertTrue(app.navigationBars["Home"].waitForExistence(timeout: 10))
        shot("home-top")
        app.swipeUp()
        app.swipeUp()
        shot("home-bottom")
    }

    func testThread() {
        app.open(URL(string: "bbgo://thread/\(threadId)")!)
        XCTAssertTrue(app.buttons["reaction"].firstMatch.waitForExistence(timeout: 10), "reaction chip")
        let chip = app.buttons.matching(identifier: "reaction").allElementsBoundByIndex.last!
        let chipText = chip.label
        sleep(2)
        XCTAssertFalse(app.buttons["Jump to latest"].exists, "opens at the latest message")
        shot("thread-bottom")

        let composer = app.textViews["Message"]
        XCTAssertTrue(composer.exists, "composer")

        // A reaction drafts a reply instead of sending it.
        chip.tap()
        XCTAssertTrue(wait { (composer.value as? String)?.contains(chipText) == true }, "reaction drafted")
        shot("thread-reaction")
        clear(composer)

        // Pasting text.
        UIPasteboard.general.string = "Pasted hello"
        paste(into: composer)
        XCTAssertTrue(wait { (composer.value as? String)?.contains("Pasted hello") == true }, "text pasted")
        clear(composer)

        // Pasting an image becomes an attachment.
        UIPasteboard.general.image = UIGraphicsImageRenderer(size: CGSize(width: 40, height: 40)).image { context in
            UIColor.systemPink.setFill()
            context.fill(CGRect(x: 0, y: 0, width: 40, height: 40))
        }
        paste(into: composer)
        let remove = app.buttons["Remove attachment"]
        XCTAssertTrue(remove.waitForExistence(timeout: 5), "image pasted as attachment")
        shot("thread-paste-image")
        if remove.exists { remove.tap() }
        clear(composer)

        // Long press on the assistant reply.
        // Just above the newest row of chips is the newest assistant reply.
        let chips = app.buttons.matching(identifier: "reaction").allElementsBoundByIndex
        let lastTop = chips.map(\.frame.minY).max() ?? 0
        guard let firstRow = chips.filter({ $0.frame.minY > lastTop - 100 }).min(by: { $0.frame.minY < $1.frame.minY }) else {
            return XCTFail("assistant reply")
        }
        firstRow.coordinate(withNormalizedOffset: CGVector(dx: 0.2, dy: 0)).withOffset(CGVector(dx: 0, dy: -30))
            .press(forDuration: 1.2)
        XCTAssertTrue(app.buttons["Copy"].waitForExistence(timeout: 5), "context menu")
        XCTAssertTrue(app.buttons["Select Text"].exists)
        shot("thread-menu")
        let quote = app.buttons["Quote"]
        XCTAssertTrue(quote.exists)
        quote.tap()
        XCTAssertTrue(wait { (composer.value as? String)?.hasPrefix("> ") == true }, "quoted into composer")
        shot("thread-quote")
        clear(composer)

        // Scroll up, then jump back down.
        app.swipeDown()
        app.swipeDown()
        let jump = app.buttons["Jump to latest"]
        XCTAssertTrue(jump.waitForExistence(timeout: 3), "jump button after scrolling up")
        shot("thread-scrolled")
        if jump.exists { jump.tap() }
        XCTAssertTrue(wait { !jump.exists }, "back at bottom")
    }

    /// Screenshots a thread while scrolling up through it. Read-only, so it can
    /// point at any thread: TEST_RUNNER_BBGO_PROBE_THREAD, TEST_RUNNER_BBGO_PROBE_SWIPES,
    /// TEST_RUNNER_BBGO_PROBE_FAST=1 for full-speed swipes, and
    /// TEST_RUNNER_BBGO_PROBE_FIND=<label> to stop once that element is on screen.
    func testProbe() throws {
        let env = ProcessInfo.processInfo.environment
        guard let id = env["BBGO_PROBE_THREAD"] else { throw XCTSkip("no probe thread") }
        app.open(URL(string: "bbgo://thread/\(id)")!)
        sleep(4)
        shot("probe-0")
        for index in 1...(Int(env["BBGO_PROBE_SWIPES"] ?? "") ?? 3) {
            app.swipeDown(velocity: env["BBGO_PROBE_FAST"] == nil ? .slow : .fast)
            sleep(2)
            shot("probe-\(index)")
            if let label = env["BBGO_PROBE_FIND"], app.descendants(matching: .any).matching(NSPredicate(format: "label CONTAINS %@", label)).firstMatch.isHittable {
                for step in 0..<3 {
                    app.swipeDown(velocity: .slow)
                    sleep(2)
                    shot("probe-found-\(step)")
                }
                return
            }
        }
    }

    /// Needs a running thread with a queued message.
    func testQueueRemove() throws {
        app.open(URL(string: "bbgo://thread/\(threadId)")!)
        let remove = app.buttons["Remove from queue"].firstMatch
        guard remove.waitForExistence(timeout: 10) else { throw XCTSkip("nothing queued") }
        let count = app.buttons.matching(identifier: "Remove from queue").count
        remove.tap()
        XCTAssertTrue(wait(10) { app.buttons.matching(identifier: "Remove from queue").count < count }, "queued card removed")
        shot("queue-removed")
    }

    func testShelfDemo() {
        app.terminate()
        app.launchArguments = ["-qaShelfDemo"]
        app.launch()
        app.open(URL(string: "bbgo://thread/\(threadId)")!)
        XCTAssertTrue(app.staticTexts["Plan mode"].waitForExistence(timeout: 10))
        shot("shelf-demo")
        app.buttons.matching(NSPredicate(format: "label CONTAINS 'complete'")).firstMatch.tap()
        sleep(1)
        shot("shelf-demo-todos")
    }

    private func paste(into composer: XCUIElement) {
        composer.tap()
        composer.press(forDuration: 1.2)
        let item = app.menuItems["Paste"].exists ? app.menuItems["Paste"] : app.buttons["Paste"]
        if item.waitForExistence(timeout: 3) {
            item.tap()
        } else {
            XCTFail("no Paste item in the edit menu")
            shot("paste-missing")
        }
    }

    private func clear(_ field: XCUIElement) {
        guard let value = field.value as? String, !value.isEmpty, value != "Message" else { return }
        if !field.hasKeyboardFocus { field.tap() }
        field.typeText(String(repeating: XCUIKeyboardKey.delete.rawValue, count: value.count + 4))
    }

    private func wait(_ timeout: TimeInterval = 5, _ condition: () -> Bool) -> Bool {
        let end = Date().addingTimeInterval(timeout)
        while Date() < end {
            if condition() { return true }
            RunLoop.current.run(until: Date().addingTimeInterval(0.2))
        }
        return condition()
    }

    private func shot(_ name: String) {
        let data = XCUIScreen.main.screenshot().pngRepresentation
        try? data.write(to: URL(fileURLWithPath: "/tmp/qa-ui-\(name).png"))
        let attachment = XCTAttachment(data: data, uniformTypeIdentifier: "public.png")
        attachment.name = name
        attachment.lifetime = .keepAlways
        add(attachment)
    }
}

private extension XCUIElement {
    var hasKeyboardFocus: Bool { (value(forKey: "hasKeyboardFocus") as? Bool) ?? false }
}
