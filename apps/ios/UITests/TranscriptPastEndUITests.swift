import XCTest

/// The Bot chat must never come to rest scrolled past its last row: black
/// above the composer, the indicator at the bottom. Each step reads the live
/// UIScrollView (`qa-duo/layout`) for a few seconds and fails if, once
/// settled, the bottom of what the reader sees (above the composer and
/// keyboard) is below the content's end. See docs/ios/scroll-root-cause.md.
///
/// Runs on a phone; with `TEST_RUNNER_SCROLL_DUO=1`, on the Duo's outer
/// screen (466x678). `TEST_RUNNER_SCROLL_SHOTS=<dir>` saves screenshots.
@MainActor
final class TranscriptPastEndUITests: XCTestCase {
    private let app = XCUIApplication()
    private let duo = ProcessInfo.processInfo.environment["SCROLL_DUO"] != nil
    private var steps: [String] = []
    private var failures: [String] = []

    /// Closing the keyboard at the bottom shrinks the bottom inset by the
    /// keyboard's height. The offset stayed, leaving that much black.
    func testClosingTheKeyboardAtTheBottomLeavesNoBlank() {
        let composer = open()
        for round in 0..<3 {
            composer.tap()
            // At the bottom, the newest row rides up with the keyboard.
            if record("r\(round) keyboard up") < -40 { failures.append("r\(round) keyboard up hides the newest row") }
            composer.typeText("Round \(round)")
            app.buttons["Send"].firstMatch.tap()
            record("r\(round) sent")
            Thread.sleep(forTimeInterval: 3)
            expectAtRest("r\(round) reply")
            command("dismiss")
            expectAtRest("r\(round) keyboard closed")
            shot("keyboard-closed-\(round)")
        }
        finish()
    }

    /// Patrick, Oct 24 10:22 PM: black right after sending with the keyboard
    /// open. Send with the keyboard up; the user row goes in, the reply
    /// streams in over several updates, then the keyboard closes. Throughout,
    /// the chat's end stays at the bottom of what the reader sees: never
    /// resting past it, and not left below the composer.
    func testSendingWithTheKeyboardOpenFollowsTheStreamingReply() {
        let composer = open(stream: true)
        for round in 0..<2 {
            composer.tap()
            expectAtEnd("r\(round) keyboard up")
            composer.typeText("Plan the release \(round)")
            app.buttons["Send"].firstMatch.tap()
            // The reply starts 3 s after the send and streams for about 4 s.
            watchStream("r\(round) send and stream", seconds: 9)
            expectAtEnd("r\(round) streamed")
            shot("streamed-keyboard-open-\(round)")
            command("dismiss")
            expectAtEnd("r\(round) keyboard closed")
        }
        composer.tap()
        expectAtEnd("keyboard up for a reply from elsewhere")
        command("stream?From%20the%20web")
        watchStream("elsewhere: user row and stream", seconds: 7)
        expectAtEnd("elsewhere: streamed")
        finish()
    }

    /// Patrick: back from the Bot chat to the Bots list, tap the Bot again,
    /// and the chat opens scrolled into black. Reopen several times, also
    /// after rows came in while away (a short reply, a streamed one, and more
    /// than a page), and the chat must open at its newest row.
    func testReopeningTheChatOpensAtTheNewestRow() {
        _ = open(stream: true)
        let away: [(String, String?)] = [("plain", nil), ("again", nil), ("reply while away", "stream?While%20away"),
                                         ("burst while away", "burst?40"), ("after burst", nil)]
        for (name, change) in away {
            let back = app.buttons["Bots"].firstMatch
            XCTAssertTrue(back.waitForExistence(timeout: 10), "No way back to the Bots list")
            back.tap()
            let row = app.buttons.matching(NSPredicate(format: "label CONTAINS 'Juniper'")).firstMatch
            XCTAssertTrue(row.waitForExistence(timeout: 10), "The Bots list has no Juniper row")
            if let change {
                command(change)
                Thread.sleep(forTimeInterval: 6)
            }
            row.tap()
            XCTAssertTrue(app.textViews.matching(NSPredicate(format: "label BEGINSWITH 'Message'")).firstMatch.waitForExistence(timeout: 10))
            watchStream("reopen \(name): opening", seconds: 3)
            expectAtEnd("reopen \(name)")
            shot("reopen-\(name.replacingOccurrences(of: " ", with: "-"))")
        }
        finish()
    }

    /// Patrick, Oct 25, on the Duo's outer screen: send, the reply streams
    /// in, back to the Bots list, reopen: black between the header and an
    /// empty composer until the composer is tapped. Not with a draft in the
    /// composer. Each round sends with the keyboard up, waits for the reply,
    /// and goes back with the keyboard still up or closed; the finished reply
    /// offers quick replies, which show only while the composer is empty.
    func testReopeningAfterAReplyWithAnEmptyComposerLeavesNoBlank() {
        let composer = open(stream: true, next: true)
        for (round, keyboard) in [(0, true), (1, false), (2, true)] {
            // The Duo's outer window is wider than the simulator's screen, and
            // Send is off it: there the message comes in as if sent from here.
            composer.tap()
            if duo {
                command("stream?Plan%20the%20release%20\(round)")
            } else {
                composer.typeText("Plan the release \(round)")
                app.buttons["Send"].firstMatch.tap()
            }
            Thread.sleep(forTimeInterval: 9)
            if !keyboard { command("dismiss") }
            record("r\(round) replied, keyboard \(keyboard ? "up" : "closed")")
            let back = app.buttons["Bots"].firstMatch
            XCTAssertTrue(back.waitForExistence(timeout: 10), "No way back to the Bots list")
            back.tap()
            let row = app.buttons.matching(NSPredicate(format: "label CONTAINS 'Juniper'")).firstMatch
            XCTAssertTrue(row.waitForExistence(timeout: 10), "The Bots list has no Juniper row")
            Thread.sleep(forTimeInterval: 1)
            row.tap()
            XCTAssertTrue(composer.waitForExistence(timeout: 10))
            watchStream("r\(round) reopened", seconds: 3)
            expectAtEnd("r\(round) reopened at rest")
            shot("reopen-empty-\(round)")
        }
        finish()
    }

    /// More rows than a page come in at once (a long turn while away): the
    /// newest page replaces the rows and the content shrinks under the offset.
    func testRowsReplacedUnderTheReaderLeaveNoBlank() {
        _ = open()
        for _ in 0..<3 { app.swipeDown(velocity: .fast) }
        record("scrolled up")
        command("bottom")
        expectAtRest("back at bottom")
        command("burst?40")
        expectAtRest("burst", seconds: 5)
        shot("burst")
        finish()
    }

    /// Folding and unfolding restores the reading position; it must never
    /// leave the transcript past its end.
    func testFoldingNeverLeavesThePastEnd() throws {
        try XCTSkipUnless(duo, "Duo only")
        _ = open()
        for cycle in 0..<4 {
            for size in ["landscape", "outer"] {
                command(size)
                expectAtRest("cycle \(cycle) \(size)", seconds: 4)
            }
            if cycle == 1 {
                for _ in 0..<2 { app.swipeDown(velocity: .fast) }
                record("scrolled up")
            }
        }
        shot("folded")
        finish()
    }

    private func open(stream: Bool = false, next: Bool = false) -> XCUIElement {
        app.launchArguments = ["-skipPushPrompt", "YES", "-serverURL", "http://127.0.0.1:9", "-qaScrollLog",
            "-qaBotDemo", duo ? "duo" : "chat", "-qaDemoLatency", "300", "-qaDemoColdCache", "-qaDark", "-openURL", "bbstudio://bot"]
        if stream { app.launchArguments.append("-qaDemoStream") }
        if next { app.launchArguments.append("-qaDemoNext") }
        if duo { app.launchArguments += ["-qaDuoPhone", "-qaDuoLong"] }
        app.launch()
        let composer = app.textViews.matching(NSPredicate(format: "label BEGINSWITH 'Message'")).firstMatch
        XCTAssertTrue(composer.waitForExistence(timeout: 30))
        if duo { command("outer") }
        expectAtRest("open")
        return composer
    }

    private func expectAtRest(_ step: String, seconds: Double = 3) {
        if record(step, seconds: seconds) > 1 { failures.append(step) }
    }

    /// At rest with the chat's last row at the bottom of what the reader
    /// sees: not past it (blank), and not short of it (the newest row
    /// hidden under the composer or keyboard).
    private func expectAtEnd(_ step: String, seconds: Double = 3) {
        let past = record(step, seconds: seconds)
        if past > 1 || past < -40 { failures.append(step) }
    }

    /// While rows go in and grow: fails if the chat the reader sees is ever
    /// wholly blank (with the keyboard up the Duo shows only 168 pt, so any
    /// overshoot that large is a black screen, however short), or if the
    /// view stays off its end for more than a second.
    private func watchStream(_ step: String, seconds: Double) {
        var run = 0.0
        var longest = 0.0
        var blank = 0
        var samples: [String] = []
        let end = Date().addingTimeInterval(seconds)
        var last = Date()
        repeat {
            if let scroll = transcript() {
                let now = Date()
                let off = scroll.past > 1 || scroll.past < -120
                if scroll.past >= scroll.height - scroll.adjustedTop - scroll.adjustedBottom { blank += 1 }
                run = off ? run + now.timeIntervalSince(last) : 0
                longest = max(longest, run)
                last = now
                samples.append(String(format: "%.0f", scroll.past))
            }
            Thread.sleep(forTimeInterval: 0.1)
        } while Date() < end
        let line = String(format: "%@: blank samples=%d longest off-end run=%.1fs past samples=%@", step, blank, longest, samples.joined(separator: ","))
        steps.append(line)
        print("SCROLL-STEP " + line)
        if longest > 1 || blank > 0 { failures.append(step) }
    }

    private func finish() {
        print("SCROLL-SUMMARY\n" + steps.joined(separator: "\n"))
        XCTAssertEqual(failures, [], "The transcript came to rest past its last row:\n" + steps.joined(separator: "\n"))
    }

    /// Samples for a while after a step; returns how far past the end it settled.
    @discardableResult private func record(_ step: String, seconds: Double = 3) -> CGFloat {
        var worst = -CGFloat.infinity
        var settled: Scroll?
        let end = Date().addingTimeInterval(seconds)
        repeat {
            if let scroll = transcript() {
                worst = max(worst, scroll.past)
                settled = scroll
            }
            Thread.sleep(forTimeInterval: 0.25)
        } while Date() < end
        let line = String(format: "%@: settled=%.1f worst=%.1f offset=%.1f content=%.1f height=%.1f insets=%.1f/%.1f",
            step, settled?.past ?? .nan, worst, settled?.contentOffsetY ?? .nan, settled?.contentHeight ?? .nan,
            settled?.height ?? .nan, settled?.adjustedTop ?? .nan, settled?.adjustedBottom ?? .nan)
        steps.append(line)
        print("SCROLL-STEP " + line)
        return settled?.past ?? 0
    }

    private func transcript() -> Scroll? {
        command("layout")
        guard let value = app.windows.firstMatch.value as? String,
              let geometry = try? JSONDecoder().decode(Geometry.self, from: Data(value.utf8)) else { return nil }
        return geometry.scrolls.filter { $0.height > 200 && $0.contentHeight > 0 }
            .max { $0.width * $0.height < $1.width * $1.height }
    }

    private func shot(_ name: String) {
        guard let dir = ProcessInfo.processInfo.environment["SCROLL_SHOTS"] else { return }
        try? XCUIScreen.main.screenshot().pngRepresentation
            .write(to: URL(fileURLWithPath: dir).appending(path: "\(duo ? "duo" : "phone")-\(name).png"))
    }

    private func command(_ path: String) { XCUIDevice.shared.system.open(URL(string: "bbstudio://qa-duo/" + path)!) }

    private struct Geometry: Decodable { let scrolls: [Scroll] }
    private struct Scroll: Decodable {
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
