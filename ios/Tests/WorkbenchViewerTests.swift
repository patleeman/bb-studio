import XCTest
@testable import BBStudio

/// Round 7: what each Workbench tab kind shows, and the design viewer's pure parts.
@MainActor
final class WorkbenchViewerTests: XCTestCase {
    private func tab(_ kind: String, id: String? = nil, path: String? = nil, environmentId: String? = nil, url: String? = nil,
                     support: WorkspaceTab.Support = .native) -> WorkspaceTab {
        WorkspaceTab(id: "t", ref: .init(kind: kind, id: id, path: path, environmentId: environmentId, url: url), title: "T", support: support)
    }

    func testEveryKindHasItsView() {
        XCTAssertEqual(WorkbenchTabKind(tab("page", id: "pg_1")), .page("pg_1"))
        XCTAssertEqual(WorkbenchTabKind(tab("design", id: "dsn_1")), .design("dsn_1"))
        XCTAssertEqual(WorkbenchTabKind(tab("whiteboard", id: "drw_1")), .item(.drawing(id: "drw_1")))
        XCTAssertEqual(WorkbenchTabKind(tab("recording", id: "rec_1", support: .web)), .item(.recording(id: "rec_1")),
                       "recordings open natively although Studio says web")
        XCTAssertEqual(WorkbenchTabKind(tab("file", path: "a/b.swift", environmentId: "env_1")), .file(path: "a/b.swift", environmentId: "env_1"))
        XCTAssertEqual(WorkbenchTabKind(tab("file", path: "/tmp/shot.png")), .file(path: "/tmp/shot.png", environmentId: nil))
        XCTAssertEqual(WorkbenchTabKind(tab("diff", path: "a/b.swift")), .diff(path: "a/b.swift"), "a diff needs no environment")
        XCTAssertEqual(WorkbenchTabKind(tab("diff")), .diff(path: nil))
        XCTAssertEqual(WorkbenchTabKind(tab("browser", url: "https://example.com", support: .web)), .browser(URL(string: "https://example.com")!))
        XCTAssertEqual(WorkbenchTabKind(tab("browser", url: "javascript:alert(1)", support: .web)), .unsafeLink)
        XCTAssertEqual(WorkbenchTabKind(tab("terminal")), .terminal)
        XCTAssertEqual(WorkbenchTabKind(tab("worker", id: "thr_1")), .thread("thr_1", worker: true))
        XCTAssertEqual(WorkbenchTabKind(tab("vscode", support: .desktopOnly)), .desktopOnly)
        XCTAssertEqual(WorkbenchTabKind(tab("memory", support: .web)), .web)
        XCTAssertEqual(WorkbenchTabKind(tab("page")), .incomplete)
        XCTAssertEqual(WorkbenchTabKind(tab("file")), .incomplete)
    }

    func testADiffTabFindsItsFileByRelativeOrAbsolutePath() {
        let diff = WorkbenchDiff(environmentId: "env", root: "/work/repo",
                                 changes: [.init(path: "ios/App.swift", status: "M", insertions: 3, deletions: 1)],
                                 diffs: ["ios/App.swift": "@@ -1 +1 @@", "renamed.swift": "@@ -0,0 +1 @@"])
        XCTAssertEqual(diff.files.map(\.path), ["ios/App.swift", "renamed.swift"], "a diff without a status line still shows")
        XCTAssertEqual(diff.files(matching: "ios/App.swift").count, 1)
        XCTAssertEqual(diff.files(matching: "/work/repo/ios/App.swift").count, 1)
        XCTAssertEqual(diff.files(matching: "./ios/App.swift").count, 1)
        XCTAssertTrue(diff.files(matching: "other.swift").isEmpty)
        XCTAssertEqual(diff.added, 3)
        XCTAssertEqual(diff.removed, 1)
    }

    // MARK: Designs

    func testCommentsAreNumberedByWhenTheyWereMadeOpenAndResolved() throws {
        let json = """
            {"id":"dsn_1","comments":[{"id":"b","screenId":"1a","selector":"h1","body":"Second","createdAt":2},
                                      {"id":"c","screenId":"1b","selector":"p","body":"Third","createdAt":3,"sent":true}],
             "resolvedComments":[{"id":"a","screenId":"1a","selector":"h2","body":"First","createdAt":1,"resolvedAt":5}],
             "rounds":[{"round":1,"screens":[{"id":"1a"},{"id":"1b"}]}]}
            """
        let design = try JSONDecoder().decode(StudioDesign.self, from: Data(json.utf8))
        let comments = design.allComments
        XCTAssertEqual(comments.map(\.id), ["a", "b", "c"])
        XCTAssertEqual(comments.map(\.number), [1, 2, 3])
        XCTAssertEqual(comments.map(\.resolved), [true, false, false])
        XCTAssertTrue(comments[2].sent)
        XCTAssertEqual(design.round(of: "1b")?.round, 1)
        XCTAssertEqual(design.screen("1b")?.id, "1b")
    }

    func testTheScreenScriptsMessagesBecomeEvents() {
        let pick = DesignLiveFrame.event(["type": "pick", "selector": "#card2", "html": "<div>", "text": "Card 2",
                                          "rect": ["x": 1.0, "y": 2.0, "width": 3.0, "height": 4.0]])
        XCTAssertEqual(pick, .pick(DesignPick(selector: "#card2", html: "<div>", text: "Card 2", rect: CGRect(x: 1, y: 2, width: 3, height: 4))))
        XCTAssertEqual(DesignLiveFrame.event(["type": "pin", "id": "dc_1"]), .pin("dc_1"))
        XCTAssertEqual(DesignLiveFrame.event(["type": "text", "before": "Old", "text": "New"]), .text(before: "Old", after: "New"))
        XCTAssertEqual(DesignLiveFrame.event(["type": "not-editable"]), .notEditable)
        XCTAssertNil(DesignLiveFrame.event(["type": "ready"]))
        XCTAssertNil(DesignLiveFrame.event(["type": "pick"]), "a pick needs its selector")
    }

    func testExportAddressesAreStudios() throws {
        let client = BBClient(baseURL: URL(string: "https://design.invalid")!)
        let screen = try JSONDecoder().decode(DesignScreen.self, from: Data(#"{"id":"1a","updatedAt":7,"url":"/api/v1/plugins/studio/http/designs/screen?design=dsn_0123456789abcdef&screen=1a&v=7&s=7"}"#.utf8))
        XCTAssertEqual(client.designScreenFileURL("dsn_0123456789abcdef", screen, print: true).absoluteString,
                       "https://design.invalid/api/v1/plugins/studio/http/designs/print?design=dsn_0123456789abcdef&screen=1a&v=7&s=7")
        XCTAssertEqual(client.designScreenFileURL("dsn_0123456789abcdef", screen, print: false).absoluteString,
                       "https://design.invalid/api/v1/plugins/studio/http/designs/screen?design=dsn_0123456789abcdef&screen=1a&v=7&s=7&download=1")
    }
}
