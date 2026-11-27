import WebKit
import XCTest
@testable import BBStudio

/// Round 7 review (S8, S9): exports name files safely, a page load ends once on
/// every path, and thumbnails are pictures kept per screen version.
@MainActor
final class DesignRenderingTests: XCTestCase {
    func testExportFileNamesAreNeverPaths() {
        XCTAssertEqual(DesignExport.fileName(designId: "dsn_0123", screenId: "1a"), "dsn_0123-1a")
        XCTAssertEqual(DesignExport.fileName(designId: "dsn_0123", screenId: "../../etc/passwd"), "dsn_0123-etc-passwd")
        XCTAssertEqual(DesignExport.fileName(designId: "a/b:c", screenId: nil), "a-b-c-screen")
        XCTAssertEqual(DesignExport.fileName(designId: "///", screenId: "///"), "design")
        XCTAssertFalse(DesignExport.fileName(designId: String(repeating: "x", count: 500), screenId: "1a").count > 120)
    }

    /// A load that fails ends with false instead of waiting for good.
    func testAFailedLoadEnds() async {
        let view = WKWebView(frame: CGRect(x: 0, y: 0, width: 100, height: 100), configuration: UntrustedWeb.configuration())
        let finished = await UntrustedPageLoad.run(view, url: URL(string: "https://offline-fixtures.invalid/screen")!)
        XCTAssertFalse(finished)
    }

    /// A cancelled export or render ends its load at once.
    func testACancelledLoadEnds() async {
        let view = WKWebView(frame: CGRect(x: 0, y: 0, width: 100, height: 100), configuration: UntrustedWeb.configuration())
        // An address that never answers: only the cancel can end it.
        let load = Task { await UntrustedPageLoad.run(view, url: URL(string: "http://10.255.255.1/never")!) }
        try? await Task.sleep(for: .milliseconds(300))
        let started = Date()
        load.cancel()
        let finished = await load.value
        XCTAssertFalse(finished)
        XCTAssertLessThan(Date().timeIntervalSince(started), 3, "ended by the cancel, not a timeout")
    }

    func testAPrintThatCantLoadThrows() async {
        do {
            _ = try await DesignExport.printed(URL(string: "https://offline-fixtures.invalid/print")!, size: CGSize(width: 390, height: 844))
            XCTFail("a print that can't load throws")
        } catch {}
    }

    func testThumbnailsAreKeptPerScreenVersionAndSize() {
        let v1 = URL(string: "https://bb.invalid/api/v1/plugins/studio/http/designs/screen?design=dsn_1&screen=1a&v=1")!
        let v2 = URL(string: "https://bb.invalid/api/v1/plugins/studio/http/designs/screen?design=dsn_1&screen=1a&v=2")!
        XCTAssertEqual(DesignThumbnails.key(v1, height: 300), DesignThumbnails.key(v1, height: 300))
        XCTAssertNotEqual(DesignThumbnails.key(v1, height: 300), DesignThumbnails.key(v2, height: 300), "a new revision draws again")
        XCTAssertNotEqual(DesignThumbnails.key(v1, height: 300), DesignThumbnails.key(v1, height: 200), "and so does another size")
        XCTAssertTrue(DesignThumbnails.key(v1, height: 300).allSatisfy { $0.isHexDigit }, "a safe file name")
    }
}
