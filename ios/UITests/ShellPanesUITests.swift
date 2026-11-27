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

    private func element(_ id: String) -> XCUIElement { app.descendants(matching: .any)[id] }

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
            // The panes share the room left of the rail's 84 pt column.
            let share = conversation.frame.width / (landscape.width - 84)
            XCTAssertEqual(share, 0.58, accuracy: 0.02, "\(posture): the conversation keeps the larger share")
            XCTAssertEqual(workbench.frame.minX, conversation.frame.maxX, accuracy: 1, "\(posture): the Workbench beside it")
            XCTAssertGreaterThanOrEqual(conversation.frame.width, 481, "about 60 characters a line")
            capture("\(posture)-landscape-default")
        }
        // Home from the rail comes over the conversation, and goes again.
        command("activate?rail-home")
        XCTAssertTrue(element("homeColumn").waitForExistence(timeout: 10), "Home over the conversation")
        XCTAssertLessThan(element("homeColumn").frame.width, landscape.width / 2)
        capture("flat-landscape-default-home-over")
        command("activate?rail-home")
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
            XCTAssertLessThanOrEqual(app.textViews["Message"].frame.maxX, landscape.width - 84, "the composer clear of the rail")
            capture("\(posture)-landscape-default-mac-tab")
        }
        command("activate?rail-home")
        XCTAssertTrue(element("homeColumn").waitForNonExistence(timeout: 10), "Home in the rail hides it")
        capture("flat-landscape-default-mac-tab-home-hidden")
        command("activate?rail-home")
        XCTAssertTrue(element("homeColumn").waitForExistence(timeout: 10), "and shows it again")
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
            XCTAssertTrue(element("rail-workbench").waitForExistence(timeout: 10), "\(posture): the Workbench a flip away")
            XCTAssertFalse(element("conversationColumn").exists, "\(posture): no squeezed panes")
            XCTAssertFalse(element("workbenchPage").exists)
            capture("\(posture)-landscape-\(size.name)")
        }
        command("activate?rail-home")
        XCTAssertTrue(element("home").waitForExistence(timeout: 10), "Home, as in vertical")
        capture("flat-landscape-\(size.name)-home")
        command("activate?homeConversation-thr_botdemo01")
        XCTAssertTrue(app.textViews["Message"].waitForExistence(timeout: 10))
    }

    // MARK: Every size

    /// Flat held upright, vertical and folded: one column at every size.
    private func portraitAndFolded(_ size: TextSize) {
        for posture in ["flat", "vertical"] {
            show(posture, "portrait", portrait)
            XCTAssertTrue(element("rail-workbench").waitForExistence(timeout: 10), "\(posture) upright: one column")
            XCTAssertFalse(element("conversationColumn").exists)
            capture("\(posture)-portrait-\(size.name)")
        }
        show("folded", "outer", outer)
        XCTAssertTrue(element("rail-workbench").waitForExistence(timeout: 10), "folded: one column")
        capture("folded-\(size.name)")
        command("activate?rail-home")
        XCTAssertTrue(element("home").waitForExistence(timeout: 10))
        capture("folded-\(size.name)-home")
    }
}
