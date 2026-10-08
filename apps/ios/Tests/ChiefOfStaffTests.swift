import XCTest
@testable import BBStudio

final class ChiefOfStaffTests: XCTestCase {
    private let a = URL(string: "https://chief-a.invalid")!
    private let b = URL(string: "https://chief-b.invalid")!

    private func client(_ url: URL, spaces: String, lead: String) -> BBClient {
        let client = BBClient(baseURL: url)
        client.transport = { _, path, _ in
            let result = path.contains("space_lead") ? lead : spaces
            return (200, Data(#"{"ok":true,"result":\#(result)}"#.utf8))
        }
        return client
    }

    func testLeadIsRememberedPerServerAndClearedWhenRemoved() async throws {
        let spaces = ##"{"spaces":[{"id":"sp_1","name":"Personal","isDefault":true,"color":"#000000","description":"","projectIds":[],"threadIds":[]}]}"##
        let withLead = client(a, spaces: spaces, lead: #"{"leadThreadId":"thr_a"}"#)
        let other = client(b, spaces: spaces, lead: #"{"leadThreadId":"thr_b"}"#)
        let first = try await withLead.chiefOfStaffThreadId()
        let second = try await other.chiefOfStaffThreadId()
        XCTAssertEqual(first, "thr_a")
        XCTAssertEqual(second, "thr_b")
        XCTAssertEqual(withLead.cachedChiefOfStaffThreadId, "thr_a")
        XCTAssertEqual(other.cachedChiefOfStaffThreadId, "thr_b")

        let cleared = client(a, spaces: spaces, lead: #"{"leadThreadId":null}"#)
        let none = try await cleared.chiefOfStaffThreadId()
        XCTAssertNil(none)
        XCTAssertNil(cleared.cachedChiefOfStaffThreadId)
        XCTAssertEqual(other.cachedChiefOfStaffThreadId, "thr_b")
    }

    func testChiefLeadFromOptionalId() {
        XCTAssertEqual(ChiefLead(nil), .none)
        XCTAssertEqual(ChiefLead("thr_1"), .thread("thr_1"))
    }
}
