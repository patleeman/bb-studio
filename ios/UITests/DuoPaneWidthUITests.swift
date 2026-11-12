import XCTest

/// The Duo inner screen (951×669, phone idiom): the list pane hides, shows and
/// resizes to its snap points, remembers its width across relaunch and fold,
/// and nothing in the detail lies under the status cluster. Run on an owned
/// iPhone Duo simulator.
@MainActor
final class DuoPaneWidthUITests: ServerIsolatedUITestCase {
    private let app = XCUIApplication()
    private let rail: CGFloat = 64
    private let gutter: CGFloat = 32
    /// The header's toggle sits 16 points into the detail page.
    private let headerPadding: CGFloat = 16
    /// The Duo's clock, battery and Now Playing float in the status column's
    /// top: measured from Patrick's inner-screen screenshot with music
    /// playing (23 to 187 points down, 20 to 75 points from the edge).
    private let clusterHeight: CGFloat = 196

    private var launchArguments: [String] {
        ["-skipPushPrompt", "YES", "-qaBotDemo", "duo", "-qaDuoPhone",
         "-qaDuoColdWide", "-qaDuoWideTitles", "-qaDark", "-openURL", "bbstudio://bot"]
    }

    override func tearDown() {
        // Leave the next test the default split.
        if app.state == .runningForeground { command("pane?even"); Thread.sleep(forTimeInterval: 1) }
        super.tearDown()
    }

    func testToggleHidesAndShowsTheList() throws {
        try launch()
        let toggle = app.buttons["duoPaneToggle"]
        XCTAssertEqual(toggle.label, "Hide list")
        XCTAssertTrue(listRow.isHittable, "The Bot's list shows")
        tapToggle()
        try waitForPage(.hidden)
        XCTAssertFalse(listRow.exists && listRow.isHittable, "The list is hidden")
        XCTAssertEqual(toggle.label, "Show list")
        XCTAssertEqual(rail + headerPadding, toggle.frame.minX, accuracy: 2, "The detail starts at the rail")
        XCTAssertTrue(app.buttons["Bot"].isHittable, "The rail stays")
        tapToggle()
        try waitForPage(.even)
        XCTAssertTrue(listRow.isHittable, "The list is back")

        // From narrow, the toggle brings narrow back.
        command("pane?narrow")
        try waitForPage(.narrow)
        tapToggle()
        try waitForPage(.hidden)
        tapToggle()
        try waitForPage(.narrow)

        // A swipe in from the detail's leading edge shows the list as well.
        command("pane?hidden")
        try waitForPage(.hidden)
        let window = app.windows.firstMatch
        let start = window.coordinate(withNormalizedOffset: .zero).withOffset(CGVector(dx: rail + 6, dy: 400))
        start.press(forDuration: 0.05, thenDragTo: start.withOffset(CGVector(dx: 310, dy: 0)),
                    withVelocity: .slow, thenHoldForDuration: 0.2)
        try waitForPage(.narrow, "An edge swipe of 310 points snaps to narrow")
        XCTAssertTrue(listRow.isHittable)
    }

    func testDividerSnapsToEachPoint() throws {
        try launch()
        let divider = app.descendants(matching: .any)["duoPaneDivider"].firstMatch
        XCTAssertTrue(divider.waitForExistence(timeout: 5))
        // The even width's divider sits on the crease, with a 44-point grab area.
        XCTAssertEqual(divider.frame.midX, 951 / 2, accuracy: 1, "On the crease")
        XCTAssertGreaterThanOrEqual(divider.frame.width, 44)

        // (target x for the divider's centre, where it lands)
        let drags: [(CGFloat, Pane)] = [(rail + 330 + gutter / 2, .narrow), (rail + 420 + gutter / 2, .even),
                                        (rail + 280 + gutter / 2, .narrow), (rail + 90, .hidden)]
        for (x, expected) in drags {
            if !divider.exists {
                command("pane?even")
                try waitForPage(.even)
            }
            let from = divider.coordinate(withNormalizedOffset: CGVector(dx: 0.5, dy: 0.5))
            from.press(forDuration: 0.1, thenDragTo: from.withOffset(CGVector(dx: x - divider.frame.midX, dy: 0)),
                       withVelocity: .slow, thenHoldForDuration: 0.3)
            try waitForPage(expected, "Dragged to x \(x)")
            command("capture?pane-drag-\(expected.rawValue)")
        }
        XCTAssertFalse(divider.exists, "No divider with the list hidden")
    }

    func testWidthPersistsAcrossRelaunchAndFold() throws {
        try launch()
        command("pane?narrow")
        try waitForPage(.narrow)
        app.terminate()
        app.launchOffline()
        XCTAssertTrue(app.otherElements["threadComposer"].firstMatch.waitForExistence(timeout: 30))
        try waitForPage(.narrow, "Narrow after relaunch")
        tapToggle()
        try waitForPage(.hidden)
        app.terminate()
        app.launchOffline()
        XCTAssertTrue(app.otherElements["threadComposer"].firstMatch.waitForExistence(timeout: 30))
        try waitForPage(.hidden, "Full width after relaunch")

        // Fold to the outer screen and back: the choice stays, the chat at its end.
        for pane in [Pane.hidden, .narrow, .even] {
            command("pane?\(pane.rawValue)")
            try waitForPage(pane)
            command("outer")
            XCTAssertTrue(app.otherElements["threadComposer"].firstMatch.waitForExistence(timeout: 10))
            Thread.sleep(forTimeInterval: 1.5)
            XCTAssertFalse(app.buttons["duoPaneToggle"].exists, "One page on the outer screen")
            command("landscape")
            try waitForPage(pane, "\(pane) after folding and unfolding")
            let last = app.staticTexts.matching(NSPredicate(format: "label BEGINSWITH %@", "Duo message 80")).firstMatch
            XCTAssertTrue(last.waitForExistence(timeout: 10))
            let composer = app.otherElements["threadComposer"].firstMatch
            XCTAssertLessThanOrEqual(last.frame.maxY, composer.frame.minY + 1, "\(pane): the last message is above the composer")
            XCTAssertFalse(app.buttons["Jump to latest"].exists, "\(pane): still at the end")
        }
    }

    /// No transcript or header text lies under the status cluster: the Bot's
    /// chat and a normal thread, at each width, with the keyboard down and up,
    /// at the end and up in the history.
    func testNoBotChatTextUnderTheStatusCluster() throws {
        try launch()
        try checkCluster("bot-chat", last: "Duo message 80")
    }

    func testNoThreadTextUnderTheStatusCluster() throws {
        try launch()
        command("tab?threads")
        let conversation = app.buttons["inbox-thread-thr_botdemo01"]
        XCTAssertTrue(conversation.waitForExistence(timeout: 15))
        conversation.tap()
        XCTAssertTrue(app.staticTexts["duoThreadTitle"].waitForExistence(timeout: 15))
        try checkCluster("thread", last: "Duo message 80")
    }

    private func checkCluster(_ name: String, last: String) throws {
        let message = app.staticTexts.matching(NSPredicate(format: "label BEGINSWITH %@", last)).firstMatch
        XCTAssertTrue(message.waitForExistence(timeout: 15), "\(name): transcript loads")
        let layout = try geometry()
        XCTAssertGreaterThan(layout.safeRight, 0, "The Duo's status column")
        let cluster = CGRect(x: layout.width - layout.safeRight, y: 0, width: layout.safeRight, height: clusterHeight)
        for pane in [Pane.even, .narrow, .hidden] {
            command("pane?\(pane.rawValue)")
            try waitForPage(pane)
            for state in ["end", "history", "keyboard"] {
                switch state {
                case "history": command("mid")
                case "keyboard":
                    command("bottom")
                    Thread.sleep(forTimeInterval: 1)
                    command("focus?thr_botdemo01")
                    XCTAssertTrue(app.keyboards.firstMatch.waitForExistence(timeout: 10), "\(name): keyboard up")
                default: break
                }
                Thread.sleep(forTimeInterval: 1.5)
                let texts = try visibleTexts()
                    .filter { $0.1.width > 0 && $0.1.height > 0 && $0.1.maxY > 0 && $0.1.minY < layout.height }
                XCTAssertGreaterThan(texts.filter { $0.1.minY < clusterHeight && $0.1.maxY > 58 }.count, 0,
                                     "\(name) \(pane) \(state): rows reach the cluster's band")
                for (label, frame) in texts where frame.intersects(cluster) {
                    XCTFail("\(name) \(pane) \(state): “\(label.prefix(40))” at \(frame) lies under the status cluster")
                }
                command("capture?pane-cluster-\(name)-\(pane.rawValue)-\(state)")
                if state == "keyboard" {
                    command("dismiss")
                    Thread.sleep(forTimeInterval: 1)
                }
            }
            command("bottom")
        }
    }

    /// The recording in docs/ios/duo-pane-width: the divider dragged to
    /// each snap point, then the header button and an edge swipe. Run with
    /// TEST_RUNNER_DUO_PANE_RECORD=1; frames land in the app's Documents.
    func testRecordDragAndToggle() throws {
        try XCTSkipUnless(ProcessInfo.processInfo.environment["DUO_PANE_RECORD"] != nil, "Recording only on request")
        try launch()
        command("record?start")
        Thread.sleep(forTimeInterval: 1)
        let divider = app.descendants(matching: .any)["duoPaneDivider"].firstMatch
        for x: CGFloat in [rail + 300 + gutter / 2, 951 / 2] {
            let from = divider.coordinate(withNormalizedOffset: CGVector(dx: 0.5, dy: 0.5))
            from.press(forDuration: 0.2, thenDragTo: from.withOffset(CGVector(dx: x - divider.frame.midX, dy: 0)),
                       withVelocity: XCUIGestureVelocity(150), thenHoldForDuration: 0.5)
            Thread.sleep(forTimeInterval: 1)
        }
        tapToggle()
        Thread.sleep(forTimeInterval: 1.5)
        tapToggle()
        Thread.sleep(forTimeInterval: 1.5)
        let from = divider.coordinate(withNormalizedOffset: CGVector(dx: 0.5, dy: 0.5))
        from.press(forDuration: 0.2, thenDragTo: from.withOffset(CGVector(dx: rail + 60 - divider.frame.midX, dy: 0)),
                   withVelocity: XCUIGestureVelocity(200), thenHoldForDuration: 0.3)
        Thread.sleep(forTimeInterval: 1.5)
        let window = app.windows.firstMatch
        let edge = window.coordinate(withNormalizedOffset: .zero).withOffset(CGVector(dx: rail + 6, dy: 400))
        edge.press(forDuration: 0.1, thenDragTo: edge.withOffset(CGVector(dx: 420, dy: 0)), withVelocity: XCUIGestureVelocity(200), thenHoldForDuration: 0.3)
        Thread.sleep(forTimeInterval: 1.5)
        command("record?stop")
        try waitForPage(.even)
    }

    // MARK: - Helpers

    private enum Pane: String { case hidden, narrow, even }

    /// The simulator's screen is the Duo's outer one (466 × 678), so taps in
    /// the stretched inner window's right page aren't delivered. The Debug
    /// command activates the header button through accessibility, as
    /// VoiceOver does, which runs its tap action.
    private func tapToggle() {
        XCTAssertTrue(app.buttons["duoPaneToggle"].exists, "The header's toggle")
        command("activate?duoPaneToggle")
    }

    /// Every static text's label and frame, from one snapshot: querying each
    /// element of a long transcript in turn takes minutes.
    private func visibleTexts() throws -> [(String, CGRect)] {
        var result: [(String, CGRect)] = []
        func walk(_ element: XCUIElementSnapshot) {
            if element.elementType == .staticText { result.append((element.label, element.frame)) }
            element.children.forEach(walk)
        }
        walk(try app.snapshot())
        return result
    }

    private var listRow: XCUIElement {
        app.buttons.matching(NSPredicate(format: "label BEGINSWITH %@", "iOS: black on reopen")).firstMatch
    }

    private func launch() throws {
        app.launchArguments = launchArguments
        app.launchOffline()
        XCTAssertTrue(app.otherElements["threadComposer"].firstMatch.waitForExistence(timeout: 30))
        XCTAssertTrue(app.staticTexts.matching(NSPredicate(format: "label BEGINSWITH %@", "Duo message 80")).firstMatch
            .waitForExistence(timeout: 15))
        command("pane?even")
        try waitForPage(.even)
    }

    /// The pane state and the detail's leading edge (its header's toggle) agree.
    private func waitForPage(_ pane: Pane, _ message: String = "", file: StaticString = #filePath, line: UInt = #line) throws {
        let pageMinX: CGFloat = switch pane {
        case .hidden: rail
        case .narrow: rail + 300 + gutter
        case .even: 951 / 2 + gutter / 2
        }
        let toggle = app.buttons["duoPaneToggle"]
        let deadline = Date().addingTimeInterval(8)
        var state = ""
        while Date() < deadline {
            state = (try? geometry().pane) ?? "?"
            if state == pane.rawValue, toggle.exists, abs(toggle.frame.minX - pageMinX - headerPadding) < 2 { return }
            Thread.sleep(forTimeInterval: 0.3)
        }
        XCTFail("\(message) expected \(pane), pane=\(state) toggle=\(toggle.exists ? toggle.frame : .zero)", file: file, line: line)
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
        let pane: String
    }
}
