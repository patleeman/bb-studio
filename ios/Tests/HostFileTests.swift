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

    func testPageImagesLoadFromTheServer() {
        let client = BBClient(baseURL: URL(string: "https://bb.invalid")!)
        // An image imported into a page is one of the server's own addresses, not a host path.
        XCTAssertEqual(client.serverImageURL(src: "/api/v1/plugins/studio/http/pages/files?id=file_1", pageId: nil)?.absoluteString,
                       "https://bb.invalid/api/v1/plugins/studio/http/pages/files?id=file_1")
        XCTAssertEqual(client.serverImageURL(src: "https://example.invalid/a.png", pageId: nil)?.absoluteString, "https://example.invalid/a.png")
        // A local path in an older page goes through Studio's route; in a reply, through the thread.
        XCTAssertEqual(client.serverImageURL(src: "/tmp/My Shots/a.png", pageId: "pg_1")?.absoluteString,
                       "https://bb.invalid/api/v1/plugins/studio/http/pages/local-image?page=pg_1&path=%2Ftmp%2FMy%20Shots%2Fa.png")
        XCTAssertNil(client.serverImageURL(src: "/tmp/a.png", pageId: nil))
        XCTAssertNil(client.serverImageURL(src: "chart.png", pageId: "pg_1"))
    }
}
