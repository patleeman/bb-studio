import XCTest
@testable import BBStudio

final class OfficeInboxPayloadTests: XCTestCase {
    private struct Fixture: Decodable {
        var method: String
        var input: JSONValue
        var output: JSONValue
    }
    private func client(_ name: String) throws -> BBClient {
        let url = try XCTUnwrap(Bundle(for: Self.self).url(forResource: "office-payloads", withExtension: "json"))
        let fixture = try XCTUnwrap(JSONDecoder().decode([Fixture].self, from: Data(contentsOf: url)).first { $0.method == name })
        let client = BBClient(baseURL: URL(string: "https://office.invalid")!)
        client.transport = { method, path, body in
            XCTAssertEqual(method, "POST")
            XCTAssertEqual(path, "/api/v1/plugins/studio/rpc/\(fixture.method)")
            XCTAssertEqual(try JSONDecoder().decode(JSONValue.self, from: XCTUnwrap(body)), fixture.input)
            return (200, try JSONEncoder().encode(JSONValue.object(["ok": true, "result": fixture.output])))
        }
        return client
    }
    func testInboxPageCountsAndMutationsMatchSchemaFixtures() async throws {
        let page = try await client("inbox_list").officeInbox()
        XCTAssertEqual(page.nextCursor, "next")
        let event = try XCTUnwrap(page.events.first)
        XCTAssertEqual(event.id, "interaction:office")
        XCTAssertFalse(event.isPending)
        XCTAssertNil(event.doneAt)
        XCTAssertEqual(event.actions?.first?.id, "approve")
        let encoded = try JSONDecoder().decode(JSONValue.self, from: JSONEncoder().encode(event))
        XCTAssertNil(encoded["isPending"])
        let counts = try await client("inbox_counts").officeInboxCounts()
        XCTAssertEqual(counts.count().requests, 1)
        XCTAssertEqual(counts.count().unreadReports, 2)
        try await client("inbox_act").officeInboxAct(key: event.key, actionId: "answer", text: "Proceed")
        try await client("inbox_done").officeInboxDone(keys: [event.key])
        try await client("inbox_read").officeInboxRead(keys: [event.key])
    }
}
