import XCTest
@testable import BBStudio

final class QueryEncodingTests: XCTestCase {
    func testSearchAndTimelinePreserveQueryValues() async throws {
        for value in ["A&B", "A+B", "A#B", "雪 & café+%"] {
            let client = BBClient(baseURL: URL(string: "https://query.invalid")!)
            client.transport = { _, path, _ in
                // Match servers that decode application/x-www-form-urlencoded queries.
                let components = URLComponents(string: path.replacingOccurrences(of: "+", with: " "))!
                let items = components.queryItems ?? []
                if components.path.hasSuffix("/search") {
                    XCTAssertEqual(items.first { $0.name == "query" }?.value, value)
                    XCTAssertEqual(items.count, 2)
                    return (200, Data(#"{"active":{"total":0,"results":[]},"archived":{"total":0,"results":[]}}"#.utf8))
                }
                XCTAssertEqual(items.first { $0.name == "beforeAnchorId" }?.value, value)
                XCTAssertEqual(items.count, 4)
                return (200, Data(#"{"rows":[],"maxSeq":0}"#.utf8))
            }
            _ = try await client.search(value)
            _ = try await client.timeline("thread", before: TimelineCursor(anchorSeq: 4, anchorId: value), after: 2)
        }
    }
}
