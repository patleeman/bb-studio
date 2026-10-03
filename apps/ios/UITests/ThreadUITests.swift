import XCTest

/// Clicks through the thread screen against the live BB server the simulator
/// app is signed in to. Set `TEST_RUNNER_BBGO_QA_THREAD` to a thread whose last
/// assistant message ends with a `::reactions` directive. Nothing is sent.
final class ThreadUITests: XCTestCase {
    private let app = XCUIApplication()
    private var threadId: String { StagedFixture.threadId }

    override func setUp() {
        continueAfterFailure = true
        app.launchArguments = ["-skipPushPrompt", "YES", "-officeTab", "work"]
        app.launch()
    }

    func testWork() {
        XCTAssertTrue(app.navigationBars["Work"].waitForExistence(timeout: 10))
        shot("work-top")
        app.swipeUp()
        app.swipeUp()
        shot("work-bottom")
    }

    /// The split view and keyboard shortcuts; run on an iPad simulator. Nothing is sent.
    func testIPad() throws {
        guard UIDevice.current.userInterfaceIdiom == .pad else { throw XCTSkip("iPad only") }
        // A leftover "Open in BB Studio?" prompt from `simctl openurl` swallows keys.
        let prompt = XCUIApplication(bundleIdentifier: "com.apple.springboard").buttons["Cancel"]
        if prompt.exists { prompt.tap() }
        app.open(URL(string: "bbstudio://thread/\(ProcessInfo.processInfo.environment["BBGO_PROBE_THREAD"] ?? threadId)")!)
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
        app.open(URL(string: "bbstudio://thread/\(threadId)")!)
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
        app.open(URL(string: "bbstudio://thread/\(id)")!)
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
        app.open(URL(string: "bbstudio://thread/\(id)")!)
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
        app.open(URL(string: "bbstudio://thread/\(id)")!)
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

    /// Automations, usage and host settings. Read-only: nothing is run, paused or sent.
    func testTools() {
        continueAfterFailure = false
        app.open(URL(string: "bbstudio://automations")!)
        XCTAssertTrue(app.navigationBars["Automations"].waitForExistence(timeout: 10))
        sleep(2)
        shot("tools-automations")
        let daily = app.staticTexts["Daily native UI fixture"].firstMatch
        XCTAssertTrue(daily.waitForExistence(timeout: 10), "paused staged automation")
        daily.tap()
        XCTAssertTrue(app.switches["Enabled"].waitForExistence(timeout: 10), "automation detail")
        sleep(2)
        shot("tools-automation")
        app.open(URL(string: "bbstudio://usage")!)
        XCTAssertTrue(app.navigationBars["Usage"].waitForExistence(timeout: 10))
        sleep(2)
        shot("tools-usage")
        app.open(URL(string: "bbstudio://settings")!)
        XCTAssertTrue(app.switches["Keep Mac awake"].waitForExistence(timeout: 10), "keep awake")
        shot("tools-settings")
        let automations = app.buttons["Automations"]
        for _ in 0..<5 where !automations.exists || !automations.isHittable { app.swipeUp() }
        XCTAssertTrue(automations.waitForExistence(timeout: 5), "Automations entry in Settings")
        automations.tap()
        XCTAssertTrue(app.navigationBars["Automations"].waitForExistence(timeout: 10), "Automations is in Settings")
        shot("tools-settings-automations")
    }

    /// Read-only: opens sheets and screens, never sends, forks or compacts.
    func testThreadExtras() throws {
        app.open(URL(string: "bbstudio://thread/\(threadId)")!)
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
        // The diff steps need the fixture thread's checkout to have changes.
        try XCTSkipIf(app.staticTexts["No uncommitted changes"].exists, "no uncommitted changes to open")
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
        app.open(URL(string: "bbstudio://archived")!)
        XCTAssertTrue(app.navigationBars["Archived"].waitForExistence(timeout: 10))
        sleep(2)
        shot("extras-archived")
        app.open(URL(string: "bbstudio://drawings")!)
        XCTAssertTrue(app.navigationBars["Studio"].waitForExistence(timeout: 10))
        sleep(2)
        shot("extras-drawings")
        if let id = ProcessInfo.processInfo.environment["BBGO_QA_DRAWING"] {
            app.open(URL(string: "bbstudio://drawing/\(id)")!)
            sleep(3)
            shot("extras-drawing")
        }
    }

    /// Read-only: filters Studio by kind, opens one of each, and searches. Records nothing.
    func testStudio() {
        openStudioCollection()
        XCTAssertTrue(app.navigationBars["Studio"].waitForExistence(timeout: 10))
        sleep(2)
        shot("studio-all")
        for (chip, name) in [("Pages", "page"), ("Recordings", "recording"), ("Dictations", "dictation"), ("Drawings", "drawing"), ("Artifacts", "artifact")] {
            let button = app.buttons[chip].firstMatch
            guard button.waitForExistence(timeout: 3) else { continue }
            button.tap()
            sleep(1)
            shot("studio-\(name)s")
            // Items only: the quick-action tiles start real recordings.
            let first = app.descendants(matching: .any).matching(identifier: "studioItem").firstMatch
            if first.waitForExistence(timeout: 3) {
                first.tap()
                sleep(3)
                shot("studio-\(name)")
                XCTAssertFalse(app.navigationBars["Recording"].exists)
                app.navigationBars.buttons.firstMatch.tap()
                sleep(1)
            }
            app.buttons[chip].firstMatch.tap()
        }
        let search = app.searchFields.firstMatch
        if !search.waitForExistence(timeout: 2) {
            app.collectionViews.firstMatch.swipeDown()
        }
        if search.waitForExistence(timeout: 3) {
            search.tap()
            search.typeText("roadmap")
            sleep(2)
            shot("studio-search")
        }
    }

    /// Read-only: browses a channel and custom instructions.
    func testPluginScreens() {
        app.open(URL(string: "bbstudio://home")!)
        let channel = app.buttons.containing(.image, identifier: "number").firstMatch
        if channel.waitForExistence(timeout: 10) {
            channel.tap()
            sleep(3)
            shot("plugins-channel")
            app.navigationBars.buttons.element(boundBy: 0).tap()
        }
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

    /// Records a few seconds from the microphone (the Mac's, in the simulator).
    /// Play speech near the mic while it runs; a silent recording is discarded by Talk.
    func testDictationCapture() {
        app.open(URL(string: "bbstudio://dictate")!)
        sleep(8)
        shot("dictation-recording")
        let finish = app.buttons["checkmark"]
        if finish.waitForExistence(timeout: 3) { finish.tap() }
        sleep(20)
        shot("dictation-result")
    }

    func testPageDemo() {
        app.terminate()
        app.launchArguments = ["-qaPageDemo"]
        app.launch()
        app.open(URL(string: "bbstudio://page/qa-demo")!)
        XCTAssertTrue(app.staticTexts["Launch plan"].waitForExistence(timeout: 10))
        sleep(1)
        shot("page-demo-top")
        app.swipeUp(velocity: .slow)
        sleep(1)
        shot("page-demo-bottom")
    }

    /// Removes this test's scheduled message; never depends on a shared queue.
    func testQueueRemove() throws {
        continueAfterFailure = false
        let id = try XCTUnwrap(scratchThread("QA queue removal \(UUID().uuidString.prefix(8))"))
        addTeardownBlock { _ = self.api("DELETE", "/threads/\(id)", ["childThreadsConfirmed": false]) }
        XCTAssertEqual(api("GET", "/threads/\(id)", [:])?["queuedMessageCount"] as? Int, 1)
        app.open(URL(string: "bbstudio://thread/\(id)")!)
        let remove = app.buttons["Remove from queue"].firstMatch
        XCTAssertTrue(remove.waitForExistence(timeout: 10), "scheduled message has a removal control")
        remove.tap()
        XCTAssertTrue(wait(10) { self.api("GET", "/threads/\(id)", [:])?["queuedMessageCount"] as? Int == 0 }, "server removed the queued message")
        XCTAssertTrue(remove.waitForNonExistence(timeout: 10), "queued card removed")
        shot("queue-removed")
    }

    /// Rewrites the first queued message. Only runs against a scratch thread
    /// named by `TEST_RUNNER_BBGO_QA_QUEUE_THREAD`, never a real one.
    func testQueueEdit() throws {
        guard let id = ProcessInfo.processInfo.environment["BBGO_QA_QUEUE_THREAD"] else { throw XCTSkip("no scratch thread") }
        app.open(URL(string: "bbstudio://thread/\(id)")!)
        let card = app.buttons.matching(NSPredicate(format: "label BEGINSWITH 'Hello'")).firstMatch
        XCTAssertTrue(card.waitForExistence(timeout: 10), "queued card")
        card.tap()
        let editor = app.textViews["queuedMessageEditor"]
        XCTAssertTrue(editor.waitForExistence(timeout: 5), "editor")
        editor.typeText(" today")
        shot("queue-edit")
        app.buttons["Save"].tap()
        XCTAssertTrue(app.buttons.matching(NSPredicate(format: "label CONTAINS 'this today'")).firstMatch.waitForExistence(timeout: 10),
            "edited text on the card")
        shot("queue-edited")
    }

    /// Collapses, expands and drags queued messages. Scratch thread only,
    /// named by `TEST_RUNNER_BBGO_QA_QUEUE_THREAD`, with three or more queued.
    func testQueueReorder() throws {
        guard let id = ProcessInfo.processInfo.environment["BBGO_QA_QUEUE_THREAD"] else { throw XCTSkip("no scratch thread") }
        app.open(URL(string: "bbstudio://thread/\(id)")!)
        let summary = app.buttons["queueSummary"]
        XCTAssertTrue(summary.waitForExistence(timeout: 10), "collapsed queue")
        shot("queue-collapsed")
        summary.tap()
        let cards = app.buttons.matching(NSPredicate(format: "label CONTAINS 'scratch message'"))
        XCTAssertTrue(wait(5) { cards.count >= 3 }, "expanded cards")
        shot("queue-expanded")
        let from = cards.element(boundBy: cards.count - 1).coordinate(withNormalizedOffset: CGVector(dx: 0.5, dy: 0.5))
        let to = cards.element(boundBy: 0).coordinate(withNormalizedOffset: CGVector(dx: 0.5, dy: 0.3))
        from.press(forDuration: 0.8, thenDragTo: to, withVelocity: .slow, thenHoldForDuration: 0.5)
        sleep(2)
        if app.buttons["Move to Top"].exists || app.buttons["Move Up"].exists {
            app.coordinate(withNormalizedOffset: CGVector(dx: 0.5, dy: 0.2)).tap()
            sleep(1)
        }
        shot("queue-dragged")
        app.buttons["Collapse queue"].firstMatch.tap()
        XCTAssertTrue(summary.waitForExistence(timeout: 5), "collapsed again")
    }

    /// Renames the scratch thread from the ⋯ menu.
    func testRenameThread() throws {
        guard let id = ProcessInfo.processInfo.environment["BBGO_QA_QUEUE_THREAD"] else { throw XCTSkip("no scratch thread") }
        app.open(URL(string: "bbstudio://thread/\(id)")!)
        let more = app.buttons["More"].firstMatch
        XCTAssertTrue(more.waitForExistence(timeout: 10))
        more.tap()
        app.buttons["Rename"].tap()
        let field = app.alerts.textFields.firstMatch
        XCTAssertTrue(field.waitForExistence(timeout: 5), "title field")
        field.coordinate(withNormalizedOffset: CGVector(dx: 0.97, dy: 0.5)).tap()
        field.typeText(String(repeating: XCUIKeyboardKey.delete.rawValue, count: ((field.value as? String) ?? "").count + 2))
        field.typeText("BB Studio renamed scratch")
        sleep(1)
        shot("rename-thread")
        app.alerts.buttons["Rename"].tap()
        sleep(2)
        shot("renamed-thread")
        XCTAssertTrue(app.navigationBars.staticTexts["BB Studio renamed scratch"].waitForExistence(timeout: 10), "new title")
    }

    /// Opens voice chat on the scratch thread and checks it starts listening.
    func testVoiceChat() throws {
        guard let id = ProcessInfo.processInfo.environment["BBGO_QA_QUEUE_THREAD"] else { throw XCTSkip("no scratch thread") }
        addUIInterruptionMonitor(withDescription: "permissions") { alert in
            for label in ["Allow", "OK"] where alert.buttons[label].exists {
                alert.buttons[label].tap()
                return true
            }
            return false
        }
        app.open(URL(string: "bbstudio://thread/\(id)")!)
        let more = app.buttons["More"].firstMatch
        XCTAssertTrue(more.waitForExistence(timeout: 10))
        more.tap()
        app.buttons["Voice chat"].tap()
        sleep(2)
        app.tap()
        sleep(5)
        shot("voice-chat")
        // The simulator can't grant speech recognition, so accept the Settings path too.
        let listening = app.staticTexts.matching(NSPredicate(format: "label BEGINSWITH 'Listening'")).firstMatch
        XCTAssertTrue(listening.waitForExistence(timeout: 5) || app.links["Open Settings"].exists || app.buttons["Open Settings"].exists,
            "listening, or a way to fix the permission")
        app.buttons["Pause"].tap()
        app.buttons["End"].tap()
    }

    /// Taps a file path in a reply and checks the file viewer opens. Scratch
    /// thread only, named by `TEST_RUNNER_BBGO_QA_FILE_THREAD`, whose last reply
    /// mentions `README.md`, or the file named by `TEST_RUNNER_BBGO_QA_FILE_NAME`
    /// (a link to `/tmp/…` checks files outside the workspace).
    func testFileLink() throws {
        guard let id = ProcessInfo.processInfo.environment["BBGO_QA_FILE_THREAD"] else { throw XCTSkip("no scratch thread") }
        let name = ProcessInfo.processInfo.environment["BBGO_QA_FILE_NAME"] ?? "README.md"
        app.open(URL(string: "bbstudio://thread/\(id)")!)
        let text = app.staticTexts.matching(NSPredicate(format: "label CONTAINS %@", name)).firstMatch
        XCTAssertTrue(text.waitForExistence(timeout: 15), "reply with a path")
        shot("file-link")
        let link = text.links[name].firstMatch.exists ? text.links[name].firstMatch : app.links[name].firstMatch
        XCTAssertTrue(link.waitForExistence(timeout: 5), "path is a link")
        link.tap()
        XCTAssertTrue(app.navigationBars[name].waitForExistence(timeout: 10), "file viewer")
        sleep(2)
        XCTAssertFalse(app.staticTexts["Couldn't open the file"].exists, "file loads")
        shot("file-viewer")
        app.buttons["Done"].tap()
    }

    func testShelfDemo() {
        app.terminate()
        app.launchArguments = ["-qaShelfDemo", "-skipPushPrompt", "YES", "-officeTab", "work"]
        app.launch()
        app.open(URL(string: "bbstudio://thread/\(threadId)")!)
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

    /// The Studio deep link opens All items in Work.
    private func openStudioCollection() {
        app.open(URL(string: "bbstudio://studio")!)
        XCTAssertTrue(app.navigationBars["Studio"].waitForExistence(timeout: 10), "Studio collection")
    }

    /// The socket closes in the background: on return the inbox catches up on what
    /// changed meanwhile, then stays live. Creates two scratch threads, held
    /// with a far-off send, and deletes them.
    func testResumeReconnects() throws {
        XCTAssertTrue(app.navigationBars["Work"].waitForExistence(timeout: 10))
        let tag = String(UUID().uuidString.prefix(6))
        XCUIDevice.shared.press(.home)
        sleep(3)
        let away = try XCTUnwrap(scratchThread("QA away \(tag)"))
        addTeardownBlock { _ = self.api("DELETE", "/threads/\(away)", ["childThreadsConfirmed": false]) }
        app.activate()
        sleep(3)
        XCTAssertTrue(scrollTo("QA away \(tag)"), "picks up changes made while in the background")
        let live = try XCTUnwrap(scratchThread("QA live \(tag)"))
        addTeardownBlock { _ = self.api("DELETE", "/threads/\(live)", ["childThreadsConfirmed": false]) }
        sleep(4)
        XCTAssertTrue(scrollTo("QA live \(tag)"), "live again after returning")
        shot("resume")
    }

    /// The inbox list renders only the rows on screen: look further down, then back up.
    private func scrollTo(_ text: String) -> Bool {
        let row = app.staticTexts.containing(NSPredicate(format: "label CONTAINS %@", text)).firstMatch
        for up in [true, false] {
            for _ in 0..<6 {
                if row.exists { return true }
                if up { app.swipeUp() } else { app.swipeDown() }
            }
        }
        return row.exists
    }

    /// Opens a scratch artifact named by `TEST_RUNNER_BBGO_QA_ARTIFACT`, then its
    /// card in the reply of the scratch thread `TEST_RUNNER_BBGO_QA_ARTIFACT_THREAD`.
    func testArtifact() throws {
        guard let id = ProcessInfo.processInfo.environment["BBGO_QA_ARTIFACT"] else { throw XCTSkip("no scratch artifact") }
        app.open(URL(string: "bbstudio://artifact/\(id)")!)
        XCTAssertTrue(app.staticTexts["QA artifact"].waitForExistence(timeout: 10), "rendered Markdown")
        sleep(1)
        shot("artifact-viewer")
        app.buttons["More"].firstMatch.tap()
        XCTAssertTrue(app.buttons["New Thread with This"].waitForExistence(timeout: 5), "menu")
        shot("artifact-menu")
        app.coordinate(withNormalizedOffset: CGVector(dx: 0.5, dy: 0.9)).tap()
        app.buttons["Show source"].tap()
        XCTAssertTrue(app.staticTexts.containing(NSPredicate(format: "label CONTAINS '# QA artifact'")).firstMatch.waitForExistence(timeout: 5))
        shot("artifact-source")

        // A reply with the card; queued messages show as plain text.
        guard let thread = ProcessInfo.processInfo.environment["BBGO_QA_ARTIFACT_THREAD"] else { return }
        app.open(URL(string: "bbstudio://thread/\(thread)")!)
        let card = app.buttons["artifactCard"].firstMatch
        XCTAssertTrue(card.waitForExistence(timeout: 15), "artifact card")
        sleep(1)
        shot("artifact-card")
        card.tap()
        XCTAssertTrue(app.staticTexts["QA artifact"].waitForExistence(timeout: 10), "card opens the viewer")
    }

    /// A scratch page named by `TEST_RUNNER_BBGO_QA_PAGE`: the work bar, a saved
    /// version, and rename. Nothing is sent, so no thread starts.
    func testPageTools() throws {
        guard let id = ProcessInfo.processInfo.environment["BBGO_QA_PAGE"] else { throw XCTSkip("no scratch page") }
        app.open(URL(string: "bbstudio://page/\(id)")!)
        XCTAssertTrue(app.descendants(matching: .any)["pageWorkField"].waitForExistence(timeout: 10), "work bar")
        sleep(1)
        shot("page-work-bar")
        app.buttons["More"].firstMatch.tap()
        XCTAssertTrue(app.buttons["Version History"].waitForExistence(timeout: 5), "menu")
        shot("page-menu")
        app.buttons["Version History"].tap()
        let save = app.buttons["Save a Version Now"]
        XCTAssertTrue(save.waitForExistence(timeout: 5), "history")
        save.tap()
        app.alerts.textFields.firstMatch.typeText("QA version")
        app.alerts.buttons["Save"].tap()
        XCTAssertTrue(app.buttons.containing(NSPredicate(format: "label CONTAINS 'QA version'")).firstMatch.waitForExistence(timeout: 10), "saved version")
        shot("page-history")
        app.buttons["Done"].tap()
        app.buttons["More"].firstMatch.tap()
        app.buttons["Rename"].tap()
        let title = app.alerts.textFields.firstMatch
        XCTAssertTrue(title.waitForExistence(timeout: 5))
        title.typeText(" renamed")
        app.alerts.buttons["Rename"].tap()
        XCTAssertTrue(app.staticTexts.containing(NSPredicate(format: "label CONTAINS 'renamed'")).firstMatch.waitForExistence(timeout: 10), "renamed")
        shot("page-renamed")
    }

    /// Comments on a scratch page named by `TEST_RUNNER_BBGO_QA_PAGE` that has one
    /// open thread: reply, resolve, then start a new thread on "Ship it".
    func testPageComments() throws {
        guard let id = ProcessInfo.processInfo.environment["BBGO_QA_PAGE"] else { throw XCTSkip("no scratch page") }
        // Reopen the first thread and drop what earlier runs added.
        let threads = (rpc("pages", "comments", ["id": id, "includeResolved": true])?["threads"] as? [[String: Any]]) ?? []
        let first = try XCTUnwrap(threads.min { ($0["updatedAt"] as? Double ?? 0) < ($1["updatedAt"] as? Double ?? 0) }?["id"] as? String)
        _ = rpc("pages", "commentResolve", ["id": id, "thread": first, "resolved": false])
        for thread in threads where thread["id"] as? String != first {
            _ = rpc("pages", "commentResolve", ["id": id, "thread": thread["id"] as? String ?? "", "resolved": true])
        }
        app.open(URL(string: "bbstudio://page/\(id)")!)
        let comments = app.buttons["Comments"].firstMatch
        XCTAssertTrue(comments.waitForExistence(timeout: 10), "comments button")
        shot("page-comments-button")
        comments.tap()
        XCTAssertTrue(app.navigationBars["Comments"].waitForExistence(timeout: 5), "sheet")
        XCTAssertTrue(app.staticTexts["Is this final?"].waitForExistence(timeout: 10), "thread")
        let reply = app.textFields["Reply"].firstMatch
        reply.tap()
        reply.typeText("QA reply")
        app.buttons["Send Reply"].firstMatch.tap()
        XCTAssertTrue(app.staticTexts["QA reply"].firstMatch.waitForExistence(timeout: 10), "reply")
        shot("page-comments")
        app.buttons["Resolve"].firstMatch.tap()
        XCTAssertTrue(app.staticTexts["No open comments"].waitForExistence(timeout: 10), "resolved")
        app.buttons["New Comment"].firstMatch.tap()
        XCTAssertTrue(app.navigationBars["New Comment"].waitForExistence(timeout: 5), "composer")
        let field = app.textFields["newCommentField"]
        XCTAssertTrue(field.waitForExistence(timeout: 5), "comment field")
        field.tap()
        field.typeText("QA new thread")
        let block = app.buttons.containing(NSPredicate(format: "label CONTAINS 'Ship it'")).firstMatch
        XCTAssertTrue(block.waitForExistence(timeout: 10), "blocks")
        block.tap()
        shot("page-comment-new")
        app.navigationBars["New Comment"].buttons["Post"].tap()
        XCTAssertTrue(app.staticTexts["QA new thread"].waitForExistence(timeout: 10), "new thread")
        shot("page-comments-after")
    }

    /// Plays real recordings, read-only: WebM/Opus ones from the browser and MP4 ones
    /// from the phone. Playback crosses segments, skips, jumps from the transcript, and speeds up.
    func testRecordingPlayback() throws {
        let webm = try XCTUnwrap(ProcessInfo.processInfo.environment["BBGO_QA_RECORDING"], "Seed playback fixtures with BB_QA_DATA_DIR")
        let mp4 = try XCTUnwrap(ProcessInfo.processInfo.environment["BBGO_QA_RECORDING_MP4"], "Seed playback fixtures with BB_QA_DATA_DIR")
        let position = app.staticTexts["playerPosition"]
        func seconds() -> Int {
            let parts = position.label.split(separator: ":").compactMap { Int($0) }
            return parts.reduce(0) { $0 * 60 + $1 }
        }
        for id in [webm, mp4] {
            app.open(URL(string: "bbstudio://recording/\(id)")!)
            let play = app.buttons["Play"].firstMatch
            XCTAssertTrue(play.waitForExistence(timeout: 10), "player bar")
            play.tap()
            XCTAssertTrue(app.buttons["Pause"].firstMatch.waitForExistence(timeout: 15), "playing \(id)")
            sleep(3)
            XCTAssertGreaterThanOrEqual(seconds(), 2, "position moves")
            XCTAssertFalse(app.staticTexts.containing(NSPredicate(format: "label BEGINSWITH 'Couldn'")).firstMatch.exists, "no error")
            // Past the first segment, which is at most 40 s.
            for _ in 0..<3 { app.buttons["Forward 15 seconds"].tap() }
            sleep(3)
            XCTAssertGreaterThanOrEqual(seconds(), 47, "skipped across segments")
            XCTAssertTrue(app.buttons["Pause"].firstMatch.exists, "still playing")
            shot("recording-playing-\(id)")
            app.buttons["Back 15 seconds"].tap()
            sleep(1)
            XCTAssertLessThan(seconds(), 47, "skipped back")
            let firstSentence = app.buttons.matching(NSPredicate(format: "label BEGINSWITH 'Play from '")).firstMatch
            XCTAssertTrue(firstSentence.waitForExistence(timeout: 5), "seeded transcript seek control")
            firstSentence.tap()
            sleep(2)
            XCTAssertLessThan(seconds(), 10, "jumped to the first sentence")
            app.buttons["Speed"].tap()
            app.buttons["2×"].firstMatch.tap()
            let before = seconds()
            sleep(3)
            XCTAssertGreaterThanOrEqual(seconds() - before, 5, "twice as fast")
            app.buttons["Pause"].firstMatch.tap()
            XCTAssertTrue(app.buttons["Play"].firstMatch.waitForExistence(timeout: 5), "paused")
            let paused = seconds()
            sleep(2)
            XCTAssertEqual(seconds(), paused, "stays paused")
            shot("recording-paused-\(id)")
        }
    }

    /// A bot's Mission and Memory open from the bot. Read-only on a real bot: edit is
    /// started and cancelled, and the file's version is checked to be unchanged.
    func testBotDocuments() throws {
        let bots = (rpc("studio", "teams_list", NSNull())?["bots"] as? [[String: Any]]) ?? []
        let bot = try XCTUnwrap(bots.first { $0["retired"] as? Bool != true })
        let id = try XCTUnwrap(bot["id"] as? String)
        let before = try XCTUnwrap(rpc("studio", "teams_document", ["id": id, "file": "MISSION.md"])?["version"] as? String)
        app.open(URL(string: "bbstudio://bot/\(id)")!)
        let mission = app.buttons["Mission"]
        XCTAssertTrue(mission.waitForExistence(timeout: 10), "bot files")
        XCTAssertTrue(app.buttons["Memory"].exists)
        shot("bot-files")
        mission.tap()
        XCTAssertTrue(app.navigationBars["Mission"].buttons["Edit"].waitForExistence(timeout: 10), "mission loaded")
        shot("bot-mission")
        app.navigationBars["Mission"].buttons["Edit"].tap()
        let editor = app.textViews["botDocumentEditor"]
        XCTAssertTrue(editor.waitForExistence(timeout: 5), "editor")
        XCTAssertFalse(app.navigationBars["Mission"].buttons["Save"].isEnabled, "nothing to save yet")
        editor.typeText("QA")
        XCTAssertTrue(app.navigationBars["Mission"].buttons["Save"].isEnabled, "edited")
        shot("bot-mission-edit")
        app.navigationBars["Mission"].buttons["Cancel"].tap()
        XCTAssertTrue(app.navigationBars["Mission"].buttons["Edit"].waitForExistence(timeout: 5), "back to reading")
        let after = rpc("studio", "teams_document", ["id": id, "file": "MISSION.md"])?["version"] as? String
        XCTAssertEqual(before, after, "mission untouched")
        app.navigationBars["Mission"].buttons.element(boundBy: 0).tap()
        app.buttons["Memory"].tap()
        XCTAssertTrue(app.navigationBars["Memory"].buttons["Edit"].waitForExistence(timeout: 10), "memory loaded")
        shot("bot-memory")
    }

    /// Office channels are Team conversations over ordinary threads. Edit and archive
    /// a scratch conversation without sending a message or dispatching a bot.
    func testChannelManagement() throws {
        continueAfterFailure = false
        let name = "QA channel \(UUID().uuidString.prefix(8))"
        let bots = try XCTUnwrap(rpc("studio", "teams_list", NSNull())?["bots"] as? [[String: Any]])
        let atlas = try XCTUnwrap(bots.first { $0["name"] as? String == "Atlas" })
        let scribe = try XCTUnwrap(bots.first { $0["name"] as? String == "Scribe" })
        let atlasId = try XCTUnwrap(atlas["id"] as? String)
        let scribeId = try XCTUnwrap(scribe["id"] as? String)
        let quinnId = try XCTUnwrap(bots.first { $0["name"] as? String == "Quinn" }?["id"] as? String)
        let created = try XCTUnwrap(rpc("studio", "teams_viewCreate", ["name": name,
            "members": [["kind": "bot", "id": atlasId], ["kind": "bot", "id": quinnId]], "requestId": UUID().uuidString]))
        let id = try XCTUnwrap(created["id"] as? String)
        addTeardownBlock { _ = self.rpc("studio", "teams_viewDelete", ["id": id]) }
        func channel() -> [String: Any]? { rpc("studio", "teams_view", ["id": id])?["view"] as? [String: Any] }
        app.buttons["Team"].tap()
        let row = app.staticTexts[name].firstMatch
        for _ in 0..<5 where !row.isHittable { app.swipeUp() }
        XCTAssertTrue(row.waitForExistence(timeout: 10), "conversation on Team")
        row.tap()
        XCTAssertTrue(app.buttons["Edit channel"].waitForExistence(timeout: 10))
        XCTAssertTrue(app.textFields["Message or @mention members…"].exists)
        app.buttons["Edit channel"].tap()
        let field = app.textFields["Channel name"]
        XCTAssertTrue(field.waitForExistence(timeout: 5))
        clear(field); field.typeText(name + " edited")
        app.buttons["Scribe"].tap()
        app.navigationBars["Edit Channel"].buttons["Save"].tap()
        XCTAssertTrue(wait(10) { channel()?["name"] as? String == name + " edited" })
        let members = try XCTUnwrap(channel()?["members"] as? [[String: Any]])
        XCTAssertEqual(Set(members.compactMap { $0["id"] as? String }), Set([atlasId, scribeId, quinnId]))
        shot("team-channel-edited")
        app.buttons["Edit channel"].tap()
        let archive = app.buttons["Archive channel"]
        for _ in 0..<8 where !archive.isHittable { app.swipeUp() }
        XCTAssertTrue(archive.waitForExistence(timeout: 5)); archive.tap()
        XCTAssertTrue(wait(10) { channel()?["archived"] as? Bool == true })
        app.buttons["Edit channel"].tap()
        let restore = app.buttons["Restore channel"]
        for _ in 0..<8 where !restore.isHittable { app.swipeUp() }
        XCTAssertTrue(restore.waitForExistence(timeout: 5)); restore.tap()
        XCTAssertTrue(wait(10) { channel()?["archived"] as? Bool == false })
        shot("team-channel-restored")
    }

    /// The Save to Studio sheet on a scratch thread that never runs, so there's nothing to save.
    func testSaveToStudio() throws {
        let thread = try XCTUnwrap(scratchThread("QA save to studio \(Int(Date().timeIntervalSince1970))"))
        addTeardownBlock { _ = self.api("DELETE", "/threads/\(thread)", ["childThreadsConfirmed": false]) }
        app.open(URL(string: "bbstudio://thread/\(thread)")!)
        let more = app.buttons["More"].firstMatch
        XCTAssertTrue(more.waitForExistence(timeout: 10))
        more.tap()
        let item = app.buttons["Save Files to Studio…"]
        XCTAssertTrue(item.waitForExistence(timeout: 5), "menu item")
        item.tap()
        XCTAssertTrue(app.navigationBars["Save to Studio"].waitForExistence(timeout: 5), "sheet")
        XCTAssertTrue(app.staticTexts.containing(NSPredicate(format: "label CONTAINS 'didn\\'t create'")).firstMatch.waitForExistence(timeout: 10), "empty state")
        shot("save-to-studio")
        app.buttons["Done"].tap()
    }

    /// Studio's New menu makes a page (deleted after), and a scratch page's
    /// Studio embeds show their items and open them.
    func testStudioHub() throws {
        let start = Date().timeIntervalSince1970 * 1000
        addTeardownBlock {
            // Pages this test made: untitled ones created since it started.
            let overview = self.rpc("studio", "overview", NSNull())
            for item in (overview?["items"] as? [[String: Any]]) ?? [] {
                guard item["pluginId"] as? String == "pages", (item["createdAt"] as? Double ?? 0) >= start,
                    (item["title"] as? String ?? "").isEmpty || item["title"] as? String == "Untitled" || item["title"] as? String == "QA embeds"
                else { continue }
                _ = self.rpc("pages", "remove", ["id": item["id"] as? String ?? ""])
            }
        }
        openStudioCollection()
        let new = app.buttons["New"].firstMatch
        XCTAssertTrue(new.waitForExistence(timeout: 10), "New menu")
        new.tap()
        let newPage = app.buttons["New Page"]
        XCTAssertTrue(newPage.waitForExistence(timeout: 5), "New Page")
        shot("studio-new-menu")
        newPage.tap()
        XCTAssertTrue(app.descendants(matching: .any)["pageWorkField"].waitForExistence(timeout: 10), "new page opens")
        shot("studio-new-page")

        let recording = try XCTUnwrap(
            ((rpc("studio", "overview", NSNull())?["items"] as? [[String: Any]]) ?? [])
                .first { $0["kind"] as? String == "recording" }?["id"] as? String)
        let markdown = """
            # QA embeds

            ```embed
            {"kind":"recording","target":"\(recording)"}
            ```

            ```embed
            {"kind":"task","target":"task_missing","title":"A task"}
            ```
            """
        let page = rpc("pages", "create", ["projectId": NSNull(), "parentId": NSNull(), "title": "QA embeds", "markdown": markdown])
        let pageId = try XCTUnwrap((page?["page"] as? [String: Any])?["id"] as? String)
        app.open(URL(string: "bbstudio://page/\(pageId)")!)
        let embed = app.buttons["studioEmbed"].firstMatch
        XCTAssertTrue(embed.waitForExistence(timeout: 10), "embed card")
        sleep(2)
        shot("page-studio-embeds")
        embed.tap()
        XCTAssertTrue(app.staticTexts.containing(NSPredicate(format: "label CONTAINS 'Transcript' OR label CONTAINS 'transcript'")).firstMatch.waitForExistence(timeout: 10)
            || app.navigationBars.count > 0, "recording opens")
        sleep(1)
        shot("page-embed-opened")
    }

    /// Studio's Write and Task tiles and the Home Screen links behind them. The page and
    /// tasks it makes are scratch items, found by title and deleted afterwards.
    func testQuickCapture() throws {
        let stamp = Int(Date().timeIntervalSince1970)
        let titles = ["QA quick page \(stamp)", "QA quick task \(stamp)", "QA quick task two \(stamp)"]
        addTeardownBlock {
            let items = (self.rpc("studio", "overview", NSNull())?["items"] as? [[String: Any]]) ?? []
            for item in items where titles.contains(item["title"] as? String ?? "") {
                let id = item["id"] as? String ?? ""
                switch item["pluginId"] as? String {
                case "pages": _ = self.rpc("pages", "remove", ["id": id])
                case "studio-tasks", "studio": _ = self.rpc("studio", "tasks_delete", ["id": id])
                default: break
                }
            }
        }
        openStudioCollection()
        let write = app.buttons["Write"].firstMatch
        XCTAssertTrue(write.waitForExistence(timeout: 10), "Write tile")
        XCTAssertTrue(app.buttons["Dictate"].exists && app.buttons["Task"].exists, "Dictate and Task tiles")
        shot("capture-tiles")

        write.tap()
        let text = app.textViews["quickWriteText"]
        XCTAssertTrue(text.waitForExistence(timeout: 5))
        text.typeText("\(titles[0])\n\nA line under the title.")
        shot("capture-write")
        app.buttons["quickWriteSave"].tap()
        XCTAssertTrue(app.staticTexts[titles[0]].firstMatch.waitForExistence(timeout: 15), "page opened")
        shot("capture-write-saved")

        app.open(URL(string: "bbstudio://new-task")!)
        let field = app.textFields["quickTaskTitle"].exists ? app.textFields["quickTaskTitle"] : app.textViews["quickTaskTitle"]
        XCTAssertTrue(field.waitForExistence(timeout: 5), "quick task sheet")
        field.typeText(titles[1] + "\n")
        XCTAssertTrue(app.buttons[titles[1]].waitForExistence(timeout: 10), "first task added")
        field.typeText(titles[2])
        app.buttons["quickTaskAdd"].tap()
        XCTAssertTrue(app.buttons[titles[2]].waitForExistence(timeout: 10), "second task added")
        shot("capture-tasks")
        let items = (rpc("studio", "overview", NSNull())?["items"] as? [[String: Any]]) ?? []
        XCTAssertEqual(items.filter { titles.contains($0["title"] as? String ?? "") }.count, 3, "page and two tasks saved")
    }

    private func rpc(_ plugin: String, _ method: String, _ input: Any) -> [String: Any]? {
        var request = URLRequest(url: URL(string: "\(StagedFixture.serverURL)/api/v1/plugins/\(plugin)/rpc/\(method)")!)
        request.httpMethod = "POST"
        request.setValue("application/json", forHTTPHeaderField: "Content-Type")
        request.httpBody = try? JSONSerialization.data(withJSONObject: input, options: .fragmentsAllowed)
        var result: [String: Any]?
        let done = expectation(description: method)
        URLSession.shared.dataTask(with: request) { data, _, _ in
            let json = data.flatMap { try? JSONSerialization.jsonObject(with: $0) as? [String: Any] }
            result = json?["result"] as? [String: Any]
            done.fulfill()
        }.resume()
        wait(for: [done], timeout: 20)
        return result
    }

    /// Picks a thread's permissions on a scratch thread; the sheet then shows the choice.
    func testPermissions() throws {
        let thread = try XCTUnwrap(scratchThread("QA permissions \(Int(Date().timeIntervalSince1970))"))
        addTeardownBlock { _ = self.api("DELETE", "/threads/\(thread)", ["childThreadsConfirmed": false]) }
        app.open(URL(string: "bbstudio://thread/\(thread)")!)
        let more = app.buttons["More"].firstMatch
        XCTAssertTrue(more.waitForExistence(timeout: 10))
        more.tap()
        app.buttons["Model & permissions"].tap()
        let picker = app.buttons["permissionPicker"].firstMatch
        XCTAssertTrue(picker.waitForExistence(timeout: 10), "permissions picker")
        shot("permissions-sheet")
        picker.tap()
        app.buttons["Accept edits"].firstMatch.tap()
        app.buttons["Save"].tap()
        XCTAssertTrue(more.waitForExistence(timeout: 5))
        let pending = app.descendants(matching: .any)["pendingPermission"].firstMatch
        XCTAssertTrue(pending.waitForExistence(timeout: 5), "pending permissions over the composer")
        shot("permissions-pending")
        sleep(1)
        more.tap()
        XCTAssertTrue(app.buttons["Copy Thread ID"].exists, "Copy Thread ID")
        app.buttons["Model & permissions"].tap()
        XCTAssertTrue(picker.waitForExistence(timeout: 10))
        XCTAssertTrue(picker.label.contains("Accept edits") || (picker.value as? String)?.contains("Accept edits") == true, "kept the choice: \(picker.label)")
        shot("permissions-kept")
        app.buttons["Cancel"].tap()
        app.buttons["Undo"].tap()
        XCTAssertTrue(wait(5) { !pending.exists }, "undo clears it")
    }

    /// A seeded assistant message's menu ends with when it was sent.
    func testMessageSentTime() throws {
        let fixture = try XCTUnwrap(ProcessInfo.processInfo.environment["BBGO_QA_MESSAGE_THREAD"], "Seed the assistant fixture with BB_QA_DATA_DIR")
        let text = try XCTUnwrap(ProcessInfo.processInfo.environment["BBGO_QA_MESSAGE_TEXT"])
        app.open(URL(string: "bbstudio://thread/\(fixture)")!)
        let message = app.staticTexts[text].firstMatch
        XCTAssertTrue(message.waitForExistence(timeout: 15), "seeded assistant message")
        message.press(forDuration: 1)
        let sent = app.staticTexts.containing(NSPredicate(format: "label BEGINSWITH 'Sent '")).firstMatch
        let button = app.buttons.containing(NSPredicate(format: "label BEGINSWITH 'Sent '")).firstMatch
        XCTAssertTrue(sent.waitForExistence(timeout: 5) || button.exists, "sent time in the menu")
        shot("message-sent-time")
    }

    /// Opens terminals from a scratch thread's menu, named by
    /// `TEST_RUNNER_BBGO_QA_QUEUE_THREAD`, never a real one.
    func testTerminal() throws {
        guard let id = ProcessInfo.processInfo.environment["BBGO_QA_QUEUE_THREAD"] else { throw XCTSkip("no scratch thread") }
        app.open(URL(string: "bbstudio://thread/\(id)")!)
        let more = app.buttons["More"].firstMatch
        XCTAssertTrue(more.waitForExistence(timeout: 15), "thread")
        more.tap()
        app.buttons["Terminals"].tap()
        let create = app.buttons["newTerminal"]
        XCTAssertTrue(create.waitForExistence(timeout: 10), "terminal list")
        create.tap()
        let canvas = app.descendants(matching: .any)["terminalCanvas"]
        XCTAssertTrue(canvas.waitForExistence(timeout: 10), "terminal screen")
        let connecting = app.staticTexts["Connecting…"]
        let deadline = Date().addingTimeInterval(15)
        while connecting.exists && Date() < deadline { sleep(1) }
        XCTAssertFalse(connecting.exists, "attached")
        sleep(2)
        canvas.tap()
        app.typeText("echo bbgo-qa-$((6*7))\n")
        sleep(3)
        shot("terminal-shell")
        app.buttons["Terminal actions"].tap()
        XCTAssertTrue(app.buttons["Close Terminal"].waitForExistence(timeout: 5), "menu")
        shot("terminal-menu")
        app.buttons["Close Terminal"].tap()
        let confirm = app.buttons["Close Terminal"].firstMatch
        XCTAssertTrue(confirm.waitForExistence(timeout: 5))
        confirm.tap()
        XCTAssertTrue(create.waitForExistence(timeout: 10), "back on the list")
        sleep(1)
        shot("terminal-list")
    }

    /// A reply's `::inline-vis` directives on a scratch thread named by
    /// `TEST_RUNNER_BBGO_QA_VIS_THREAD`: an HTML chart whose script runs, a
    /// Markdown file, a missing file and a bad height.
    func testInlineVis() throws {
        guard let id = ProcessInfo.processInfo.environment["BBGO_QA_VIS_THREAD"] else { throw XCTSkip("no scratch thread") }
        app.open(URL(string: "bbstudio://thread/\(id)")!)
        XCTAssertTrue(app.staticTexts["QA inline-vis reply"].waitForExistence(timeout: 15), "reply")
        XCTAssertTrue(app.webViews.staticTexts["QA chart (script ran)"].waitForExistence(timeout: 15), "HTML ran its script")
        shot("inline-vis-html")
        app.swipeUp()
        XCTAssertTrue(app.staticTexts["QA notes"].waitForExistence(timeout: 10), "Markdown file")
        XCTAssertTrue(app.staticTexts.matching(NSPredicate(format: "label CONTAINS 'Preview file not found'")).firstMatch
            .waitForExistence(timeout: 10), "missing file")
        XCTAssertTrue(app.staticTexts.matching(NSPredicate(format: "label CONTAINS 'height must be'")).firstMatch.exists, "bad height")
        shot("inline-vis-markdown")
        app.buttons["Open qa/notes.md full screen"].tap()
        XCTAssertTrue(app.navigationBars["notes.md"].waitForExistence(timeout: 5), "full screen")
        shot("inline-vis-full")
        app.buttons["Done"].tap()
        app.buttons["Hide qa/chart.html"].firstMatch.tap()
        XCTAssertTrue(app.buttons["Show qa/chart.html"].firstMatch.waitForExistence(timeout: 5), "collapsed")
        shot("inline-vis-collapsed")
        app.buttons["Show qa/chart.html"].firstMatch.tap()
    }

    /// `BBGO_QA_IMAGE_THREAD`: a reply with `![QA silk icon](/abs.png)`, an image
    /// inside a paragraph, and a missing one.
    func testMarkdownImage() throws {
        guard let id = ProcessInfo.processInfo.environment["BBGO_QA_IMAGE_THREAD"] else { throw XCTSkip("no scratch thread") }
        app.open(URL(string: "bbstudio://thread/\(id)")!)
        XCTAssertTrue(app.staticTexts["QA image reply"].waitForExistence(timeout: 15), "reply")
        let loaded = app.descendants(matching: .any).matching(identifier: "markdownImage")
        XCTAssertTrue(loaded["QA silk icon"].waitForExistence(timeout: 15), "absolute path loads")
        XCTAssertTrue(app.staticTexts["Text before text after."].firstMatch.exists, "paragraph keeps its text")
        app.swipeUp()
        let sheet = loaded["QA inline sheet"]
        XCTAssertTrue(sheet.waitForExistence(timeout: 15), "file:// image loads")
        XCTAssertFalse(loaded["QA missing image"].exists, "missing file doesn't load")
        XCTAssertTrue(app.descendants(matching: .any).matching(identifier: "markdownImageAlt")["QA missing image"].firstMatch
            .waitForExistence(timeout: 15), "missing shows its alt text")
        shot("markdown-image")
        sheet.tap()
        XCTAssertTrue(app.buttons["Done"].waitForExistence(timeout: 5), "full screen")
        shot("markdown-image-full")
        app.buttons["Done"].tap()
    }

    /// Studio Tasks on a scratch task (deleted after): the board, the task,
    /// moving it with the Status menu, and a swipe to the next column.
    func testTasks() throws {
        let title = "QA task \(Int(Date().timeIntervalSince1970))"
        let created = rpc("studio", "tasks_create", [
            "title": title, "description": "Scratch task for a **UI test**.", "due": "2026-10-02", "assignee": "me",
        ])
        let id = try XCTUnwrap((created?["task"] as? [String: Any])?["id"] as? String)
        addTeardownBlock { _ = self.rpc("studio", "tasks_delete", ["id": id]) }
        app.open(URL(string: "bbstudio://tasks")!)
        app.segmentedControls.buttons.element(boundBy: 0).tap()
        let row = app.buttons.containing(NSPredicate(format: "label CONTAINS %@", title)).firstMatch
        XCTAssertTrue(row.waitForExistence(timeout: 10), "task on the board")
        shot("tasks-board")
        row.tap()
        XCTAssertTrue(app.staticTexts["UI test"].waitForExistence(timeout: 10) || app.staticTexts.containing(NSPredicate(format: "label CONTAINS 'Scratch task'")).firstMatch.exists, "description")
        shot("task-detail")
        app.buttons["taskStatus"].tap()
        app.buttons["Review"].tap()
        XCTAssertTrue(wait(10) { (self.rpc("studio", "tasks_get", ["id": id])?["task"] as? [String: Any])?["status"] as? String == "review" }, "moved to Review")
        shot("task-review")
        app.navigationBars.buttons.element(boundBy: 0).tap()
        app.segmentedControls.buttons.element(boundBy: 2).tap()
        let moved = app.buttons.containing(NSPredicate(format: "label CONTAINS %@", title)).firstMatch
        XCTAssertTrue(moved.waitForExistence(timeout: 10), "in the Review column")
        moved.swipeRight()
        app.buttons["Done"].firstMatch.tap()
        XCTAssertTrue(wait(10) { (self.rpc("studio", "tasks_get", ["id": id])?["task"] as? [String: Any])?["status"] as? String == "done" }, "swiped to Done")
        shot("tasks-done")
    }

    /// Tags a scratch task from Studio's long-press menu, then deletes the tag and the task.
    func testStudioTags() throws {
        let stamp = Int(Date().timeIntervalSince1970)
        let title = "QA tag task \(stamp)", tagName = "QA tag \(stamp)"
        let created = rpc("studio", "tasks_create", ["title": title, "description": ""])
        let id = try XCTUnwrap((created?["task"] as? [String: Any])?["id"] as? String)
        func overview() -> [String: Any]? { self.rpc("studio", "overview", NSNull()) }
        addTeardownBlock {
            for tag in (overview()?["tags"] as? [[String: Any]]) ?? [] where tag["name"] as? String == tagName {
                _ = self.rpc("studio", "deleteTag", ["id": tag["id"] as? String ?? ""])
            }
            _ = self.rpc("studio", "tasks_delete", ["id": id])
        }
        openStudioCollection()
        let row = app.buttons.containing(NSPredicate(format: "label CONTAINS %@", title)).firstMatch
        XCTAssertTrue(row.waitForExistence(timeout: 15), "task in Studio")
        row.press(forDuration: 1)
        app.buttons["Tags"].tap()
        app.buttons["New Tag…"].tap()
        app.alerts.textFields.firstMatch.typeText(tagName)
        app.alerts.buttons["Add"].tap()
        func tagged() -> Bool {
            let tagId = ((overview()?["tags"] as? [[String: Any]]) ?? []).first { $0["name"] as? String == tagName }?["id"] as? String
            let item = ((overview()?["items"] as? [[String: Any]]) ?? []).first { $0["pluginId"] as? String == "studio" && $0["id"] as? String == id }
            return tagId != nil && (item?["tags"] as? [String])?.contains(tagId!) == true
        }
        XCTAssertTrue(wait(10, tagged), "task tagged")
        XCTAssertTrue(app.staticTexts[tagName].firstMatch.waitForExistence(timeout: 10) || app.buttons[tagName].firstMatch.exists, "tag chip")
        shot("studio-tags")
        row.press(forDuration: 1)
        app.buttons["Tags"].tap()
        shot("studio-tags-menu")
        // The lifted row's chip has the same name; the menu's item comes first.
        app.buttons.matching(identifier: tagName).firstMatch.tap()
        XCTAssertTrue(wait(10) { !tagged() }, "tag removed")
    }

    /// Starts a real Studio Chat thread from a scratch task, then deletes both.
    func testStudioChat() throws {
        let title = "QA chat task \(Int(Date().timeIntervalSince1970))"
        let created = rpc("studio", "tasks_create", ["title": title, "description": "Scratch task.", "projectId": StagedFixture.projectId])
        let id = try XCTUnwrap((created?["task"] as? [String: Any])?["id"] as? String)
        var threadId: String?
        addTeardownBlock {
            if let threadId { _ = self.api("DELETE", "/threads/\(threadId)", ["childThreadsConfirmed": false]) }
            _ = self.rpc("studio", "tasks_delete", ["id": id])
        }
        app.open(URL(string: "bbstudio://task/\(id)")!)
        let more = app.buttons["More"].firstMatch
        XCTAssertTrue(more.waitForExistence(timeout: 10), "task menu")
        more.tap()
        app.buttons["Chat About This"].tap()
        let field = app.textViews["studioChatField"].exists ? app.textViews["studioChatField"] : app.textFields["studioChatField"]
        XCTAssertTrue(field.waitForExistence(timeout: 5), "chat sheet")
        field.typeText("This is an automated UI test. Reply with just OK and do nothing else.")
        shot("studio-chat-sheet")
        app.buttons["Start"].tap()
        XCTAssertTrue(wait(20) {
            threadId = ((self.rpc("studio", "chat_home", ["pluginId": "studio", "id": id])?["thread"] as? [String: Any])?["threadId"] as? String)
            return threadId != nil
        }, "thread linked to the task")
        XCTAssertTrue(app.staticTexts.containing(NSPredicate(format: "label CONTAINS 'automated UI test'")).firstMatch.waitForExistence(timeout: 15), "opened the thread")
        shot("studio-chat-thread")
        // Let the agent finish so the thread deletes cleanly.
        _ = wait(90) { (self.api("GET", "/threads/\(threadId!)", [:])?["status"] as? String).map { !["running", "starting", "queued"].contains($0) } ?? false }
    }

    /// Channels are opened from Team. Scheduling is now the host Automations
    /// surface: preserve editor, schedule, pause/resume, and rename coverage there.
    /// The scratch run is scheduled an hour ahead and deleted in teardown.
    func testChannelAutomations() throws {
        continueAfterFailure = false
        app.buttons["Team"].tap()
        let channel = app.staticTexts["ORBIT-42 release room"].firstMatch
        XCTAssertTrue(channel.waitForExistence(timeout: 10)); channel.tap()
        XCTAssertTrue(app.buttons["Edit channel"].waitForExistence(timeout: 10))
        app.open(URL(string: "bbstudio://automations")!)
        XCTAssertTrue(app.navigationBars["Automations"].waitForExistence(timeout: 10))
        let name = "QA automation \(UUID().uuidString.prefix(8))"
        func automation() -> [String: Any]? {
            let entries = rpc("automations", "automations_overview", NSNull())?["automations"] as? [[String: Any]] ?? []
            return entries.compactMap { $0["automation"] as? [String: Any] }.first {
                ($0["name"] as? String)?.hasPrefix(name) == true
            }
        }
        addTeardownBlock {
            if let item = automation(), let id = item["id"], let project = item["projectId"] {
                _ = self.rpc("automations", "automations_delete", ["projectId": project, "automationId": id])
            }
        }
        app.buttons["workflowNewAutomation"].tap()
        let nameField = app.textFields["workflowAutomationName"]
        XCTAssertTrue(nameField.waitForExistence(timeout: 10))
        nameField.tap(); nameField.typeText(name)
        let prompt = app.textFields["workflowAutomationPrompt"].exists ? app.textFields["workflowAutomationPrompt"] : app.textViews["workflowAutomationPrompt"]
        prompt.tap(); prompt.typeText("UI test scratch. Never runs.")
        let repeatPicker = app.buttons.matching(NSPredicate(format: "label BEGINSWITH 'Repeat'")).firstMatch
        for _ in 0..<4 where !repeatPicker.isHittable { app.swipeUp() }
        repeatPicker.tap(); app.buttons["Once"].firstMatch.tap()
        app.buttons["workflowAutomationSave"].tap()
        let row = app.staticTexts[name].firstMatch
        XCTAssertTrue(row.waitForExistence(timeout: 15), "created automation")
        let created = try XCTUnwrap(automation())
        XCTAssertEqual((created["trigger"] as? [String: Any])?["triggerType"] as? String, "once")
        row.tap()
        let enabled = app.switches["Enabled"].firstMatch
        XCTAssertTrue(enabled.waitForExistence(timeout: 10))
        func toggleEnabled() {
            let control = enabled.switches.firstMatch
            (control.exists ? control : enabled).tap()
        }
        toggleEnabled()
        XCTAssertTrue(wait(10) { automation()?["enabled"] as? Bool == false }, "paused")
        XCTAssertTrue(app.buttons["Run now"].exists)
        XCTAssertTrue(app.staticTexts["No runs yet"].waitForExistence(timeout: 10))
        shot("office-automation-paused")
        toggleEnabled()
        XCTAssertTrue(wait(10) { automation()?["enabled"] as? Bool == true }, "resumed future run")
        toggleEnabled()
        XCTAssertTrue(wait(10) { automation()?["enabled"] as? Bool == false })
        app.buttons["Edit"].tap()
        XCTAssertTrue(nameField.waitForExistence(timeout: 5))
        clear(nameField); nameField.typeText(name + " edited")
        app.buttons["workflowAutomationSave"].tap()
        XCTAssertTrue(wait(10) { automation()?["name"] as? String == name + " edited" })
        shot("office-automation-edited")
        // The current native detail has no delete control; verify removal through
        // the same host API used by teardown, without leaving scheduled work.
        let saved = try XCTUnwrap(automation())
        let removed = rpc("automations", "automations_delete", [
            "projectId": try XCTUnwrap(saved["projectId"]),
            "automationId": try XCTUnwrap(saved["id"]),
        ])
        XCTAssertEqual(removed?["ok"] as? Bool, true)
        XCTAssertNil(automation())
    }

    func testBotInStudio() throws {
        continueAfterFailure = false
        let bots = try XCTUnwrap(rpc("studio", "teams_list", NSNull())?["bots"] as? [[String: Any]])
        let bot = try XCTUnwrap(bots.first { $0["name"] as? String == "Atlas" })
        let id = try XCTUnwrap(bot["id"] as? String)
        app.buttons["Team"].tap()
        XCTAssertTrue(app.buttons["Atlas"].waitForExistence(timeout: 10)); app.buttons["Atlas"].tap()
        XCTAssertTrue(app.buttons["Chat"].waitForExistence(timeout: 10))
        XCTAssertTrue(app.staticTexts["Atlas"].exists)
        app.buttons["Tasks"].tap()
        XCTAssertTrue(app.staticTexts["Review the ORBIT-42 release checklist"].waitForExistence(timeout: 10))
        app.buttons["Profile"].tap()
        XCTAssertTrue(app.staticTexts["Trust, Asks first"].waitForExistence(timeout: 10))
        XCTAssertTrue(app.buttons["Edit Profile"].exists)
        shot("team-bot-desk-profile")
        // Preserve legacy deep-link coverage with an actual fixture bot.
        app.open(URL(string: "bbgo://bot/\(id)")!)
        XCTAssertTrue(app.buttons["Mission"].waitForExistence(timeout: 10))
        XCTAssertTrue(app.buttons["Memory"].exists)
        openStudioCollection()
        XCTAssertTrue(app.buttons["New"].waitForExistence(timeout: 10))
        XCTAssertFalse(app.buttons["Bots"].exists, "bots belong to Team")
        let items = rpc("studio", "overview", NSNull())?["items"] as? [[String: Any]] ?? []
        XCTAssertFalse(items.contains { ["bot", "view"].contains($0["kind"] as? String ?? "") })
        shot("work-without-bots")
    }

    /// Finds two scratch tasks by their description, renames and deletes a scratch
    /// tag, archives one task and deletes both from select mode.
    func testStudioBulk() throws {
        let stamp = Int(Date().timeIntervalSince1970)
        let word = "zebracorn\(stamp)", titleA = "QA bulk A \(stamp)", titleB = "QA bulk B \(stamp)"
        let tagName = "QA bulk tag \(stamp)", renamed = "QA renamed \(stamp)"
        var ids: [String] = []
        for title in [titleA, titleB] {
            let created = rpc("studio", "tasks_create", ["title": title, "description": "Has \(word) inside.", "projectId": StagedFixture.projectId])
            ids.append(try XCTUnwrap((created?["task"] as? [String: Any])?["id"] as? String))
        }
        func overview() -> [String: Any]? { self.rpc("studio", "overview", NSNull()) }
        func tagId(_ name: String) -> String? {
            ((overview()?["tags"] as? [[String: Any]]) ?? []).first { $0["name"] as? String == name }?["id"] as? String
        }
        func task(_ id: String) -> [String: Any]? { self.rpc("studio", "tasks_get", ["id": id])?["task"] as? [String: Any] }
        addTeardownBlock {
            for name in [tagName, renamed] { if let id = tagId(name) { _ = self.rpc("studio", "deleteTag", ["id": id]) } }
            for id in ids { _ = self.rpc("studio", "tasks_delete", ["id": id]) }
        }
        let tag = try XCTUnwrap((rpc("studio", "createTag", ["name": tagName])?["tag"] as? [String: Any])?["id"] as? String)
        _ = rpc("studio", "tagItems", ["items": [["pluginId": "studio", "id": ids[0]]], "add": [tag], "remove": [String]()])

        openStudioCollection()
        let search = app.searchFields.firstMatch
        if !search.waitForExistence(timeout: 5) { app.swipeDown() }
        XCTAssertTrue(search.waitForExistence(timeout: 10), "search field")
        search.tap()
        search.typeText(word)
        XCTAssertTrue(app.staticTexts.matching(identifier: "studioSnippet").firstMatch.waitForExistence(timeout: 10), "content snippet")
        shot("studio-snippet")

        // The tag chip: rename, then delete.
        let chips = app.scrollViews.containing(.button, identifier: "All").firstMatch
        let chip = chips.buttons["studioTagChip-\(tag)"]
        for _ in 0..<6 where !chip.isHittable { chips.swipeLeft() }
        XCTAssertTrue(chip.waitForExistence(timeout: 10), "tag chip")
        chip.press(forDuration: 1.5)
        shot("studio-tag-menu")
        app.buttons["Rename Tag…"].tap()
        let field = app.alerts.textFields.firstMatch
        clear(field)
        field.typeText(renamed)
        // The alert slides up with the keyboard; tap once it's settled.
        sleep(1)
        app.alerts.buttons["Rename"].tap()
        XCTAssertTrue(wait(10) { tagId(renamed) != nil && tagId(tagName) == nil }, "tag renamed")
        let renamedChip = chips.buttons["studioTagChip-\(tag)"]
        XCTAssertTrue(renamedChip.waitForExistence(timeout: 10), "renamed chip")
        for _ in 0..<6 where !renamedChip.isHittable { chips.swipeLeft() }
        renamedChip.press(forDuration: 1)
        app.buttons["Delete Tag…"].tap()
        app.buttons["Delete Tag"].firstMatch.tap()
        XCTAssertTrue(wait(10) { tagId(renamed) == nil }, "tag deleted")

        // Archive one from select mode.
        app.buttons["Select"].tap()
        let rowA = app.cells.containing(NSPredicate(format: "label CONTAINS %@", titleA)).firstMatch
        XCTAssertTrue(rowA.waitForExistence(timeout: 10), "row A")
        rowA.tap()
        XCTAssertTrue(app.otherElements["studioSelectionBar"].waitForExistence(timeout: 5) || app.buttons["Archive"].exists, "selection bar")
        shot("studio-select")
        app.buttons["Archive"].tap()
        XCTAssertTrue(wait(10) { task(ids[0])?["archived"] as? Bool == true }, "archived")

        // Delete what's left. Rows are picked one by one: Select All would take real items if the search were lost.
        app.buttons["Select"].tap()
        let rowB = app.cells.containing(NSPredicate(format: "label CONTAINS %@", titleB)).firstMatch
        XCTAssertTrue(rowB.waitForExistence(timeout: 10), "row B")
        rowB.tap()
        app.buttons["Delete"].firstMatch.tap()
        app.sheets.buttons["Delete"].firstMatch.tap()
        XCTAssertTrue(wait(10) { task(ids[1]) == nil }, "deleted from select mode")
        shot("studio-bulk-done")
    }

    /// Links a scratch task to the first linkable item, then opens the handoff
    /// sheet's agent pickers without starting anything; deletes the task.
    func testTaskLinksAndHandOff() throws {
        let title = "QA link task \(Int(Date().timeIntervalSince1970))"
        let created = rpc("studio", "tasks_create", ["title": title, "description": "", "projectId": StagedFixture.projectId])
        let id = try XCTUnwrap((created?["task"] as? [String: Any])?["id"] as? String)
        addTeardownBlock { _ = self.rpc("studio", "tasks_delete", ["id": id]) }
        app.open(URL(string: "bbstudio://task/\(id)")!)
        let add = app.buttons["addTaskLink"]
        XCTAssertTrue(add.waitForExistence(timeout: 10), "Add Link")
        for _ in 0..<4 where !add.isHittable { app.swipeUp() }
        add.tap()
        XCTAssertTrue(app.navigationBars["Add Link"].waitForExistence(timeout: 5), "picker")
        let first = app.cells.firstMatch
        XCTAssertTrue(first.waitForExistence(timeout: 10), "linkables")
        shot("task-link-picker")
        first.tap()
        XCTAssertTrue(wait(10) { ((self.rpc("studio", "tasks_get", ["id": id])?["links"] as? [Any]) ?? []).count == 1 }, "linked")
        shot("task-linked")

        let handOff = app.buttons["Hand to an Agent"]
        for _ in 0..<4 where !handOff.isHittable { app.swipeDown() }
        handOff.tap()
        XCTAssertTrue(app.buttons.matching(NSPredicate(format: "label BEGINSWITH 'Provider'")).firstMatch.waitForExistence(timeout: 10), "provider picker")
        XCTAssertTrue(app.buttons.matching(NSPredicate(format: "label CONTAINS 'Default ('")).firstMatch.waitForExistence(timeout: 10), "project default shown")
        shot("task-handoff-agent")
        app.buttons["Cancel"].tap()
    }

    private func scratchThread(_ title: String) -> String? {
        let json = api("POST", "/threads", [
            "projectId": StagedFixture.projectId, "origin": "app", "title": title,
            "environment": ["type": "project-default"], "sendAt": 1_924_992_000_000,
            "input": [["type": "text", "text": "Scratch thread for a UI test. Do nothing.", "mentions": [String]()]],
        ])
        return json?["id"] as? String ?? (json?["thread"] as? [String: Any])?["id"] as? String
    }

    private func api(_ method: String, _ path: String, _ body: [String: Any]) -> [String: Any]? {
        var request = URLRequest(url: URL(string: "\(StagedFixture.serverURL)/api/v1\(path)")!)
        request.httpMethod = method
        request.setValue("application/json", forHTTPHeaderField: "Content-Type")
        if method != "GET" { request.httpBody = try? JSONSerialization.data(withJSONObject: body) }
        var result: [String: Any]?
        let done = expectation(description: path)
        URLSession.shared.dataTask(with: request) { data, _, _ in
            result = data.flatMap { try? JSONSerialization.jsonObject(with: $0) as? [String: Any] }
            done.fulfill()
        }.resume()
        wait(for: [done], timeout: 15)
        return result
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
