import XCTest

/// Scrolling the Bot chat replayed in the Chief of Staff Bot's real shape
/// (`-qaReplayThread chief-of-staff`: its rows' kinds, order, lengths and
/// Markdown, all in lorem ipsum; see `ReplayThread`), idle and while a long
/// turn streams with commands between its paragraphs. The app's scroll log
/// (`ScrollLog`, written to a file here) gives each gesture's frames and any
/// offset jump the reader didn't make. Screens land in `/tmp/qa-replay-*.png`.
final class ReplayScrollUITests: XCTestCase {
    /// The longest frame allowed while scrolling: no hitch (time past the
    /// frame's 16.7ms) over 50ms. Before the fixes for stutter during
    /// streaming (Oct 2026), frames ran to 90ms mid-stream and 270ms flinging
    /// into older pages; after, to about 50 on an iPhone 16 Pro simulator.
    private static let longestFrameMs = 66.0
    /// Hitch time per second of scrolling (Apple counts under 5 good, over 10
    /// bad; a simulator runs noisier than a phone). Before: 141ms/s mid-stream,
    /// 46 flinging far up; after, about 13 for each and under 1 idle.
    private static let hitchRatio = 20.0

    private var log: URL!

    override func setUp() {
        continueAfterFailure = true
        // Kept for a look after a failure; each run starts it afresh.
        log = URL(fileURLWithPath: "/tmp/qa-replay-scroll-\(name.split(separator: " ").last?.dropLast() ?? "test").txt")
        try? FileManager.default.removeItem(at: log)
    }

    private func launch(chunkMs: Int = 120) -> XCUIApplication {
        let app = XCUIApplication()
        app.launchArguments += ["-skipPushPrompt", "YES", "-qaBotDemo", "chat", "-qaDemoLatency", "150", "-qaDemoPage", "34",
                                "-qaReplayThread", "chief-of-staff", "-qaReplayRepeat", "3", "-qaReplayInterval", "\(chunkMs)",
                                "-qaDemoColdCache", "-scrollDiagnostics", "YES", "-qaScrollLogFile", log.path,
                                "-openURL", "bbstudio://bot"]
        app.launch()
        return app
    }

    func testIdleScrollAndFlings() throws {
        let app = launch()
        let composer = app.textViews["Message Juniper"]
        XCTAssertTrue(composer.waitForExistence(timeout: 30), "the chat loaded")
        sleep(3)
        let chat = Chat(app, area: visibleRect(app, composer: composer))
        // Slow drags up into the history and back, then flings both ways.
        for _ in 0..<3 { chat.drag(up: false) }
        for _ in 0..<3 { chat.drag(up: true) }
        for _ in 0..<4 { chat.fling(up: false) }
        for _ in 0..<4 { chat.fling(up: true) }
        snapshot("idle")
        try check(app, composer: composer, gestures: 14)
    }

    /// Up through the many images, cards and long replies, far into older pages.
    func testFlingFarUpThroughHistory() throws {
        let app = launch()
        let composer = app.textViews["Message Juniper"]
        XCTAssertTrue(composer.waitForExistence(timeout: 30), "the chat loaded")
        sleep(3)
        let chat = Chat(app, area: visibleRect(app, composer: composer))
        for _ in 0..<16 { chat.fling(up: false) }
        snapshot("far-up")
        try check(app, composer: composer, gestures: 16)
        XCTAssertTrue(app.buttons["Jump to latest"].exists, "scrolled away from the end")
    }

    /// Right after a send, and on through the turn as it streams: commands
    /// with screens of output between parts of a long reply.
    func testScrollWhileTheReplyStreams() throws {
        let app = launch()
        let composer = app.textViews["Message Juniper"]
        XCTAssertTrue(composer.waitForExistence(timeout: 30), "the chat loaded")
        sleep(3)
        composer.tap()
        composer.typeText("Go")
        app.buttons["Send"].tap()
        // Keyboard down, so drags land on the chat, not its suggestions.
        app.navigationBars.firstMatch.coordinate(withNormalizedOffset: CGVector(dx: 0.5, dy: 0.5)).tap()
        let chat = Chat(app, area: visibleRect(app, composer: composer))
        // At once after the send.
        chat.drag(up: false)
        chat.drag(up: true)
        XCTAssertFalse(app.buttons["Send"].exists, "the turn runs")
        sleep(3)
        // Mid-stream: up a little, hold, and back down; then flings.
        for _ in 0..<2 {
            chat.drag(up: false)
            sleep(1)
            chat.drag(up: true)
        }
        chat.fling(up: false)
        snapshot("streaming-up")
        // The reader stays where they are while the reply streams below.
        let held = visibleTexts(app, composer: composer).first
        let top = held?.frame.minY
        sleep(2)
        if let held, let top, held.exists {
            XCTAssertEqual(held.frame.minY, top, accuracy: 8, "the chat holds still under the reader while it streams")
        }
        chat.fling(up: true)
        chat.fling(up: true)
        snapshot("streaming-down")
        try check(app, composer: composer, gestures: 8)
    }

    // MARK: Helpers

    /// Where gestures go: on the chat, above the composer and keyboard (the
    /// scroll view runs under them, so its own center can land on them).
    /// Worked out once, from the app's own coordinates: looking elements up
    /// before each gesture snapshots the app's whole accessibility tree,
    /// which is costly in a long chat and, mid-fling, shows up as dropped
    /// frames of the test's own making.
    private struct Chat {
        let low: XCUICoordinate
        let high: XCUICoordinate

        init(_ app: XCUIApplication, area: CGRect) {
            let origin = app.coordinate(withNormalizedOffset: .zero)
            low = origin.withOffset(CGVector(dx: area.midX, dy: area.maxY - area.height * 0.2))
            high = origin.withOffset(CGVector(dx: area.midX, dy: area.minY + area.height * 0.2))
        }

        /// A slow drag, then a moment to rest.
        func drag(up: Bool) {
            (up ? low : high).press(forDuration: 0.05, thenDragTo: up ? high : low, withVelocity: .slow, thenHoldForDuration: 0.1)
            usleep(600_000)
        }

        /// A fast flick, then long enough for its fling to come to rest.
        func fling(up: Bool) {
            (up ? low : high).press(forDuration: 0.01, thenDragTo: up ? high : low, withVelocity: .fast, thenHoldForDuration: 0)
            sleep(3)
        }
    }

    /// Each gesture's frames within budget, no jump the reader didn't make, and text on screen.
    private func check(_ app: XCUIApplication, composer: XCUIElement, gestures: Int, file: StaticString = #filePath, line: UInt = #line) throws {
        // Leaving the chat writes out the log.
        XCUIDevice.shared.press(.home)
        sleep(1)
        let lines = try String(contentsOf: log, encoding: .utf8).split(separator: "\n").map(String.init)
        let frames = lines.filter { $0.contains("frames scroll") }
        let attachment = XCTAttachment(string: (frames + lines.filter { $0.contains("JUMP") }).joined(separator: "\n"))
        attachment.name = "frames"
        attachment.lifetime = .keepAlways
        add(attachment)
        XCTAssertGreaterThanOrEqual(frames.count, gestures / 2, "the gestures were logged", file: file, line: line)
        let longest = frames.compactMap { value($0, "longestMs") }.max() ?? 0
        let hitch = frames.compactMap { value($0, "hitchMs") }.reduce(0, +)
        let duration = frames.compactMap { value($0, "durationMs") }.reduce(0, +)
        let ratio = duration > 0 ? hitch * 1000 / duration : 0
        print("[replay] gestures=\(frames.count) longestMs=\(longest) hitchMs=\(hitch) durationMs=\(duration) ratioMsPerS=\(ratio)")
        XCTAssertLessThanOrEqual(longest, Self.longestFrameMs, "no hitch over 50ms (frames to \(Self.longestFrameMs)ms) while scrolling", file: file, line: line)
        XCTAssertLessThanOrEqual(ratio, Self.hitchRatio, "hitch time ratio", file: file, line: line)
        let jumps = lines.filter { $0.contains(" JUMP") }
        XCTAssertTrue(jumps.isEmpty, "no offset jump over 8pt the reader didn't make: \(jumps.prefix(5))", file: file, line: line)
        app.activate()
        _ = composer.waitForExistence(timeout: 10)
        sleep(1)
        snapshot("check-\(name.split(separator: " ").last?.dropLast() ?? "")")
        XCTAssertFalse(visibleTexts(app, composer: composer).isEmpty, "the chat isn't blank", file: file, line: line)
    }

    private func value(_ line: String, _ key: String) -> Double? {
        line.split(separator: " ").first { $0.hasPrefix(key + "=") }.flatMap { Double($0.dropFirst(key.count + 1)) }
    }

    private func visibleTexts(_ app: XCUIApplication, composer: XCUIElement) -> [XCUIElement] {
        let shown = visibleRect(app, composer: composer)
        return app.staticTexts.allElementsBoundByIndex.filter { $0.exists && !$0.frame.isEmpty && $0.frame.intersects(shown) }
    }

    private func snapshot(_ name: String) {
        let screen = XCUIScreen.main.screenshot()
        try? screen.pngRepresentation.write(to: URL(fileURLWithPath: "/tmp/qa-replay-\(name).png"))
    }

    /// Between the header and the composer.
    private func visibleRect(_ app: XCUIApplication, composer: XCUIElement) -> CGRect {
        let window = app.windows.firstMatch.frame
        let top = app.navigationBars.firstMatch.exists ? app.navigationBars.firstMatch.frame.maxY : window.minY + 120
        let bottom = composer.frame.minY - 12
        return CGRect(x: window.minX, y: top, width: window.width, height: max(0, bottom - top))
    }
}
