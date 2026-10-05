import XCTest
@testable import BBStudio

/// A thread's Space menu: hidden without Studio's thread lookup, and honest after a failed change.
@MainActor
final class ThreadSpacesModelTests: XCTestCase {
    private static let spaces = #"{"ok":true,"result":{"spaces":[{"id":"personal","isDefault":true,"name":"Personal","description":"","projectIds":[],"threadIds":[]},{"id":"launch","isDefault":false,"name":"Launch","description":"","projectIds":[],"threadIds":[]}]}}"#
    private static let lead = #"{"ok":true,"result":{"spaceId":"launch","threadId":null}}"#

    nonisolated private func client(_ answer: @escaping @Sendable (String) throws -> (Int, String)) -> BBClient {
        let client = BBClient(baseURL: URL(string: "https://spaces.invalid")!)
        client.transport = { _, path, _ in
            let (status, body) = try answer(path)
            return (status, Data(body.utf8))
        }
        return client
    }

    nonisolated private static func answer(_ path: String, spaceOf: String = #"{"thr_1":"launch"}"#) -> (Int, String) {
        switch path.split(separator: "/").last.map(String.init) {
        case "spaces": (200, Self.spaces)
        case "space_of_threads": (200, #"{"ok":true,"result":{"threads":\#(spaceOf)}}"#)
        case "space_lead": (200, Self.lead)
        default: (500, #"{"ok":false,"error":{"message":"boom"}}"#)
        }
    }

    func testMenuHidesWhenStudioCannotSayWhereThreadsAre() async {
        let model = ThreadSpacesModel()
        let old = client { path in
            path.hasSuffix("space_of_threads") ? (404, #"{"ok":false,"error":{"code":"unknown_method","message":"no"}}"#) : Self.answer(path)
        }
        await model.load("thr_1", client: old)
        XCTAssertNil(model.space(of: "thr_1", projectId: nil))

        let failing = client { path in
            if path.hasSuffix("space_of_threads") { throw URLError(.timedOut) }
            return Self.answer(path)
        }
        await model.load("thr_1", client: failing)
        XCTAssertNil(model.space(of: "thr_1", projectId: nil))
    }

    func testFailedMoveRestoresTheThreadsSpace() async throws {
        let model = ThreadSpacesModel()
        await model.load("thr_1", client: client { Self.answer($0) })
        XCTAssertEqual(model.space(of: "thr_1", projectId: nil)?.id, "launch")
        let personal = try XCTUnwrap(model.spaces.first { $0.id == "personal" })

        // The move fails and so does the reload: the menu shows where the thread was.
        let offline = client { path in
            if path.hasSuffix("spaceMembers") { return (500, #"{"ok":false,"error":{"message":"boom"}}"#) }
            throw URLError(.notConnectedToInternet)
        }
        do {
            try await model.move("thr_1", to: personal, client: offline)
            XCTFail("The move should fail")
        } catch {}
        XCTAssertEqual(model.space(of: "thr_1", projectId: nil)?.id, "launch")
    }

    func testFailedLeadChangeRestoresTheLead() async throws {
        let model = ThreadSpacesModel()
        await model.load("thr_1", client: client { Self.answer($0) })
        let launch = try XCTUnwrap(model.spaces.first { $0.id == "launch" })
        XCTAssertNil(model.leadOfSpace["launch"])

        let offline = client { path in
            if path.hasSuffix("space_set_lead") { return (500, #"{"ok":false,"error":{"message":"boom"}}"#) }
            throw URLError(.notConnectedToInternet)
        }
        do {
            try await model.setLead("thr_1", of: launch, reload: "thr_1", client: offline)
            XCTFail("Setting the lead should fail")
        } catch {}
        XCTAssertNil(model.leadOfSpace["launch"])
    }
}
