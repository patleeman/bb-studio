import XCTest
@testable import BBStudio

/// Round 5, change 3: the Workspace's pure parts.
final class WorkspaceTests: XCTestCase {
    func testAtMostTwoHeavyViewsStayLoaded() {
        var mounted: [String] = []
        mounted = WorkspaceMounted.touch(mounted, "a", heavy: true)
        mounted = WorkspaceMounted.touch(mounted, "b", heavy: true)
        mounted = WorkspaceMounted.touch(mounted, "c", heavy: true)
        XCTAssertEqual(mounted, ["c", "b"], "the oldest goes")
        mounted = WorkspaceMounted.touch(mounted, "b", heavy: true)
        XCTAssertEqual(mounted, ["b", "c"], "a revisit moves it to the front")
        XCTAssertEqual(WorkspaceMounted.touch(mounted, "light", heavy: false), ["b", "c"], "light views don't count")
        XCTAssertEqual(WorkspaceMounted.prune(mounted, keeping: ["c"]), ["c"])
    }

    func testOnlyHttpLinksOpen() {
        func tab(_ url: String) -> WorkspaceTab { WorkspaceTab(id: "t", ref: .init(kind: "browser", url: url), title: "x", support: .web) }
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
        let state = WorkspaceState(output, threadId: "t")
        XCTAssertEqual(state.version, 7)
        XCTAssertEqual(state.tabs.map(\.id), ["a", "b"], "in position order")
        XCTAssertEqual(state.tabs[0].title, "README.md", "a nameless tab takes its path's name")
        XCTAssertEqual(state.tabs[0].support, .desktopOnly)
        XCTAssertTrue(state.tabs[1].openedByAgent)
        XCTAssertEqual(state.tabs[1].ref.kind, "design")
        XCTAssertTrue(state.tabs[1].heavy)
    }
}
