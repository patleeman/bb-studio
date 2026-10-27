import XCTest

/// Patrick, Oct 27: "I can't seem to stay scrolled up. I scroll up, touch
/// something and it scrolls down." Taps never move the transcript: only a
/// send, the jump button or the pill go to the end.
///
/// Up a few screens with real flings (the momentum is what matters: rows
/// size themselves while it runs), then a tap on a message, on empty space,
/// on a tool row (which expands), on the composer (the keyboard comes up), a
/// message with the keyboard up (it goes), and the keyboard closed from the
/// app. After each, the transcript's offset is where it was, within 1 pt.
///
/// The old transcript by default; `TEST_RUNNER_TRANSCRIPT_V2=1` the new one.
@MainActor
final class TranscriptScrollHoldUITests: ServerIsolatedUITestCase {
    private let app = XCUIApplication()
    private var steps: [String] = []
    private var failures: [String] = []
    /// The old transcript moves 2 to 3 pt each time the keyboard goes up or
    /// down (its lazy stack lays out again); known, and kept visible.
    private var knownOldPathDrift: [String] = []
    private let newTranscript = ProcessInfo.processInfo.environment["TRANSCRIPT_V2"] != nil

    private var composerField: XCUIElement {
        app.textViews.matching(NSPredicate(format: "label BEGINSWITH 'Message'")).firstMatch
    }
    private var composer: XCUIElement { app.otherElements["threadComposer"].firstMatch }

    func testTapsNeverMoveTheTranscript() {
        // A long chat whose rows size themselves as a fling brings them in.
        // The served demo (as the other chat tests use), with a long history.
        app.launchArguments = ["-skipPushPrompt", "YES", "-qaScrollLog", "-qaBotDemo", "chat", "-qaDemoLatency", "300",
                               "-qaDemoColdCache", "-qaDemoMessages", "300", "-qaDark", "-openURL", "bbstudio://bot"]
        app.launchOffline()
        XCTAssertTrue(composerField.waitForExistence(timeout: 30))
        command("draft?0")
        Thread.sleep(forTimeInterval: 2)

        // Up from the end with a fling, stopped by a touch while it still
        // runs: what a reader does to land somewhere. A touch that stops a
        // fling ends it without "decelerating ended" or "dragging ended".
        transcriptPoint(y: 0.35).press(forDuration: 0.01, thenDragTo: transcriptPoint(y: 0.75), withVelocity: .fast, thenHoldForDuration: 0)
        transcriptPoint(y: 0.5, x: 6).tap()
        guard var last = hold("a fling stopped by a touch", from: nil) else { return finish() }
        if last.distanceToEnd < 300 { failures.append(String(format: "a fling stopped by a touch: back at the end (%.0f pt from it)", last.distanceToEnd)) }
        // Then a few more screens, flung to rest.
        for _ in 0..<2 { transcriptPoint(y: 0.35).press(forDuration: 0.01, thenDragTo: transcriptPoint(y: 0.75), withVelocity: .fast, thenHoldForDuration: 0) }
        Thread.sleep(forTimeInterval: 3)
        last = hold("flung up a few screens", from: nil) ?? last
        if last.distanceToEnd < 400 { failures.append(String(format: "the flings didn't leave the end (%.0f pt from it)", last.distanceToEnd)) }
        // Stopped by a touch again, this far up.
        transcriptPoint(y: 0.35).press(forDuration: 0.01, thenDragTo: transcriptPoint(y: 0.75), withVelocity: .fast, thenHoldForDuration: 0)
        transcriptPoint(y: 0.5, x: 6).tap()
        Thread.sleep(forTimeInterval: 1)
        last = hold("stopped again", from: nil) ?? last
        if last.distanceToEnd < 400 { failures.append(String(format: "stopped again: back at the end (%.0f pt from it)", last.distanceToEnd)) }

        // A message.
        if let text = visibleText() { text.tap() } else { failures.append("no message on screen") }
        last = hold("a tap on a message", from: last) ?? last

        // Empty space: the leading margin beside a reply.
        transcriptPoint(y: 0.45, x: 6).tap()
        last = hold("a tap on empty space", from: last) ?? last

        // A tool row expands below what the reader is looking at.
        let tool = app.buttons.matching(NSPredicate(format: "label BEGINSWITH 'Worked' OR label BEGINSWITH 'Thought'")).allElementsBoundByIndex
            .first { $0.isHittable && $0.frame.minY > 140 && $0.frame.maxY < composer.frame.minY }
        if let tool { tool.tap(); last = hold("a tool row expanded", from: last) ?? last } else { steps.append("no tool row on screen") }

        // The composer: the keyboard comes up.
        composerField.tap()
        _ = app.keyboards.firstMatch.waitForExistence(timeout: 5)
        last = hold("a tap on the composer (keyboard up)", from: last) ?? last

        // A message with the keyboard up: the keyboard goes.
        if let text = visibleText() { text.tap() }
        last = hold("a tap on a message (keyboard closes)", from: last) ?? last

        // Up again, the keyboard closed by the app rather than a tap.
        composerField.tap()
        _ = app.keyboards.firstMatch.waitForExistence(timeout: 5)
        last = hold("keyboard up again", from: last) ?? last
        command("dismiss")
        _ = hold("the keyboard closed", from: last)
        finish()
    }

    // MARK: - Harness

    /// Waits for the transcript to settle, then checks it didn't move.
    @discardableResult private func hold(_ step: String, from before: Scroll?) -> Scroll? {
        Thread.sleep(forTimeInterval: 2.5)
        guard let now = transcript() else {
            failures.append("\(step): no transcript")
            return nil
        }
        if let before {
            // Content above the reader can measure (estimates settling): the
            // offset may move by exactly that, so compare the distance to the
            // end's complement, the reader's place from the top of the content
            // being what changes on a jump.
            let moved = now.contentOffsetY - before.contentOffsetY
            let grew = now.contentHeight - before.contentHeight
            steps.append(String(format: "%@: offset %.1f -> %.1f (moved %.1f, content grew %.1f), %.0f pt from the end",
                                step, before.contentOffsetY, now.contentOffsetY, moved, grew, now.distanceToEnd))
            if abs(moved) > 1, abs(moved - grew) > 1 {
                let failure = String(format: "%@: the transcript moved %.1f pt (%.0f pt from the end now)", step, moved, now.distanceToEnd)
                if !newTranscript, step.contains("keyboard"), abs(moved) < 6 { knownOldPathDrift.append(failure) } else { failures.append(failure) }
            }
        } else {
            steps.append(String(format: "%@: offset %.1f, %.0f pt from the end", step, now.contentOffsetY, now.distanceToEnd))
        }
        return now
    }

    /// Text in a row, clear of the jump button (which does jump), tapped
    /// at its centre.
    private func visibleText() -> XCUIElement? {
        let jump = [app.buttons["jumpToLatest"], app.buttons["Jump to latest"]].filter(\.exists).map { $0.frame.insetBy(dx: -12, dy: -12) }
        let text = app.staticTexts.allElementsBoundByIndex.first { element in
            element.isHittable && element.frame.minY > 160 && element.frame.maxY < composer.frame.minY - 80
                && element.frame.height > 14 && element.label.count > 12
                && !jump.contains { $0.contains(CGPoint(x: element.frame.midX, y: element.frame.midY)) }
        }
        if let text { steps.append("tapping '\(text.label.prefix(40))' at \(Int(text.frame.midX)),\(Int(text.frame.midY))") }
        return text
    }

    private func transcriptPoint(y: CGFloat, x: CGFloat? = nil) -> XCUICoordinate {
        let frame = app.windows.firstMatch.frame
        return app.coordinate(withNormalizedOffset: .zero).withOffset(CGVector(dx: x ?? frame.width / 2, dy: frame.height * y))
    }

    private func finish() {
        print("HOLD-SUMMARY\n" + steps.joined(separator: "\n"))
        XCTAssertEqual(failures, [], steps.joined(separator: "\n"))
        if !knownOldPathDrift.isEmpty {
            XCTExpectFailure("The old transcript moves 2 to 3 pt when the keyboard goes up or down", strict: false) {
                XCTAssertEqual(knownOldPathDrift, [])
            }
        }
    }

    private func transcript() -> Scroll? {
        command("layout")
        guard let value = app.windows.firstMatch.value as? String,
              let geometry = try? JSONDecoder().decode(Geometry.self, from: Data(value.utf8)) else { return nil }
        return geometry.scrolls.filter { $0.height > 200 && $0.contentHeight > 0 }.max { $0.width * $0.height < $1.width * $1.height }
    }

    private func command(_ path: String) { XCUIDevice.shared.system.open(URL(string: "bbstudio://qa-duo/" + path)!) }

    private struct Geometry: Decodable { let scrolls: [Scroll] }
    fileprivate struct Scroll: Decodable {
        let height: CGFloat
        let width: CGFloat
        let contentHeight: CGFloat
        let contentOffsetY: CGFloat
        let adjustedBottom: CGFloat
        /// How far the end of the content is below what the reader sees.
        var distanceToEnd: CGFloat { contentHeight - (contentOffsetY + height - adjustedBottom) }
    }
}
