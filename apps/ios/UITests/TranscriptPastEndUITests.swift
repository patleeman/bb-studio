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

    private func open() -> XCUIElement {
        app.launchArguments = ["-skipPushPrompt", "YES", "-serverURL", "http://127.0.0.1:9", "-qaScrollLog",
            "-qaBotDemo", duo ? "duo" : "chat", "-qaDemoLatency", "300", "-qaDemoColdCache", "-qaDark", "-openURL", "bbstudio://bot"]
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
