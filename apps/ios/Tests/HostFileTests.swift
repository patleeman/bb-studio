import XCTest
@testable import BBStudio

/// Files outside the workspace (`/tmp/shot.png`) load from BB's host-files
/// route, with the path in the URL as BB web builds it.
final class HostFileTests: XCTestCase {
    func testPathGoesInTheURLEncodedPerSegment() {
        XCTAssertEqual(BBClient.hostFilePath(threadId: "thr_a", path: "/tmp/review-check/2-pending.png"),
                       "/api/v1/threads/thr_a/host-files/tmp/review-check/2-pending.png")
        XCTAssertEqual(BBClient.hostFilePath(threadId: "thr_a", path: "/Users/me/My Shots/a#1?.png"),
                       "/api/v1/threads/thr_a/host-files/Users/me/My%20Shots/a%231%3F.png")
    }

    func testHostFileAsksForThatPath() async throws {
        let client = BBClient(baseURL: URL(string: "https://bb.invalid")!)
        nonisolated(unsafe) var asked = ""
        client.transport = { _, path, _ in asked = path; return (200, Data([0x89, 0x50, 0x4E, 0x47])) }
        let file = try await client.hostFile(threadId: "thr_a", path: "/tmp/shot.png")
        XCTAssertEqual(asked, "/api/v1/threads/thr_a/host-files/tmp/shot.png")
        XCTAssertEqual(file.contentEncoding, "base64")
    }

    func testImageURLUsesTheSameRoute() {
        let client = BBClient(baseURL: URL(string: "https://bb.invalid")!)
        XCTAssertEqual(client.hostFileURL(threadId: "thr_a", path: "/tmp/shot.png")?.absoluteString,
                       "https://bb.invalid/api/v1/threads/thr_a/host-files/tmp/shot.png")
    }
}
