import XCTest

/// The open Duo's panes by width and text size (round 7 fix: "the layout is
/// super cramped"), offline, in every posture at the default text size, at
/// xxxLarge and at an accessibility size. Book and flat share one rule: the
/// conversation, the Workbench only when it has a tab the phone can show
/// (the larger share stays the conversation's), Home beside them only where
/// it fits; at large text, one big column. With `SHELL_CAPTURE` set,
/// `qa-duo/capture` keeps each window's PNG in the app's Documents.
final class ShellPanesUITests: ServerIsolatedUITestCase {
    private let app = XCUIApplication()
    private var isDuo: Bool { UIDevice.current.name.lowercased().contains("duo") }
    private let landscape = CGSize(width: 951, height: 669)
    private let portrait = CGSize(width: 669, height: 951)
    private let outer = CGSize(width: 466, height: 678)

    private enum TextSize: String {
        case large = "UICTContentSizeCategoryL"
        case xxxLarge = "UICTContentSizeCategoryXXXL"
        case accessibility = "UICTContentSizeCategoryAccessibilityL"

        var name: String {
            switch self {
            case .large: "default"
            case .xxxLarge: "xxxl"
            case .accessibility: "ax"
            }
        }
    }

    private func launch(_ size: TextSize, macOnly: Bool = false) {
        app.launchArguments = ["-skipPushPrompt", "YES", "-qaBotDemo", "chat", "-qaSpacesDemo", "list", "-qaWorkbenchDemo",
                               "-qaPageDemo", "-qaDark", "-qaConversation", "thr_botdemo01",
                               "-UIPreferredContentSizeCategoryName", size.rawValue]
            + (macOnly ? ["-qaWorkbenchMacOnly"] : [])
        app.launchOffline()
        XCTAssertTrue(app.textViews["Message"].waitForExistence(timeout: 30), "the conversation")
    }

    private func command(_ path: String) {
        XCUIDevice.shared.system.open(URL(string: "bbstudio://qa-duo/" + path)!)
        sleep(2)
    }

    /// A posture in a window: the simulator has no hinge, so the posture is named.
    private func show(_ posture: String, _ window: String, _ size: CGSize) {
        command("posture?" + posture)
        command(window)
        let frame = app.windows.firstMatch
        let sized = NSPredicate { _, _ in abs(frame.frame.width - size.width) < 1 && abs(frame.frame.height - size.height) < 1 }
        expectation(for: sized, evaluatedWith: nil)
        waitForExpectations(timeout: 10)
        sleep(2)
    }

    private func capture(_ name: String) {
        guard ProcessInfo.processInfo.environment["SHELL_CAPTURE"] != nil else { return }
        command("capture?" + name)
    }

    private func element(_ id: String) -> XCUIElement { app.descendants(matching: .any).matching(identifier: id).firstMatch }

    // MARK: The default text size

    func testDefaultSizeSplitsTheConversationAndItsWorkbench() throws {
        try XCTSkipUnless(isDuo, "an iPhone Duo simulator")
        launch(.large)
        for posture in ["book", "flat"] {
            show(posture, "landscape", landscape)
            let conversation = element("conversationColumn")
            let workbench = element("workbenchPage")
            XCTAssertTrue(conversation.waitForExistence(timeout: 10), "\(posture): the conversation")
            XCTAssertTrue(workbench.exists, "\(posture): a page tab the phone can show takes the Workbench pane")
            XCTAssertFalse(element("homeColumn").exists, "\(posture): Home doesn't fit beside both")
            // The panes share the room between the safe areas.
            let share = conversation.frame.width / (conversation.frame.width + workbench.frame.width)
            XCTAssertEqual(share, 0.58, accuracy: 0.02, "\(posture): the conversation keeps the larger share")
            XCTAssertEqual(workbench.frame.minX, conversation.frame.maxX, accuracy: 1, "\(posture): the Workbench beside it")
            XCTAssertGreaterThanOrEqual(conversation.frame.width, 481, "about 60 characters a line")
            capture("\(posture)-landscape-default")
        }
        // Home from the conversation's bar comes over it, and goes again.
        app.press(element("homePane"), id: "homePane")
        XCTAssertTrue(element("homeColumn").waitForExistence(timeout: 10), "Home over the conversation")
        XCTAssertLessThan(element("homeColumn").frame.width, landscape.width / 2)
        capture("flat-landscape-default-home-over")
        // Modal to VoiceOver: its way out is the dimming (Close Home) or escape, not the bar under it.
        command("activate?homeOverlayScrim")
        XCTAssertTrue(element("homeColumn").waitForNonExistence(timeout: 10))
        portraitAndFolded(.large)
    }

    func testDefaultSizeGivesAMacOnlyTabNoPane() throws {
        try XCTSkipUnless(isDuo, "an iPhone Duo simulator")
        launch(.large, macOnly: true)
        for posture in ["book", "flat"] {
            show(posture, "landscape", landscape)
            XCTAssertTrue(element("conversationColumn").waitForExistence(timeout: 10), "\(posture): the conversation")
            XCTAssertFalse(element("workbenchPage").exists, "\(posture): a VS Code tab claims no pane")
            let home = element("homeColumn")
            XCTAssertTrue(home.exists, "\(posture): Home fits beside the conversation")
            XCTAssertGreaterThanOrEqual(home.frame.width, 269, "a name and its time on one line")
            XCTAssertGreaterThanOrEqual(element("conversationColumn").frame.width, 481)
            XCTAssertLessThanOrEqual(app.textViews["Message"].frame.maxX, element("conversationColumn").frame.maxX, "the composer in its column")
            capture("\(posture)-landscape-default-mac-tab")
        }
        XCTAssertTrue(element("workbenchTabs").exists, "no Workbench pane: its tab menu in the conversation's bar")
        app.press(element("homePane"), id: "homePane")
        XCTAssertTrue(element("homeColumn").waitForNonExistence(timeout: 10), "Home's button hides it")
        capture("flat-landscape-default-mac-tab-home-hidden")
        app.press(element("homePane"), id: "homePane")
        XCTAssertTrue(element("homeColumn").waitForExistence(timeout: 10), "and shows it again")
    }

    // MARK: Home over the conversation (review SF1-SF4)

    /// Home over the conversation is modal: the dimmed conversation and
    /// Workbench (the transcript's UIKit views too) leave VoiceOver, the
    /// dimming is its close button, and the composer's keyboard goes.
    /// Opening the hinge from book to flat keeps it.
    func testHomeOverTheConversationIsModalAndTakesTheKeyboard() throws {
        try XCTSkipUnless(isDuo, "an iPhone Duo simulator")
        launch(.large)
        show("book", "landscape", landscape)
        let message = app.textViews["Message"]
        command("activate?composerField")
        XCTAssertTrue(waitFor(message, focused: true), "the composer has the keyboard")

        app.press(element("homePane"), id: "homePane")
        XCTAssertTrue(element("homeColumn").waitForExistence(timeout: 10), "Home over the conversation")
        // Modal (XCUITest reads it as an alert): VoiceOver stays in it, off its siblings, the panes.
        let modal = app.alerts.firstMatch
        XCTAssertTrue(modal.exists, "Home over the conversation is modal")
        XCTAssertTrue(modal.descendants(matching: .any)["homeColumn"].exists)
        XCTAssertFalse(modal.descendants(matching: .any)["conversationColumn"].exists, "the conversation is outside it")
        XCTAssertFalse(modal.descendants(matching: .any)["workbenchPage"].exists, "the Workbench is outside it")
        XCTAssertEqual(covered("composerField"), "hidden", "the transcript's UIKit host leaves VoiceOver")
        XCTAssertTrue(waitFor(message, focused: false), "opening Home took the composer's keyboard")
        XCTAssertTrue(element("homeOverlayScrim").exists, "the dimming closes Home")
        XCTAssertEqual(element("homeOverlayScrim").label, "Close Home")
        capture("book-home-over-modal")

        show("flat", "landscape", landscape)
        XCTAssertTrue(element("homeColumn").exists, "book to flat is the same layout: Home stays over")

        command("activate?homeOverlayScrim")
        XCTAssertTrue(element("homeColumn").waitForNonExistence(timeout: 10), "the dimming closed Home")
        XCTAssertFalse(app.alerts.firstMatch.exists)
        XCTAssertEqual(covered("composerField"), "shown", "the conversation is back for VoiceOver")
        XCTAssertTrue(waitFor(message, focused: false), "the keyboard doesn't come back by itself")
    }

    /// The swipe from the left edge: a screen-edge pan over the conversation
    /// that opens Home; off while a screen is pushed (the stack's swipe goes
    /// back); a tap at the edge goes through to what is there.
    func testTheEdgeSwipeOpensHomeAndLeavesTapsAndBackAlone() throws {
        try XCTSkipUnless(isDuo, "an iPhone Duo simulator")
        launch(.large)
        show("book", "landscape", landscape)
        XCTAssertEqual(element("homeEdge").value as? String, "on")

        // A tap at the edge reaches the composer's + (the old 20 pt strip took it).
        let attach = app.buttons["Attach"]
        XCTAssertTrue(attach.waitForExistence(timeout: 5))
        let edgeTap = min(attach.frame.minX + 4, attach.frame.midX)
        app.coordinate(withNormalizedOffset: .zero).withOffset(CGVector(dx: edgeTap, dy: attach.frame.midY)).tap()
        XCTAssertTrue(app.buttons["Photo Library"].waitForExistence(timeout: 5), "the + menu at x \(edgeTap)")
        XCTAssertFalse(element("homeColumn").exists, "a tap is no swipe")
        // Away from the menu, on the transcript: the menu closes.
        app.coordinate(withNormalizedOffset: .zero).withOffset(CGVector(dx: 300, dy: 120)).tap()
        XCTAssertTrue(app.buttons["Photo Library"].waitForNonExistence(timeout: 5))

        swipeFromTheEdge()
        XCTAssertTrue(element("homeColumn").waitForExistence(timeout: 10), "the edge swipe brings Home over")
        XCTAssertEqual(element("homeEdge").value as? String, "off", "not again while it is over")
        command("activate?homeWorker-thr_demo_w2")
        let worker = element("conversation-thr_demo_w2")
        XCTAssertTrue(worker.waitForExistence(timeout: 10), "a worker, pushed in the column")
        XCTAssertEqual(element("homeEdge").value as? String, "off", "pushed: the edge belongs to the stack")
        swipeFromTheEdge()
        XCTAssertFalse(element("homeColumn").exists, "the edge swipe over a pushed screen doesn't open Home")
        app.press(element("BackButton"), id: "BackButton")
        XCTAssertTrue(worker.waitForNonExistence(timeout: 10), "the system's Back")
        XCTAssertEqual(element("homeEdge").value as? String, "on", "the conversation again: the swipe opens Home")
    }

    /// Review SF4: Home over the conversation closes when the last tab the
    /// phone can show closes (Home fits beside it now), and doesn't come
    /// back over it when a tab opens again.
    func testHomeOverTheConversationDoesNotComeBackUnasked() throws {
        try XCTSkipUnless(isDuo, "an iPhone Duo simulator")
        launch(.large)
        show("book", "landscape", landscape)
        app.press(element("homePane"), id: "homePane")
        XCTAssertTrue(element("homeOverlayScrim").waitForExistence(timeout: 10), "Home over the conversation")
        for _ in 0..<3 { command("workbench?close") }
        XCTAssertTrue(element("workbenchPage").waitForNonExistence(timeout: 10), "only the Mac-only tab is left: no Workbench pane")
        XCTAssertTrue(element("homeColumn").exists, "Home fits beside the conversation")
        XCTAssertFalse(element("homeOverlayScrim").exists, "beside it, not over it")
        command("workbench?open")
        XCTAssertTrue(element("workbenchPage").waitForExistence(timeout: 10), "a tab the phone can show takes the pane again")
        XCTAssertFalse(element("homeColumn").exists, "Home doesn't come back over the conversation unasked")
        XCTAssertTrue(app.textViews["Message"].exists)
    }

    /// Review SF5: one column with only a Mac-only tab: the Workbench button says 0 tabs and the Workbench "No tabs".
    func testAMacOnlyTabCountsAsNoneInOneColumn() throws {
        try XCTSkipUnless(isDuo, "an iPhone Duo simulator")
        launch(.large, macOnly: true)
        for (posture, window, size) in [("folded", "outer", outer), ("vertical", "portrait", portrait)] {
            show(posture, window, size)
            let workbench = element("workbenchButton")
            XCTAssertTrue(workbench.waitForExistence(timeout: 10), "\(posture): one column")
            XCTAssertEqual(workbench.label, "Workbench, 0 tabs", posture)
            app.press(element("workbenchButton"), id: "workbenchButton")
            XCTAssertTrue(element("workbenchEmpty").waitForExistence(timeout: 10), "\(posture): No tabs, as the count says")
            app.press(element("workbenchButton"), id: "workbenchButton")
            XCTAssertTrue(element("conversationTitle").waitForExistence(timeout: 10), "\(posture): the chat again")
        }
    }

    /// A drag in from the window's left edge, low on the conversation and on the simulator's screen.
    private func swipeFromTheEdge() {
        let start = app.coordinate(withNormalizedOffset: .zero).withOffset(CGVector(dx: 1, dy: 300))
        start.press(forDuration: 0.05, thenDragTo: start.withOffset(CGVector(dx: 260, dy: 0)), withVelocity: .default,
                    thenHoldForDuration: 0.05)
        sleep(1)
    }

    /// `qa-duo/covered`: whether VoiceOver reaches a UIKit view.
    private func covered(_ id: String) -> String? {
        command("covered?" + id)
        return app.windows.firstMatch.value as? String
    }

    private func waitFor(_ field: XCUIElement, focused: Bool) -> Bool {
        let predicate = NSPredicate { _, _ in (field.value(forKey: "hasKeyboardFocus") as? Bool ?? false) == focused }
        return XCTWaiter().wait(for: [XCTNSPredicateExpectation(predicate: predicate, object: nil)], timeout: 10) == .completed
    }

    // MARK: Large text

    func testXXXLargeIsOneBigColumn() throws {
        try XCTSkipUnless(isDuo, "an iPhone Duo simulator")
        launch(.xxxLarge)
        oneColumn(.xxxLarge)
        portraitAndFolded(.xxxLarge)
    }

    func testAnAccessibilitySizeIsOneBigColumn() throws {
        try XCTSkipUnless(isDuo, "an iPhone Duo simulator")
        launch(.accessibility)
        oneColumn(.accessibility)
        portraitAndFolded(.accessibility)
    }

    /// Book and flat where 60 characters and a readable Workbench don't both
    /// fit: the conversation alone across the screen, the Workbench a flip away.
    private func oneColumn(_ size: TextSize) {
        for posture in ["book", "flat"] {
            show(posture, "landscape", landscape)
            XCTAssertTrue(element("workbenchButton").waitForExistence(timeout: 10), "\(posture): the Workbench a flip away")
            XCTAssertFalse(element("conversationColumn").exists, "\(posture): no squeezed panes")
            XCTAssertFalse(element("workbenchPage").exists)
            capture("\(posture)-landscape-\(size.name)")
        }
        app.press(element("BackButton"), id: "BackButton")
        XCTAssertTrue(element("home").waitForExistence(timeout: 10), "Back is Home, as in vertical")
        capture("flat-landscape-\(size.name)-home")
        command("activate?homeConversation-thr_botdemo01")
        XCTAssertTrue(app.textViews["Message"].waitForExistence(timeout: 10))
    }

    // MARK: Every size

    /// Flat held upright, vertical and folded: one column at every size.
    private func portraitAndFolded(_ size: TextSize) {
        for posture in ["flat", "vertical"] {
            show(posture, "portrait", portrait)
            XCTAssertTrue(element("workbenchButton").waitForExistence(timeout: 10), "\(posture) upright: one column")
            XCTAssertFalse(element("conversationColumn").exists)
            capture("\(posture)-portrait-\(size.name)")
        }
        show("folded", "outer", outer)
        XCTAssertTrue(element("workbenchButton").waitForExistence(timeout: 10), "folded: one column")
        capture("folded-\(size.name)")
        app.press(element("BackButton"), id: "BackButton")
        XCTAssertTrue(element("home").waitForExistence(timeout: 10))
        capture("folded-\(size.name)-home")
    }
}
