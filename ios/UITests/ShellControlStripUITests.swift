import XCTest

/// The Duo's controls in the system's control strip, offline (round 8 fix:
/// "the left sidebar collapse button jumps from the Control Strip to top
/// left"). On the open Duo the conversation's stack reaches the window's
/// trailing edge in every state, with the Workbench pane inside it, so the
/// system keeps its bar buttons (Home, New, the Workbench, ⋯) together in the
/// strip. The Workbench button hides the pane and brings it back,
/// remembered per conversation.
///
/// The simulator draws its strip at the outer screen's edge whatever the
/// window, so it can't show where the device would put a stack's buttons:
/// these tests hold the layout to the rule (one stack to the edge, the
/// buttons in one place) and `ShellPanesTests` checks the widths.
final class ShellControlStripUITests: ServerIsolatedUITestCase {
    private let app = XCUIApplication()
    private var isDuo: Bool { UIDevice.current.name.lowercased().contains("duo") }
    private let landscape = CGSize(width: 951, height: 669)
    private let outer = CGSize(width: 466, height: 678)

    private func launch(posture: String, forget: Bool = true) {
        app.launchArguments = ["-skipPushPrompt", "YES", "-qaBotDemo", "chat", "-qaSpacesDemo", "list", "-qaWorkbenchDemo",
                               "-qaPageDemo", "-qaDark", "-qaConversation", "thr_botdemo01", "-qaPosture", posture]
            + (forget ? ["-qaForgetWorkbenchPanes"] : [])
        app.launchOffline()
        XCTAssertTrue(app.textViews["Message"].waitForExistence(timeout: 30), "the conversation")
    }

    private func command(_ path: String) {
        XCUIDevice.shared.system.open(URL(string: "bbstudio://qa-duo/" + path)!)
        sleep(2)
    }

    private func window(_ name: String, _ size: CGSize) {
        command(name)
        let frame = app.windows.firstMatch
        let sized = NSPredicate { _, _ in abs(frame.frame.width - size.width) < 1 && abs(frame.frame.height - size.height) < 1 }
        expectation(for: sized, evaluatedWith: nil)
        waitForExpectations(timeout: 10)
        sleep(2)
    }

    private func element(_ id: String) -> XCUIElement { app.descendants(matching: .any)[id].firstMatch }

    /// The shell's buttons, where the system put them.
    private struct Strip: Equatable {
        var home, new, workbench, more: CGRect
    }

    private func strip(_ state: String, file: StaticString = #filePath, line: UInt = #line) -> Strip {
        for id in ["homePane", "homeNew", "workbenchButton", "conversationMore"] {
            XCTAssertTrue(element(id).waitForExistence(timeout: 10), "\(state): \(id)", file: file, line: line)
        }
        let strip = Strip(home: element("homePane").frame, new: element("homeNew").frame,
                          workbench: element("workbenchButton").frame, more: element("conversationMore").frame)
        // One group: the same column, one above another.
        for frame in [strip.new, strip.workbench, strip.more] {
            XCTAssertEqual(frame.midX, strip.home.midX, accuracy: 1, "\(state): with Home's button", file: file, line: line)
        }
        return strip
    }

    /// The stack (the conversation, and its Workbench inside it) reaches the window's trailing edge.
    private func assertTheStackReachesTheEdge(_ state: String, file: StaticString = #filePath, line: UInt = #line) {
        let stack = element("conversationColumn").frame
        XCTAssertEqual(stack.maxX, app.windows.firstMatch.frame.maxX, accuracy: 1, "\(state): the stack to the edge", file: file, line: line)
        let pages = app.pages(file: file, line: line)
        XCTAssertEqual(pages.home + pages.conversation + pages.side, landscape.width, accuracy: 1, "\(state): the whole width",
                       file: file, line: line)
        if element("workbenchPage").exists {
            XCTAssertTrue(element("conversationColumn").descendants(matching: .any)["workbenchPage"].exists,
                          "\(state): the Workbench on the stack", file: file, line: line)
            XCTAssertEqual(element("workbenchPage").frame.maxX, stack.maxX, accuracy: 1, file: file, line: line)
        }
    }

    /// With the Workbench beside the chat the bar's title is two: the chat's over its page, the tab's over the pane.
    private func assertTitlesOverTheirPanes(_ state: String, file: StaticString = #filePath, line: UInt = #line) {
        let page = element("workbenchPage").frame
        let chat = element("conversationTitle")
        let tab = element("workbenchTitle")
        XCTAssertTrue(chat.exists && tab.exists, "\(state): both titles", file: file, line: line)
        XCTAssertLessThanOrEqual(chat.frame.maxX, page.minX + 1, "\(state): the chat's title over its page", file: file, line: line)
        XCTAssertGreaterThanOrEqual(tab.frame.minX, page.minX - 1, "\(state): the tab's title over the Workbench", file: file, line: line)
    }

    // MARK: The open Duo

    /// A screen the phone already has, in a tab (a drawing): no bar of its own
    /// to hide the conversation's, its buttons stay in the strip, and its
    /// actions are in ⋯ with Open Full Screen.
    func testAScreenTabKeepsTheConversationsBar() throws {
        try XCTSkipUnless(isDuo, "an iPhone Duo simulator")
        launch(posture: "flat")
        window("landscape", landscape)
        XCTAssertTrue(element("workbenchPage").waitForExistence(timeout: 10))
        let first = strip("flat, a page tab")
        command("workbench?drawing")
        XCTAssertTrue(element("workbenchTitle").label.contains("Floor plan"), "the drawing's tab shows: \(element("workbenchTitle").label)")
        XCTAssertEqual(strip("flat, a drawing tab"), first, "the strip's buttons, where they were")
        assertTitlesOverTheirPanes("flat, a drawing tab")
        app.press(element("conversationMore"), id: "conversationMore")
        XCTAssertTrue(app.buttons["Open Full Screen"].waitForExistence(timeout: 5), "the drawing's actions in ⋯")
    }

    func testTheWorkbenchCollapsesAndComesBack() throws {
        try XCTSkipUnless(isDuo, "an iPhone Duo simulator")
        for posture in ["book", "flat"] {
            launch(posture: posture)
            window("landscape", landscape)
            let button = element("workbenchButton")
            XCTAssertTrue(element("workbenchPage").waitForExistence(timeout: 10), "\(posture): the Workbench beside the conversation")
            XCTAssertEqual(button.label, "Hide Workbench")
            let split = app.pages()

            app.press(button, id: "workbenchButton")
            XCTAssertTrue(element("workbenchPage").waitForNonExistence(timeout: 10), "\(posture): the button collapses it")
            XCTAssertTrue(button.label.hasPrefix("Workbench, "), "the tab count, as everywhere: \(button.label)")
            let alone = app.pages()
            XCTAssertEqual(alone.side, 0)
            XCTAssertEqual(alone.home + alone.conversation, landscape.width, accuracy: 1, "\(posture): the conversation takes the room")
            XCTAssertGreaterThan(alone.conversation, split.conversation)
            assertTheStackReachesTheEdge("\(posture), Workbench hidden")

            app.press(button, id: "workbenchButton")
            XCTAssertTrue(element("workbenchPage").waitForExistence(timeout: 10), "\(posture): and brings it back")
            XCTAssertEqual(app.pages().side, split.side, accuracy: 1)
            assertTheStackReachesTheEdge("\(posture), Workbench shown")
        }
    }

    func testTheHiddenWorkbenchIsRememberedForTheConversation() throws {
        try XCTSkipUnless(isDuo, "an iPhone Duo simulator")
        launch(posture: "flat")
        window("landscape", landscape)
        XCTAssertTrue(element("workbenchPage").waitForExistence(timeout: 10))
        app.press(element("workbenchButton"), id: "workbenchButton")
        XCTAssertTrue(element("workbenchPage").waitForNonExistence(timeout: 10))

        app.terminate()
        launch(posture: "flat", forget: false)
        window("landscape", landscape)
        XCTAssertTrue(element("workbenchButton").waitForExistence(timeout: 10))
        XCTAssertTrue(element("workbenchButton").label.hasPrefix("Workbench, "), "the conversation keeps its Workbench hidden")
        XCTAssertFalse(element("workbenchPage").exists)
        // The agent's tab is still there, a press away.
        app.press(element("workbenchButton"), id: "workbenchButton")
        XCTAssertTrue(element("workbenchPage").waitForExistence(timeout: 10))
    }

    /// Home's button stays in one place, with New, the Workbench and ⋯, in
    /// every state: Home beside, hidden or over the conversation; the
    /// Workbench shown or hidden.
    func testTheControlsStayPutInEveryState() throws {
        try XCTSkipUnless(isDuo, "an iPhone Duo simulator")
        for posture in ["book", "flat"] {
            launch(posture: posture)
            window("landscape", landscape)
            XCTAssertTrue(element("workbenchPage").waitForExistence(timeout: 10))
            XCTAssertFalse(element("homeColumn").exists, "\(posture): Home doesn't fit beside both")
            let first = strip("\(posture): Workbench shown, Home hidden")
            assertTheStackReachesTheEdge("\(posture): Workbench shown, Home hidden")
            assertTitlesOverTheirPanes("\(posture): at the root")

            // Home over the conversation: modal, so only a tap where its button is reaches it.
            app.press(element("homePane"), id: "homePane")
            XCTAssertTrue(element("homeOverlayScrim").waitForExistence(timeout: 10), "\(posture): Home over the conversation")
            tap(first.home)
            XCTAssertTrue(element("homeOverlayScrim").waitForNonExistence(timeout: 10),
                          "\(posture): Home's button, in the same place over Home, closes it")
            XCTAssertEqual(strip("\(posture): after Home over"), first)

            app.press(element("workbenchButton"), id: "workbenchButton")
            XCTAssertTrue(element("homeColumn").waitForExistence(timeout: 10), "\(posture): Workbench hidden, Home fits beside")
            XCTAssertEqual(strip("\(posture): Workbench hidden, Home shown"), first)
            assertTheStackReachesTheEdge("\(posture): Workbench hidden, Home shown")

            app.press(element("homePane"), id: "homePane")
            XCTAssertTrue(element("homeColumn").waitForNonExistence(timeout: 10), "\(posture): Home hidden by hand")
            XCTAssertEqual(strip("\(posture): Workbench hidden, Home hidden"), first)
            assertTheStackReachesTheEdge("\(posture): Workbench hidden, Home hidden")

            app.press(element("workbenchButton"), id: "workbenchButton")
            XCTAssertTrue(element("workbenchPage").waitForExistence(timeout: 10))
            XCTAssertEqual(strip("\(posture): Workbench shown again"), first)

            // A worker pushed over the conversation: Back leads, the shell's buttons stay.
            app.press(element("homePane"), id: "homePane")
            XCTAssertTrue(element("homeColumn").waitForExistence(timeout: 10), "\(posture): Home over, for a worker")
            command("activate?homeWorker-thr_demo_w2")
            XCTAssertTrue(element("conversation-thr_demo_w2").waitForExistence(timeout: 10), "\(posture): a worker, pushed")
            XCTAssertTrue(element("homePane").waitForExistence(timeout: 10))
            // The system's Back takes the strip's first slot; the shell's buttons follow it, in the same column.
            let back = element("BackButton")
            XCTAssertTrue(back.exists, "\(posture): Back over a pushed worker")
            XCTAssertEqual(back.frame.midX, first.home.midX, accuracy: 1, "\(posture): Back in the strip")
            XCTAssertEqual(back.frame.midY, first.home.midY, accuracy: 1, "\(posture): Back where Home's button was")
            let home = element("homePane").frame
            XCTAssertEqual(home.midX, first.home.midX, accuracy: 1, "\(posture): Home's button in the strip")
            XCTAssertGreaterThan(home.minY, back.frame.maxY, "\(posture): under Back")
            XCTAssertLessThan(home.minY - back.frame.maxY, 30, "\(posture): right under it, the next slot")
            assertTheStackReachesTheEdge("\(posture): a worker pushed")
            // Back in the strip, not the bar: the two titles keep their places.
            assertTitlesOverTheirPanes("\(posture): a worker pushed")
            app.terminate()
        }
    }

    /// The Workbench's title is the stack's bar's, over the pane: a finger on it opens the tab menu.
    func testTheWorkbenchTitleTakesATap() throws {
        try XCTSkipUnless(isDuo, "an iPhone Duo simulator")
        launch(posture: "flat")
        window("landscape", landscape)
        XCTAssertTrue(element("workbenchPage").waitForExistence(timeout: 10))
        // The right page on the simulator's screen, where a tap lands.
        window("split-right", landscape)
        let title = element("workbenchTitle")
        XCTAssertTrue(title.waitForExistence(timeout: 10))
        XCTAssertLessThan(title.frame.maxX, outer.width, "the title on the simulator's screen: \(title.frame)")
        title.coordinate(withNormalizedOffset: CGVector(dx: 0.5, dy: 0.5)).tap()
        XCTAssertTrue(app.buttons["New tab…"].waitForExistence(timeout: 5), "the tab menu, from a tap on the title")
    }

    // MARK: The folded Duo

    /// Folded, one column: the conversation's buttons stay in the strip with the Workbench in the chat's place or not.
    func testTheFoldedControlsStayPut() throws {
        try XCTSkipUnless(isDuo, "an iPhone Duo simulator")
        launch(posture: "folded")
        window("outer", outer)
        let workbench = element("workbenchButton")
        let more = element("conversationMore")
        XCTAssertTrue(workbench.waitForExistence(timeout: 10))
        XCTAssertFalse(element("homePane").exists, "folded: Home is Back, no sidebar")
        let frames = (workbench.frame, more.frame)
        XCTAssertGreaterThan(frames.0.minX, outer.width - 84, "in the strip, at the trailing edge")
        app.press(workbench, id: "workbenchButton")
        XCTAssertTrue(element("workbenchTitle").waitForExistence(timeout: 10), "the Workbench in the chat's place")
        XCTAssertEqual(workbench.frame, frames.0, "the Workbench button stays put")
        XCTAssertEqual(more.frame, frames.1, "and ⋯")
        app.press(workbench, id: "workbenchButton")
        XCTAssertTrue(element("conversationTitle").waitForExistence(timeout: 10))
        XCTAssertEqual(workbench.frame, frames.0)
    }

    /// A tap at a point in the window, as a thumb would.
    private func tap(_ frame: CGRect) {
        app.coordinate(withNormalizedOffset: .zero).withOffset(CGVector(dx: frame.midX, dy: frame.midY)).tap()
        sleep(1)
    }
}
