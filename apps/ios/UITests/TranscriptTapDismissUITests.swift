import XCTest

/// Patrick, Oct 26: a tap anywhere in the chat's transcript closes the
/// keyboard. Taps on links and buttons in it still do what they did, the draft
/// and its photo stay, and the transcript doesn't jump: at the end it stays at
/// the end, with nothing past it; scrolled up, the same rows stay in view.
///
/// Runs on a phone. With `TEST_RUNNER_TAP_LAYOUT=outer`, on the Duo's outer
/// screen (466x678); with `split`, in the right page of the Duo's inner
/// screen (951x669, shifted so that page is on the simulator's screen). Both
/// on an iPhone Duo simulator.
/// `TEST_RUNNER_TAP_SHOTS=<dir>` saves screenshots.
@MainActor
final class TranscriptTapDismissUITests: XCTestCase {
    private let app = XCUIApplication()
    private let layout = ProcessInfo.processInfo.environment["TAP_LAYOUT"] ?? "phone"
    private var steps: [String] = []
    private var failures: [String] = []

    private var composerField: XCUIElement {
        app.textViews.matching(NSPredicate(format: "label BEGINSWITH 'Message'")).firstMatch
    }
    private var composer: XCUIElement { app.otherElements["threadComposer"].firstMatch }
    private var attachment: XCUIElement { app.buttons["Remove attachment"].firstMatch }

    /// At the end: a tap on a message, then on the space beside it, closes
    /// the keyboard; the chat stays at its end and the draft and photo stay.
    /// A swipe down still closes it. Scrolled up, a tap closes it and the
    /// reading position holds.
    func testTappingTheTranscriptClosesTheKeyboard() {
        open()
        command("say?Tap%20test%20reply.")
        let reply = app.staticTexts.matching(NSPredicate(format: "label CONTAINS 'Tap test reply.'")).firstMatch
        XCTAssertTrue(reply.waitForExistence(timeout: 10), "The Bot's reply is on screen")
        expectAtRest("the reply is in")
        attach()

        composerField.tap()
        composerField.typeText("Keep this draft")
        expectKeyboard(true, "keyboard up")
        expectAtEnd("keyboard up")
        shot("1-keyboard-up")
        reply.tap()
        expectKeyboard(false, "tap on a message")
        watch("tap on a message closed it", atEnd: true)
        expectDraft("tap on a message")
        shot("2-tapped-message")

        composerField.tap()
        expectKeyboard(true, "keyboard up 2")
        expectAtEnd("keyboard up 2")
        // Just above the composer, at its trailing edge: beside the newest
        // reply, which is short and on the leading side.
        transcriptPoint(dx: composer.frame.maxX - 16, dy: composer.frame.minY - 24).tap()
        expectKeyboard(false, "tap beside a message")
        watch("tap beside a message closed it", atEnd: true)
        expectDraft("tap beside a message")
        shot("3-tapped-beside")

        composerField.tap()
        expectKeyboard(true, "keyboard up 3")
        let start = transcriptPoint(dx: composer.frame.midX, dy: composer.frame.minY - 60)
        start.press(forDuration: 0.05, thenDragTo: start.withOffset(CGVector(dx: 0, dy: 300)))
        expectKeyboard(false, "swipe down")
        expectAtRest("swipe down closed it")
        expectDraft("swipe down")

        // Up in the history: the keyboard goes, the same rows stay in view.
        command("mid")
        XCTAssertTrue(app.buttons["Jump to latest"].waitForExistence(timeout: 10), "Scrolled up into the history")
        expectAtRest("reading older")
        composerField.tap()
        expectKeyboard(true, "keyboard up while reading")
        let before = record("keyboard up while reading")
        shot("4-reading-keyboard-up")
        // Over the rows' text, clear of the jump button in the trailing corner.
        transcriptPoint(dx: composer.frame.minX + composer.frame.width * 0.4, dy: (composer.frame.minY + headerBottom) / 2).tap()
        expectKeyboard(false, "tap while reading")
        let after = watch("tap while reading closed it", atEnd: false)
        if let before, let after {
            let moved = after.contentOffsetY - before.contentOffsetY
            steps.append(String(format: "reading position moved %.1f pt", moved))
            if abs(moved) > 2 { failures.append(String(format: "tap while reading: the rows moved %.1f pt", moved)) }
        }
        expectDraft("tap while reading")
        shot("5-reading-tapped")
        finish()
    }

    /// With the keyboard up, a tap on a control in the transcript does what
    /// it does, the first time: a code block's Copy button, a web link and an
    /// in-app thread link. One short reply holds all three, so they fit above
    /// the keyboard on the Duo's outer screen (176 points of chat).
    func testLinksAndButtonsStillWorkWithTheKeyboardUp() {
        open()
        // The demo has older code blocks; the new one is the lowest Copy.
        let copies = app.buttons.matching(NSPredicate(format: "label == 'Copy'"))
        let web = app.links["Release brief"].firstMatch
        for _ in 0..<3 where !web.exists {
            command("say?See%20%5BRelease%20brief%5D(https%3A%2F%2Fexample.com%2Fbrief)%20and%20%5BReview%20open%20PRs%5D(bbstudio%3A%2F%2Fthread%2Fthr_reviewprs1).%0A%0A%60%60%60sh%0Amake%20release%0A%60%60%60")
            _ = web.waitForExistence(timeout: 5)
        }
        XCTAssertTrue(web.exists, "The reply with code and links is on screen")
        // The quick replies go with the new reply, and the composer moves down.
        expectAtRest("the reply is in")

        composerField.tap()
        expectKeyboard(true, "keyboard up for Copy")
        expectAtEnd("keyboard up, the reply at the bottom")
        // Rows above may have unloaded as the keyboard rose.
        let copy = copies.allElementsBoundByIndex.max { $0.frame.minY < $1.frame.minY }
        XCTAssertNotNil(copy)
        copy?.tap()
        XCTAssertTrue(app.buttons["Copied"].firstMatch.waitForExistence(timeout: 3), "Copy fired on the first tap")
        expectKeyboard(false, "tap on Copy")
        watch("tap on Copy closed it", atEnd: true)
        shot("6-copy")

        composerField.tap()
        expectKeyboard(true, "keyboard up for the web link")
        expectAtEnd("keyboard up for the web link")
        web.tap()
        let safari = XCUIApplication(bundleIdentifier: "com.apple.mobilesafari")
        XCTAssertTrue(safari.wait(for: .runningForeground, timeout: 15), "The web link opened Safari on the first tap")
        app.activate()
        XCTAssertTrue(composerField.waitForExistence(timeout: 10))
        expectAtRest("back from Safari")

        composerField.tap()
        expectKeyboard(true, "keyboard up for the thread link")
        app.links["Review open PRs"].firstMatch.tap()
        XCTAssertTrue(app.textViews["Message"].firstMatch.waitForExistence(timeout: 10), "The thread link opened its thread on the first tap")
        shot("7-thread-link")
        finish()
    }

    // MARK: - Harness

    private func open() {
        app.launchArguments = ["-skipPushPrompt", "YES", "-serverURL", "http://127.0.0.1:9", "-qaScrollLog",
            "-qaBotDemo", layout == "phone" ? "chat" : "duo", "-qaDemoLatency", "300", "-qaDemoColdCache", "-qaDark",
            "-openURL", "bbstudio://bot"]
        switch layout {
        case "outer": app.launchArguments += ["-qaDuoPhone", "-qaDuoLong"]
        case "split": app.launchArguments += ["-qaDuoPhone", "-qaDuoColdWide"]
        default: break
        }
        app.launch()
        XCTAssertTrue(composerField.waitForExistence(timeout: 30))
        if layout == "outer" { command("outer") }
        if layout == "split" {
            // The chat is in the right page, brought onto the screen.
            command("split-right")
            let right = NSPredicate { _, _ in (0..<200).contains(self.composer.frame.minX) }
            expectation(for: right, evaluatedWith: nil)
            waitForExpectations(timeout: 10) { _ in }
        }
        // A draft saved by an earlier run stays with the thread; start empty.
        command("draft?0")
        expectAtRest("open")
    }

    /// A photo in the composer, as if picked from the library.
    private func attach() {
        for _ in 0..<3 where !attachment.exists {
            command("attach")
            _ = attachment.waitForExistence(timeout: 5)
        }
        XCTAssertTrue(attachment.exists, "The photo reached the composer")
    }

    private func expectDraft(_ step: String) {
        let text = composerField.value as? String ?? ""
        if !text.contains("Keep this draft") { failures.append("\(step): the draft is gone (\(text))") }
        if !attachment.exists { failures.append("\(step): the photo is gone") }
    }

    private func expectKeyboard(_ shown: Bool, _ step: String) {
        let keyboard = app.keyboards.firstMatch
        expectation(for: NSPredicate { _, _ in keyboard.exists == shown }, evaluatedWith: nil)
        waitForExpectations(timeout: 5) { _ in }
        if keyboard.exists != shown { failures.append("\(step): keyboard \(shown ? "not up" : "still up")") }
    }

    /// The bottom of the floating header, or the window's top.
    private var headerBottom: CGFloat {
        guard let scroll = transcript() else { return 100 }
        return scroll.y + scroll.adjustedTop
    }

    /// A point on the screen: the app's origin is its window's, which
    /// `split-right` moves off the screen's leading edge.
    private func transcriptPoint(dx: CGFloat, dy: CGFloat) -> XCUICoordinate {
        let origin = app.frame.origin
        return app.coordinate(withNormalizedOffset: .zero).withOffset(CGVector(dx: dx - origin.x, dy: dy - origin.y))
    }

    private func expectAtRest(_ step: String) {
        if (record(step)?.past ?? 0) > 1 { failures.append(step) }
    }

    private func expectAtEnd(_ step: String) {
        let past = record(step)?.past ?? 0
        if past > 1 || past < -40 { failures.append(step) }
    }

    /// While the keyboard goes: fails if the chat the reader sees is ever
    /// wholly blank, or if it settles past its end (or, `atEnd`, short of it).
    @discardableResult private func watch(_ step: String, atEnd: Bool, seconds: Double = 3) -> Scroll? {
        var samples: [String] = []
        var blank = 0
        var settled: Scroll?
        let end = Date().addingTimeInterval(seconds)
        repeat {
            if let scroll = transcript() {
                if scroll.past >= scroll.height - scroll.adjustedTop - scroll.adjustedBottom { blank += 1 }
                samples.append(String(format: "%.0f", scroll.past))
                settled = scroll
            }
            Thread.sleep(forTimeInterval: 0.1)
        } while Date() < end
        let past = settled?.past ?? .nan
        let line = String(format: "%@: settled=%.1f offset=%.1f insets=%.1f/%.1f blank=%d past samples=%@", step, past,
            settled?.contentOffsetY ?? .nan, settled?.adjustedTop ?? .nan, settled?.adjustedBottom ?? .nan, blank,
            samples.joined(separator: ","))
        steps.append(line)
        print("TAP-STEP " + line)
        if blank > 0 || past > 1 || (atEnd && past < -40) { failures.append(step) }
        return settled
    }

    /// Samples for a while after a step; returns where it settled.
    @discardableResult private func record(_ step: String, seconds: Double = 2.5) -> Scroll? {
        var settled: Scroll?
        let end = Date().addingTimeInterval(seconds)
        repeat {
            if let scroll = transcript() { settled = scroll }
            Thread.sleep(forTimeInterval: 0.25)
        } while Date() < end
        let line = String(format: "%@: settled=%.1f offset=%.1f content=%.1f insets=%.1f/%.1f", step,
            settled?.past ?? .nan, settled?.contentOffsetY ?? .nan, settled?.contentHeight ?? .nan,
            settled?.adjustedTop ?? .nan, settled?.adjustedBottom ?? .nan)
        steps.append(line)
        print("TAP-STEP " + line)
        return settled
    }

    private func finish() {
        print("TAP-SUMMARY \(layout)\n" + steps.joined(separator: "\n"))
        XCTAssertEqual(failures, [], "\(layout):\n" + steps.joined(separator: "\n"))
    }

    /// The transcript's scroll view: the largest one under the composer.
    private func transcript() -> Scroll? {
        // In window coordinates: `split-right` moves the window 476 points left.
        let mid = composer.exists ? composer.frame.midX + (layout == "split" ? 476 : 0) : nil
        command("layout")
        guard let value = app.windows.firstMatch.value as? String,
              let geometry = try? JSONDecoder().decode(Geometry.self, from: Data(value.utf8)) else { return nil }
        return geometry.scrolls.filter { scroll in
            scroll.height > 200 && scroll.contentHeight > 0 && (mid.map { scroll.x <= $0 && $0 <= scroll.x + scroll.width } ?? true)
        }.max { $0.width * $0.height < $1.width * $1.height }
    }

    private func shot(_ name: String) {
        guard let dir = ProcessInfo.processInfo.environment["TAP_SHOTS"] else { return }
        try? XCUIScreen.main.screenshot().pngRepresentation
            .write(to: URL(fileURLWithPath: dir).appending(path: "\(layout)-\(name).png"))
    }

    private func command(_ path: String) { XCUIDevice.shared.system.open(URL(string: "bbstudio://qa-duo/" + path)!) }

    private struct Geometry: Decodable { let scrolls: [Scroll] }
    fileprivate struct Scroll: Decodable {
        let x: CGFloat
        let y: CGFloat
        let width: CGFloat
        let height: CGFloat
        let contentHeight: CGFloat
        let contentOffsetY: CGFloat
        let adjustedBottom: CGFloat
        let adjustedTop: CGFloat
        /// How far the unobscured bottom of the viewport is below the content's end.
        var past: CGFloat { contentOffsetY + height - adjustedBottom - contentHeight }
    }
}
