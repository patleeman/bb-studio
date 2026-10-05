import XCTest
@testable import BBStudio

/// A thread's Space menu: hidden without Studio's thread lookup.
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
}
