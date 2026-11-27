import XCTest

/// Clicks through the thread screen against the explicitly configured staged BB.
/// Set `TEST_RUNNER_BBGO_QA_THREAD` to a thread whose last
/// assistant message ends with a `::reactions` directive. Nothing is sent.
final class ThreadUITests: ServerIsolatedUITestCase {
    private let app = XCUIApplication()
    private var threadId: String { ProcessInfo.processInfo.environment["BBGO_QA_THREAD"] ?? "thr_demo000003" }

    override func setUpWithError() throws {
        try super.setUpWithError()
        continueAfterFailure = true
    }

    func testHome() throws {
        try requireQAServer()
        app.launchStaged(server: qaServer)
        XCTAssertTrue(app.navigationBars["Home"].waitForExistence(timeout: 10)
            || app.staticTexts["Home"].waitForExistence(timeout: 5))
        shot("home-top")
        app.swipeUp()
        app.swipeUp()
        shot("home-bottom")
    }

    /// The split view and keyboard shortcuts; run on an iPad simulator. Nothing is sent.
    func testIPad() throws {
        try requireQAServer()
        app.launchStaged(server: qaServer)
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
        try requireQAServer()
        app.launchStaged(server: qaServer)
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
        try requireQAServer()
        app.launchStaged(server: qaServer)
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
        try requireQAServer()
        app.launchStaged(server: qaServer)
        let env = ProcessInfo.processInfo.environment
        guard let id = env["BBGO_PROBE_THREAD"] else { throw XCTSkip("no probe thread") }
        app.open(URL(string: "bbstudio://thread/\(id)")!)
        let composer = app.textViews["Message"]
        XCTAssertTrue(composer.waitForExistence(timeout: 10), "composer")
        sleep(2)
        // Drafts outlive a run that stopped early.
        clear(composer)

        // Find in thread.
        app.openConversationMenu()
        app.buttons["Find in conversation"].firstMatch.tap()
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
    /// Automations, usage and host settings. Read-only: nothing is run, paused or sent.
    func testTools() throws {
        try requireQAServer()
        app.launchStaged(server: qaServer)
        app.open(URL(string: "bbstudio://automations")!)
        XCTAssertTrue(app.navigationBars["Automations"].waitForExistence(timeout: 10)
            || app.staticTexts["Automations"].waitForExistence(timeout: 5))
        sleep(1)
        shot("tools-automations")
        let allRow = app.buttons["schedulesAllAutomations"].firstMatch
        if allRow.waitForExistence(timeout: 5) {
            allRow.tap()
        }
        let daily = app.buttons.matching(NSPredicate(format: "label CONTAINS 'Daily'")).firstMatch
        if daily.waitForExistence(timeout: 5) {
            daily.tap()
            XCTAssertTrue(app.switches["Enabled"].waitForExistence(timeout: 10), "automation detail")
            shot("tools-automation")
        }
        app.open(URL(string: "bbstudio://usage")!)
        XCTAssertTrue(app.navigationBars["Usage"].waitForExistence(timeout: 10)
            || app.staticTexts["Usage"].waitForExistence(timeout: 5))
        shot("tools-usage")
        app.open(URL(string: "bbstudio://settings")!)
        XCTAssertTrue(app.navigationBars["Settings"].waitForExistence(timeout: 10)
            || app.staticTexts["Settings"].waitForExistence(timeout: 5))
        shot("tools-settings")
        app.open(URL(string: "bbstudio://home")!)
        XCTAssertTrue(app.navigationBars["Home"].waitForExistence(timeout: 10)
            || app.staticTexts["Home"].waitForExistence(timeout: 5))
        shot("tools-home")
    }

    /// Read-only: opens sheets and screens, never sends, forks or compacts.
    func testThreadExtras() throws {
        try requireQAServer()
        app.launchStaged(server: qaServer)
        let targetThread = ProcessInfo.processInfo.environment["BBGO_QA_SENT_THREAD"] ?? threadId
        app.open(URL(string: "bbstudio://thread/\(targetThread)")!)
        let more = app.conversationMore
        XCTAssertTrue(more.waitForExistence(timeout: 10))
        more.tap()
        XCTAssertTrue(app.buttons["Files & changes"].waitForExistence(timeout: 5))
        shot("extras-menu")
        app.buttons["Files & changes"].tap()
        let changesTab = app.segmentedControls.buttons["Changes"]
        XCTAssertTrue(changesTab.waitForExistence(timeout: 10))
        changesTab.tap()
        let emptyChanges = app.staticTexts["No uncommitted changes"]
        let mdRow = app.staticTexts.matching(NSPredicate(format: "label ENDSWITH '.md'")).firstMatch
        let loadedChanges = XCTNSPredicateExpectation(predicate: NSPredicate { _, _ in emptyChanges.exists || mdRow.exists }, object: nil)
        _ = XCTWaiter.wait(for: [loadedChanges], timeout: 10)
        shot("extras-changes")
        // The diff steps need the fixture thread's checkout to have changes.
        try XCTSkipIf(emptyChanges.exists || !mdRow.exists, "no uncommitted changes to open")
        mdRow.tap()
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
        XCTAssertTrue(app.navigationBars["Archived"].waitForExistence(timeout: 10)
            || app.descendants(matching: .any).matching(NSPredicate(format: "identifier == 'shellTitle' AND label CONTAINS 'Archived'")).firstMatch.waitForExistence(timeout: 5))
        sleep(2)
        shot("extras-archived")
        app.open(URL(string: "bbstudio://drawings")!)
        XCTAssertTrue(app.navigationBars["Studio"].waitForExistence(timeout: 10)
            || app.descendants(matching: .any).matching(NSPredicate(format: "identifier == 'shellTitle' AND label == 'Studio'")).firstMatch.waitForExistence(timeout: 5))
        sleep(2)
        shot("extras-drawings")
        if let id = ProcessInfo.processInfo.environment["BBGO_QA_DRAWING"] {
            app.open(URL(string: "bbstudio://drawing/\(id)")!)
            sleep(3)
            shot("extras-drawing")
        }
    }

    /// Read-only: filters Studio by kind, opens one of each, and searches. Records nothing.
    func testStudio() throws {
        try requireQAServer()
        app.launchStaged(server: qaServer)
        openStudioCollection()
        sleep(2)
        shot("studio-all")
        for (chip, name) in [("Pages", "page"), ("Recordings", "recording"), ("Dictations", "dictation"), ("Whiteboards", "drawing"), ("Apps", "app")] {
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
                app.goBack()
                sleep(1)
            }
            let chipAgain = app.buttons[chip].firstMatch
            if chipAgain.waitForExistence(timeout: 3) { chipAgain.tap() }
        }
        let search = studioSearchField()
        if search.waitForExistence(timeout: 3) {
            search.tap()
            search.typeText("roadmap")
            sleep(2)
            shot("studio-search")
        }
    }

    /// Read-only: browses custom instructions.
    func testPluginScreens() throws {
        try requireQAServer()
        app.launchStaged(server: qaServer)
        app.open(URL(string: "bbstudio://settings")!)
        XCTAssertTrue(app.navigationBars["Settings"].waitForExistence(timeout: 10)
            || app.staticTexts["Settings"].waitForExistence(timeout: 5))
        let instructions = app.buttons["Custom Instructions"]
        if instructions.waitForExistence(timeout: 5) {
            instructions.tap()
            XCTAssertTrue(app.navigationBars["Custom Instructions"].waitForExistence(timeout: 10)
                || app.staticTexts["Custom Instructions"].waitForExistence(timeout: 5))
            sleep(1)
            shot("plugins-instructions")
        }
        shot("plugins-settings")
    }

    /// Records a few seconds from the microphone (the Mac's, in the simulator).
    /// Play speech near the mic while it runs; a silent recording is discarded by Talk.
    func testDictationCapture() throws {
        try requireQAServer()
        app.launchStaged(server: qaServer)
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
        // Links wait for the Bots to answer: the demo Bot answers offline.
        app.launchArguments = ["-skipPushPrompt", "YES", "-qaBotDemo", "chat", "-qaPageDemo", "-openURL", "bbstudio://page/qa-demo"]
        app.launchOffline()
        XCTAssertTrue(app.staticTexts["Launch plan"].waitForExistence(timeout: 10))
        sleep(1)
        shot("page-demo-top")
        app.swipeUp(velocity: .slow)
        sleep(1)
        shot("page-demo-bottom")
    }

    /// Needs a running thread with a queued message.
    func testQueueRemove() throws {
        try requireQAServer()
        app.launchStaged(server: qaServer)
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
        try requireQAServer()
        app.launchStaged(server: qaServer)
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
        try requireQAServer()
        app.launchStaged(server: qaServer)
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
        try requireQAServer()
        app.launchStaged(server: qaServer)
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

    /// Taps a file path in a reply and checks the file viewer opens. Scratch
    /// thread only, named by `TEST_RUNNER_BBGO_QA_FILE_THREAD`, whose last reply
    /// mentions `README.md`, or the file named by `TEST_RUNNER_BBGO_QA_FILE_NAME`
    /// (a link to `/tmp/…` checks files outside the workspace).
    func testFileLink() throws {
        try requireQAServer()
        app.launchStaged(server: qaServer)
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

    /// The shelf demo replaces the shelf when a timeline page arrives. Offline,
    /// the Bot demo's local server (`-qaDemoLatency`) serves its thread's pages.
    func testShelfDemo() {
        app.terminate()
        app.launchArguments = ["-skipPushPrompt", "YES", "-qaShelfDemo", "-qaBotDemo", "chat", "-qaDemoLatency", "0"]
        app.launchOffline()
        app.open(URL(string: "bbstudio://thread/thr_botdemo01")!)
        XCTAssertTrue(app.staticTexts["Plan mode"].waitForExistence(timeout: 10))
        shot("shelf-demo")
        app.buttons["chip-todos"].tap()
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

    /// Studio opens on the collection.
    private func openStudioCollection() {
        app.open(URL(string: "bbstudio://studio")!)
        let shellTitle = app.descendants(matching: .any).matching(NSPredicate(format: "identifier == 'shellTitle' AND label == 'Studio'")).firstMatch
        XCTAssertTrue(app.navigationBars["Studio"].waitForExistence(timeout: 10)
            || shellTitle.waitForExistence(timeout: 5), "Studio collection")
    }

    /// Studio's search field: `shellSearchField` on Duo, pulled-down `Search Studio` on iPhone.
    private func studioSearchField() -> XCUIElement {
        let duoField = app.textFields["shellSearchField"].firstMatch
        if duoField.waitForExistence(timeout: 3) { return duoField }
        let navField = app.searchFields["Search Studio"].firstMatch
        if !navField.waitForExistence(timeout: 2) {
            let list = app.collectionViews.firstMatch
            if list.waitForExistence(timeout: 5) {
                list.swipeDown()
                if navField.waitForExistence(timeout: 3) { return navField }
            }
            let window = app.windows.firstMatch
            for _ in 0..<2 where !navField.exists {
                window.coordinate(withNormalizedOffset: CGVector(dx: 0.5, dy: 0.45))
                    .press(forDuration: 0.05, thenDragTo: window.coordinate(withNormalizedOffset: CGVector(dx: 0.5, dy: 0.9)))
                _ = navField.waitForExistence(timeout: 3)
            }
        }
        return navField
    }

    /// The socket closes in the background: on return the inbox catches up on what
    /// changed meanwhile, then stays live. Creates two scratch threads, held
    /// with a far-off send, and deletes them.
    func testResumeReconnects() throws {
        try requireQAServer()
        app.launchStaged(server: qaServer)
        XCTAssertTrue(app.navigationBars["Home"].waitForExistence(timeout: 10)
            || app.staticTexts["Home"].waitForExistence(timeout: 5))
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
        try requireQAServer()
        app.launchStaged(server: qaServer)
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
        try requireQAServer()
        app.launchStaged(server: qaServer)
        guard let id = ProcessInfo.processInfo.environment["BBGO_QA_PAGE"] else { throw XCTSkip("no scratch page") }
        app.open(URL(string: "bbstudio://page/\(id)")!)
        XCTAssertTrue(app.descendants(matching: .any)["pageWorkField"].waitForExistence(timeout: 10), "work bar")
        sleep(1)
        shot("page-work-bar")
        app.screenMore.tap()
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
        app.screenMore.tap()
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
        try requireQAServer()
        app.launchStaged(server: qaServer)
        guard let id = ProcessInfo.processInfo.environment["BBGO_QA_PAGE"] else { throw XCTSkip("no scratch page") }
        // Reopen the first thread and drop what earlier runs added.
        let threads = (rpc("studio", "pages.comments", ["id": id, "includeResolved": true])?["threads"] as? [[String: Any]]) ?? []
        let first = try XCTUnwrap(threads.min { ($0["updatedAt"] as? Double ?? 0) < ($1["updatedAt"] as? Double ?? 0) }?["id"] as? String)
        _ = rpc("studio", "pages.commentResolve", ["id": id, "thread": first, "resolved": false])
        for thread in threads where thread["id"] as? String != first {
            _ = rpc("studio", "pages.commentResolve", ["id": id, "thread": thread["id"] as? String ?? "", "resolved": true])
        }
        app.open(URL(string: "bbstudio://page/\(id)")!)
        let comments = app.screenAction("comments")
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
        try requireQAServer()
        app.launchStaged(server: qaServer)
        let env = ProcessInfo.processInfo.environment
        var ids = [env["BBGO_QA_RECORDING"], env["BBGO_QA_RECORDING_MP4"]].compactMap { $0 }.filter { !$0.isEmpty }
        if ids.isEmpty,
           let list = rpc("studio", "recordings.recordings_list", ["limit": 10])?["recordings"] as? [[String: Any]],
           let first = list.first?["id"] as? String {
            ids = [first]
        }
        guard !ids.isEmpty else { throw XCTSkip("no recording available on staged server") }
        let position = app.staticTexts["playerPosition"]
        func seconds() -> Int {
            let parts = position.label.split(separator: ":").compactMap { Int($0) }
            return parts.reduce(0) { $0 * 60 + $1 }
        }
        for id in ids {
            app.open(URL(string: "bbstudio://recording/\(id)")!)
            let play = app.buttons["Play"].firstMatch
            if !play.waitForExistence(timeout: 8) {
                openStudioCollection()
                let chip = app.buttons["studio-kind-recording"].firstMatch
                if chip.waitForExistence(timeout: 5) { chip.tap() }
                let row = app.descendants(matching: .any).matching(identifier: "studioItem").firstMatch
                XCTAssertTrue(row.waitForExistence(timeout: 10), "recording row in Studio")
                row.tap()
            }
            XCTAssertTrue(play.waitForExistence(timeout: 15), "player bar")
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
            let links = app.links
            if links.count > 1 {
                links.element(boundBy: 0).tap()
                sleep(2)
                XCTAssertLessThan(seconds(), 10, "jumped to the first sentence")
            }
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


    /// The Save to Studio sheet on a scratch thread that never runs, so there's nothing to save.
    func testSaveToStudio() throws {
        try requireQAServer()
        app.launchStaged(server: qaServer)
        let thread = try XCTUnwrap(scratchThread("QA save to studio \(Int(Date().timeIntervalSince1970))"))
        addTeardownBlock { _ = self.api("DELETE", "/threads/\(thread)", ["childThreadsConfirmed": false]) }
        app.open(URL(string: "bbstudio://thread/\(thread)")!)
        let more = app.conversationMore
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
        try requireQAServer()
        app.launchStaged(server: qaServer)
        let start = Date().timeIntervalSince1970 * 1000
        addTeardownBlock {
            // Pages this test made: untitled ones created since it started.
            let overview = self.rpc("studio", "overview", NSNull())
            for item in (overview?["items"] as? [[String: Any]]) ?? [] {
                guard item["pluginId"] as? String == "pages", (item["createdAt"] as? Double ?? 0) >= start,
                    (item["title"] as? String ?? "").isEmpty || item["title"] as? String == "Untitled" || item["title"] as? String == "QA embeds"
                else { continue }
                _ = self.rpc("studio", "pages.remove", ["id": item["id"] as? String ?? ""])
            }
        }
        openStudioCollection()
        let new = app.screenAction("new")
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
        let page = rpc("studio", "pages.create", ["projectId": NSNull(), "parentId": NSNull(), "title": "QA embeds", "markdown": markdown])
        let pageId = try XCTUnwrap((page?["page"] as? [String: Any])?["id"] as? String)
        app.open(URL(string: "bbstudio://page/\(pageId)")!)
        let embed = app.buttons["studioEmbed"].firstMatch
        XCTAssertTrue(embed.waitForExistence(timeout: 10), "embed card")
        sleep(2)
        shot("page-studio-embeds")
        embed.tap()
        XCTAssertTrue(app.staticTexts.containing(NSPredicate(format: "label CONTAINS 'Transcript' OR label CONTAINS 'transcript'")).firstMatch.waitForExistence(timeout: 10)
            || app.navigationBars.count > 0
            || app.descendants(matching: .any)["shellTitle"].exists, "recording opens")
        sleep(1)
        shot("page-embed-opened")
    }

    /// Studio's Write tile. The page it makes is a scratch item, found by title and deleted afterwards.
    func testQuickCapture() throws {
        try requireQAServer()
        app.launchStaged(server: qaServer)
        let stamp = Int(Date().timeIntervalSince1970)
        let titles = ["QA quick page \(stamp)"]
        addTeardownBlock {
            let items = (self.rpc("studio", "overview", NSNull())?["items"] as? [[String: Any]]) ?? []
            for item in items where titles.contains(item["title"] as? String ?? "") && item["pluginId"] as? String == "pages" {
                _ = self.rpc("studio", "pages.remove", ["id": item["id"] as? String ?? ""])
            }
        }
        openStudioCollection()
        let write = app.buttons["Write"].firstMatch
        XCTAssertTrue(write.waitForExistence(timeout: 10), "Write tile")
        XCTAssertTrue(app.buttons["Dictate"].exists, "Dictate tile")
        shot("capture-tiles")

        write.tap()
        let text = app.textViews["quickWriteText"]
        XCTAssertTrue(text.waitForExistence(timeout: 5))
        text.typeText("\(titles[0])\n\nA line under the title.")
        shot("capture-write")
        app.buttons["quickWriteSave"].tap()
        XCTAssertTrue(app.staticTexts[titles[0]].firstMatch.waitForExistence(timeout: 15), "page opened")
        shot("capture-write-saved")
    }

    private func rpc(_ plugin: String, _ method: String, _ input: Any) -> [String: Any]? {
        var request = URLRequest(url: URL(string: "\(qaServer)/api/v1/plugins/\(plugin)/rpc/\(method)")!)
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
        try requireQAServer()
        app.launchStaged(server: qaServer)
        let thread = try XCTUnwrap(scratchThread("QA permissions \(Int(Date().timeIntervalSince1970))"))
        addTeardownBlock { _ = self.api("DELETE", "/threads/\(thread)", ["childThreadsConfirmed": false]) }
        app.open(URL(string: "bbstudio://thread/\(thread)")!)
        let more = app.conversationMore
        XCTAssertTrue(more.waitForExistence(timeout: 10))
        more.tap()
        app.buttons["Model & permissions"].tap()
        let picker = app.buttons["permissionPicker"].firstMatch
        XCTAssertTrue(picker.waitForExistence(timeout: 10), "permissions picker")
        shot("permissions-sheet")
        let targetMode = picker.label.contains("Accept edits") ? "Auto" : "Accept edits"
        picker.tap()
        app.buttons[targetMode].firstMatch.tap()
        app.buttons["Save"].tap()
        XCTAssertTrue(more.waitForExistence(timeout: 5))
        let pendingCard = app.descendants(matching: .any)["pendingPermission"].firstMatch
        let pendingChip = app.buttons["chip-permission"].firstMatch
        let shown = XCTNSPredicateExpectation(predicate: NSPredicate { _, _ in pendingCard.exists || pendingChip.exists }, object: nil)
        XCTAssertEqual(XCTWaiter.wait(for: [shown], timeout: 5), .completed, "pending permissions over the composer")
        shot("permissions-pending")
        sleep(1)
        more.tap()
        let shareMenu = app.buttons["Share & notifications"].firstMatch
        if shareMenu.waitForExistence(timeout: 3) {
            shareMenu.tap()
            XCTAssertTrue(app.buttons["Copy Thread ID"].waitForExistence(timeout: 3), "Copy Thread ID")
            app.coordinate(withNormalizedOffset: CGVector(dx: 0.1, dy: 0.4)).tap()
            more.tap()
        } else {
            XCTAssertTrue(app.buttons["Copy Thread ID"].exists, "Copy Thread ID")
        }
        app.buttons["Model & permissions"].tap()
        XCTAssertTrue(picker.waitForExistence(timeout: 10))
        XCTAssertTrue(picker.label.contains(targetMode) || (picker.value as? String)?.contains(targetMode) == true, "kept the choice: \(picker.label)")
        shot("permissions-kept")
        app.buttons["Cancel"].tap()
        let clearBtn = app.buttons["chip-permission-close"].firstMatch.exists
            ? app.buttons["chip-permission-close"].firstMatch
            : app.buttons["Undo"].firstMatch
        XCTAssertTrue(clearBtn.waitForExistence(timeout: 5), "clear pending permission button")
        clearBtn.tap()
        XCTAssertTrue(wait(5) { !pendingCard.exists && !pendingChip.exists }, "undo clears it")
    }

    /// A message's menu ends with when it was sent. Read-only on a real thread.
    func testMessageSentTime() throws {
        try requireQAServer()
        app.launchStaged(server: qaServer)
        let sentId = ProcessInfo.processInfo.environment["BBGO_QA_SENT_THREAD"] ?? threadId
        app.open(URL(string: "bbstudio://thread/\(sentId)")!)
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

    /// Opens terminals from a scratch thread's menu, named by
    /// `TEST_RUNNER_BBGO_QA_QUEUE_THREAD`, never a real one.
    func testTerminal() throws {
        try requireQAServer()
        app.launchStaged(server: qaServer)
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
        try requireQAServer()
        app.launchStaged(server: qaServer)
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
        try requireQAServer()
        app.launchStaged(server: qaServer)
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

    /// Tags a scratch page from Studio's long-press menu, then deletes the tag and the page.
    func testStudioTags() throws {
        try requireQAServer()
        app.launchStaged(server: qaServer)
        let stamp = Int(Date().timeIntervalSince1970)
        let title = "QA tag page \(stamp)", tagName = "QA tag \(stamp)"
        let created = rpc("studio", "pages.create", ["projectId": NSNull(), "parentId": NSNull(), "title": title, "markdown": ""])
        let id = try XCTUnwrap((created?["page"] as? [String: Any])?["id"] as? String)
        func overview() -> [String: Any]? { self.rpc("studio", "overview", NSNull()) }
        addTeardownBlock {
            for tag in (overview()?["tags"] as? [[String: Any]]) ?? [] where tag["name"] as? String == tagName {
                _ = self.rpc("studio", "deleteTag", ["id": tag["id"] as? String ?? ""])
            }
            _ = self.rpc("studio", "pages.remove", ["id": id])
        }
        openStudioCollection()
        let row = app.buttons.containing(NSPredicate(format: "label CONTAINS %@", title)).firstMatch
        XCTAssertTrue(row.waitForExistence(timeout: 15), "page in Studio")
        row.press(forDuration: 1)
        app.buttons["Tags"].tap()
        app.buttons["New Tag…"].tap()
        app.alerts.textFields.firstMatch.typeText(tagName)
        app.alerts.buttons["Add"].tap()
        func tagged() -> Bool {
            let tagId = ((overview()?["tags"] as? [[String: Any]]) ?? []).first { $0["name"] as? String == tagName }?["id"] as? String
            let item = ((overview()?["items"] as? [[String: Any]]) ?? []).first { $0["pluginId"] as? String == "pages" && $0["id"] as? String == id }
            return tagId != nil && (item?["tags"] as? [String])?.contains(tagId!) == true
        }
        XCTAssertTrue(wait(10, tagged), "page tagged")
        XCTAssertTrue(app.staticTexts[tagName].firstMatch.waitForExistence(timeout: 10) || app.buttons[tagName].firstMatch.exists, "tag chip")
        shot("studio-tags")
        row.press(forDuration: 1)
        app.buttons["Tags"].tap()
        shot("studio-tags-menu")
        // The lifted row's chip has the same name; the menu's item comes first.
        app.buttons.matching(identifier: tagName).firstMatch.tap()
        XCTAssertTrue(wait(10) { !tagged() }, "tag removed")
    }


    /// Finds two scratch pages by their text, renames and deletes a scratch
    /// tag, archives one page and deletes both from select mode.
    func testStudioBulk() throws {
        try requireQAServer()
        app.launchStaged(server: qaServer)
        let stamp = Int(Date().timeIntervalSince1970)
        let word = "zebracorn\(stamp)", titleA = "QA bulk A \(stamp)", titleB = "QA bulk B \(stamp)"
        let tagName = "QA bulk tag \(stamp)", renamed = "QA renamed \(stamp)"
        var ids: [String] = []
        let projectId = try XCTUnwrap(firstProjectId())
        for title in [titleA, titleB] {
            let created = rpc("studio", "pages.create", ["projectId": projectId, "parentId": NSNull(), "title": title, "markdown": "Has \(word) inside."])
            ids.append(try XCTUnwrap((created?["page"] as? [String: Any])?["id"] as? String))
        }
        func overview() -> [String: Any]? { self.rpc("studio", "overview", NSNull()) }
        func tagId(_ name: String) -> String? {
            ((overview()?["tags"] as? [[String: Any]]) ?? []).first { $0["name"] as? String == name }?["id"] as? String
        }
        func page(_ id: String) -> [String: Any]? { self.rpc("studio", "pages.get", ["id": id])?["page"] as? [String: Any] }
        addTeardownBlock {
            for name in [tagName, renamed] { if let id = tagId(name) { _ = self.rpc("studio", "deleteTag", ["id": id]) } }
            for id in ids { _ = self.rpc("studio", "pages.remove", ["id": id]) }
        }
        let tag = try XCTUnwrap((rpc("studio", "createTag", ["name": tagName])?["tag"] as? [String: Any])?["id"] as? String)
        _ = rpc("studio", "tagItems", ["items": [["pluginId": "pages", "id": ids[0]]], "add": [tag], "remove": [String]()])

        openStudioCollection()
        _ = app.descendants(matching: .any).matching(identifier: "studioItem").firstMatch.waitForExistence(timeout: 10)
        let search = studioSearchField()
        XCTAssertTrue(search.waitForExistence(timeout: 10), "search field")
        search.tap()
        search.typeText(word)
        XCTAssertTrue(app.staticTexts.matching(identifier: "studioSnippet").firstMatch.waitForExistence(timeout: 10), "content snippet")
        shot("studio-snippet")

        // The tag chip: rename, then delete.
        let chips = app.scrollViews.containing(.button, identifier: "studio-kind-all").firstMatch
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
        let selectBtn = app.screenAction("select")
        XCTAssertTrue(selectBtn.waitForExistence(timeout: 5), "Select button")
        selectBtn.tap()
        let rowA = app.cells.containing(NSPredicate(format: "label CONTAINS %@", titleA)).firstMatch
        XCTAssertTrue(rowA.waitForExistence(timeout: 10), "row A")
        rowA.tap()
        XCTAssertTrue(app.otherElements["studioSelectionBar"].waitForExistence(timeout: 5) || app.buttons["Archive"].exists, "selection bar")
        shot("studio-select")
        app.buttons["Archive"].tap()
        XCTAssertTrue(wait(10) { page(ids[0])?["archived"] as? Bool == true }, "archived")

        // Delete what's left. Rows are picked one by one: Select All would take real items if the search were lost.
        XCTAssertTrue(selectBtn.waitForExistence(timeout: 5), "Select button again")
        selectBtn.tap()
        let rowB = app.cells.containing(NSPredicate(format: "label CONTAINS %@", titleB)).firstMatch
        XCTAssertTrue(rowB.waitForExistence(timeout: 10), "row B")
        rowB.tap()
        app.buttons["Delete"].firstMatch.tap()
        app.sheets.buttons["Delete"].firstMatch.tap()
        XCTAssertTrue(wait(10) { page(ids[1]) == nil }, "deleted from select mode")
        shot("studio-bulk-done")
    }

    private func firstProjectId() -> String? {
        var request = URLRequest(url: URL(string: "\(qaServer)/api/v1/projects")!)
        request.httpMethod = "GET"
        var projectId: String?
        let done = expectation(description: "projects")
        URLSession.shared.dataTask(with: request) { data, _, _ in
            if let data, let list = try? JSONSerialization.jsonObject(with: data) as? [[String: Any]] {
                projectId = list.first(where: { ($0["id"] as? String) != "proj_personal" })?["id"] as? String
                    ?? list.first?["id"] as? String
            }
            done.fulfill()
        }.resume()
        wait(for: [done], timeout: 15)
        return projectId
    }

    private func scratchThread(_ title: String) -> String? {
        guard let projectId = firstProjectId() else { return nil }
        let json = api("POST", "/threads", [
            "projectId": projectId, "origin": "app", "title": title,
            "environment": ["type": "project-default"], "sendAt": 1_924_992_000_000,
            "input": [["type": "text", "text": "Scratch thread for a UI test. Do nothing.", "mentions": [String]()]],
        ])
        return json?["id"] as? String ?? (json?["thread"] as? [String: Any])?["id"] as? String
    }

    private func api(_ method: String, _ path: String, _ body: [String: Any]) -> [String: Any]? {
        var request = URLRequest(url: URL(string: "\(qaServer)/api/v1\(path)")!)
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
