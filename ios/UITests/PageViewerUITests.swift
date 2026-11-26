import XCTest

/// Round 7: the page viewer at desktop parity, offline (`-qaPageDemo`: a page
/// with every block kind, two comment threads and two images).
/// `VIEWERS_OUT` keeps PNGs.
final class PageViewerUITests: ServerIsolatedUITestCase {
    private let app = XCUIApplication()

    private func openPage() {
        app.launchArguments = ["-skipPushPrompt", "YES", "-qaBotDemo", "chat", "-qaSpacesDemo", "list",
                               "-qaRoomConversation", "thr_botdemo01", "-qaPageDemo"]
        app.launchOffline()
        XCTAssertTrue(app.textViews["Message"].waitForExistence(timeout: 30))
        XCUIDevice.shared.system.open(URL(string: "bbstudio://page/qa-demo")!)
        XCTAssertTrue(app.descendants(matching: .any)["pageScroll"].waitForExistence(timeout: 15), "the page opens")
    }

    private func block(_ id: String) -> XCUIElement { app.descendants(matching: .any)["pageBlock-\(id)"].firstMatch }

    func testThePageDrawsEveryBlockKind() {
        openPage()
        XCTAssertTrue(app.descendants(matching: .any)["pageCallout-warning"].waitForExistence(timeout: 5), "a callout in its tone")
        XCTAssertTrue(app.staticTexts["Owner: "].exists || app.links["Home"].exists, "the mention is a link")
        XCTAssertTrue(app.descendants(matching: .any)["pageIcon"].exists, "the icon")
        let scroll = app.descendants(matching: .any)["pageScroll"]
        scroll.swipeUp()
        let toggle = app.descendants(matching: .any)["pageToggle"].firstMatch
        XCTAssertTrue(toggle.waitForExistence(timeout: 5), "a toggle heading")
        XCTAssertFalse(app.staticTexts["The launch slips if the demo isn't recorded by Friday."].exists, "closed, as on the desktop")
        toggle.tap()
        XCTAssertTrue(app.staticTexts["The launch slips if the demo isn't recorded by Friday."].waitForExistence(timeout: 5), "and it opens")
        shot("page-blocks")
        scroll.swipeUp()
        scroll.swipeUp()
        XCTAssertTrue(app.descendants(matching: .any)["pageHTML"].waitForExistence(timeout: 5), "an html block")
        shot("page-blocks-2")
    }

    func testCommentMarksOpenTheirThreadAndShowInPageScrollsBack() {
        openPage()
        let mark = app.buttons["pageCommentMark-aaaa0004"]
        XCTAssertTrue(mark.waitForExistence(timeout: 10), "the Tasks heading shows its comment")
        mark.tap()
        XCTAssertTrue(app.staticTexts["Add the press kit."].waitForExistence(timeout: 5), "the thread opens")
        shot("page-comments")
        app.buttons["commentShow-th-2"].tap()
        XCTAssertTrue(block("aaaa0004").waitForExistence(timeout: 5))
        XCTAssertTrue(block("aaaa0004").isHittable, "Show in page brings the block on screen")
    }

    func testTouchAndHoldABlockToCommentOnIt() {
        openPage()
        let owner = block("aaaa0001")
        XCTAssertTrue(owner.waitForExistence(timeout: 10))
        owner.press(forDuration: 1.2)
        let comment = app.buttons["Comment"]
        XCTAssertTrue(comment.waitForExistence(timeout: 5), "the block's menu")
        comment.tap()
        XCTAssertTrue(app.navigationBars["New Comment"].waitForExistence(timeout: 5))
        let field = app.textFields["newCommentField"].exists ? app.textFields["newCommentField"] : app.textViews["newCommentField"]
        XCTAssertTrue(field.waitForExistence(timeout: 5))
        XCTAssertTrue(app.descendants(matching: .any)["commentQuotePicker"].waitForExistence(timeout: 5), "the block's text to pick words in")
        field.typeText("Name a backup owner")
        shot("page-new-comment")
        app.buttons["newCommentPost"].tap()
        let mark = app.buttons["pageCommentMark-aaaa0001"]
        XCTAssertTrue(mark.waitForExistence(timeout: 5))
        XCTAssertEqual(mark.label, "2 comments", "the new thread joins the block's mark")
    }

    func testResolvingAThreadClearsItsMarkAndReopenBringsItBack() {
        openPage()
        app.buttons["pageCommentMark-aaaa0004"].tap()
        let resolve = app.buttons["commentResolve-th-2"]
        XCTAssertTrue(resolve.waitForExistence(timeout: 5))
        resolve.tap()
        XCTAssertTrue(app.staticTexts["No open comments"].waitForExistence(timeout: 5) || !app.staticTexts["Add the press kit."].exists)
        app.segmentedControls.buttons["Resolved"].tap()
        XCTAssertTrue(app.staticTexts["Add the press kit."].waitForExistence(timeout: 5), "under Resolved")
        app.buttons["commentResolve-th-2"].tap()
        app.buttons["Done"].tap()
        XCTAssertTrue(app.buttons["pageCommentMark-aaaa0004"].waitForExistence(timeout: 5), "reopened, its mark is back")
    }

    func testAnImageOpensTheLightboxThatSwipesThroughThePagesImages() {
        openPage()
        let scroll = app.descendants(matching: .any)["pageScroll"]
        let image = app.descendants(matching: .any).matching(identifier: "markdownImage").firstMatch
        for _ in 0..<6 where !image.isHittable { scroll.swipeUp() }
        XCTAssertTrue(image.waitForExistence(timeout: 10), "the first image")
        image.tap()
        let gallery = app.descendants(matching: .any)["pageImageGallery"].firstMatch
        XCTAssertTrue(gallery.waitForExistence(timeout: 5), "the lightbox")
        XCTAssertTrue(app.navigationBars["1 of 2"].waitForExistence(timeout: 5))
        let zoomable = app.descendants(matching: .any)["zoomable"].firstMatch
        zoomable.pinch(withScale: 2.5, velocity: 2)
        shot("page-image-zoomed")
        zoomable.doubleTap()
        app.swipeLeft()
        XCTAssertTrue(app.navigationBars["2 of 2"].waitForExistence(timeout: 5), "a swipe goes to the page's next image")
        shot("page-image-second")
    }

    func testActionsAndEditor() {
        openPage()
        XCTAssertTrue(app.screenAction("edit").waitForExistence(timeout: 10), "Edit is one of the two buttons (bar or rail)")
        XCTAssertTrue(app.screenAction("comments").exists, "and Comments the other")
        app.screenMore.tap()
        for title in ["Add a Page Inside", "Copy Reference", "Version History", "Export PDF", "Delete"] {
            XCTAssertTrue(app.buttons[title].waitForExistence(timeout: 5), title)
        }
        shot("page-more")
        app.buttons["Change Icon"].tap()
        XCTAssertTrue(app.buttons["pageIcon-🧠"].waitForExistence(timeout: 5), "the desktop's icons")
        app.buttons["Cancel"].tap()
        app.screenAction("edit").tap()
        XCTAssertTrue(app.textViews["pageEditor"].waitForExistence(timeout: 5))
        app.buttons["Insert"].tap()
        XCTAssertTrue(app.buttons["Callout"].waitForExistence(timeout: 5), "the slash menu's blocks")
        XCTAssertTrue(app.buttons["Photo"].exists)
        shot("page-editor-insert")
        app.buttons["Callout"].tap()
        XCTAssertTrue((app.textViews["pageEditor"].value as? String)?.contains("> [!NOTE]") == true)
        app.buttons["Mention"].firstMatch.tap()
        XCTAssertTrue(app.staticTexts["Next Monday"].waitForExistence(timeout: 5), "dates to mention")
    }

    /// The shell's Workbench, offline: its first tab is this page. The tab draws no bar
    /// and no Work bar; its actions are at the top of the conversation's More.
    func testAPageTabHasNoBarAndHandsItsActionsToMore() {
        app.launchArguments = ["-skipPushPrompt", "YES", "-qaBotDemo", "chat", "-qaSpacesDemo", "list",
                               "-qaRoomConversation", "thr_botdemo01", "-qaWorkbenchDemo", "-qaPageDemo"]
        app.launchOffline()
        XCTAssertTrue(app.textViews["Message"].waitForExistence(timeout: 30))
        let either = { (ids: [String]) in self.app.buttons.matching(NSPredicate(format: "identifier IN %@", ids)).firstMatch }
        either(["workbenchButton", "rail-workbench"]).tap()
        XCTAssertTrue(app.staticTexts["Callouts take their tone's colour."].waitForExistence(timeout: 15), "the page tab")
        XCTAssertFalse(app.buttons["screenAction-edit"].exists, "no bar of its own")
        XCTAssertFalse(app.textFields["Work with this page…"].exists || app.textViews["Work with this page…"].exists, "no second composer")
        shot("page-tab")
        either(["conversationMore", "rail-more"]).tap()
        // A system menu: its items keep their labels, not always their identifiers.
        XCTAssertTrue(app.buttons["Edit"].waitForExistence(timeout: 5), "Edit at the top of More")
        XCTAssertTrue(app.buttons.matching(NSPredicate(format: "label BEGINSWITH 'Comments'")).firstMatch.exists, "and Comments")
        shot("page-tab-more")
    }

    private func shot(_ name: String) {
        guard let folder = ProcessInfo.processInfo.environment["VIEWERS_OUT"] else { return }
        let url = URL(fileURLWithPath: folder)
        try? FileManager.default.createDirectory(at: url, withIntermediateDirectories: true)
        try? XCUIScreen.main.screenshot().pngRepresentation.write(to: url.appendingPathComponent("\(name)-\(UIDevice.current.name).png"))
    }
}
