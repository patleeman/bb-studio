import XCTest
@testable import BBStudio

final class ServerIsolationTests: XCTestCase {
    private let a = URL(string: "https://isolation-a.invalid")!
    private let b = URL(string: "https://isolation-b.invalid")!

    @MainActor
    func testPageResponseAfterSwitchWritesOnlyItsOriginalCache() async {
        let original = BBClient.storedServerURL
        defer { BBClient.storedServerURL = original }
        let id = "test-\(UUID())"
        BBClient.storedServerURL = a
        let modelA = PageModel(pageId: id)
        let client = BBClient(baseURL: a)
        let other = b
        client.transport = { _, _, _ in
            BBClient.storedServerURL = other
            return (200, Data(#"{"ok":true,"result":{"markdown":"A confidential page"}}"#.utf8))
        }
        await modelA.load(client)
        let modelB = PageModel(pageId: id)
        XCTAssertNil(modelB.markdown)
        XCTAssertEqual(DiskCache.load(String.self, key: "page-\(id)", serverURL: a), "A confidential page")
        XCTAssertNil(DiskCache.load(String.self, key: "page-\(id)", serverURL: b))
    }

    func testMatchingIDsCannotReadAnotherServersCacheOrLegacyCache() {
        let key = "test-\(UUID())"
        DiskCache.saveUnscoped("legacy secret", as: key)
        XCTAssertNil(DiskCache.load(String.self, key: key, serverURL: a))
        DiskCache.save("A secret", as: key, serverURL: a)
        XCTAssertNil(DiskCache.load(String.self, key: key, serverURL: b))
        DiskCache.save("B secret", as: key, serverURL: b)
        // An A request completing after selection of B still writes only A.
        DiskCache.save("A late response", as: key, serverURL: a)
        XCTAssertEqual(DiskCache.load(String.self, key: key, serverURL: b), "B secret")
        XCTAssertEqual(DiskCache.load(String.self, key: key, serverURL: a), "A late response")
    }

    func testDraftsRemainSeparateAndLegacyRecoveryDoesNotOverwrite() throws {
        let id = "test-\(UUID())"
        let legacy = "draft.\(id)"
        let defaults = UserDefaults.standard
        defer {
            defaults.removeObject(forKey: legacy)
            for server in [a, b] { defaults.removeObject(forKey: ServerScope.key(legacy, serverURL: server)) }
        }
        defaults.set(try JSONEncoder().encode(Drafts.Draft(text: "old draft", mentions: [])), forKey: legacy)
        XCTAssertNil(Drafts.load(id, serverURL: a))
        Drafts.save(id, text: "A draft", mentions: [], serverURL: a)
        XCTAssertNil(Drafts.load(id, serverURL: b))
        Drafts.recoverLegacy(to: a)
        XCTAssertEqual(Drafts.load(id, serverURL: a)?.text, "A draft")
        Drafts.recoverLegacy(to: b)
        XCTAssertEqual(Drafts.load(id, serverURL: b)?.text, "old draft")
        XCTAssertNotNil(defaults.data(forKey: legacy))
    }

    func testPermissionModeSentOnADoesNotClearB() {
        let id = "test-\(UUID())"
        defer { for server in [a, b] { PermissionMode.setPending(nil, for: id, serverURL: server) } }
        PermissionMode.setPending("full", for: id, serverURL: a)
        PermissionMode.setPending("full", for: id, serverURL: b)
        var body: [String: JSONValue] = [:]
        PermissionMode.apply(id, to: &body, serverURL: a)
        PermissionMode.sent(id, body, serverURL: a)
        XCTAssertNil(PermissionMode.pending(id, serverURL: a))
        XCTAssertEqual(PermissionMode.pending(id, serverURL: b), "full")
    }

    func testStaleWidgetLinkCannotOpenMatchingIDOnOtherServer() {
        let link = AppLink.scoped(URL(string: "bbstudio://thread/thr_clone")!, serverURL: a)
        XCTAssertTrue(AppLink.acceptsOrigin(link, serverURL: a))
        XCTAssertFalse(AppLink.acceptsOrigin(link, serverURL: b))
    }

    func testStatusSnapshotCountsIncludeOrigin() {
        let first = StatusSnapshot(ThreadSummary([]), serverURL: a)
        let second = StatusSnapshot(ThreadSummary([]), serverURL: b)
        XCTAssertFalse(first.sameCounts(second))
        XCTAssertEqual(StatusSnapshot(dictionary: first.dictionary)?.serverURL, a.absoluteString)
    }
}
