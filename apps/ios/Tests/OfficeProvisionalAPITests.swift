import XCTest
@testable import BBStudio

/// office_start still mirrors the web UI until its server contract lands.
final class OfficeProvisionalAPITests: XCTestCase {
    private func client(method expected: String, input: JSONValue, result: String) -> BBClient {
        let client = BBClient(baseURL: URL(string: "https://office.invalid")!)
        client.transport = { method, path, body in
            XCTAssertEqual(method, "POST")
            XCTAssertEqual(path, "/api/v1/plugins/studio/rpc/\(expected)")
            XCTAssertEqual(try JSONDecoder().decode(JSONValue.self, from: XCTUnwrap(body)), input)
            return (200, Data("{\"ok\":true,\"result\":\(result)}".utf8))
        }
        return client
    }
    func testStartReturnsNavigationTarget() async throws {
        let start = try await client(method: "office_start", input: ["spaceId": "sp_one", "request": "Write a plan"], result: #"{"threadId":"thr_one"}"#).officeStart(spaceId: "sp_one", request: "Write a plan")
        XCTAssertEqual(start.threadId, "thr_one")
    }
}
