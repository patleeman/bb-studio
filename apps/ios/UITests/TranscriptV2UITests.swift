import XCTest

/// The new chat transcript (Settings ▸ Diagnostics ▸ New chat transcript,
/// `-qaTranscriptV2`) with the real composer and keyboard, offline on the
/// local Bot demo. In the Bot chat, a Bot thread and a normal thread, it
/// checks the rules the SwiftUI transcript broke:
///
/// - never past the end, and at the end while following, sampled through
///   sends, streaming, the keyboard, taps and swipes;
/// - up in the history, the rows stay put through the keyboard and new rows,
///   and the jump pill counts what came in;
/// - the composer's gap for the layout; the keyboard closes on a tap or a
///   swipe down; the draft and its photo stay.
///
/// `TEST_RUNNER_TRANSCRIPT_LAYOUT`: `phone` (default), `outer` (the Duo's
/// outer screen) or `split` (the inner screen's right page, two pages).
/// `TEST_RUNNER_TRANSCRIPT_SHOTS=<dir>` saves window renders.
@MainActor
final class TranscriptV2UITests: ServerIsolatedUITestCase {
    private let app = XCUIApplication()
    private let layout = ProcessInfo.processInfo.environment["TRANSCRIPT_LAYOUT"] ?? "phone"
    private var steps: [String] = []
    private var failures: [String] = []

    private var composerField: XCUIElement {
        app.textViews.matching(NSPredicate(format: "label BEGINSWITH 'Message'")).firstMatch
    }
    private var composer: XCUIElement { app.otherElements["threadComposer"].firstMatch }
    private var pill: XCUIElement { app.buttons["jumpToLatest"].firstMatch }
    private var attachment: XCUIElement { app.buttons["Remove attachment"].firstMatch }

    /// The Bot chat, end to end.
    func testBotChat() {
        open()
        checkChat("bot-chat")
        finish()
    }

    /// A Bot thread from its Running group, and a normal thread from the Threads list.
    func testThreads() {
        // Warm cache, as `DuoSplitComposerUITests`: the demo serves these threads from it.
        open(cold: false)
        let row = app.buttons.matching(NSPredicate(format: "label BEGINSWITH %@", "iOS: black on reopen")).firstMatch
        showList()
        if row.waitForExistence(timeout: 15) {
            row.tap()
            showRightPage()
            XCTAssertTrue(composer.waitForExistence(timeout: 15))
            expectAtEnd("bot thread: open")
            expectGap("bot thread")
            shot("bot-thread")
            command("mid")
            expectPill(true, "bot thread: up in the history")
            expectAtRest("bot thread: reading")
        } else {
            steps.append("no Running Bot thread in this layout")
        }
        showList()
        command("tab?threads")
        let conversation = app.buttons["inbox-thread-thr_botdemo01"]
        if conversation.waitForExistence(timeout: 15) {
            conversation.tap()
            showRightPage()
            XCTAssertTrue(composer.waitForExistence(timeout: 15))
            expectAtEnd("thread: open")
            expectGap("thread")
            shot("thread")
            command("mid")
            expectPill(true, "thread: up in the history")
            let before = record("thread: reading")
            pill.tap()
            expectPill(false, "thread: jumped")
            expectAtEnd("thread: jumped to latest")
            if let before, (record("thread: after jump")?.contentOffsetY ?? 0) <= before.contentOffsetY {
                failures.append("thread: the jump didn't move down")
            }
        } else {
            steps.append("no normal thread in this layout")
        }
        finish()
    }

    private func checkChat(_ name: String) {
        command("draft?0")
        expectAtEnd("\(name): open")
        expectGap(name)
        shot("\(name)-keyboard-down")

        // A reply comes in at the end, and streams.
        command("say?Transcript%20v2%20reply.")
        XCTAssertTrue(app.staticTexts.matching(NSPredicate(format: "label CONTAINS 'Transcript v2 reply.'")).firstMatch.waitForExistence(timeout: 10))
        watch("\(name): a reply came in", atEnd: true)
        attach()

        composerField.tap()
        composerField.typeText("Keep this draft")
        expectKeyboard(true, "\(name): keyboard up")
        watch("\(name): keyboard up", atEnd: true)
        expectComposerOverKeyboard(name)
        shot("\(name)-keyboard-up")
        command("stream?Streamed%20while%20typing")
        watch("\(name): a reply streams with the keyboard up", atEnd: true, seconds: 5)

        // A tap on the transcript closes the keyboard; the draft stays.
        transcriptPoint(dx: composer.frame.midX, dy: composer.frame.minY - 40).tap()
        expectKeyboard(false, "\(name): tap")
        watch("\(name): tap closed the keyboard", atEnd: true)
        expectDraft("\(name): tap")

        // A swipe down closes it too.
        composerField.tap()
        expectKeyboard(true, "\(name): keyboard up 2")
        let start = transcriptPoint(dx: composer.frame.midX, dy: composer.frame.minY - 60)
        start.press(forDuration: 0.05, thenDragTo: start.withOffset(CGVector(dx: 0, dy: 300)))
        expectKeyboard(false, "\(name): swipe down")
        watch("\(name): swipe down closed the keyboard", atEnd: false)
        expectDraft("\(name): swipe down")
        command("bottom")
        watch("\(name): back at the end", atEnd: true)

        // Up in the history: nothing moves the rows but the reader.
        command("mid")
        expectPill(true, "\(name): up in the history")
        let reading = record("\(name): reading")
        shot("\(name)-reading")
        command("burst?12")
        let afterBurst = record("\(name): a burst while reading")
        moved(from: reading, to: afterBurst, "\(name): a burst while reading")
        if !pill.label.contains("new") { failures.append("\(name): the pill doesn't count new rows (\(pill.label))") }
        composerField.tap()
        expectKeyboard(true, "\(name): keyboard up while reading")
        let keyboardUp = record("\(name): keyboard up while reading")
        moved(from: afterBurst, to: keyboardUp, "\(name): keyboard up while reading")
        shot("\(name)-reading-keyboard-up")
        command("dismiss")
        expectKeyboard(false, "\(name): keyboard down while reading")
        let keyboardDown = record("\(name): keyboard down while reading")
        moved(from: keyboardUp, to: keyboardDown, "\(name): keyboard down while reading")

        // The pill: back to the end, following again.
        pill.tap()
        expectPill(false, "\(name): jumped")
        watch("\(name): jumped to latest", atEnd: true)
        command("stream?After%20the%20jump")
        watch("\(name): a reply streams after the jump", atEnd: true, seconds: 5)
        command("draft?0")
    }

    // MARK: - Harness

    private func open(cold: Bool = true) {
        app.launchArguments = ["-skipPushPrompt", "YES", "-qaTranscriptV2", "-qaScrollLog",
            "-qaBotDemo", layout == "phone" ? "chat" : "duo", "-qaDark", "-openURL", "bbstudio://bot"]
            + (cold ? ["-qaDemoLatency", "300", "-qaDemoColdCache"] : [])
        switch layout {
        case "outer": app.launchArguments += ["-qaDuoPhone", "-qaDuoLong"]
        case "split": app.launchArguments += ["-qaDuoPhone", "-qaDuoColdWide", "-qaDuoWideTitles"]
        default: break
        }
        app.launchOffline()
        XCTAssertTrue(composerField.waitForExistence(timeout: 30))
        if layout == "outer" { command("outer") }
        showRightPage()
        Thread.sleep(forTimeInterval: 1)
    }

    /// The split's right page on the simulator's screen (it's only as wide as the outer one).
    private func showRightPage() {
        guard layout == "split" else { return }
        command("split-right")
        expectation(for: NSPredicate { _, _ in (0..<200).contains(self.composer.frame.minX) }, evaluatedWith: nil)
        waitForExpectations(timeout: 10) { _ in }
    }

    /// The split's left page, the list, back on the screen.
    private func showList() {
        guard layout == "split" else { return }
        command("landscape")
        Thread.sleep(forTimeInterval: 1)
    }

    private func attach() {
        for _ in 0..<3 where !attachment.exists {
            command("attach")
            _ = attachment.waitForExistence(timeout: 5)
        }
        if !attachment.exists { failures.append("the photo didn't reach the composer") }
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

    private func expectPill(_ shown: Bool, _ step: String) {
        expectation(for: NSPredicate { _, _ in self.pill.exists && self.pill.isHittable == shown || !self.pill.exists && !shown },
                    evaluatedWith: nil)
        waitForExpectations(timeout: 6) { _ in }
        let visible = pill.exists && pill.isHittable
        if visible != shown { failures.append("\(step): the pill is \(visible ? "shown" : "hidden")") }
    }

    /// The composer's resting gap: 8 pt over the home indicator (phone, outer
    /// screen), or 8 pt over the window's edge beside two pages.
    private func expectGap(_ step: String) {
        guard let geometry = window() else { return failures.append("\(step): no layout") }
        let below = geometry.height - composer.frame.maxY - (layout == "split" ? 0 : app.frame.minY)
        let expected: CGFloat = layout == "split" ? 8 : 8 + geometry.safeBottom
        steps.append(String(format: "%@: composer gap %.1f (expected %.1f, safe bottom %.1f)", step, below, expected, geometry.safeBottom))
        // A tab bar under the Bot chat on a phone holds the composer higher.
        if layout == "split" ? abs(below - expected) > 2 : below < expected - 2 {
            failures.append(String(format: "%@: composer gap %.1f, expected %.1f", step, below, expected))
        }
    }

    private func expectComposerOverKeyboard(_ step: String) {
        let keyboard = app.keyboards.firstMatch
        guard keyboard.exists else { return }
        // XCUITest's keyboard frame leaves out the 44 pt suggestion bar above
        // the keys: 8 pt above the keyboard reads as 52 here.
        let gap = keyboard.frame.minY - composer.frame.maxY
        steps.append(String(format: "%@: composer %.1f pt above the keys", step, gap))
        if gap < 7 || gap > 54 { failures.append(String(format: "%@: composer %.1f pt from the keys", step, gap)) }
    }

    private func moved(from before: Scroll?, to after: Scroll?, _ step: String) {
        guard let before, let after else { return failures.append("\(step): no geometry") }
        // The offset may move only by what went in above; here nothing does.
        let delta = after.contentOffsetY - before.contentOffsetY
        steps.append(String(format: "%@: offset moved %.1f", step, delta))
        if abs(delta) > 2 { failures.append(String(format: "%@: the rows moved %.1f pt", step, delta)) }
    }

    private func transcriptPoint(dx: CGFloat, dy: CGFloat) -> XCUICoordinate {
        let origin = app.frame.origin
        return app.coordinate(withNormalizedOffset: .zero).withOffset(CGVector(dx: dx - origin.x, dy: dy - origin.y))
    }

    private func expectAtRest(_ step: String) {
        if (record(step)?.past ?? 0) > 1 { failures.append("\(step): past the end") }
    }

    private func expectAtEnd(_ step: String) {
        let past = record(step)?.past ?? 0
        if past > 1 || past < -1 { failures.append(String(format: "%@: %.1f pt from the end", step, past)) }
    }

    /// Samples every 0.1 s: fails if the chat is ever past its end or wholly
    /// blank, or (`atEnd`) if it settles anywhere but its end.
    @discardableResult private func watch(_ step: String, atEnd: Bool, seconds: Double = 3) -> Scroll? {
        var samples: [String] = []
        var blank = 0
        var worst: CGFloat = -.infinity
        var settled: Scroll?
        let end = Date().addingTimeInterval(seconds)
        repeat {
            if let scroll = transcript() {
                if scroll.past >= scroll.height - scroll.adjustedTop - scroll.adjustedBottom - 1 { blank += 1 }
                worst = max(worst, scroll.past)
                samples.append(String(format: "%.0f", scroll.past))
                settled = scroll
            }
            Thread.sleep(forTimeInterval: 0.1)
        } while Date() < end
        let past = settled?.past ?? .nan
        let line = String(format: "%@: settled=%.1f worst=%.1f blank=%d samples=%@", step, past, worst, blank, samples.joined(separator: ","))
        steps.append(line)
        print("V2-STEP " + line)
        if blank > 0 { failures.append("\(step): \(blank) blank samples") }
        if worst > 1 { failures.append(String(format: "%@: %.1f pt past the end", step, worst)) }
        if atEnd, abs(past) > 1 { failures.append(String(format: "%@: settled %.1f pt from the end", step, past)) }
        return settled
    }

    @discardableResult private func record(_ step: String, seconds: Double = 2) -> Scroll? {
        var settled: Scroll?
        let end = Date().addingTimeInterval(seconds)
        repeat {
            if let scroll = transcript() {
                if scroll.past > 1 { failures.append(String(format: "%@: %.1f pt past the end", step, scroll.past)) }
                settled = scroll
            }
            Thread.sleep(forTimeInterval: 0.25)
        } while Date() < end
        let line = String(format: "%@: settled=%.1f offset=%.1f content=%.1f insets=%.1f/%.1f", step,
            settled?.past ?? .nan, settled?.contentOffsetY ?? .nan, settled?.contentHeight ?? .nan,
            settled?.adjustedTop ?? .nan, settled?.adjustedBottom ?? .nan)
        steps.append(line)
        print("V2-STEP " + line)
        return settled
    }

    private func finish() {
        print("V2-SUMMARY \(layout)\n" + steps.joined(separator: "\n"))
        XCTAssertEqual(failures, [], "\(layout):\n" + steps.joined(separator: "\n"))
    }

    private func window() -> Geometry? {
        command("layout")
        guard let value = app.windows.firstMatch.value as? String else { return nil }
        return try? JSONDecoder().decode(Geometry.self, from: Data(value.utf8))
    }

    /// The transcript: the largest scroll view over the composer.
    private func transcript() -> Scroll? {
        let mid = composer.exists ? composer.frame.midX + (layout == "split" ? 476 : 0) : nil
        return window()?.scrolls.filter { scroll in
            scroll.height > 200 && scroll.contentHeight > 0 && (mid.map { scroll.x <= $0 && $0 <= scroll.x + scroll.width } ?? true)
        }.max { $0.width * $0.height < $1.width * $1.height }
    }

    private func shot(_ name: String) {
        guard let dir = ProcessInfo.processInfo.environment["TRANSCRIPT_SHOTS"] else { return }
        command("capture?v2-\(layout)-\(name)")
        Thread.sleep(forTimeInterval: 0.5)
        try? XCUIScreen.main.screenshot().pngRepresentation
            .write(to: URL(fileURLWithPath: dir).appending(path: "screen-\(layout)-\(name).png"))
    }

    private func command(_ path: String) { XCUIDevice.shared.system.open(URL(string: "bbstudio://qa-duo/" + path)!) }

    private struct Geometry: Decodable {
        let width: CGFloat
        let height: CGFloat
        let safeBottom: CGFloat
        let scrolls: [Scroll]
    }

    fileprivate struct Scroll: Decodable {
        let x: CGFloat
        let y: CGFloat
        let width: CGFloat
        let height: CGFloat
        let contentHeight: CGFloat
        let contentOffsetY: CGFloat
        let adjustedBottom: CGFloat
        let adjustedTop: CGFloat
        /// How far the bottom of what the reader sees is below the content's end.
        var past: CGFloat {
            // A chat shorter than its view rests at the top: nothing past it.
            if contentHeight + adjustedTop + adjustedBottom <= height { return 0 }
            return contentOffsetY + height - adjustedBottom - contentHeight
        }
    }
}
