import XCTest
@testable import BBStudio

final class ChiefOfStaffTests: XCTestCase {
    private let a = URL(string: "https://chief-a.invalid")!
    private let b = URL(string: "https://chief-b.invalid")!

    private func client(_ url: URL, status: Int = 200, body: String) -> BBClient {
        let client = BBClient(baseURL: url)
        client.transport = { _, path, _ in
            XCTAssertTrue(path.hasSuffix("chief_of_staff"), path)
            return (status, Data(body.utf8))
        }
        return client
    }

    private func chief(_ id: String?) -> String {
        let value = id.map { "\"\($0)\"" } ?? "null"
        return #"{"ok":true,"result":{"threadId":\#(value),"originSpaceId":null}}"#
    }

    func testChiefIsRememberedPerServerAndClearedWhenRemoved() async throws {
        let withChief = client(a, body: chief("thr_a"))
        let other = client(b, body: chief("thr_b"))
        let first = try await withChief.chiefOfStaffThreadId()
        let second = try await other.chiefOfStaffThreadId()
        XCTAssertEqual(first, "thr_a")
        XCTAssertEqual(second, "thr_b")
        XCTAssertEqual(withChief.cachedChiefOfStaffThreadId, "thr_a")
        XCTAssertEqual(other.cachedChiefOfStaffThreadId, "thr_b")

        let cleared = client(a, body: chief(nil))
        let none = try await cleared.chiefOfStaffThreadId()
        XCTAssertNil(none)
        XCTAssertNil(cleared.cachedChiefOfStaffThreadId)
        XCTAssertEqual(other.cachedChiefOfStaffThreadId, "thr_b")
    }

    func testOlderStudioOrNoStudioMeansNoChief() async throws {
        let seeded = client(a, body: chief("thr_a"))
        _ = try await seeded.chiefOfStaffThreadId()
        let old = client(a, status: 404, body: #"{"ok":false,"error":{"code":"unknown_method","message":"no"}}"#)
        let none = try await old.chiefOfStaffThreadId()
        XCTAssertNil(none)
        XCTAssertNil(old.cachedChiefOfStaffThreadId)
        let stopped = client(b, status: 503, body: #"{"ok":false,"error":{"message":"not running"}}"#)
        let alsoNone = try await stopped.chiefOfStaffThreadId()
        XCTAssertNil(alsoNone)
    }

    func testSetChiefSendsThreadAndCachesAnswer() async throws {
        let client = BBClient(baseURL: a)
        client.transport = { _, path, body in
            XCTAssertTrue(path.hasSuffix("chief_of_staff_set"), path)
            XCTAssertTrue(String(decoding: body ?? Data(), as: UTF8.self).contains(#""threadId":null"#))
            return (200, Data(#"{"ok":true,"result":{"threadId":null,"originSpaceId":null}}"#.utf8))
        }
        try await client.setChiefOfStaff(nil)
        XCTAssertNil(client.cachedChiefOfStaffThreadId)
    }

    func testChiefLeadFromOptionalId() {
        XCTAssertEqual(ChiefLead(nil), .none)
        XCTAssertEqual(ChiefLead("thr_1"), .thread("thr_1"))
    }
}
