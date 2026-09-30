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

    /// Every Pages block kind, from a built-in page rather than a real one.
    /// Automations, queue, usage and host settings. Read-only: nothing is run, paused or sent.
    func testTools() {
        app.open(URL(string: "bbstudio://automations")!)
        XCTAssertTrue(app.navigationBars["Automations"].waitForExistence(timeout: 10))
        sleep(2)
        shot("tools-automations")
        app.staticTexts.matching(NSPredicate(format: "label CONTAINS 'Daily'")).firstMatch.tap()
        XCTAssertTrue(app.switches["Enabled"].waitForExistence(timeout: 10), "automation detail")
        sleep(2)
        shot("tools-automation")
        app.open(URL(string: "bbstudio://queue")!)
        XCTAssertTrue(app.navigationBars["Queue"].waitForExistence(timeout: 10))
        sleep(2)
        shot("tools-queue")
        app.open(URL(string: "bbstudio://usage")!)
        XCTAssertTrue(app.navigationBars["Usage"].waitForExistence(timeout: 10))
        sleep(2)
        shot("tools-usage")
        app.open(URL(string: "bbstudio://settings")!)
        XCTAssertTrue(app.switches["Keep Mac awake"].waitForExistence(timeout: 10), "keep awake")
        shot("tools-settings")
        app.open(URL(string: "bbstudio://home")!)
        XCTAssertTrue(app.buttons["Automations"].waitForExistence(timeout: 10))
        shot("tools-home")
    }

    /// Read-only: opens sheets and screens, never sends, forks or compacts.
    func testThreadExtras() {
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
        app.open(URL(string: "bbstudio://studio")!)
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
        app.open(URL(string: "bbstudio://attention")!)
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
        app.open(URL(string: "bbstudio://queue")!)
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

    /// Needs a running thread with a queued message.
    func testQueueRemove() throws {
        app.open(URL(string: "bbstudio://thread/\(threadId)")!)
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
    /// mentions `README.md`.
    func testFileLink() throws {
        guard let id = ProcessInfo.processInfo.environment["BBGO_QA_FILE_THREAD"] else { throw XCTSkip("no scratch thread") }
        app.open(URL(string: "bbstudio://thread/\(id)")!)
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
        app.open(URL(string: "bbstudio://studio")!)
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

    private func rpc(_ plugin: String, _ method: String, _ input: Any) -> [String: Any]? {
        var request = URLRequest(url: URL(string: "http://127.0.0.1:38886/api/v1/plugins/\(plugin)/rpc/\(method)")!)
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

    /// A message's menu ends with when it was sent. Read-only on a real thread.
    func testMessageSentTime() throws {
        app.open(URL(string: "bbstudio://thread/thr_64r2wmjrim")!)
        let texts = app.staticTexts.matching(NSPredicate(format: "label MATCHES %@", "(?s).{20,}"))
        XCTAssertTrue(texts.firstMatch.waitForExistence(timeout: 15), "messages")
        sleep(2)
        let message = try XCTUnwrap(texts.allElementsBoundByIndex.last { $0.isHittable }, "a message on screen")
        message.press(forDuration: 1)
        let sent = app.staticTexts.containing(NSPredicate(format: "label BEGINSWITH 'Sent '")).firstMatch
        let button = app.buttons.containing(NSPredicate(format: "label BEGINSWITH 'Sent '")).firstMatch
        XCTAssertTrue(sent.waitForExistence(timeout: 5) || button.exists, "sent time in the menu")
        shot("message-sent-time")
    }

    func testTerminal() throws {
        app.open(URL(string: "bbstudio://terminals")!)
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
        let created = rpc("studio-tasks", "create", [
            "title": title, "description": "Scratch task for a **UI test**.", "due": "2026-10-02", "assignee": "me",
        ])
        let id = try XCTUnwrap((created?["task"] as? [String: Any])?["id"] as? String)
        addTeardownBlock { _ = self.rpc("studio-tasks", "delete", ["id": id]) }
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
        XCTAssertTrue(wait(10) { (self.rpc("studio-tasks", "get", ["id": id])?["task"] as? [String: Any])?["status"] as? String == "review" }, "moved to Review")
        shot("task-review")
        app.navigationBars.buttons.element(boundBy: 0).tap()
        app.segmentedControls.buttons.element(boundBy: 2).tap()
        let moved = app.buttons.containing(NSPredicate(format: "label CONTAINS %@", title)).firstMatch
        XCTAssertTrue(moved.waitForExistence(timeout: 10), "in the Review column")
        moved.swipeRight()
        app.buttons["Done"].firstMatch.tap()
        XCTAssertTrue(wait(10) { (self.rpc("studio-tasks", "get", ["id": id])?["task"] as? [String: Any])?["status"] as? String == "done" }, "swiped to Done")
        shot("tasks-done")
    }

    /// Tags a scratch task from Studio's long-press menu, then deletes the tag and the task.
    func testStudioTags() throws {
        let stamp = Int(Date().timeIntervalSince1970)
        let title = "QA tag task \(stamp)", tagName = "QA tag \(stamp)"
        let created = rpc("studio-tasks", "create", ["title": title, "description": ""])
        let id = try XCTUnwrap((created?["task"] as? [String: Any])?["id"] as? String)
        func overview() -> [String: Any]? { self.rpc("studio", "overview", NSNull()) }
        addTeardownBlock {
            for tag in (overview()?["tags"] as? [[String: Any]]) ?? [] where tag["name"] as? String == tagName {
                _ = self.rpc("studio", "deleteTag", ["id": tag["id"] as? String ?? ""])
            }
            _ = self.rpc("studio-tasks", "delete", ["id": id])
        }
        app.open(URL(string: "bbstudio://studio")!)
        let row = app.buttons.containing(NSPredicate(format: "label CONTAINS %@", title)).firstMatch
        XCTAssertTrue(row.waitForExistence(timeout: 15), "task in Studio")
        row.press(forDuration: 1)
        app.buttons["Tags"].tap()
        app.buttons["New Tag…"].tap()
        app.alerts.textFields.firstMatch.typeText(tagName)
        app.alerts.buttons["Add"].tap()
        func tagged() -> Bool {
            let tagId = ((overview()?["tags"] as? [[String: Any]]) ?? []).first { $0["name"] as? String == tagName }?["id"] as? String
            let item = ((overview()?["items"] as? [[String: Any]]) ?? []).first { $0["pluginId"] as? String == "studio-tasks" && $0["id"] as? String == id }
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
        let created = rpc("studio-tasks", "create", ["title": title, "description": "Scratch task.", "projectId": "proj_8ztiq6dkh5"])
        let id = try XCTUnwrap((created?["task"] as? [String: Any])?["id"] as? String)
        var threadId: String?
        addTeardownBlock {
            if let threadId { _ = self.api("DELETE", "/threads/\(threadId)", ["childThreadsConfirmed": false]) }
            _ = self.rpc("studio-tasks", "delete", ["id": id])
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
            threadId = (self.rpc("studio-chat", "lastThread", ["pluginId": "studio-tasks", "id": id])?["threadId"] as? String)
            return threadId != nil
        }, "thread linked to the task")
        XCTAssertTrue(app.staticTexts.containing(NSPredicate(format: "label CONTAINS 'automated UI test'")).firstMatch.waitForExistence(timeout: 15), "opened the thread")
        shot("studio-chat-thread")
        // Let the agent finish so the thread deletes cleanly.
        _ = wait(90) { (self.api("GET", "/threads/\(threadId!)", [:])?["status"] as? String).map { !["running", "starting", "queued"].contains($0) } ?? false }
    }

    /// Read-only on Command Center's real automations; writes only touch a
    /// disabled one-off scratch automation 300 days out, deleted at the end.
    func testChannelAutomations() throws {
        let channel = "1a5943b7-4148-436b-94b0-aab0a5401064"
        let room = app.staticTexts["Command Center"].firstMatch
        XCTAssertTrue(room.waitForExistence(timeout: 10), "channel in Home")
        room.tap()
        let more = app.buttons["More"].firstMatch
        XCTAssertTrue(more.waitForExistence(timeout: 10), "channel menu")
        more.tap()
        app.buttons["Automations"].tap()
        let reminder = app.staticTexts["Daily garbage-day reminder"].firstMatch
        XCTAssertTrue(reminder.waitForExistence(timeout: 10), "automations listed")
        XCTAssertTrue(app.staticTexts["Every day at 19:00 · America/New_York"].exists, "schedule described")
        shot("channel-automations")
        reminder.tap()
        XCTAssertTrue(app.staticTexts["Status"].waitForExistence(timeout: 10), "detail")
        for _ in 0..<6 where !app.staticTexts["RUNS"].exists && !app.staticTexts["Runs"].exists { app.swipeUp() }
        XCTAssertTrue(app.buttons["Run Now"].exists && app.buttons["Pause"].exists, "actions shown")
        XCTAssertTrue(app.staticTexts["RUNS"].exists || app.staticTexts["Runs"].exists, "runs section")
        _ = wait(5) { !self.app.activityIndicators.firstMatch.exists }
        shot("channel-automation-detail")

        // Create through the editor on the scratch-safe path.
        let name = "QA automation \(Int(Date().timeIntervalSince1970))"
        var createdId: String?
        addTeardownBlock {
            let list = self.rpc("bot-teams", "automationList", ["channelId": channel, "limit": 50])
            for case let automation as [String: Any] in list?["automations"] as? [Any] ?? []
            where (automation["name"] as? String)?.hasPrefix("QA automation") == true {
                _ = self.rpc("bot-teams", "automationAction", [
                    "channelId": channel, "automationId": automation["id"] as! String, "action": "delete"])
            }
        }
        app.navigationBars.buttons.element(boundBy: 0).tap()
        app.buttons["New Automation"].tap()
        let nameField = app.textFields["automationName"]
        XCTAssertTrue(nameField.waitForExistence(timeout: 5), "editor")
        nameField.tap()
        nameField.typeText(name)
        let prompt = app.textViews["automationPrompt"].exists ? app.textViews["automationPrompt"] : app.textFields["automationPrompt"]
        prompt.tap()
        prompt.typeText("UI test scratch. Never runs.")
        app.buttons.matching(NSPredicate(format: "label BEGINSWITH 'Repeat'")).firstMatch.tap()
        app.buttons["Once"].firstMatch.tap()
        let toggle = app.switches["Start enabled"].firstMatch
        if !toggle.isHittable { app.swipeUp() }
        toggle.switches.firstMatch.exists ? toggle.switches.firstMatch.tap() : toggle.tap()
        XCTAssertEqual(toggle.value as? String, "0", "created paused")
        shot("channel-automation-editor")
        app.buttons["Save"].tap()
        let created = app.staticTexts[name].firstMatch
        XCTAssertTrue(created.waitForExistence(timeout: 10), "created and listed")
        let list = rpc("bot-teams", "automationList", ["channelId": channel, "limit": 50])
        let automation = (list?["automations"] as? [[String: Any]])?.first { $0["name"] as? String == name }
        createdId = automation?["id"] as? String
        XCTAssertEqual(automation?["enabled"] as? Bool, false, "saved disabled")
        XCTAssertEqual((automation?["trigger"] as? [String: Any])?["triggerType"] as? String, "once")
        // Push it far out so nothing can fire even if a later step enables it.
        if let id = createdId {
            _ = rpc("bot-teams", "automationUpdate", [
                "channelId": channel, "automationId": id,
                "trigger": ["triggerType": "once", "runAt": (Date().timeIntervalSince1970 + 300 * 86400) * 1000]])
        }

        let bar = app.navigationBars["Automations"].frame.maxY
        for _ in 0..<4 where created.frame.minY < bar { app.swipeDown() }
        for _ in 0..<4 where !created.isHittable { app.swipeUp() }
        created.tap()
        let resumed = app.buttons["Resume"].waitForExistence(timeout: 10)
        shot("channel-automation-created")
        XCTAssertTrue(resumed, "paused detail")
        app.buttons["Edit"].tap()
        XCTAssertTrue(nameField.waitForExistence(timeout: 5))
        nameField.tap()
        nameField.typeText(" edited")
        app.buttons["Save"].tap()
        XCTAssertTrue(app.navigationBars["\(name) edited"].waitForExistence(timeout: 10), "renamed")
        app.buttons["Delete"].firstMatch.tap()
        app.buttons.matching(identifier: "Delete").allElementsBoundByIndex.last { $0.isHittable }?.tap()
        XCTAssertTrue(reminder.waitForExistence(timeout: 10), "back to list")
        XCTAssertTrue(wait(10) { !self.app.staticTexts["\(name) edited"].exists }, "deleted")
        shot("channel-automations-after")
    }

    func testBotInStudio() throws {
        // A link from before the rename still opens.
        app.open(URL(string: "bbgo://bot/bot_32fb8c40db41abea")!)
        XCTAssertTrue(app.staticTexts["Chief of Staff"].firstMatch.waitForExistence(timeout: 10), "bot screen")
        XCTAssertTrue(app.staticTexts["Channels"].waitForExistence(timeout: 5) || app.staticTexts["CHANNELS"].exists, "channels")
        shot("bot-view")
        app.open(URL(string: "bbstudio://studio")!)
        let bots = app.buttons["Bots"].firstMatch
        for _ in 0..<4 where !bots.isHittable { app.scrollViews.containing(.button, identifier: "All").firstMatch.swipeLeft() }
        bots.tap()
        XCTAssertTrue(app.staticTexts["Red4"].firstMatch.waitForExistence(timeout: 10), "bots listed in Studio")
        shot("studio-bots")
    }

    /// Finds two scratch tasks by their description, renames and deletes a scratch
    /// tag, archives one task and deletes both from select mode.
    func testStudioBulk() throws {
        let stamp = Int(Date().timeIntervalSince1970)
        let word = "zebracorn\(stamp)", titleA = "QA bulk A \(stamp)", titleB = "QA bulk B \(stamp)"
        let tagName = "QA bulk tag \(stamp)", renamed = "QA renamed \(stamp)"
        var ids: [String] = []
        for title in [titleA, titleB] {
            let created = rpc("studio-tasks", "create", ["title": title, "description": "Has \(word) inside.", "projectId": "proj_8ztiq6dkh5"])
            ids.append(try XCTUnwrap((created?["task"] as? [String: Any])?["id"] as? String))
        }
        func overview() -> [String: Any]? { self.rpc("studio", "overview", NSNull()) }
        func tagId(_ name: String) -> String? {
            ((overview()?["tags"] as? [[String: Any]]) ?? []).first { $0["name"] as? String == name }?["id"] as? String
        }
        func task(_ id: String) -> [String: Any]? { self.rpc("studio-tasks", "get", ["id": id])?["task"] as? [String: Any] }
        addTeardownBlock {
            for name in [tagName, renamed] { if let id = tagId(name) { _ = self.rpc("studio", "deleteTag", ["id": id]) } }
            for id in ids { _ = self.rpc("studio-tasks", "delete", ["id": id]) }
        }
        let tag = try XCTUnwrap((rpc("studio", "createTag", ["name": tagName])?["tag"] as? [String: Any])?["id"] as? String)
        _ = rpc("studio", "tagItems", ["items": [["pluginId": "studio-tasks", "id": ids[0]]], "add": [tag], "remove": [String]()])

        app.open(URL(string: "bbstudio://studio")!)
        let search = app.searchFields.firstMatch
        if !search.waitForExistence(timeout: 5) { app.swipeDown() }
        XCTAssertTrue(search.waitForExistence(timeout: 10), "search field")
        search.tap()
        search.typeText(word)
        XCTAssertTrue(app.staticTexts.matching(identifier: "studioSnippet").firstMatch.waitForExistence(timeout: 10), "content snippet")
        shot("studio-snippet")

        // The tag chip: rename, then delete.
        let chips = app.scrollViews.containing(.button, identifier: "All").firstMatch
        let chip = chips.buttons.matching(NSPredicate(format: "label CONTAINS %@", tagName)).firstMatch
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
        let renamedChip = chips.buttons.matching(NSPredicate(format: "label CONTAINS %@", renamed)).firstMatch
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
        let created = rpc("studio-tasks", "create", ["title": title, "description": "", "projectId": "proj_8ztiq6dkh5"])
        let id = try XCTUnwrap((created?["task"] as? [String: Any])?["id"] as? String)
        addTeardownBlock { _ = self.rpc("studio-tasks", "delete", ["id": id]) }
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
        XCTAssertTrue(wait(10) { ((self.rpc("studio-tasks", "get", ["id": id])?["links"] as? [Any]) ?? []).count == 1 }, "linked")
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
