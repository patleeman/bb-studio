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
        XCTAssertTrue(app.navigationBars["Studio"].waitForExistence(timeout: 10))
        sleep(2)
        shot("extras-drawings")
        if let id = ProcessInfo.processInfo.environment["BBGO_QA_DRAWING"] {
            app.open(URL(string: "bbgo://drawing/\(id)")!)
            sleep(3)
            shot("extras-drawing")
        }
    }

    /// Read-only: filters Studio by kind, opens one of each, and searches. Records nothing.
    func testStudio() {
        app.open(URL(string: "bbgo://studio")!)
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

    /// Records a few seconds from the microphone (the Mac's, in the simulator).
    /// Play speech near the mic while it runs; a silent recording is discarded by Talk.
    func testDictationCapture() {
        app.open(URL(string: "bbgo://dictate")!)
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

    /// Rewrites the first queued message. Only runs against a scratch thread
    /// named by `TEST_RUNNER_BBGO_QA_QUEUE_THREAD`, never a real one.
    func testQueueEdit() throws {
        guard let id = ProcessInfo.processInfo.environment["BBGO_QA_QUEUE_THREAD"] else { throw XCTSkip("no scratch thread") }
        app.open(URL(string: "bbgo://thread/\(id)")!)
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
        app.open(URL(string: "bbgo://thread/\(id)")!)
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
        app.open(URL(string: "bbgo://thread/\(id)")!)
        let more = app.buttons["More"].firstMatch
        XCTAssertTrue(more.waitForExistence(timeout: 10))
        more.tap()
        app.buttons["Rename"].tap()
        let field = app.alerts.textFields.firstMatch
        XCTAssertTrue(field.waitForExistence(timeout: 5), "title field")
        field.coordinate(withNormalizedOffset: CGVector(dx: 0.97, dy: 0.5)).tap()
        field.typeText(String(repeating: XCUIKeyboardKey.delete.rawValue, count: ((field.value as? String) ?? "").count + 2))
        field.typeText("BB Go renamed scratch")
        sleep(1)
        shot("rename-thread")
        app.alerts.buttons["Rename"].tap()
        sleep(2)
        shot("renamed-thread")
        XCTAssertTrue(app.navigationBars.staticTexts["BB Go renamed scratch"].waitForExistence(timeout: 10), "new title")
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
        app.open(URL(string: "bbgo://thread/\(id)")!)
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
    /// mentions `README.md`.
    func testFileLink() throws {
        guard let id = ProcessInfo.processInfo.environment["BBGO_QA_FILE_THREAD"] else { throw XCTSkip("no scratch thread") }
        app.open(URL(string: "bbgo://thread/\(id)")!)
        let text = app.staticTexts.matching(NSPredicate(format: "label CONTAINS 'README.md'")).firstMatch
        XCTAssertTrue(text.waitForExistence(timeout: 15), "reply with a path")
        shot("file-link")
        let link = text.links["README.md"].firstMatch.exists ? text.links["README.md"].firstMatch : app.links["README.md"].firstMatch
        XCTAssertTrue(link.waitForExistence(timeout: 5), "path is a link")
        link.tap()
        XCTAssertTrue(app.navigationBars["README.md"].waitForExistence(timeout: 10), "file viewer")
        sleep(2)
        shot("file-viewer")
        app.buttons["Done"].tap()
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

    /// The socket closes in the background: on return the inbox catches up on what
    /// changed meanwhile, then stays live. Creates two scratch threads, held
    /// with a far-off send, and deletes them.
    func testResumeReconnects() throws {
        XCTAssertTrue(app.navigationBars["Home"].waitForExistence(timeout: 10))
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
        app.open(URL(string: "bbgo://artifact/\(id)")!)
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
        app.open(URL(string: "bbgo://thread/\(thread)")!)
        let card = app.buttons["artifactCard"].firstMatch
        XCTAssertTrue(card.waitForExistence(timeout: 15), "artifact card")
        sleep(1)
        shot("artifact-card")
        card.tap()
        XCTAssertTrue(app.staticTexts["QA artifact"].waitForExistence(timeout: 10), "card opens the viewer")
    }

    func testTerminal() throws {
        app.open(URL(string: "bbgo://terminals")!)
        let host = app.buttons.containing(NSPredicate(format: "label CONTAINS 'MegaMac'")).firstMatch
        XCTAssertTrue(host.waitForExistence(timeout: 10), "machine list")
        shot("terminal-machines")
        host.tap()
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

    private func scratchThread(_ title: String) -> String? {
        let json = api("POST", "/threads", [
            "projectId": "proj_8ztiq6dkh5", "origin": "app", "title": title,
            "environment": ["type": "project-default"], "sendAt": 1_924_992_000_000,
            "input": [["type": "text", "text": "Scratch thread for a UI test. Do nothing.", "mentions": [String]()]],
        ])
        return json?["id"] as? String ?? (json?["thread"] as? [String: Any])?["id"] as? String
    }

    private func api(_ method: String, _ path: String, _ body: [String: Any]) -> [String: Any]? {
        var request = URLRequest(url: URL(string: "http://127.0.0.1:38886/api/v1\(path)")!)
        request.httpMethod = method
        request.setValue("application/json", forHTTPHeaderField: "Content-Type")
        request.httpBody = try? JSONSerialization.data(withJSONObject: body)
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
