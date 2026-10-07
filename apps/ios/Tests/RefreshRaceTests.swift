import XCTest
@testable import BBStudio

/// Reloads that are superseded or overtaken must not undo newer state.
final class RefreshRaceTests: XCTestCase {
    private let server = URL(string: "https://refresh-race.invalid")!

    @MainActor
    func testCancelledStudioReloadKeepsTagsAndSpacesInsteadOfFallingBack() async {
        let original = BBClient.storedServerURL
        defer { BBClient.storedServerURL = original }
        BBClient.storedServerURL = server
        let store = StudioStore()
        let client = BBClient(baseURL: server)
        let cancelOverview = LockedFlag()
        client.transport = { _, path, _ in
            if path == "/api/v1/plugins" {
                return (200, Data(#"{"plugins":[{"id":"studio","status":"running"},{"id":"pages","status":"running"}]}"#.utf8))
            }
            if path.hasSuffix("/studio/rpc/overview") {
                if cancelOverview.value { throw URLError(.cancelled) }
                return (200, Data(#"""
                    {"ok":true,"result":{"items":[{"pluginId":"pages","id":"p1","kind":"page","title":"Plan","createdAt":1,"updatedAt":2}],
                    "tags":[{"id":"t1","name":"Work","color":"#ff0000"}]}}
                    """#.utf8))
            }
            // The fallback would list pages directly; it must not be reached.
            if path.contains("/plugins/pages/") { XCTFail("Fell back to the add-ons after a cancelled reload: \(path)") }
            return (404, Data())
        }
        await store.load(client)
        XCTAssertEqual(store.tags.map(\.id), ["t1"])
        XCTAssertTrue(store.viaStudio)

        cancelOverview.value = true
        await store.load(client)
        XCTAssertEqual(store.tags.map(\.id), ["t1"])
        XCTAssertTrue(store.supportsTags)
        XCTAssertTrue(store.viaStudio)
        XCTAssertEqual(store.items.map(\.itemId), ["p1"])
    }
}

final class LockedFlag: @unchecked Sendable {
    private let lock = NSLock()
    private var stored = false
    var value: Bool {
        get { lock.lock(); defer { lock.unlock() }; return stored }
        set { lock.lock(); stored = newValue; lock.unlock() }
    }
}
