import XCTest

/// Clicks through the thread screen against the live BB server the simulator
/// app is signed in to. Set `TEST_RUNNER_BBGO_QA_THREAD` to a thread whose last
/// assistant message ends with a `::reactions` directive. Nothing is sent.
final class ThreadUITests: XCTestCase {
    private let app = XCUIApplication()
    private var threadId: String { ProcessInfo.processInfo.environment["BBGO_QA_THREAD"] ?? "thr_64r2wmjrim" }

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

    /// The split view and keyboard shortcuts; run on an iPad simulator. Nothing is sent.
    func testIPad() throws {
        guard UIDevice.current.userInterfaceIdiom == .pad else { throw XCTSkip("iPad only") }
        // A leftover "Open in BB Go?" prompt from `simctl openurl` swallows keys.
        let prompt = XCUIApplication(bundleIdentifier: "com.apple.springboard").buttons["Cancel"]
        if prompt.exists { prompt.tap() }
        app.open(URL(string: "bbgo://thread/\(ProcessInfo.processInfo.environment["BBGO_PROBE_THREAD"] ?? threadId)")!)
        XCTAssertTrue(app.textViews["Message"].waitForExistence(timeout: 10), "composer")
        sleep(3)
        shot("ipad-thread")
        app.buttons["Find"].tap()
        XCTAssertTrue(app.textFields["Find in thread"].waitForExistence(timeout: 3), "find bar")
        app.textFields["Find in thread"].typeText("the")
        let first = app.staticTexts.matching(NSPredicate(format: "label BEGINSWITH '1 of '")).firstMatch
        XCTAssertTrue(first.waitForExistence(timeout: 20), "match count")
        app.typeKey("g", modifierFlags: .command)
        XCTAssertTrue(app.staticTexts.matching(NSPredicate(format: "label BEGINSWITH '2 of '")).firstMatch.waitForExistence(timeout: 3), "⌘G steps")
        shot("ipad-find")
        app.buttons["Done"].firstMatch.tap()
        app.typeKey("m", modifierFlags: [.command, .shift])
        XCTAssertTrue(app.navigationBars["Model"].waitForExistence(timeout: 5), "⇧⌘M opens the model sheet")
        app.buttons["Cancel"].tap()
        app.typeKey("n", modifierFlags: .command)
        XCTAssertTrue(app.navigationBars["New thread"].waitForExistence(timeout: 5), "⌘N opens a new thread")
        shot("ipad-new")
    }

    func testThread() throws {
        app.open(URL(string: "bbgo://thread/\(threadId)")!)
        guard app.buttons["reaction"].firstMatch.waitForExistence(timeout: 10) else {
            throw XCTSkip("the thread's last reply has no reactions")
        }
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

    /// Find, mentions, drafts, diffs and the model sheet, without sending or
    /// saving anything, so it can point at any thread: TEST_RUNNER_BBGO_PROBE_THREAD.
    func testFeatures() throws {
        let env = ProcessInfo.processInfo.environment
        guard let id = env["BBGO_PROBE_THREAD"] else { throw XCTSkip("no probe thread") }
        app.open(URL(string: "bbgo://thread/\(id)")!)
        let composer = app.textViews["Message"]
        XCTAssertTrue(composer.waitForExistence(timeout: 10), "composer")
        sleep(2)
        // Drafts outlive a run that stopped early.
        clear(composer)

        // Find in thread.
        app.buttons["More"].tap()
        app.buttons["Find in thread"].tap()
        let field = app.textFields["Find in thread"]
        XCTAssertTrue(field.waitForExistence(timeout: 3), "find field")
        field.typeText("the")
        XCTAssertTrue(wait(20) { app.staticTexts.matching(NSPredicate(format: "label CONTAINS ' of '")).firstMatch.exists }, "match count")
        shot("find-1")
        app.buttons["Earlier match"].tap()
        sleep(1)
        shot("find-2")
        app.buttons["Done"].firstMatch.tap()

        // @ suggestions, then the draft surviving a trip back to Home.
        composer.tap()
        composer.typeText("@at")
        XCTAssertTrue(app.buttons["mention"].firstMatch.waitForExistence(timeout: 5), "mention suggestions")
        shot("mentions")
        clear(composer)
        composer.typeText("Draft kept")
        app.navigationBars.buttons.element(boundBy: 0).tap()
        sleep(1)
        app.open(URL(string: "bbgo://thread/\(id)")!)
        XCTAssertTrue(wait { (app.textViews["Message"].value as? String) == "Draft kept" }, "draft restored")
        clear(app.textViews["Message"])
        app.swipeDown(velocity: .slow)

        // Model sheet, cancelled.
        app.buttons["More"].tap()
        app.buttons["Model & reasoning"].tap()
        XCTAssertTrue(app.navigationBars["Model"].waitForExistence(timeout: 5), "model sheet")
        sleep(2)
        shot("model")
        app.buttons["Cancel"].tap()

        // An edit's diff.
        let edited = app.buttons.matching(NSPredicate(format: "label CONTAINS[c] 'edited'")).firstMatch
        for _ in 0..<12 where !edited.isHittable {
            app.swipeDown(velocity: .slow)
            sleep(1)
        }
        guard edited.isHittable else { return XCTFail("no edits on screen") }
        edited.tap()
        let step = app.buttons.matching(NSPredicate(format: "label BEGINSWITH 'Edited ' OR label BEGINSWITH 'Created '")).firstMatch
        XCTAssertTrue(step.waitForExistence(timeout: 3), "edit step")
        step.tap()
        sleep(1)
        shot("diff")
    }

    /// Every Pages block kind, from a built-in page rather than a real one.
    /// Automations, queue, usage and host settings. Read-only: nothing is run, paused or sent.
    func testTools() {
        app.open(URL(string: "bbgo://automations")!)
        XCTAssertTrue(app.navigationBars["Automations"].waitForExistence(timeout: 10))
        sleep(2)
        shot("tools-automations")
        app.staticTexts.matching(NSPredicate(format: "label CONTAINS 'Daily'")).firstMatch.tap()
        XCTAssertTrue(app.switches["Enabled"].waitForExistence(timeout: 10), "automation detail")
        sleep(2)
        shot("tools-automation")
        app.open(URL(string: "bbgo://queue")!)
        XCTAssertTrue(app.navigationBars["Queue"].waitForExistence(timeout: 10))
        sleep(2)
        shot("tools-queue")
        app.open(URL(string: "bbgo://usage")!)
        XCTAssertTrue(app.navigationBars["Usage"].waitForExistence(timeout: 10))
        sleep(2)
        shot("tools-usage")
        app.open(URL(string: "bbgo://settings")!)
        XCTAssertTrue(app.switches["Keep Mac awake"].waitForExistence(timeout: 10), "keep awake")
        shot("tools-settings")
        app.open(URL(string: "bbgo://home")!)
        XCTAssertTrue(app.buttons["Automations"].waitForExistence(timeout: 10))
        shot("tools-home")
    }

    /// Read-only: opens sheets and screens, never sends, forks or compacts.
    func testThreadExtras() {
        app.open(URL(string: "bbgo://thread/\(threadId)")!)
        let more = app.buttons["More"]
        XCTAssertTrue(more.waitForExistence(timeout: 10))
        more.tap()
        XCTAssertTrue(app.buttons["Fork thread"].waitForExistence(timeout: 5))
        XCTAssertTrue(app.buttons["Compact context"].exists)
        shot("extras-menu")
        app.buttons["Files & changes"].tap()
        XCTAssertTrue(app.segmentedControls.buttons["Changes"].waitForExistence(timeout: 10))
        sleep(2)
        shot("extras-changes")
        app.staticTexts.matching(NSPredicate(format: "label ENDSWITH '.md'")).firstMatch.tap()
        sleep(2)
        shot("extras-diff")
        if app.buttons["View file"].waitForExistence(timeout: 3) {
            app.buttons["View file"].tap()
            sleep(2)
            shot("extras-file")
            app.navigationBars.buttons.element(boundBy: 0).tap()
        }
        app.navigationBars.buttons.element(boundBy: 0).tap()
        app.segmentedControls.buttons["Files"].tap()
        sleep(1)
        shot("extras-files")
        app.buttons["Done"].tap()
        more.tap()
        app.buttons["Recent prompts"].tap()
        XCTAssertTrue(app.navigationBars["Recent prompts"].waitForExistence(timeout: 10))
        sleep(2)
        shot("extras-history")
        app.buttons["Done"].tap()
        app.open(URL(string: "bbgo://archived")!)
        XCTAssertTrue(app.navigationBars["Archived"].waitForExistence(timeout: 10))
        sleep(2)
        shot("extras-archived")
        app.open(URL(string: "bbgo://drawings")!)
        XCTAssertTrue(app.navigationBars["Drawings"].waitForExistence(timeout: 10))
        sleep(2)
        shot("extras-drawings")
        if let id = ProcessInfo.processInfo.environment["BBGO_QA_DRAWING"] {
            app.open(URL(string: "bbgo://drawing/\(id)")!)
            sleep(3)
            shot("extras-drawing")
        }
    }

    /// Read-only: browses attention, a channel, the queue and custom instructions.
    func testPluginScreens() {
        app.open(URL(string: "bbgo://attention")!)
        XCTAssertTrue(app.navigationBars["Attention"].waitForExistence(timeout: 10))
        sleep(2)
        shot("plugins-attention-open")
        app.segmentedControls.buttons["Done"].tap()
        sleep(2)
        shot("plugins-attention-done")
        let first = app.cells.firstMatch
        if first.waitForExistence(timeout: 5) {
            first.tap()
            sleep(3)
            shot("plugins-channel")
            app.navigationBars.buttons.element(boundBy: 0).tap()
        }
        app.open(URL(string: "bbgo://queue")!)
        XCTAssertTrue(app.navigationBars["Queue"].waitForExistence(timeout: 10))
        sleep(2)
        shot("plugins-queue")
        app.tabBars.buttons["Settings"].tap()
        let instructions = app.buttons["Custom Instructions"]
        if instructions.waitForExistence(timeout: 5) {
            instructions.tap()
            XCTAssertTrue(app.navigationBars["Custom Instructions"].waitForExistence(timeout: 10))
            sleep(2)
            shot("plugins-instructions")
            app.navigationBars.buttons.element(boundBy: 0).tap()
        }
        shot("plugins-settings")
    }

    func testPageDemo() {
        app.terminate()
        app.launchArguments = ["-qaPageDemo"]
        app.launch()
        app.open(URL(string: "bbgo://page/qa-demo")!)
        XCTAssertTrue(app.staticTexts["Launch plan"].waitForExistence(timeout: 10))
        sleep(1)
        shot("page-demo-top")
        app.swipeUp(velocity: .slow)
        sleep(1)
        shot("page-demo-bottom")
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
