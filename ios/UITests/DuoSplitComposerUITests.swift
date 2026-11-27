import XCTest

/// The Duo inner screen (951×669, phone idiom), book posture: in the
/// conversation's page (beside Home, or the Workbench), the
/// composer has the transcript's margins, the jump button sits beside it, and
/// the composer sits as close to the bottom edge as a phone's does above its
/// home indicator. Run on an owned iPhone Duo simulator.
@MainActor
final class DuoSplitComposerUITests: ServerIsolatedUITestCase {
    private let app = XCUIApplication()
    /// The conversation's page in the window, as the app lays the panes out (`XCUIApplication.pages`).
    private var page: ClosedRange<CGFloat> = 0...951
    private var pageMinX: CGFloat { page.lowerBound }
    private var pageMaxX: CGFloat { page.upperBound }
    /// Below a phone's composer, above the home indicator or keyboard: its
    /// vertical padding.
    private let composerGap: CGFloat = 8
    /// The demo's second conversation (Launch prep) and its last reply.
    private let otherId = "thr_demo_interview"
    private let other = "Mock with Sam moved to Friday 10:00. I asked"

    func testComposerJumpButtonAndBottomGapInTheConversationPage() throws {
        // The inner screen's sizes: an iPhone has none (the phone's own is `testComposerGapOnAPhone`).
        try XCTSkipUnless(UIDevice.current.name.lowercased().contains("duo"), "an iPhone Duo simulator")
        app.launchArguments = ["-skipPushPrompt", "YES",
            "-qaBotDemo", "duo", "-qaDuoPhone", "-qaDuoColdWide", "-qaDuoWideTitles", "-qaDark",
            "-openURL", "bbstudio://bot"]
        app.launchOffline()
        XCTAssertTrue(app.otherElements["threadComposer"].firstMatch.waitForExistence(timeout: 30))
        // The inner screen, landscape: with no hinge to read, the book posture.
        command("landscape")
        XCTAssertTrue(app.descendants(matching: .any).matching(NSPredicate(format: "identifier == %@", "conversationColumn")).firstMatch
            .waitForExistence(timeout: 10), "the book posture's conversation page")

        try check("bot-chat", last: "Duo message 80")
        // Another conversation, from Home's column beside it.
        try openOther()
        try check("conversation", last: other, history: false)

        // With the keyboard up the composer still sits above it.
        let composer = app.otherElements["threadComposer"].firstMatch
        command("focus?\(otherId)")
        let keyboard = app.keyboards.firstMatch
        XCTAssertTrue(keyboard.waitForExistence(timeout: 10))
        Thread.sleep(forTimeInterval: 1)
        print("SPLIT KEYBOARD composer=\(composer.frame) keyboard=\(keyboard.frame)")
        XCTAssertLessThanOrEqual(composer.frame.maxY, keyboard.frame.minY + 1, "The composer stays above the keyboard")
    }

    /// One page (the Duo's outer screen, or any iPhone): the composer keeps
    /// its 12-point margins inside the safe area, rests on the home
    /// indicator's inset (8 points above a tab bar where one shows), and the
    /// jump button sits in the corner beside it.
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
        XCTAssertGreaterThan(layout.safeBottom, 0, "A home indicator")
        assertResting(layout.height - layout.safeBottom - composer.frame.maxY, layout: layout, "narrow")
        if app.isFoldedDuo {
            // The folded Duo's side column holds it, right of the composer.
            XCTAssertGreaterThanOrEqual(jump.frame.minX, composer.frame.maxX, "in the side column, clear of the composer")
            XCTAssertLessThanOrEqual(jump.frame.maxX, layout.width, "on screen")
        } else {
            XCTAssertEqual(jump.frame.minX - 8, composer.frame.maxX, accuracy: 1, "the composer makes room for the jump button beside it")
            XCTAssertEqual(jump.frame.maxX, layout.width - layout.safeRight - 12, accuracy: 2, "In the corner, as before")
            XCTAssertEqual(jump.frame.midY, composer.frame.midY, accuracy: 4, "on the composer's row: it adds no height and covers no row")
        }
        command("capture?split-composer-narrow-\(Int(layout.width))")
    }

    /// The gap under the composer in every layout of the Duo, with the
    /// keyboard down and up: 8 points from the window's bottom edge on the
    /// inner screen (the room's two pages, or beside another app in iOS's
    /// split), above the home indicator on the outer screen, and 8 points
    /// above the keyboard everywhere.
    func testComposerGapInEveryLayout() throws {
        try XCTSkipUnless(UIDevice.current.name.lowercased().contains("duo"), "an iPhone Duo simulator")
        // As on a real phone: the room reopens the conversation it showed when the layout changes.
        app.launchArguments = ["-qaRememberConversation", "-skipPushPrompt", "YES",
            "-qaBotDemo", "duo", "-qaDuoPhone", "-qaDuoColdWide", "-qaDuoWideTitles", "-qaDark",
            "-openURL", "bbstudio://bot"]
        app.launchOffline()
        XCTAssertTrue(app.otherElements["threadComposer"].firstMatch.waitForExistence(timeout: 30))
        XCTAssertTrue(app.staticTexts.matching(NSPredicate(format: "label BEGINSWITH %@", "Duo message 80")).firstMatch
            .waitForExistence(timeout: 15))
        let layouts: [(name: String, commands: [String], innerScreen: Bool)] = [
            ("inner", ["landscape"], true),
            ("inner-split", ["split"], true),
            ("outer", ["outer"], false),
        ]
        for chat in ["bot-chat", "conversation"] {
            if chat == "conversation" { try openOther() }
            for layout in layouts {
                layout.commands.forEach(command)
                try measureGap("\(chat) \(layout.name)", capture: "composer-gap-\(chat)-\(layout.name)",
                               innerScreen: layout.innerScreen, focus: chat == "bot-chat" ? "thr_botdemo01" : otherId)
            }
        }
        command("landscape")
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
        try measureGap("bot-chat phone", capture: "composer-gap-bot-chat-phone", innerScreen: false, focus: "thr_botdemo01")
        try openOther()
        try measureGap("conversation phone", capture: "composer-gap-conversation-phone", innerScreen: false, focus: otherId)
    }

    /// Launch prep: from the inner screen's left page, or the one list on a single page.
    /// Launch prep: from Home's column where it shows beside the conversation (book), else from Home.
    private func openOther() throws {
        let row = app.buttons["homeConversation-\(otherId)"]
        if row.exists, row.isHittable { row.tap() } else { app.pickConversation(otherId) }
        XCTAssertTrue(app.staticTexts.matching(NSPredicate(format: "label BEGINSWITH %@", other)).firstMatch
            .waitForExistence(timeout: 15))
    }

    private func measureGap(_ name: String, capture: String, innerScreen: Bool, focus: String) throws {
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
            assertResting(aboveIndicator, layout: layout, name)
        }
        command("capture?\(capture)-down")

        command("focus?\(focus)")
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

    /// `history`: long enough to scroll up and show Jump to latest.
    private func check(_ name: String, last: String, history: Bool = true) throws {
        page = app.pages().conversationX
        let message = app.staticTexts.matching(NSPredicate(format: "label BEGINSWITH %@", last)).firstMatch
        XCTAssertTrue(message.waitForExistence(timeout: 15), "\(name): transcript loads")
        let composer = app.otherElements["threadComposer"].firstMatch
        XCTAssertTrue(composer.waitForExistence(timeout: 10))
        expectation(for: NSPredicate { _, _ in message.frame.maxX <= self.pageMaxX + 1 && composer.frame.maxX <= self.pageMaxX + 1 },
                    evaluatedWith: nil)
        waitForExpectations(timeout: 5) { _ in }
        Thread.sleep(forTimeInterval: 1)

        // 1. The composer has the transcript's margins, on its page.
        var layout = try geometry()
        func onPage(_ layout: Geometry) -> [String: Rect] {
            layout.surfaces.filter { $0.key.hasPrefix("transcript-") && $0.value.x >= pageMinX - 1 && $0.value.maxX <= pageMaxX + 1 }
        }
        // Its probe reports on a layout: scrolling to the end makes one.
        for _ in 0..<5 where onPage(layout).isEmpty {
            command("bottom")
            Thread.sleep(forTimeInterval: 1)
            layout = try geometry()
        }
        let transcripts = onPage(layout)
        XCTAssertLessThanOrEqual(transcripts.count, 1, "\(name): one transcript on the page")
        if let transcript = transcripts.first?.value {
            print("SPLIT COMPOSER \(name) composer=\(composer.frame) transcript=\(transcript) safeRight=\(layout.safeRight) safeBottom=\(layout.safeBottom)")
            // The composer's 12-point margins against the transcript's 16: 4 points out, half a point either way at an odd width.
            XCTAssertEqual(composer.frame.maxX, transcript.maxX + 4, accuracy: 1, "\(name): composer ends where the transcript does")
            XCTAssertEqual(composer.frame.minX, transcript.x - 4, accuracy: 1, "\(name): composer starts where the transcript does")
        } else {
            // No probe reported (emulated inner screen on an iPhone): the composer stays on the page.
            print("SPLIT COMPOSER \(name) composer=\(composer.frame): no transcript probe on the page")
            XCTAssertGreaterThanOrEqual(composer.frame.minX, pageMinX + 12 - 1, "\(name): composer on the page, with its margin")
            XCTAssertLessThanOrEqual(composer.frame.maxX, pageMaxX - 12 + 1, "\(name): composer on the page, with its margin")
        }

        // 3. The composer sits as far above the window's bottom edge as a
        // phone's does above its home indicator, not above a second inset.
        XCTAssertEqual(layout.height - composer.frame.maxY, composerGap, accuracy: 2,
                       "\(name): the gap under the composer, with a \(layout.safeBottom)-point bottom safe area")

        guard history else { return command("capture?split-composer-" + name) }
        // 2. Up in the history, the jump button sits beside the composer:
        // no row of its own, and over no row.
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
        let page = (minX: pageMinX, maxX: pageMaxX)
        let visibleBottom = scroll.y + scroll.height - scroll.adjustedBottom
        print("SPLIT JUMP \(name) jump=\(jump.frame) composer=\(composer.frame) visibleBottom=\(visibleBottom)")
        XCTAssertLessThanOrEqual(jump.frame.maxX, page.maxX + 1, "\(name): jump button stays on the page")
        XCTAssertGreaterThanOrEqual(jump.frame.minX, composer.frame.maxX + 7, "\(name): jump button is beside the composer")
        // Level with the composer's bottom row (it can be taller: an attachment).
        XCTAssertGreaterThanOrEqual(jump.frame.minY, composer.frame.minY, "\(name): on the composer's row, not a row of its own")
        XCTAssertEqual(jump.frame.maxY, composer.frame.maxY - 4, accuracy: 4, "\(name): level with the composer's last row")
        XCTAssertGreaterThanOrEqual(jump.frame.minY, visibleBottom - 1, "\(name): below the transcript's visible rows")
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
        let minX: CGFloat = pageMinX - 1, maxX: CGFloat = pageMaxX + 1
        // Typed steps: as one expression Xcode 26 couldn't type-check it.
        let frames: [CGRect] = app.staticTexts.allElementsBoundByIndex.map { $0.frame }
        let endRows: [CGRect] = frames.filter { (frame: CGRect) -> Bool in
            guard frame.width > 0, frame.height > 0, frame.minX >= minX, frame.maxX <= maxX, frame.minY < 669 else { return false }
            return !composerFrame.contains(frame)
        }
        let above: [CGRect] = endRows.filter { $0.minY < top }
        let last = try XCTUnwrap(above.max { $0.maxY < $1.maxY }, "\(name): a row above the composer")
        print("SPLIT END \(name) last=\(last) composer=\(composer.frame)")
        XCTAssertLessThanOrEqual(last.maxY, top + 1, "\(name): the last row is whole above the composer at the end")
        command("capture?split-composer-" + name + "-end")
    }

    /// Text of the conversation page's transcript: not the bar, composer or Workbench.
    private func transcriptTexts() -> [CGRect] {
        let composer = app.otherElements["threadComposer"].firstMatch.frame
        let minX: CGFloat = pageMinX - 1, maxX: CGFloat = pageMaxX + 1
        let frames: [CGRect] = app.staticTexts.allElementsBoundByIndex.map { $0.frame }
        return frames.filter { (frame: CGRect) -> Bool in
            guard frame.width > 0, frame.height > 0, frame.minX >= minX, frame.maxX <= maxX, frame.maxY > 0, frame.minY < 669 else { return false }
            return !frame.intersects(composer) && frame.minY >= 58
        }
    }

    /// Over a home indicator alone the card rests on its inset (its own
    /// padding inside it); where a tab bar shows, 8 points above the bar.
    private func assertResting(_ aboveIndicator: CGFloat, layout: Geometry, _ name: String,
                               file: StaticString = #filePath, line: UInt = #line) {
        let tabBar = app.tabBars.firstMatch
        if tabBar.exists, tabBar.frame.width > layout.width / 2, tabBar.frame.minY < layout.height - 1 {
            XCTAssertGreaterThanOrEqual(aboveIndicator, composerGap - 1, "\(name): above the tab bar", file: file, line: line)
        } else {
            XCTAssertEqual(aboveIndicator, 0, accuracy: 1, "\(name): resting on the home indicator's inset", file: file, line: line)
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
