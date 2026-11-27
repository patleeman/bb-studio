import Foundation
import XCTest
@testable import BBStudio

final class SharedModelsBackfillTests: XCTestCase {
    func testPageMetaDisplayTitleAndEmoji() {
        let blank = PageMeta(id: "pg_1", title: "   \n ", icon: "")
        XCTAssertEqual(blank.displayTitle, "Untitled")
        XCTAssertNil(blank.emoji)

        let named = PageMeta(id: "pg_2", title: "  Roadmap  ", icon: "🧭")
        XCTAssertEqual(named.displayTitle, "Roadmap")
        XCTAssertEqual(named.emoji, "🧭")
    }

    func testWatchRelayPackAndUnpackRoundTrip() {
        let payload = Data(String(repeating: "{\"thread\":\"thr_1\",\"status\":\"idle\"}\n", count: 50).utf8)
        let packed = WatchRelay.pack(payload)
        XCTAssertLessThan(packed.count, payload.count)
        XCTAssertEqual(WatchRelay.unpack(packed), payload)

        // Uncompressed / invalid zlib bytes fall back to the original data safely.
        let raw = Data("not-zlib".utf8)
        XCTAssertEqual(WatchRelay.unpack(raw), raw)
    }

    func testWorkspacePathAndWorkspaceFile() {
        let nested = WorkspacePath(kind: "file", path: "src/app/main.swift", name: "main.swift")
        XCTAssertFalse(nested.isDirectory)
        XCTAssertEqual(nested.parent, "src/app")

        let rootDir = WorkspacePath(kind: "directory", path: "docs", name: "docs")
        XCTAssertTrue(rootDir.isDirectory)
        XCTAssertEqual(rootDir.parent, "")

        let utf8File = WorkspaceFile(content: "hello", contentEncoding: "utf8", mimeType: "text/plain", sizeBytes: 5)
        XCTAssertEqual(utf8File.text, "hello")
        XCTAssertEqual(utf8File.data, Data("hello".utf8))

        let b64 = Data([0xDE, 0xAD, 0xBE, 0xEF]).base64EncodedString()
        let binFile = WorkspaceFile(content: b64, contentEncoding: "base64", mimeType: "application/octet-stream", sizeBytes: 4)
        XCTAssertNil(binFile.text)
        XCTAssertEqual(binFile.data, Data([0xDE, 0xAD, 0xBE, 0xEF]))
    }
}
