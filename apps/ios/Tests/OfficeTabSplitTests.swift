import XCTest
@testable import BBStudio

final class OfficeTabSplitTests: XCTestCase {
    private let split = #"{"ref":"split:s","kind":"split","title":"Thread | Notes","zone":"archived","folderId":"f","openedAt":12,"archivedAt":34,"members":[{"ref":"thread:t","kind":"thread","title":null},{"ref":"item:pages:p","kind":"item","title":"Notes","itemKind":"page","href":"/plugins/pages/pages/p"}]}"#

    func testMembersDecodeWithoutStorageFieldsInPaneOrder() throws {
        let tab = try JSONDecoder().decode(OfficeTab.self, from: Data(split.utf8))
        XCTAssertEqual(tab.kind, .split)
        let members = try XCTUnwrap(tab.members)
        XCTAssertEqual(members.map(\.ref), ["thread:t", "item:pages:p"])
        XCTAssertNil(members[0].title)
        XCTAssertEqual(members[1].title, "Notes")
        XCTAssertEqual(members[1].itemKind, "page")
        XCTAssertEqual(members[1].href, "/plugins/pages/pages/p")
        for member in members {
            XCTAssertEqual(member.zone, .archived)
            XCTAssertEqual(member.folderId, "f")
            XCTAssertEqual(member.openedAt, 12)
            XCTAssertEqual(member.archivedAt, 34)
            XCTAssertNil(member.members)
        }
        XCTAssertEqual(try JSONDecoder().decode(OfficeTab.self, from: JSONEncoder().encode(tab)), tab)
    }

    func testPlainTabsAndMalformedTopLevel() throws {
        for suffix in ["", ",\"members\":null"] {
            let json = "{\"ref\":\"thread:t\",\"kind\":\"thread\",\"zone\":\"today\",\"openedAt\":1\(suffix)}"
            XCTAssertNil(try JSONDecoder().decode(OfficeTab.self, from: Data(json.utf8)).members)
        }
        for json in [#"{"ref":"thread:t","kind":"thread"}"#, #"{"ref":"thread:t","kind":"thread","zone":"today"}"#] {
            XCTAssertThrowsError(try JSONDecoder().decode(OfficeTab.self, from: Data(json.utf8)))
        }
    }

    @MainActor func testRoundTwoClientAndStoreMethods() async throws {
        let stub = SplitAPIStub(split: split)
        let client = BBClient(baseURL: URL(string: "https://tabs.invalid")!)
        client.transport = { try await stub.request($0, $1, $2) }
        let opened = try await client.officeTabOpen("s", ref: "thread:t", follow: true)
        XCTAssertEqual(opened.spaceId, "destination")
        XCTAssertEqual(opened.tab?.kind, .split)
        let unresolved = try await client.officeTabOpen("s", href: "/missing", follow: false)
        XCTAssertNil(unresolved.tab)
        XCTAssertEqual(unresolved.spaceId, "s")
        _ = try await client.officeTabSplitCreate("s", refs: ["thread:t", "item:pages:p"], zone: .pinned, folderId: "f")
        try await client.officeSpaceReorder(["destination", "s"])
        let store = TabsStore(spaceId: "s", client: client)
        await store.refresh()
        XCTAssertEqual(store.title(for: try XCTUnwrap(store.today.first)), "Live thread | Notes")
        await store.keepSplit(["thread:t", "item:pages:p"])
        await store.separate("split:s")
        await store.moveToSpace("split:s", to: "destination")
        let reopened = await store.reopen()
        XCTAssertEqual(reopened?.ref, "split:s")
        let empty = await store.reopen()
        XCTAssertNil(empty)
        await store.closeMany(["thread:t", "item:pages:p"])
        await store.clearToday()
        XCTAssertNil(store.error)
        let inputs = await stub.inputs
        XCTAssertTrue(inputs.contains { $0.0 == "tabs_open" && $0.1["follow"] == .bool(true) && $0.1["ref"] == .string("thread:t") })
        XCTAssertTrue(inputs.contains { $0.0 == "tabs_open" && $0.1["follow"] == .bool(false) && $0.1["href"] == .string("/missing") })
        XCTAssertTrue(inputs.contains { $0.0 == "tabs_split_create" && $0.1["zone"] == .string("pinned") && $0.1["folderId"] == .string("f") })
        XCTAssertTrue(inputs.contains { $0.0 == "tabs_split_create" && $0.1["zone"] == nil && $0.1["refs"] == .array([.string("thread:t"), .string("item:pages:p")]) })
        XCTAssertTrue(inputs.contains { $0.0 == "tabs_split_remove" && $0.1["ref"] == .string("split:s") })
        XCTAssertTrue(inputs.contains { $0.0 == "tabs_move_space" && $0.1["toSpaceId"] == .string("destination") })
        XCTAssertTrue(inputs.contains { $0.0 == "space_reorder" && $0.1["spaceIds"] == .array([.string("destination"), .string("s")]) })
        let closeInputs = inputs.filter { $0.0 == "tabs_close_many" }
        XCTAssertEqual(closeInputs.count, 2)
        XCTAssertEqual(closeInputs.last?.1["refs"], .array([.string("split:s")]))
        XCTAssertFalse(inputs.contains { $0.0 == "tabs_move" })
    }
}

private actor SplitAPIStub {
    let split: String
    var inputs: [(String, [String: JSONValue])] = []
    var reopened = false
    init(split: String) { self.split = split }
    func request(_ method: String, _ path: String, _ body: Data?) throws -> (Int, Data) {
        if path == "/api/v1/sidebar-bootstrap" {
            let thread: [String: Any] = ["id": "t", "projectId": "p", "title": "Live thread", "status": "idle", "createdAt": 1, "updatedAt": 2]
            return (200, try JSONSerialization.data(withJSONObject: ["sections": [], "projects": [], "personalProject": ["id": "p", "name": "P", "threads": [thread]]]))
        }
        let rpc = String(path.split(separator: "/").last!)
        let input = try JSONDecoder().decode([String: JSONValue].self, from: body!)
        inputs.append((rpc, input))
        let tab = try JSONSerialization.jsonObject(with: Data(split.utf8))
        var result: [String: Any] = ["ok": true]
        switch rpc {
        case "tabs_get": result = ["seeded": true, "essentials": [], "pinned": [], "folders": [], "today": [tab]]
        case "tabs_open": result = input["href"] == nil ? ["tab": tab, "spaceId": "destination"] : ["tab": NSNull(), "spaceId": "s"]
        case "tabs_split_create", "tabs_move_space": result = ["tab": tab]
        case "tabs_reopen":
            result = ["tab": reopened ? NSNull() : tab]
            reopened = true
        default: break
        }
        return (200, try JSONSerialization.data(withJSONObject: ["ok": true, "result": result]))
    }
}
