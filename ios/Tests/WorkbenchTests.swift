import SwiftUI
import XCTest
@testable import BBStudio

/// The Workbench's pure parts: loaded views, links, the contract, which tab shows, New tab's refs.
final class WorkbenchTests: XCTestCase {
    func testAtMostTwoHeavyViewsStayLoaded() {
        var mounted: [String] = []
        mounted = WorkbenchMounted.touch(mounted, "a", heavy: true)
        mounted = WorkbenchMounted.touch(mounted, "b", heavy: true)
        mounted = WorkbenchMounted.touch(mounted, "c", heavy: true)
        XCTAssertEqual(mounted, ["c", "b"], "the oldest goes")
        mounted = WorkbenchMounted.touch(mounted, "b", heavy: true)
        XCTAssertEqual(mounted, ["b", "c"], "a revisit moves it to the front")
        XCTAssertEqual(WorkbenchMounted.touch(mounted, "light", heavy: false), ["b", "c"], "light views don't count")
        XCTAssertEqual(WorkbenchMounted.prune(mounted, keeping: ["c"]), ["c"])
    }

    /// Review B3: the shown tab and the loaded heavy ones are one list, so
    /// switching between two loaded tabs keeps both views (nothing rebuilt).
    func testSwitchingKeepsBothLoadedTabsInOneList() {
        let tabs = ["a", "b", "c"].map { WorkbenchTab(id: $0, ref: .init(kind: $0 == "c" ? "file" : "page", id: $0), title: $0) }
        let mounted = ["b", "a"]
        let onA = WorkbenchMounted.kept(tabs, mounted: mounted, shown: "a").map(\.id)
        let onB = WorkbenchMounted.kept(tabs, mounted: mounted, shown: "b").map(\.id)
        XCTAssertEqual(onA, ["a", "b"])
        XCTAssertEqual(onA, onB, "the same views, only which one is hidden changes")
        XCTAssertEqual(WorkbenchMounted.kept(tabs, mounted: mounted, shown: "c").map(\.id), ["a", "b", "c"], "a light tab joins while shown")
        XCTAssertEqual(WorkbenchMounted.kept(tabs, mounted: [], shown: nil).map(\.id), [], "nothing shown, nothing loaded")
    }

    func testOnlyHttpLinksOpen() {
        func tab(_ url: String) -> WorkbenchTab { WorkbenchTab(id: "t", ref: .init(kind: "browser", url: url), title: "x", support: .web) }
        XCTAssertNotNil(tab("https://example.com/a").safeURL)
        XCTAssertNotNil(tab("http://example.test/a").safeURL)
        XCTAssertNil(tab("javascript:alert(1)").safeURL)
        XCTAssertNil(tab("file:///etc/hosts").safeURL)
        XCTAssertNil(tab("bbstudio://settings").safeURL)
    }

    func testStateFromTheContract() throws {
        let json = """
        {"threadId":"t","activeTabId":"b","panelOpen":true,"version":7,"tabs":[
          {"tabId":"b","ref":{"kind":"design","id":"dsn_1"},"title":"Stills","position":1,"openedBy":"agent","openedAt":2,"mobileSupport":"native"},
          {"tabId":"a","ref":{"kind":"vscode","path":"ios/README.md"},"title":"","position":0,"openedBy":"user","openedAt":1,"mobileSupport":"desktopOnly"}]}
        """
        let output = try JSONDecoder().decode(Studio.ThreadWorkbenchGetOutput.self, from: Data(json.utf8))
        let state = WorkbenchState(output, threadId: "t")
        XCTAssertEqual(state.version, 7)
        XCTAssertEqual(state.tabs.map(\.id), ["a", "b"], "in position order")
        XCTAssertEqual(state.tabs[0].title, "README.md", "a nameless tab takes its path's name")
        XCTAssertEqual(state.tabs[0].support, .desktopOnly)
        XCTAssertTrue(state.tabs[1].openedByAgent)
        XCTAssertEqual(state.tabs[1].ref.kind, "design")
        XCTAssertTrue(state.tabs[1].heavy)
    }

    func testTheShownTabIsThePickedOneElseStudiosActiveElseTheFirst() {
        let tabs = ["a", "b", "c"].map { WorkbenchTab(id: $0, ref: .init(kind: "page", id: $0), title: $0) }
        XCTAssertEqual(WorkbenchStore.selected(tabs, picked: "c", active: "b")?.id, "c")
        XCTAssertEqual(WorkbenchStore.selected(tabs, picked: "gone", active: "b")?.id, "b", "a closed pick falls back")
        XCTAssertEqual(WorkbenchStore.selected(tabs, picked: nil, active: nil)?.id, "a")
        XCTAssertNil(WorkbenchStore.selected([], picked: "a", active: "a"), "no tabs: the empty Workbench")
    }

    /// Round 7 fix: a tab only the Mac opens never claims the Workbench, picked, active or first.
    func testATabOnlyTheMacOpensIsNeverShown() {
        let code = WorkbenchTab(id: "code", ref: .init(kind: "vscode", path: "a.swift"), title: "VS Code", support: .desktopOnly)
        let page = WorkbenchTab(id: "page", ref: .init(kind: "page", id: "p"), title: "Page")
        XCTAssertNil(WorkbenchStore.selected([code], picked: "code", active: "code"), "nothing to show: no pane")
        XCTAssertEqual(WorkbenchStore.selected([code, page], picked: nil, active: "code")?.id, "page")
        XCTAssertEqual(WorkbenchStore.selected([code, page], picked: "code", active: nil)?.id, "page")
        XCTAssertFalse(WorkbenchTabKind(code).showsOnPhone)
        XCTAssertTrue(WorkbenchTabKind(page).showsOnPhone)
    }

    func testNewTabOpensStudioItemsByKind() throws {
        func item(_ href: String) throws -> Studio.SearchAllOutputItem {
            try JSONDecoder().decode(Studio.SearchAllOutputItem.self, from: Data(#"{"title":"x","href":"\#(href)"}"#.utf8))
        }
        XCTAssertEqual(WorkbenchNewTab.ref(try item("/plugins/studio/studio/pages/pg_1"))?.kind, "page")
        XCTAssertEqual(WorkbenchNewTab.ref(try item("/plugins/studio/studio/pages/pg_1"))?.id, "pg_1")
        XCTAssertNil(WorkbenchNewTab.ref(try item("/somewhere/else")), "what can't be a tab isn't offered")
    }
}

/// A hidden, still-loaded tab's actions never reach the More menu; the shown tab's do.
@MainActor
final class ScreenActionsTests: XCTestCase {
    private struct Tab: View {
        let id: String
        var body: some View {
            Color.clear.frame(width: 10, height: 10)
                .screenActions([ScreenAction(id: id, title: id, systemImage: "star")])
        }
    }

    private final class Box { var ids: [String] = [] }

    private func reported(_ view: some View) -> [String] {
        let box = Box()
        let renderer = ImageRenderer(content: view.onPreferenceChange(ScreenActionsKey.self) { actions in
            MainActor.assumeIsolated { box.ids = actions.map(\.id) }
        })
        _ = renderer.uiImage
        return box.ids
    }

    func testTheShownTabsActionsWinOverAHiddenOnesAfterIt() {
        XCTAssertEqual(reported(ZStack { Tab(id: "shown"); Tab(id: "hidden").modifier(WorkbenchHiddenTab()) }), ["shown"])
        XCTAssertEqual(reported(ZStack { Tab(id: "hidden").modifier(WorkbenchHiddenTab()); Tab(id: "shown") }), ["shown"])
    }

    /// Re-review S7: a screen's own list (an empty one, or none) doesn't
    /// override what its content shows (an editor's Save and Cancel).
    func testTheInnermostActionsWin() {
        XCTAssertEqual(reported(Tab(id: "save").screenActions([])), ["save"])
        XCTAssertEqual(reported(Tab(id: "save").screenActions([ScreenAction(id: "edit", title: "Edit", systemImage: "pencil")])), ["save"])
        XCTAssertEqual(reported(Color.clear.frame(width: 10, height: 10).screenActions([ScreenAction(id: "edit", title: "Edit", systemImage: "pencil")])), ["edit"])
    }

    func testAHiddenTabAloneReportsNone() {
        XCTAssertEqual(reported(ZStack { Tab(id: "hidden").modifier(WorkbenchHiddenTab()) }), [])
    }
}
