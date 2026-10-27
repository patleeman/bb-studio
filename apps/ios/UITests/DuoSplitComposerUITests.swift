import XCTest

/// The Duo inner screen (951×669, phone idiom): in the right page, the
/// composer has the transcript's margins, the jump button is centred on the
/// page above the composer, and the composer sits as close to the bottom edge
/// as a phone's does above its home indicator. Run on an owned iPhone Duo
/// simulator.
@MainActor
final class DuoSplitComposerUITests: ServerIsolatedUITestCase {
    private let app = XCUIApplication()
    /// The crease's right edge: the window midpoint plus half the gutter.
    private let pageMinX: CGFloat = 951 / 2 + 16
    /// Below a phone's composer, above the home indicator or keyboard: its
    /// vertical padding.
    private let composerGap: CGFloat = 8

    func testComposerJumpButtonAndBottomGapInTheRightPage() throws {
        app.launchArguments = ["-skipPushPrompt", "YES",
            "-qaBotDemo", "duo", "-qaDuoPhone", "-qaDuoColdWide", "-qaDuoWideTitles", "-qaDark",
            "-openURL", "bbstudio://bot"]
        app.launchOffline()
        XCTAssertTrue(app.otherElements["threadComposer"].firstMatch.waitForExistence(timeout: 30))

        try check("bot-chat", last: "Duo message 80")
        // A Bot thread from its Running group.
        let row = app.buttons.matching(NSPredicate(format: "label BEGINSWITH %@", "iOS: black on reopen")).firstMatch
        XCTAssertTrue(row.waitForExistence(timeout: 15))
        row.tap()
        try check("bot-thread", last: "Wide 12")
        // A normal thread from the Threads list.
        command("tab?threads")
        let conversation = app.buttons["inbox-thread-thr_botdemo01"]
        XCTAssertTrue(conversation.waitForExistence(timeout: 15))
        conversation.tap()
        XCTAssertTrue(app.staticTexts["duoThreadTitle"].waitForExistence(timeout: 15))
        try check("thread", last: "Duo message 80")

        // With the keyboard up the composer still sits above it.
        let composer = app.otherElements["threadComposer"].firstMatch
        command("focus")
        let keyboard = app.keyboards.firstMatch
        XCTAssertTrue(keyboard.waitForExistence(timeout: 10))
        Thread.sleep(forTimeInterval: 1)
        print("SPLIT KEYBOARD composer=\(composer.frame) keyboard=\(keyboard.frame)")
        XCTAssertLessThanOrEqual(composer.frame.maxY, keyboard.frame.minY + 1, "The composer stays above the keyboard")
    }

    /// One page (the Duo's outer screen, or any iPhone): the composer keeps
    /// its 12-point margins inside the safe area, stays clear of the home
    /// indicator, and the jump button floats in the corner above it.
    func testNarrowWindowKeepsItsComposerAndJumpButton() throws {
        app.launchArguments = ["-skipPushPrompt", "YES",
            "-qaBotDemo", "duo", "-qaDuoPhone", "-qaDark", "-openURL", "bbstudio://bot"]
        app.launchOffline()
        let composer = app.otherElements["threadComposer"].firstMatch
        XCTAssertTrue(composer.waitForExistence(timeout: 30))
        XCTAssertTrue(app.staticTexts.matching(NSPredicate(format: "label BEGINSWITH %@", "Duo message 80")).firstMatch.waitForExistence(timeout: 15))
        let jump = app.buttons["Jump to latest"]
        for _ in 0..<3 where !jump.exists {
            command("mid")
            _ = jump.waitForExistence(timeout: 10)
        }
        guard jump.exists else { return XCTFail("The jump button shows up in the history") }
        Thread.sleep(forTimeInterval: 1)
        let layout = try geometry()
        print("NARROW width=\(layout.width) height=\(layout.height) safeRight=\(layout.safeRight) safeBottom=\(layout.safeBottom) composer=\(composer.frame) jump=\(jump.frame)")
        XCTAssertLessThan(layout.width, 900)
        XCTAssertEqual(composer.frame.maxX, layout.width - layout.safeRight - 12, accuracy: 1)
        XCTAssertGreaterThan(layout.safeBottom, 0, "A home indicator")
        // 8 points above the home indicator, or above the tab bar where it shows.
        XCTAssertGreaterThanOrEqual(layout.height - layout.safeBottom - composer.frame.maxY, composerGap - 1,
                                    "Above the home indicator, as before")
        XCTAssertEqual(jump.frame.maxX, layout.width - layout.safeRight - 12, accuracy: 2, "In the corner, as before")
        XCTAssertLessThanOrEqual(jump.frame.maxY, composer.frame.minY + 1)
        command("capture?split-composer-narrow-\(Int(layout.width))")
    }

    /// The gap under the composer in every layout of the Duo, with the
    /// keyboard down and up: 8 points from the window's bottom edge on the
    /// inner screen (our two pages at each list width, or beside another app
    /// in iOS's split), above the home indicator on the outer screen, and
    /// 8 points above the keyboard everywhere.
    func testComposerGapInEveryLayout() throws {
        app.launchArguments = ["-skipPushPrompt", "YES",
            "-qaBotDemo", "duo", "-qaDuoPhone", "-qaDuoColdWide", "-qaDuoWideTitles", "-qaDark",
            "-openURL", "bbstudio://bot"]
        app.launchOffline()
        XCTAssertTrue(app.otherElements["threadComposer"].firstMatch.waitForExistence(timeout: 30))
        XCTAssertTrue(app.staticTexts.matching(NSPredicate(format: "label BEGINSWITH %@", "Duo message 80")).firstMatch
            .waitForExistence(timeout: 15))
        let layouts: [(name: String, commands: [String], innerScreen: Bool)] = [
            ("inner-hidden", ["landscape", "pane?hidden"], true),
            ("inner-narrow", ["landscape", "pane?narrow"], true),
            ("inner-even", ["landscape", "pane?even"], true),
            ("inner-split", ["split"], true),
            ("outer", ["outer"], false),
        ]
        for chat in ["bot-chat", "thread"] {
            if chat == "thread" { try openThread() }
            for layout in layouts {
                layout.commands.forEach(command)
                try measureGap("\(chat) \(layout.name)", capture: "composer-gap-\(chat)-\(layout.name)",
                               innerScreen: layout.innerScreen)
            }
        }
        command("landscape")
        command("pane?even")
    }

    /// One page on a phone: above the home indicator (or the tab bar), and
    /// 8 points above the keyboard. Run on an owned iPhone 18 Pro.
    func testComposerGapOnAPhone() throws {
        app.launchArguments = ["-skipPushPrompt", "YES",
            "-qaBotDemo", "duo", "-qaDuoPhone", "-qaDuoWideTitles", "-qaDark", "-openURL", "bbstudio://bot"]
        app.launchOffline()
        XCTAssertTrue(app.otherElements["threadComposer"].firstMatch.waitForExistence(timeout: 30))
        XCTAssertTrue(app.staticTexts.matching(NSPredicate(format: "label BEGINSWITH %@", "Duo message 80")).firstMatch
            .waitForExistence(timeout: 15))
        try measureGap("bot-chat phone", capture: "composer-gap-bot-chat-phone", innerScreen: false)
        try openThread()
        try measureGap("thread phone", capture: "composer-gap-thread-phone", innerScreen: false)
    }

    private func openThread() throws {
        command("tab?threads")
        let conversation = app.buttons["inbox-thread-thr_botdemo01"]
        XCTAssertTrue(conversation.waitForExistence(timeout: 15))
        conversation.tap()
        XCTAssertTrue(app.staticTexts.matching(NSPredicate(format: "label BEGINSWITH %@", "Duo message 80")).firstMatch
            .waitForExistence(timeout: 15))
    }

    private func measureGap(_ name: String, capture: String, innerScreen: Bool) throws {
        let composer = app.otherElements["threadComposer"].firstMatch
        command("dismiss")
        command("bottom")
        Thread.sleep(forTimeInterval: 2)
        XCTAssertTrue(composer.waitForExistence(timeout: 10), "\(name): composer")
        var layout = try geometry()
        let edge = layout.height - composer.frame.maxY
        let aboveIndicator = edge - layout.safeBottom
        print("COMPOSER GAP \(name) keyboard=down window=\(layout.width)x\(layout.height) safeBottom=\(layout.safeBottom) composer=\(composer.frame) edge=\(edge) aboveIndicator=\(aboveIndicator)")
        if innerScreen {
            XCTAssertEqual(edge, composerGap, accuracy: 1, "\(name): 8 points from the inner screen's bottom edge")
        } else {
            // Above the home indicator, or the tab bar where it shows.
            XCTAssertGreaterThanOrEqual(aboveIndicator, composerGap - 1, "\(name): clear of the home indicator")
        }
        command("capture?\(capture)-down")

        command("focus?thr_botdemo01")
        XCTAssertTrue(app.keyboards.firstMatch.waitForExistence(timeout: 10), "\(name): keyboard up")
        Thread.sleep(forTimeInterval: 2)
        layout = try geometry()
        let aboveKeyboard = layout.keyboardTop - composer.frame.maxY
        print("COMPOSER GAP \(name) keyboard=up keyboardTop=\(layout.keyboardTop) xcuiKeyboard=\(app.keyboards.firstMatch.frame) composer=\(composer.frame) aboveKeyboard=\(aboveKeyboard)")
        XCTAssertLessThan(layout.keyboardTop, layout.height, "\(name): the keyboard's frame is known")
        XCTAssertEqual(aboveKeyboard, composerGap, accuracy: 1, "\(name): 8 points above the keyboard")
        command("capture?\(capture)-up")
        command("dismiss")
        Thread.sleep(forTimeInterval: 1)
    }

    private func check(_ name: String, last: String) throws {
        let message = app.staticTexts.matching(NSPredicate(format: "label BEGINSWITH %@", last)).firstMatch
        XCTAssertTrue(message.waitForExistence(timeout: 15), "\(name): transcript loads")
        let composer = app.otherElements["threadComposer"].firstMatch
        XCTAssertTrue(composer.waitForExistence(timeout: 10))
        expectation(for: NSPredicate { _, _ in message.frame.minX >= self.pageMinX - 1 && composer.frame.minX >= self.pageMinX - 1 },
                    evaluatedWith: nil)
        waitForExpectations(timeout: 5) { _ in }
        Thread.sleep(forTimeInterval: 1)

        // 1. The composer has the transcript's leading margin. It runs under
        // the status column; the transcript keeps clear of it, so its rows
        // never pass under the Duo's clock, battery and Now Playing.
        var layout = try geometry()
        // Only the thread on screen keeps its probe.
        let transcripts = layout.surfaces.filter { $0.key.hasPrefix("transcript-") }
        XCTAssertEqual(transcripts.count, 1, "\(name): one transcript on screen")
        let transcript = try XCTUnwrap(transcripts.first?.value, "\(name): transcript content probe")
        print("SPLIT COMPOSER \(name) composer=\(composer.frame) transcript=\(transcript) safeRight=\(layout.safeRight) safeBottom=\(layout.safeBottom)")
        XCTAssertEqual(composer.frame.maxX, transcript.maxX + layout.safeRight, accuracy: 4,
                       "\(name): composer runs under the status column; the transcript stops short of it")
        XCTAssertEqual(composer.frame.minX, transcript.x, accuracy: 4, "\(name): composer starts where the transcript does")

        // 3. The composer sits as far above the window's bottom edge as a
        // phone's does above its home indicator, not above a second inset.
        XCTAssertEqual(layout.height - composer.frame.maxY, composerGap, accuracy: 2,
                       "\(name): the gap under the composer, with a \(layout.safeBottom)-point bottom safe area")

        // 2. Up in the history, the jump button is centred on the page,
        // above the composer and below the transcript's visible rows.
        let jump = app.buttons["Jump to latest"]
        for _ in 0..<3 where !jump.exists {
            command("mid")
            _ = jump.waitForExistence(timeout: 10)
        }
        guard jump.exists else { return XCTFail("\(name): jump button shows up in the history") }
        Thread.sleep(forTimeInterval: 1)
        layout = try geometry()
        let scroll = try XCTUnwrap(layout.scrolls.first { abs($0.x - pageMinX) < 2 && $0.height > 400 && $0.contentHeight > 0 },
                                   "\(name): the transcript scroll view")
        let page = (minX: pageMinX, maxX: layout.width)
        let visibleBottom = scroll.y + scroll.height - scroll.adjustedBottom
        print("SPLIT JUMP \(name) jump=\(jump.frame) composer=\(composer.frame) visibleBottom=\(visibleBottom)")
        XCTAssertEqual(jump.frame.midX, (page.minX + page.maxX) / 2, accuracy: 2, "\(name): jump button is centred on the page")
        XCTAssertLessThanOrEqual(jump.frame.maxY, composer.frame.minY + 1, "\(name): jump button is above the composer")
        XCTAssertGreaterThanOrEqual(jump.frame.minY, visibleBottom - 1, "\(name): the transcript's bottom inset includes the jump button")
        let rows = transcriptTexts().filter { $0.maxY <= visibleBottom + 1 }
        let lastRow = try XCTUnwrap(rows.max { $0.maxY < $1.maxY }, "\(name): a visible transcript row")
        XCTAssertFalse(lastRow.intersects(jump.frame), "\(name): jump button covers the last row's text \(lastRow)")
        XCTAssertEqual(layout.height - composer.frame.maxY, composerGap, accuracy: 2, "\(name): the gap under the composer in history")
        command("capture?split-composer-" + name + "-history")

        // At the end the button goes, and the last row is whole above the composer.
        command("bottom")
        XCTAssertTrue(message.waitForExistence(timeout: 10))
        Thread.sleep(forTimeInterval: 2)
        XCTAssertFalse(jump.exists, "\(name): no jump button at the end")
        let top = composer.frame.minY
        let composerFrame: CGRect = composer.frame
        let minX: CGFloat = pageMinX - 1
        // Typed steps: as one expression Xcode 26 couldn't type-check it.
        let frames: [CGRect] = app.staticTexts.allElementsBoundByIndex.map { $0.frame }
        let endRows: [CGRect] = frames.filter { (frame: CGRect) -> Bool in
            guard frame.width > 0, frame.height > 0, frame.minX >= minX, frame.minY < 669 else { return false }
            return !composerFrame.contains(frame)
        }
        let above: [CGRect] = endRows.filter { $0.minY < top }
        let last = try XCTUnwrap(above.max { $0.maxY < $1.maxY }, "\(name): a row above the composer")
        print("SPLIT END \(name) last=\(last) composer=\(composer.frame)")
        XCTAssertLessThanOrEqual(last.maxY, top + 1, "\(name): the last row is whole above the composer at the end")
        command("capture?split-composer-" + name + "-end")
    }

    /// Text of the right page's transcript: not the header, composer or sidebar.
    private func transcriptTexts() -> [CGRect] {
        let composer = app.otherElements["threadComposer"].firstMatch.frame
        let minX: CGFloat = pageMinX - 1
        let frames: [CGRect] = app.staticTexts.allElementsBoundByIndex.map { $0.frame }
        return frames.filter { (frame: CGRect) -> Bool in
            guard frame.width > 0, frame.height > 0, frame.minX >= minX, frame.maxY > 0, frame.minY < 669 else { return false }
            return !frame.intersects(composer) && frame.minY >= 58
        }
    }

    private func geometry() throws -> Geometry {
        command("layout")
        let value = try XCTUnwrap(app.windows.firstMatch.value as? String)
        return try JSONDecoder().decode(Geometry.self, from: Data(value.utf8))
    }

    private func command(_ path: String) {
        XCUIDevice.shared.system.open(URL(string: "bbstudio://qa-duo/" + path)!)
    }

    private struct Geometry: Decodable {
        let width: CGFloat
        let height: CGFloat
        let safeRight: CGFloat
        let safeBottom: CGFloat
        let keyboardTop: CGFloat
        let surfaces: [String: Rect]
        let scrolls: [Scroll]
    }
    private struct Rect: Decodable {
        let x: CGFloat
        let y: CGFloat
        let width: CGFloat
        let height: CGFloat
        var maxX: CGFloat { x + width }
    }
    private struct Scroll: Decodable {
        let x: CGFloat
        let y: CGFloat
        let height: CGFloat
        let contentHeight: CGFloat
        let adjustedBottom: CGFloat
    }
}
