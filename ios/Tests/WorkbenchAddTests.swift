import XCTest
@testable import BBStudio

/// The Workbench menu's add section: the desktop's New actions in its order, what each makes, and Open link's addresses.
final class WorkbenchAddTests: XCTestCase {
    func testTheDesktopsNewActionsInItsOrderThenOpenLinkThenNewTab() {
        XCTAssertEqual(WorkbenchAdd.allCases.map(\.title),
                       ["New page", "New whiteboard", "New design", "New app", "Open link…", "New tab…"])
        XCTAssertEqual(WorkbenchAdd.allCases.map(\.symbol),
                       ["doc.text", "square.and.pencil", "paintpalette", "macwindow", "globe", "plus"],
                       "the desktop's FileText, Edit, Palette, AppWindow and Globe")
        XCTAssertEqual(Set(WorkbenchAdd.allCases.map(\.accessibilityId)).count, WorkbenchAdd.allCases.count)
    }

    func testEachNewActionMakesItsKindThroughStudio() {
        XCTAssertEqual(WorkbenchAdd.page.made, .item(pluginId: "pages", kind: "page", tab: "page"))
        XCTAssertEqual(WorkbenchAdd.design.made, .item(pluginId: "design", kind: "design", tab: "design"))
        XCTAssertEqual(WorkbenchAdd.app.made, .item(pluginId: "minis", kind: "mini", tab: "app"))
        XCTAssertEqual(WorkbenchAdd.whiteboard.made, .whiteboardPage, "a whiteboard lives in a page, as on the desktop")
        XCTAssertNil(WorkbenchAdd.link.made, "Open link asks for the address")
        XCTAssertNil(WorkbenchAdd.find.made, "New tab… finds an item")
    }

    func testTheNewTabIsTitledAsTheDesktopTitlesIt() {
        XCTAssertEqual(WorkbenchAdd.page.untitled, "Untitled page")
        XCTAssertEqual(WorkbenchAdd.whiteboard.untitled, "Untitled whiteboard")
        XCTAssertEqual(WorkbenchAdd.app.untitled, "Untitled app")
        XCTAssertNil(WorkbenchAdd.link.untitled, "Open link names its tab by the address")
        XCTAssertNil(WorkbenchAdd.find.untitled)
    }

    func testOpenLinkTakesWebAddressesOnly() {
        XCTAssertEqual(WorkbenchAdd.link("example.com/a")?.absoluteString, "https://example.com/a", "https when no scheme is typed")
        XCTAssertEqual(WorkbenchAdd.link("  http://example.test  ")?.absoluteString, "http://example.test")
        XCTAssertEqual(WorkbenchAdd.link("HTTPS://Example.com")?.host(), "Example.com")
        XCTAssertNotNil(WorkbenchAdd.link("http://localhost/a"))
        XCTAssertNil(WorkbenchAdd.link(""))
        XCTAssertNil(WorkbenchAdd.link("not a link"))
        XCTAssertNil(WorkbenchAdd.link("word"), "a bare word is no address")
        XCTAssertNil(WorkbenchAdd.link("javascript:alert(1)"))
        XCTAssertNil(WorkbenchAdd.link("file:///etc/hosts"))
        XCTAssertNil(WorkbenchAdd.link("bbstudio://settings"))
    }
}
