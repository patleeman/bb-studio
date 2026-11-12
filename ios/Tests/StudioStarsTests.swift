import XCTest
@testable import BBStudio

/// Stars: decoding Studio's lists, their order, and the optimistic toggle.
final class StudioStarsTests: XCTestCase {
    private let server = URL(string: "https://studio-stars.invalid")!

    private func item(_ id: String, starredAt: Double? = nil) -> StudioItem {
        var item = StudioItem(pluginId: "pages", itemId: id, kind: "page", title: id, createdAt: 0, updatedAt: 0)
        item.starredAt = starredAt
        return item
    }

    func testStarredListDecodesNewestFirstAndSkipsMalformedEntries() async throws {
        let client = BBClient(baseURL: server)
        client.transport = { method, path, _ in
            XCTAssertEqual(method, "POST")
            XCTAssertEqual(path, "/api/v1/plugins/studio/rpc/starred")
            return (200, Data(#"""
            {"ok":true,"result":{"items":[
              {"pluginId":"pages","id":"old","title":"Vocabulary","icon":"🔤","kind":"page","kindIcon":"file-text","href":"/plugins/studio/studio/pages/old","projectId":null,"starredAt":100},
              {"pluginId":"pages","title":"No id","kind":"page","starredAt":300},
              {"pluginId":"excalidraw","id":"new","title":"Board","icon":null,"kind":"drawing","kindIcon":"pen","href":"/plugins/studio/studio/drawings/new","projectId":"proj_1","starredAt":200}
            ]}}
            """#.utf8))
        }
        let starred = try await client.studioStarred()
        XCTAssertEqual(starred.map(\.itemId), ["new", "old"])
        XCTAssertEqual(starred.map(\.starredAt), [200, 100])
        XCTAssertEqual(starred.last?.emoji, "🔤")
        XCTAssertNil(starred.first?.emoji)
        XCTAssertEqual(starred.first?.projectId, "proj_1")
        XCTAssertEqual(starred.first?.route, .drawing(id: "new"))
        XCTAssertEqual(starred.last?.route, .page(id: "old"))
    }

    func testListedItemsCarryStarredAtAndKeepItInTheCache() throws {
        let json = Data(#"""
        [{"pluginId":"pages","id":"a","kind":"page","title":"A","starredAt":1700000000000},
         {"pluginId":"pages","id":"b","kind":"page","title":"B","starredAt":null},
         {"pluginId":"pages","id":"c","kind":"page","title":"C"}]
        """#.utf8)
        let items = try JSONDecoder().decode([StudioItem].self, from: json)
        XCTAssertEqual(items.map(\.starredAt), [1_700_000_000_000, nil, nil])
        let snapshot = StudioSnapshot(items: items, kinds: nil, tags: nil, starred: [items[0]])
        let restored = try JSONDecoder().decode(StudioSnapshot.self, from: JSONEncoder().encode(snapshot))
        XCTAssertEqual(restored.items.first?.starredAt, 1_700_000_000_000)
        XCTAssertEqual(restored.starred?.map(\.itemId), ["a"])
    }

    func testStarringPutsItFirstAndStarringAgainKeepsItsTime() {
        let list = [item("b", starredAt: 200), item("a", starredAt: 100)]
        let starred = StudioStars.toggled(list, item("c"), on: true, now: 300)
        XCTAssertEqual(starred.map(\.itemId), ["c", "b", "a"])
        XCTAssertEqual(starred.first?.starredAt, 300)
        let again = StudioStars.toggled(starred, item("a"), on: true, now: 400)
        XCTAssertEqual(again.map(\.itemId), ["c", "b", "a"])
        XCTAssertEqual(again.last?.starredAt, 100)
    }

    func testUnstarringRemovesOnlyThatItem() {
        let list = [item("b", starredAt: 200), item("a", starredAt: 100)]
        XCTAssertEqual(StudioStars.toggled(list, item("b"), on: false, now: 300).map(\.itemId), ["a"])
        XCTAssertEqual(StudioStars.toggled(list, item("z"), on: false, now: 300).map(\.itemId), ["b", "a"])
    }

    func testSortKeepsTiesInTheirOrder() {
        let sorted = StudioStars.sorted([item("x", starredAt: 5), item("y", starredAt: 9), item("z", starredAt: 5)])
        XCTAssertEqual(sorted.map(\.itemId), ["y", "x", "z"])
    }

    @MainActor
    func testStoreLoadsStarsTogglesAtOnceAndPutsThemBackOnFailure() async throws {
        let original = BBClient.storedServerURL
        defer { BBClient.storedServerURL = original }
        BBClient.storedServerURL = server
        let store = StudioStore()
        let client = BBClient(baseURL: server)
        let fail = LockedFlag()
        let sent = LockedCounter()
        client.transport = { _, path, body in
            if path == "/api/v1/plugins" { return (200, Data(#"{"plugins":[{"id":"studio","status":"running"}]}"#.utf8)) }
            if path.hasSuffix("/studio/rpc/overview") {
                return (200, Data(#"""
                {"ok":true,"result":{"items":[
                  {"pluginId":"pages","id":"p1","kind":"page","title":"One","starredAt":100},
                  {"pluginId":"pages","id":"p2","kind":"page","title":"Two","starredAt":null}
                ]}}
                """#.utf8))
            }
            if path.hasSuffix("/studio/rpc/starred") {
                return (200, Data(#"{"ok":true,"result":{"items":[{"pluginId":"pages","id":"p1","title":"One","kind":"page","starredAt":100}]}}"#.utf8))
            }
            if path.hasSuffix("/studio/rpc/starItems") {
                _ = sent.next()
                let input = try JSONSerialization.jsonObject(with: body ?? Data()) as? [String: Any]
                XCTAssertEqual((input?["items"] as? [[String: String]])?.first?["id"], "p2")
                if fail.value { return (500, Data(#"{"ok":false,"error":"nope"}"#.utf8)) }
                return (200, Data(#"{"ok":true,"result":{"ok":true}}"#.utf8))
            }
            return (404, Data())
        }
        await store.load(client)
        XCTAssertTrue(store.supportsStars)
        XCTAssertEqual(store.starred.map(\.itemId), ["p1"])
        let two = try XCTUnwrap(store.items.first { $0.itemId == "p2" })
        XCTAssertFalse(store.isStarred(two))
        XCTAssertEqual(store.item(for: .page(id: "p2"))?.title, "Two")

        try await store.setStarred(two, true, client: client)
        XCTAssertEqual(store.starred.map(\.itemId), ["p2", "p1"])
        XCTAssertNotNil(store.items.first { $0.itemId == "p2" }?.starredAt)

        fail.value = true
        do {
            try await store.setStarred(two, false, client: client)
            XCTFail("Studio refused the change")
        } catch {}
        XCTAssertEqual(store.starred.map(\.itemId), ["p2", "p1"], "a refused unstar puts the star back")
        XCTAssertNotNil(store.items.first { $0.itemId == "p2" }?.starredAt)
        XCTAssertEqual(sent.next(), 3)
    }

    @MainActor
    func testAStudioWithoutStarsHidesThem() async {
        let original = BBClient.storedServerURL
        defer { BBClient.storedServerURL = original }
        BBClient.storedServerURL = server
        let store = StudioStore()
        let client = BBClient(baseURL: server)
        client.transport = { _, path, _ in
            if path == "/api/v1/plugins" { return (200, Data(#"{"plugins":[{"id":"studio","status":"running"}]}"#.utf8)) }
            if path.hasSuffix("/studio/rpc/overview") {
                return (200, Data(#"{"ok":true,"result":{"items":[{"pluginId":"pages","id":"p1","kind":"page","title":"One"}]}}"#.utf8))
            }
            return (404, Data(#"{"error":"Unknown method"}"#.utf8))
        }
        await store.load(client)
        XCTAssertEqual(store.items.map(\.itemId), ["p1"])
        XCTAssertFalse(store.supportsStars)
        XCTAssertTrue(store.starred.isEmpty)
    }
}
