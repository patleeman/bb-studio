import XCTest

/// The Workbench menu's New actions, offline (TestFlight 20261128.1522: "a
/// few new page new etc options on the workbench button. Like in bb"): a
/// long press on the Workbench button, or a tap on the Workbench's title,
/// offers New page, New whiteboard, New design, New app, Open link and New
/// tab…; what it makes opens as the shown tab, the Workbench in view. The
/// demo Workbench (`-qaWorkbenchDemo`) makes items without a server.
final class WorkbenchMenuUITests: ServerIsolatedUITestCase {
    private let app = XCUIApplication()
    private var isDuo: Bool { UIDevice.current.name.lowercased().contains("duo") }
    private let landscape = CGSize(width: 951, height: 669)
    private let outer = CGSize(width: 466, height: 678)
    private let added = ["New page", "New whiteboard", "New design", "New app", "Open link…", "New tab…"]

    private func launch(_ extra: [String] = []) {
        app.launchArguments = ["-skipPushPrompt", "YES", "-qaBotDemo", "chat", "-qaSpacesDemo", "list", "-qaWorkbenchDemo",
                               "-qaPageDemo", "-qaConversation", "thr_botdemo01", "-qaForgetWorkbenchPanes"] + extra
        app.launchOffline()
        XCTAssertTrue(app.textViews["Message"].waitForExistence(timeout: 30), "the conversation")
    }

    private func window(_ name: String, _ size: CGSize) {
        XCUIDevice.shared.system.open(URL(string: "bbstudio://qa-duo/" + name)!)
        let frame = app.windows.firstMatch
        let sized = NSPredicate { _, _ in abs(frame.frame.width - size.width) < 1 && abs(frame.frame.height - size.height) < 1 }
        expectation(for: sized, evaluatedWith: nil)
        waitForExpectations(timeout: 10)
        sleep(2)
    }

    private func element(_ id: String) -> XCUIElement { app.descendants(matching: .any)[id].firstMatch }

    /// The menu lists the add section in the desktop's order. A system menu's
    /// items keep their labels, not always their identifiers.
    private func assertTheAddSection(_ state: String, file: StaticString = #filePath, line: UInt = #line) {
        XCTAssertTrue(app.buttons["New page"].waitForExistence(timeout: 5), "\(state): the menu", file: file, line: line)
        let tops = added.map { app.buttons[$0].firstMatch }
        for (title, button) in zip(added, tops) { XCTAssertTrue(button.exists, "\(state): \(title)", file: file, line: line) }
        let ys = tops.map(\.frame.minY)
        XCTAssertEqual(ys, ys.sorted(), "\(state): in the desktop's order", file: file, line: line)
    }

    /// Phone-sized (the iPhone, the folded Duo): a long press on the Workbench
    /// button, New page, and the Workbench shows it in the chat's place.
    private func newPageFromTheButton(_ state: String) {
        let button = element("workbenchButton")
        XCTAssertTrue(button.waitForExistence(timeout: 10), "\(state): the Workbench button")
        XCTAssertEqual(button.label, "Workbench, 3 tabs", "\(state): the chat shows")
        button.press(forDuration: 1.0)
        assertTheAddSection(state)
        app.buttons["New page"].tap()
        let title = element("workbenchTitle")
        XCTAssertTrue(title.waitForExistence(timeout: 10), "\(state): the Workbench comes into view")
        XCTAssertTrue(title.label.contains("Untitled page"), "\(state): the new page is the shown tab: \(title.label)")

        // From the title's menu too: New design, and back to the chat it's 5 tabs.
        title.tap()
        assertTheAddSection("\(state), the title's menu")
        app.buttons["New design"].tap()
        let designed = NSPredicate { _, _ in title.label.contains("Untitled design") }
        expectation(for: designed, evaluatedWith: nil)
        waitForExpectations(timeout: 10)
        element("workbenchButton").tap()
        XCTAssertTrue(element("conversationTitle").waitForExistence(timeout: 10), "\(state): a tap still flips to the chat")
        XCTAssertEqual(element("workbenchButton").label, "Workbench, 5 tabs", "\(state): both made tabs counted")

        // Open link: a typed address opens as a browser tab, the Workbench in view.
        element("workbenchButton").press(forDuration: 1.0)
        XCTAssertTrue(app.buttons["Open link…"].waitForExistence(timeout: 5))
        app.buttons["Open link…"].tap()
        let field = app.alerts.textFields.firstMatch
        XCTAssertTrue(field.waitForExistence(timeout: 5), "\(state): Open link asks for the address")
        XCTAssertFalse(app.alerts.buttons["Open"].isEnabled, "\(state): nothing to open yet")
        field.typeText("example.org/a")
        XCTAssertTrue(app.alerts.buttons["Open"].isEnabled, "\(state): a web address opens")
        app.alerts.buttons["Open"].tap()
        XCTAssertTrue(title.waitForExistence(timeout: 10), "\(state): the Workbench comes into view")
        let linked = NSPredicate { _, _ in title.label.contains("example.org") }
        expectation(for: linked, evaluatedWith: nil)
        waitForExpectations(timeout: 10)
    }

    func testNewPageFromTheWorkbenchButtonOnTheIPhone() throws {
        try XCTSkipIf(isDuo, "the iPhone")
        launch()
        newPageFromTheButton("iPhone")
    }

    func testNewPageFromTheWorkbenchButtonOnTheFoldedDuo() throws {
        try XCTSkipUnless(isDuo, "an iPhone Duo simulator")
        launch(["-qaPosture", "folded"])
        window("outer", outer)
        newPageFromTheButton("folded")
    }

    /// Open: the Workbench's title over its pane offers the same menu; a page
    /// made from it is the pane's tab. Hidden by hand, the Workbench button's
    /// long press brings the pane back with the new tab.
    func testNewPageOpensInThePaneOnTheOpenDuo() throws {
        try XCTSkipUnless(isDuo, "an iPhone Duo simulator")
        launch(["-qaPosture", "flat"])
        window("landscape", landscape)
        XCTAssertTrue(element("workbenchPage").waitForExistence(timeout: 10))
        // The right page on the simulator's screen, where a finger lands.
        window("split-right", landscape)
        let title = element("workbenchTitle")
        XCTAssertTrue(title.waitForExistence(timeout: 10))
        title.coordinate(withNormalizedOffset: CGVector(dx: 0.5, dy: 0.5)).tap()
        assertTheAddSection("open, the title's menu")
        app.buttons["New page"].tap()
        let paged = NSPredicate { _, _ in title.label.contains("Untitled page") }
        expectation(for: paged, evaluatedWith: nil)
        waitForExpectations(timeout: 10)

        // Hidden by hand: the button's long press adds a whiteboard and the pane comes back.
        let button = element("workbenchButton")
        app.press(button, id: "workbenchButton")
        XCTAssertTrue(element("workbenchPage").waitForNonExistence(timeout: 10), "the pane hidden")
        try XCTSkipUnless(button.isHittable, "the control strip off the simulator's screen: the menu is checked from the title")
        button.press(forDuration: 1.0)
        assertTheAddSection("open, the button's menu")
        app.buttons["New whiteboard"].tap()
        XCTAssertTrue(element("workbenchPage").waitForExistence(timeout: 10), "the pane comes back")
        XCTAssertTrue(element("workbenchTitle").label.contains("Untitled whiteboard"), element("workbenchTitle").label)
    }
}
