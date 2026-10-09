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

    func testChiefOfStaffReadsHeartbeat() async throws {
        let client = BBClient(baseURL: a)
        client.transport = { _, path, _ in
            XCTAssertTrue(path.hasSuffix("chief_of_staff"), path)
            return (200, Data(#"{"ok":true,"result":{"threadId":"thr_c","originSpaceId":null,"run":{"enabled":true,"cadence":"every15minutes","time":"09:30"}}}"#.utf8))
        }
        let chief = try await client.chiefOfStaff()
        XCTAssertEqual(chief, SpaceLead(threadId: "thr_c", heartbeat: "every15minutes", time: "09:30"))
        XCTAssertEqual(client.cachedChiefOfStaffThreadId, "thr_c")
    }

    func testChiefOfStaffMissingOnOlderStudio() async throws {
        let client = BBClient(baseURL: b)
        client.transport = { _, _, _ in (404, Data(#"{"ok":false,"error":{"code":"unknown_method","message":"no"}}"#.utf8)) }
        let chief = try await client.chiefOfStaff()
        XCTAssertNil(chief)
    }

    func testSetChiefHeartbeatSendsRunAndReadsAnswer() async throws {
        let client = BBClient(baseURL: a)
        client.transport = { _, path, body in
            XCTAssertTrue(path.hasSuffix("chief_of_staff_set_run"), path)
            let sent = String(decoding: body ?? Data(), as: UTF8.self)
            XCTAssertTrue(sent.contains(#""enabled":false"#), sent)
            XCTAssertTrue(sent.contains(#""cadence":"daily""#), sent)
            XCTAssertFalse(sent.contains("cron"), sent)
            return (200, Data(#"{"ok":true,"result":{"threadId":"thr_c","originSpaceId":null,"run":{"enabled":false,"cadence":"daily","time":"08:00"}}}"#.utf8))
        }
        let chief = try await client.setChiefOfStaffHeartbeat(enabled: false, cadence: "daily", time: "08:00", cron: nil)
        XCTAssertEqual(chief.threadId, "thr_c")
        XCTAssertNil(chief.heartbeat)
    }

    func testCadenceIdKeepsUnknownValues() {
        XCTAssertEqual(SpaceLead.cadenceId(Studio.ChiefOfStaffOutputRunCadence.every2hours), "every2hours")
        XCTAssertEqual(SpaceLead.cadenceId(Studio.ChiefOfStaffOutputRunCadence.unknown("every10minutes")), "every10minutes")
        XCTAssertNil(SpaceLead.cadenceId(Optional<Studio.ChiefOfStaffOutputRunCadence>.none))
    }

    func testHeartbeatTimeRoundTrips() {
        let date = HeartbeatFields.date("07:05")
        XCTAssertEqual(date.map(HeartbeatFields.text), "07:05")
        XCTAssertNil(HeartbeatFields.date("bad"))
    }

    @MainActor func testChiefMenuLabelSaysTopLevel() {
        XCTAssertEqual(ThreadSpacesModel.chiefLabel, "Chief of Staff · top level")
        XCTAssertFalse(ThreadSpacesModel().isChief("thr_x"))
    }
}
