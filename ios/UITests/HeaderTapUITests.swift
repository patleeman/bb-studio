import XCTest

/// Patrick, Oct 26, Duo inner screen: "if you click on the button to expand
/// the sidebar it just scrolls up", then "All the buttons on top of the
/// screen cause scrolling up." Each header button gets a real tap, at its
/// centre and near its top edge, in the status-bar tap strip. It must do
/// what it says, and the transcript under the header keeps its place.
///
/// `TEST_RUNNER_HEADER_LAYOUT`: `inner` (the default: the Duo's inner screen,
/// 951 × 669, the room's two pages), `outer` (the Duo's outer screen), both on
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

    /// The conversation's ⋯, in the room's header (the folded Duo's side column).
    func testConversationHeader() throws {
        launch(bot: true)
        let more = app.conversationMore
        // Round 5: the title opens the Workspace (a sheet; the right screen on the unfolded Duo).
        let strip = app.descendants(matching: .any)["workspaceStrip"].firstMatch
        check("conversation: title", more, opened: { strip.exists },
              close: {
                  let done = self.app.buttons["workspaceDone"]
                  if done.exists { done.tap() } else if self.app.buttons["roomList"].exists { self.app.buttons["roomList"].firstMatch.tap() }
              },
              // On the unfolded Duo the title moves the conversation left and shows the Workspace: the screen rearranges by design.
              keepsTranscript: layout == "phone")
        finish()
    }

    // MARK: - Checks

    /// Near a button's top edge: 4 points into it. (The room's header starts
    /// under the status bar, whose tap strip scrolls to the top as on any iPhone.)
    private func topEdge(_ frame: CGRect) -> CGFloat { frame.minY - app.frame.minY + 4 }

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
            let row = keepsTranscript ? anchor() : nil
            let frame = button.frame
            tap(button, top: top)
            let did = waitFor(4, opened)
            let during = transcript()
            let rowDuring = row.flatMap { onScreen($0.label) }
            close()
            Thread.sleep(forTimeInterval: 2)
            if app.otherElements["PopoverDismissRegion"].exists { failures.append("\(name) \(place): a menu is open after closing") }
            let after = transcript()
            let rowAfter = row.flatMap { onScreen($0.label) }
            if !did { add(XCTAttachment(screenshot: XCUIScreen.main.screenshot())) }
            note(String(format: "%@ %@ (button %.0f,%.0f-%.0f): opened %@, first visible %.0f -> %.0f -> %.0f", name, place, frame.minX - app.frame.minX, frame.minY, frame.maxY,
                        did ? "yes" : "no", before?.firstVisible ?? .nan, during?.firstVisible ?? .nan, after?.firstVisible ?? .nan))
            if !did { failures.append("\(name) \(place): didn't open") }
            guard keepsTranscript, let before else { continue }
            // B16: what counts is the text on screen. The content offset changes
            // while rows above measure in, with nothing moving where you look.
            if let row {
                for (when, y) in [("while open", rowDuring), ("after", rowAfter)] {
                    // A find bar pushes the top down by its height at most; a scroll moves the row far more.
                    if let y, abs(y - row.y) > 60 {
                        failures.append(String(format: "%@ %@: the transcript moved %@ (\"%@\" %.0f -> %.0f)", name, place, when, row.label, row.y, y))
                    } else if y == nil, when == "after" {
                        failures.append("\(name) \(place): the transcript moved after (\"\(row.label)\" left the screen)")
                    }
                }
                continue
            }
            for (when, scroll) in [("while open", during), ("after", after)] {
                // A find bar's inset rounds by a point; a scroll moves far more.
                if let scroll, abs(scroll.firstVisible - before.firstVisible) > 2 {
                    failures.append(String(format: "%@ %@: the transcript moved %@ (%.0f -> %.0f)", name, place, when, before.firstVisible, scroll.firstVisible))
                }
            }
        }
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

    // MARK: - Harness

    /// `bot`: the Bot's chat, which on an iPhone is the `chat` demo (the Duo
    /// one opens on the Bots list there).
    private func launch(bot: Bool = false) {
        let variant = bot && layout == "phone" ? "chat" : "duo"
        app.launchArguments = ["-skipPushPrompt", "YES", "-qaBotDemo", variant, "-qaDuoWideTitles",
                               "-qaDark", "-openURL", "bbstudio://bot"]
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
        Thread.sleep(forTimeInterval: 1)
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

    /// The transcript: the tall scroll view with the most content.
    /// A message's text in the middle of the screen, to see whether the transcript scrolled.
    private func anchor() -> (label: String, y: CGFloat)? {
        let screen = app.frame
        for text in app.staticTexts.allElementsBoundByIndex.prefix(80) where text.exists {
            let frame = text.frame
            let label = text.label
            guard label.count > 12, frame.minY > screen.minY + 160, frame.maxY < screen.maxY - 200,
                  app.staticTexts.matching(NSPredicate(format: "label == %@", label)).count == 1 else { continue }
            return (label, frame.minY)
        }
        return nil
    }

    private func onScreen(_ label: String) -> CGFloat? {
        let text = app.staticTexts.matching(NSPredicate(format: "label == %@", label)).firstMatch
        return text.exists ? text.frame.minY : nil
    }

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
