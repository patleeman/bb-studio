import XCTest

/// Patrick, Oct 26, Duo inner screen: "if you click on the button to expand
/// the sidebar it just scrolls up", then "All the buttons on top of the
/// screen cause scrolling up." Each header button gets a real tap, at its
/// centre and near its top edge, in the status-bar tap strip. It must do
/// what it says, and the transcript under the header keeps its place.
///
/// `TEST_RUNNER_HEADER_LAYOUT`: `inner` (the default: the Duo's inner screen,
/// 951 × 669, at each list width), `outer` (the Duo's outer screen), both on
/// an iPhone Duo simulator, or `phone` (an iPhone). The simulator's screen is
/// only as wide as the outer one, so for a button in the inner screen's
/// right page, `qa-duo/split-right` shifts the window left to bring it on
/// screen.
@MainActor
final class HeaderTapUITests: ServerIsolatedUITestCase {
    private let app = XCUIApplication()
    private let layout = ProcessInfo.processInfo.environment["HEADER_LAYOUT"] ?? "inner"
    private var steps: [String] = []
    private var failures: [String] = []

    override func tearDown() {
        if layout == "inner", app.state == .runningForeground { command("pane?even"); Thread.sleep(forTimeInterval: 1) }
        super.tearDown()
    }

    func testBotChatHeader() throws {
        launch(bot: true)
        for pane in panes {
            setPane(pane)
            if layout == "inner" { checkToggle("bot \(pane)") }
            let bell = app.buttons.matching(NSPredicate(format: "label BEGINSWITH 'Activity'")).firstMatch
            check("bot \(pane): bell", bell, opened: { self.app.navigationBars["Activity"].exists || !bell.isHittable },
                  close: { self.closeSheet { self.app.navigationBars["Activity"].exists || !bell.isHittable } })
            check("bot \(pane): ⋯", app.buttons["Juniper options"].firstMatch,
                  opened: { self.app.buttons["Edit profile"].exists }, close: { self.closeMenu(self.app.buttons["Edit profile"]) })
        }
        finish()
    }

    /// A thread from the Threads tab, launched afresh at each list width.
    func testThreadHeaderEven() throws { try threadHeader(.even) }
    func testThreadHeaderNarrow() throws { try XCTSkipUnless(layout == "inner"); try threadHeader(.narrow) }
    func testThreadHeaderHidden() throws { try XCTSkipUnless(layout == "inner"); try threadHeader(.hidden) }

    private func threadHeader(_ pane: Pane) throws {
        launch()
        command("tab?threads")
        let conversation = app.buttons["inbox-thread-thr_botdemo01"]
        XCTAssertTrue(conversation.waitForExistence(timeout: 15))
        conversation.tap()
        XCTAssertTrue(app.staticTexts.matching(NSPredicate(format: "label BEGINSWITH 'Duo message 80'")).firstMatch.waitForExistence(timeout: 15))
        setPane(pane)
        check("thread \(pane): ⋯", app.buttons["More"].firstMatch,
              opened: { self.app.buttons["Rename"].exists }, close: { self.closeMenu(self.app.buttons["Rename"]) })
        let find = headerButton("Find")
        if find.exists {
            let field = app.textFields["Find in thread"]
            check("thread \(pane): find", find, opened: { field.exists }, close: {
                let done = self.app.buttons["Done"].firstMatch
                guard done.waitForExistence(timeout: 2) else { return }
                self.reach(done)
                done.tap()
                _ = self.waitFor { !field.exists && !self.app.keyboards.firstMatch.exists }
            })
        }
        if layout == "inner" { checkToggle("thread \(pane)") }
        if layout == "phone" {
            // On the outer screen the thread showed no navigation-bar back button.
            let back = app.navigationBars.buttons.firstMatch
            check("thread: back", back, opened: { conversation.isHittable }, close: {
                conversation.tap()
                _ = self.app.otherElements["threadComposer"].firstMatch.waitForExistence(timeout: 10)
            }, keepsTranscript: false)
        } else if layout == "inner", pane == .even {
            // The list's own header, on the left page.
            let sheet = app.navigationBars["New thread"]
            check("threads list: new thread", headerButton("New Thread"), opened: { sheet.exists }, close: {
                guard sheet.exists else { return }
                let cancel = sheet.buttons["Cancel"]
                self.reach(cancel)
                cancel.tap()
                _ = self.waitFor { !sheet.exists }
            })
        }
        finish()
    }

    // MARK: - Checks

    private enum Pane: String { case even, narrow, hidden }
    private var panes: [Pane] { layout == "inner" ? [.even, .narrow, .hidden] : [.even] }
    /// Near a button's top edge. Beside two pages the header reaches the
    /// window's top, and this is in the status-bar tap strip, above the
    /// button's own frame. Elsewhere the status bar is above the navigation
    /// bar, and this is 4 points into the button.
    private func topEdge(_ frame: CGRect) -> CGFloat { layout == "inner" ? 4 : frame.minY - app.frame.minY + 4 }

    /// The sidebar button shows or hides the list, and the rows in view stay in view.
    private func checkToggle(_ name: String) {
        let toggle = app.buttons["duoPaneToggle"]
        XCTAssertTrue(toggle.waitForExistence(timeout: 5), "\(name): the toggle")
        for (place, top) in [("centre", false), ("top edge", true)] {
            let start = pane()
            reach(toggle)
            scrollUp()
            guard let row = visibleRow(), let before = transcript() else {
                failures.append("\(name) toggle \(place): no transcript in view")
                continue
            }
            tap(toggle, top: top)
            let changed = waitFor { self.pane() != start }
            Thread.sleep(forTimeInterval: 1)
            let after = transcript()
            let text = app.staticTexts[row]
            let inView = text.exists && (0..<669).contains(text.frame.midY)
            note(String(format: "%@ toggle %@: pane %@ -> %@, offset %.0f -> %.0f, '%@' in view: %@", name, place, start, pane(),
                        before.offset, after?.offset ?? .nan, row, inView ? "yes" : "no"))
            if !changed { failures.append("\(name) toggle \(place): the list didn't change") }
            if let after, after.offset < 200 { failures.append("\(name) toggle \(place): scrolled to the top") }
            if !inView { failures.append("\(name) toggle \(place): '\(row)' left the view") }
            setPane(Pane(rawValue: start) ?? .even)
        }
    }

    /// A tap at the button's centre, then one near its top edge: each does
    /// `opened`, and the transcript doesn't scroll: the content at the top of
    /// its visible part stays the same (a find bar adds to the top inset).
    private func check(_ name: String, _ button: XCUIElement, opened: @escaping () -> Bool, close: () -> Void,
                       keepsTranscript: Bool = true) {
        for (place, top) in [("centre", false), ("top edge", true)] {
            guard button.waitForExistence(timeout: 5) else { return failures.append("\(name): no button") }
            reach(button)
            if keepsTranscript { scrollUp() }
            let before = transcript()
            let frame = button.frame
            tap(button, top: top)
            let did = waitFor(4, opened)
            let during = transcript()
            close()
            Thread.sleep(forTimeInterval: 2)
            if app.otherElements["PopoverDismissRegion"].exists { failures.append("\(name) \(place): a menu is open after closing") }
            let after = transcript()
            if !did { add(XCTAttachment(screenshot: XCUIScreen.main.screenshot())) }
            note(String(format: "%@ %@ (button %.0f,%.0f-%.0f): opened %@, first visible %.0f -> %.0f -> %.0f", name, place, frame.minX - app.frame.minX, frame.minY, frame.maxY,
                        did ? "yes" : "no", before?.firstVisible ?? .nan, during?.firstVisible ?? .nan, after?.firstVisible ?? .nan))
            if !did { failures.append("\(name) \(place): didn't open") }
            guard keepsTranscript, let before else { continue }
            for (when, scroll) in [("while open", during), ("after", after)] {
                // A find bar's inset rounds by a point; a scroll moves far more.
                if let scroll, abs(scroll.firstVisible - before.firstVisible) > 2 {
                    failures.append(String(format: "%@ %@: the transcript moved %@ (%.0f -> %.0f)", name, place, when, before.firstVisible, scroll.firstVisible))
                }
            }
        }
    }

    private func closeSheet(_ shown: @escaping () -> Bool) {
        for label in ["Done", "Close"] where app.buttons[label].exists {
            app.buttons[label].firstMatch.tap()
            _ = waitFor { !shown() }
            return
        }
        app.swipeDown(velocity: .fast)
        _ = waitFor { !shown() }
    }

    /// A tap outside the menu.
    private func closeMenu(_ item: XCUIElement) {
        for _ in 0..<3 where item.exists {
            let region = app.otherElements["PopoverDismissRegion"].firstMatch
            // The screen's left edge, beside the menu, which reaches past the header.
            if region.exists { region.tap() } else { windowPoint(x: 30 - app.frame.minX, y: 400).tap() }
            _ = waitFor(2) { !item.exists }
        }
        if item.exists { failures.append("the menu didn't close") }
    }

    /// The button with this label in a header, not one further down.
    private func headerButton(_ label: String) -> XCUIElement {
        let matches = app.buttons.matching(NSPredicate(format: "label == %@", label))
        return matches.allElementsBoundByIndex.first { $0.frame.minY < 60 } ?? matches.firstMatch
    }

    // MARK: - Harness

    /// `bot`: the Bot's chat, which on an iPhone is the `chat` demo (the Duo
    /// one opens on the Bots list there).
    private func launch(bot: Bool = false) {
        let variant = bot && layout == "phone" ? "chat" : "duo"
        app.launchArguments = ["-skipPushPrompt", "YES", "-qaBotDemo", variant, "-qaDuoWideTitles",
                               "-qaVoice", "idle", "-qaDark", "-openURL", "bbstudio://bot"]
        if layout != "phone" { app.launchArguments += ["-qaDuoPhone"] }
        if layout == "inner" { app.launchArguments += ["-qaDuoColdWide"] }
        app.launchOffline()
        // On an iPhone the Duo demo opens on the Bots list, with no chat.
        guard bot || layout != "phone" else { return XCTAssertTrue(app.wait(for: .runningForeground, timeout: 30)) }
        XCTAssertTrue(app.otherElements["threadComposer"].firstMatch.waitForExistence(timeout: 30))
        if variant == "duo" {
            XCTAssertTrue(app.staticTexts.matching(NSPredicate(format: "label BEGINSWITH 'Duo message 80'")).firstMatch
                .waitForExistence(timeout: 15))
        }
        if layout == "outer" { command("outer") }
        setPane(.even)
        Thread.sleep(forTimeInterval: 1)
    }

    private func setPane(_ pane: Pane) {
        guard layout == "inner" else { return }
        command("pane?\(pane.rawValue)")
        _ = waitFor { self.pane() == pane.rawValue }
        Thread.sleep(forTimeInterval: 0.5)
    }

    /// Shifts the inner window to bring the element to the middle of the
    /// simulator's screen, the outer screen's width. Near its right edge,
    /// XCUITest's taps aren't delivered.
    private func reach(_ element: XCUIElement) {
        guard layout == "inner", element.exists, !(60..<380).contains(element.frame.midX) else { return }
        let x = element.frame.midX - app.frame.minX
        let shift = max(0, min(951 - 466, (x - 200).rounded()))
        command("shift?\(Int(shift))")
        _ = waitFor { abs(self.app.frame.minX + shift) < 1 }
        Thread.sleep(forTimeInterval: 0.5)
    }

    /// A real tap at the element's centre, or near its top edge. A screen
    /// point, not `element.tap()`: the window can hold an off-screen copy of
    /// a header, whose button XCUITest may resolve.
    private func tap(_ element: XCUIElement, top: Bool) {
        let frame = element.frame
        windowPoint(x: frame.midX - app.frame.minX, y: top ? topEdge(frame) : frame.midY - app.frame.minY).tap()
    }

    private func windowPoint(x: CGFloat, y: CGFloat) -> XCUICoordinate {
        app.coordinate(withNormalizedOffset: .zero).withOffset(CGVector(dx: x, dy: y))
    }

    /// Up in the history, settled: older rows may still be loading.
    private func scrollUp() {
        command("mid")
        _ = app.buttons["Jump to latest"].waitForExistence(timeout: 10)
        var last: (CGFloat, CGFloat)?
        var still = 0
        let deadline = Date().addingTimeInterval(10)
        while still < 3, Date() < deadline {
            Thread.sleep(forTimeInterval: 0.5)
            let scroll = transcript()
            let now = scroll.map { ($0.contentOffsetY, $0.contentHeight) }
            if let now, let last, abs(now.0 - last.0) < 0.5, abs(now.1 - last.1) < 0.5 { still += 1 } else { still = 0 }
            last = now
        }
    }

    /// A message in the middle of the transcript's view.
    private func visibleRow() -> String? {
        guard let snapshot = try? app.snapshot() else { return nil }
        var found: String?
        func walk(_ element: XCUIElementSnapshot) {
            if found == nil, element.elementType == .staticText, element.label.hasPrefix("Duo message"),
               (150..<450).contains(element.frame.midY) { found = element.label }
            element.children.forEach(walk)
        }
        walk(snapshot)
        return found
    }

    @discardableResult private func waitFor(_ timeout: TimeInterval = 4, _ condition: @escaping () -> Bool) -> Bool {
        let deadline = Date().addingTimeInterval(timeout)
        while Date() < deadline {
            if condition() { return true }
            Thread.sleep(forTimeInterval: 0.25)
        }
        return condition()
    }

    private func note(_ line: String) {
        steps.append(line)
        print("HEADER-STEP " + line)
    }

    private func finish() {
        failures.forEach { print("HEADER-FAIL " + $0) }
        XCTAssertEqual(failures, [], "\(layout):\n" + steps.joined(separator: "\n"))
    }

    private func pane() -> String { geometry()?.pane ?? "?" }

    /// The transcript: the tall scroll view with the most content.
    private func transcript() -> Scroll? {
        geometry()?.scrolls.filter { $0.height > 200 }.max { $0.contentHeight < $1.contentHeight }
    }

    private func geometry() -> Geometry? {
        command("layout")
        guard let value = app.windows.firstMatch.value as? String else { return nil }
        return try? JSONDecoder().decode(Geometry.self, from: Data(value.utf8))
    }

    private func command(_ path: String) { XCUIDevice.shared.system.open(URL(string: "bbstudio://qa-duo/" + path)!) }

    private struct Geometry: Decodable {
        let pane: String
        let scrolls: [Scroll]
    }
    fileprivate struct Scroll: Decodable {
        let height: CGFloat
        let contentHeight: CGFloat
        let contentOffsetY: CGFloat
        let adjustedTop: CGFloat
        var offset: CGFloat { contentOffsetY }
        /// The content at the top of what's visible, under the header (and a find bar).
        var firstVisible: CGFloat { contentOffsetY + adjustedTop }
    }
}
