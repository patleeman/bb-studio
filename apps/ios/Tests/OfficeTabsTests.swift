import XCTest
@testable import BBStudio

final class OfficeTabsTests: XCTestCase {
    private func tab(_ ref: String, _ kind: OfficeTabKind = .thread, itemKind: String? = nil) -> OfficeTab {
        OfficeTab(ref: ref, kind: kind, zone: .today, openedAt: 1, itemKind: itemKind)
    }
    func testReferencesAndRoutes() {
        XCTAssertEqual(tab("thread:thr_1").threadId, "thr_1")
        XCTAssertNil(tab("thread:").threadId)
        XCTAssertNil(tab("thread:a:b").threadId)
        XCTAssertEqual(tab("item:pages:pg:a", .item).itemRef?.itemId, "pg:a")
        XCTAssertEqual(tab("item:pages:pg", .item).itemRef?.pluginId, "pages")
        XCTAssertNil(tab("item::pg", .item).itemRef)
        XCTAssertNil(tab("item:pages:", .item).itemRef)
        XCTAssertEqual(tab("thread:thr_1").route, .thread(id: "thr_1"))
        XCTAssertEqual(tab("bot:b", .bot).route, .botDesk(id: "b"))
        XCTAssertEqual(tab("conversation:c", .conversation).route, .savedView(id: "c"))
        XCTAssertEqual(tab("library:page", .library).route, .studioCollection)
        XCTAssertNil(tab("office:home", .home).route)
        XCTAssertNil(tab("office:inbox", .inbox).route)
        let cases: [(String, Route)] = [("page", .page(id: "i")), ("drawing", .drawing(id: "i")), ("artifact", .artifact(id: "i")), ("task", .task(id: "i")), ("board", .tasks), ("table", .table(id: "i")), ("recording", .recording(id: "i")), ("dictation", .recording(id: "i"))]
        for (kind, route) in cases {
            XCTAssertEqual(tab("item:plugin:i", .item, itemKind: kind).route, route)
            XCTAssertFalse(tab("item:plugin:i", .item, itemKind: kind).symbol.isEmpty)
        }
        XCTAssertNil(tab("item:plugin:i", .item, itemKind: "future").route)
    }
    func testUnknownKindIsSkippedWithoutLosingKnownTabs() throws {
        let known = try JSONSerialization.jsonObject(with: JSONEncoder().encode(tab("thread:t")))
        let data = try JSONSerialization.data(withJSONObject: ["seeded": true, "essentials": [], "pinned": [], "folders": [], "today": [["kind": "future"], known]])
        let result = try JSONDecoder().decode(OfficeTabsResult.self, from: data)
        XCTAssertEqual(result.today.map(\.ref), ["thread:t"])
        XCTAssertEqual(try JSONDecoder().decode(OfficeTab.self, from: JSONEncoder().encode(result.today[0])), result.today[0])
    }

    @MainActor func testStoreSeedsTitlesSearchMutationsAndTracking() async throws {
        let stub = TabsStub()
        let client = BBClient(baseURL: URL(string: "https://tabs.invalid")!)
        client.transport = { try await stub.request($0, $1, $2) }
        let store = TabsStore(spaceId: "s", client: client)
        await store.refresh()
        XCTAssertNil(store.error)
        XCTAssertEqual(store.title(for: try XCTUnwrap(store.today.first)), "Matching open")
        await store.refresh()
        let seedCount = await stub.seedCount
        XCTAssertEqual(seedCount, 1)
        let results = try await store.search("Matching")
        XCTAssertEqual(results.map(\.ref), ["thread:t", "thread:other", "item:pages:p"])
        XCTAssertEqual(results[1].zone, .archived)
        await store.noteOpened(.savedView(id: "channel"))
        await store.noteOpened(.page(id: "p"))
        await store.move("thread:t", to: .pinned, folderId: "f")
        await store.createFolder(name: "Notes")
        await store.renameFolder("f", to: "Work")
        await store.setFolderOpen("f", false)
        await store.deleteFolder("f")
        _ = try await store.archived(query: "x")
        await store.clearToday()
        let requests = await stub.inputs
        XCTAssertTrue(requests.contains { $0.0 == "tabs_open" && $0.1["ref"] == .string("conversation:channel") })
        XCTAssertTrue(requests.contains { $0.0 == "tabs_open" && $0.1["href"] == .string("/plugins/pages/pages/p") && $0.1["ref"] == nil })
        XCTAssertTrue(requests.contains { $0.0 == "tabs_move" && $0.1["folderId"] == .string("f") })
        XCTAssertTrue(requests.contains { $0.0 == "tabs_close_many" && $0.1["refs"] == .array([.string("thread:t")]) })
        XCTAssertTrue(requests.contains { $0.0 == "tab_folder_update" && $0.1["open"] == .bool(false) && $0.1["spaceId"] == nil })
        let before = await stub.getCount
        await store.receiveRealtime(.connected)
        let after = await stub.getCount
        XCTAssertEqual(after, before + 1)
        await stub.failNextMove()
        await store.archive("thread:t")
        XCTAssertNotNil(store.error)
        XCTAssertFalse(store.isLoading)
        XCTAssertEqual(store.today.count, 1)
    }
}

private actor TabsStub {
    var seeded = false
    var seedCount = 0
    var getCount = 0
    var inputs: [(String, [String: JSONValue])] = []
    var failMove = false
    func failNextMove() { failMove = true }
    func request(_ method: String, _ path: String, _ body: Data?) throws -> (Int, Data) {
        if path == "/api/v1/sidebar-bootstrap" {
            let thread: (String, String) -> [String: Any] = { id, title in ["id": id, "projectId": "p", "title": title, "status": "idle", "createdAt": 1, "updatedAt": 2, "pinnedAt": 1] }
            return (200, try JSONSerialization.data(withJSONObject: ["sections": [], "projects": [], "personalProject": ["id": "p", "name": "P", "threads": [thread("t", "Matching open"), thread("other", "Matching other")]]]))
        }
        let rpc = String(path.split(separator: "/").last!)
        let input = try JSONDecoder().decode([String: JSONValue].self, from: body!)
        inputs.append((rpc, input))
        let tab: [String: Any] = ["ref": "thread:t", "kind": "thread", "zone": "today", "openedAt": 1]
        var result: [String: Any] = ["ok": true]
        switch rpc {
        case "tabs_get":
            getCount += 1
            result = ["seeded": seeded, "essentials": [], "pinned": [], "folders": [], "today": [tab]]
        case "tabs_seed": seeded = true; seedCount += 1
        case "tabs_move" where failMove:
            failMove = false
            throw BBError(status: 500, message: "Move failed")
        case "tabs_open": result = ["tab": tab]
        case "office_search": result = ["results": [tab, ["ref": "item:pages:p", "kind": "item", "title": "Matching page", "zone": "archived", "openedAt": 1]]]
        case "tabs_archived": result = ["tabs": [tab, ["kind": "future"]]]
        case "tab_folder_create", "tab_folder_update": result = ["folder": ["id": "f", "name": "Work", "open": false, "position": 0]]
        default: break
        }
        return (200, try JSONSerialization.data(withJSONObject: ["ok": true, "result": result]))
    }
}
