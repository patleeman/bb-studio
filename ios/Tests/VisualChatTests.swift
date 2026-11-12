import UIKit
import XCTest
@testable import BBStudio

final class VisualChatBridgeTests: XCTestCase {
    private func parse(_ object: [String: Any]) -> VisualChatBridgeMessage? {
        let data = try! JSONSerialization.data(withJSONObject: object)
        return VisualChatBridgeMessage.parse(String(decoding: data, as: UTF8.self))
    }

    func testTheFourMessages() {
        XCTAssertEqual(parse(["type": "ready", "protocol": 1]), .ready(protocol: 1))
        XCTAssertEqual(parse(["type": "open", "url": "https://en.wikipedia.org/wiki/Game_Boy"]), .open(URL(string: "https://en.wikipedia.org/wiki/Game_Boy")!))
        XCTAssertEqual(parse(["type": "webpage", "id": 3, "url": "https://github.com/microsoft/vscode"]), .webpage(id: 3, url: "https://github.com/microsoft/vscode"))
        XCTAssertEqual(parse(["type": "rendered", "rev": 4, "streamN": 12, "streaming": true, "embeds": 1]), .rendered(rev: 4, streamN: 12, streaming: true, embeds: 1))
    }

    func testAnythingElseIsDropped() {
        // Not a JSON string, unknown types, extra or missing keys, wrong types.
        XCTAssertNil(VisualChatBridgeMessage.parse(["type": "ready", "protocol": 1]))
        XCTAssertNil(VisualChatBridgeMessage.parse("not json"))
        XCTAssertNil(parse(["type": "navigate", "url": "https://example.com"]))
        XCTAssertNil(parse(["type": "ready", "protocol": 1, "extra": true]))
        XCTAssertNil(parse(["type": "open"]))
        XCTAssertNil(parse(["type": "ready", "protocol": "1"]))
        XCTAssertNil(parse(["type": "ready", "protocol": true]))
        XCTAssertNil(parse(["type": "ready", "protocol": 1.5]))
        XCTAssertNil(parse(["type": "rendered", "rev": 1, "streamN": 0, "streaming": 1, "embeds": 0]))
        XCTAssertNil(parse(["type": "webpage", "id": 0, "url": "https://example.com"]))
        XCTAssertNil(parse(["type": "webpage", "id": -2, "url": "https://example.com"]))
        // Only https URLs with a host, no credentials, not too long.
        for url in ["http://example.com", "javascript:alert(1)", "file:///etc/passwd", "https://", "https://user:pw@example.com/", "spotify:track:1",
                    "https://example.com/" + String(repeating: "a", count: 2001)] {
            XCTAssertNil(parse(["type": "open", "url": url]), url)
        }
        // Too big a message.
        XCTAssertNil(parse(["type": "open", "url": "https://example.com/?" + String(repeating: "a", count: 9000)]))
    }

    func testTheTopDocumentNeverNavigates() {
        var loaded = false
        let origin = VisualChatBoardHost.origin
        XCTAssertFalse(VisualChatBoardHost.allows(URL(string: "https://evil.example/")!, mainFrame: true, hostLoaded: &loaded))
        XCTAssertTrue(VisualChatBoardHost.allows(origin, mainFrame: true, hostLoaded: &loaded))
        XCTAssertTrue(loaded)
        XCTAssertFalse(VisualChatBoardHost.allows(origin, mainFrame: true, hostLoaded: &loaded), "loads once")
        // Frames inside it: the agent's page and https embeds only.
        XCTAssertTrue(VisualChatBoardHost.allows(URL(string: "about:srcdoc")!, mainFrame: false, hostLoaded: &loaded))
        XCTAssertTrue(VisualChatBoardHost.allows(URL(string: "https://www.youtube-nocookie.com/embed/x")!, mainFrame: false, hostLoaded: &loaded))
        for url in ["http://example.com", "javascript:alert(1)", "data:text/html,hi", "spotify:track:1", "maps://x"] {
            XCTAssertFalse(VisualChatBoardHost.allows(URL(string: url)!, mainFrame: false, hostLoaded: &loaded), url)
        }
    }
}

final class VisualChatTimelineTests: XCTestCase {
    private func versions(_ count: Int) -> [VisualChatTimeline.Version] {
        (1...count).map { .init(n: $0 + 10, rev: $0 * 5, prompt: "Ask \($0)", caption: "Answer \($0)") }
    }

    func testStepsBackAndForwardToTheLiveBoard() {
        var timeline = VisualChatTimeline(versions: versions(3), liveRev: 15, working: false, viewing: nil)
        XCTAssertEqual(timeline.total, 3)
        XCTAssertEqual(timeline.position, 3)
        XCTAssertEqual(timeline.label, "3 of 3")
        XCTAssertFalse(timeline.canGoForward)
        XCTAssertEqual(timeline.step(1), .none)
        // Back to version 2: it's n 12.
        XCTAssertEqual(timeline.step(-1), .some(12))
        timeline.viewing = 12
        XCTAssertEqual(timeline.position, 2)
        XCTAssertEqual(timeline.shown, 12)
        XCTAssertEqual(timeline.step(-1), .some(11))
        timeline.viewing = 11
        XCTAssertFalse(timeline.canGoBack)
        XCTAssertEqual(timeline.step(-1), .none)
        // Forward twice is the live board (nil), not the last version's n.
        timeline.viewing = 12
        XCTAssertEqual(timeline.step(1), .some(nil))
    }

    func testTheLastVersionIsTheLiveBoard() {
        let timeline = VisualChatTimeline(versions: versions(3), liveRev: 15, working: false, viewing: 13)
        XCTAssertEqual(timeline.position, 3)
        XCTAssertNil(timeline.shown, "viewing the newest version is the live board")
    }

    func testAWorkingTurnIsOneMorePosition() {
        let timeline = VisualChatTimeline(versions: versions(2), liveRev: 12, working: true, viewing: nil)
        XCTAssertEqual(timeline.total, 3)
        XCTAssertEqual(timeline.position, 3)
        XCTAssertEqual(timeline.step(-1), .some(12))
        // Still working but the live board is the last version: no extra position.
        XCTAssertEqual(VisualChatTimeline(versions: versions(2), liveRev: 10, working: true, viewing: nil).total, 2)
    }

    func testNoVersionsYetAndAGoneOne() {
        let empty = VisualChatTimeline(versions: [], liveRev: 0, working: true, viewing: nil)
        XCTAssertEqual(empty.total, 1)
        XCTAssertNil(empty.label)
        XCTAssertEqual(empty.step(-1), .none)
        // A version that dropped off: the live board.
        XCTAssertNil(VisualChatTimeline(versions: versions(2), liveRev: 10, working: false, viewing: 99).shown)
    }
}

final class VisualChatStreamTests: XCTestCase {
    private func signal(_ n: Int, _ html: String) -> JSONValue { ["type": "canvas:stream", "threadId": "thr_1", "n": .from(n), "html": .string(html)] }
    private func done(_ rev: Int?) -> JSONValue { ["type": "canvas:stream", "threadId": "thr_1", "n": 9, "done": true, "rev": rev.map { .from($0) } ?? .null] }

    func testGrowsKeepsOrderAndLandsOnTheFinishedRevision() {
        var stream = VisualChatStream.reduce(nil, signal: signal(1, "<h1>"))
        stream = VisualChatStream.reduce(stream, signal: signal(3, "<h1>Hi</h1><p>"))
        // A late, older step doesn't step back.
        stream = VisualChatStream.reduce(stream, signal: signal(2, "<h1>Hi"))
        XCTAssertEqual(stream?.html, "<h1>Hi</h1><p>")
        stream = VisualChatStream.reduce(stream, signal: done(7))
        XCTAssertEqual(stream?.until, 7)
        XCTAssertEqual(stream?.ended, true)
        // Shows until the board has revision 7.
        XCTAssertNotNil(VisualChatStream.settle(stream, rev: 6, working: true))
        XCTAssertNil(VisualChatStream.settle(stream, rev: 7, working: false))
    }

    func testAStreamThatCommittedNothingGoes() {
        let stream = VisualChatStream.reduce(nil, signal: signal(1, "<h1>"))
        XCTAssertNil(VisualChatStream.reduce(stream, signal: done(nil)))
        // An unfinished stream goes when the turn is over.
        XCTAssertNotNil(VisualChatStream.settle(stream, rev: 3, working: true))
        XCTAssertNil(VisualChatStream.settle(stream, rev: 3, working: false))
    }
}

final class VisualChatRendererCacheTests: XCTestCase {
    private var directory: URL!
    private let server = URL(string: "https://bb.test")!
    private let other = URL(string: "https://other.test")!

    override func setUp() {
        directory = FileManager.default.temporaryDirectory.appending(path: "vc-cache-\(UUID().uuidString)")
    }

    override func tearDown() {
        try? FileManager.default.removeItem(at: directory)
    }

    private func bundle(_ js: String) -> VisualChatRenderer { VisualChatRenderer(version: VisualChatRenderer.version(of: js), js: js) }

    func testTheVersionIsTheScriptsHash() {
        // As src/renderer.ts: the first 16 hex of the SHA-256.
        XCTAssertEqual(VisualChatRenderer.version(of: "abc"), "ba7816bf8f01cfea")
    }

    func testKeepsOneCopyByVersionAndDownloadsOnlyANewOne() async throws {
        let cache = VisualChatRendererCache(directory: directory)
        let first = bundle("globalThis.BBCanvasRenderer={protocol:1};")
        var asked: [String?] = []
        // Nothing kept: the server sends the script, which is kept.
        let got = try await cache.resolve(server: server) { have in asked.append(have); return (first.version, first.js) }
        XCTAssertEqual(got, first)
        XCTAssertEqual(cache.load(server: server), first)
        // Kept and current: the server sends no script.
        let again = try await cache.resolve(server: server) { have in asked.append(have); return (first.version, nil) }
        XCTAssertEqual(again, first)
        // A new build: a new version, downloaded and kept instead.
        let second = bundle("globalThis.BBCanvasRenderer={protocol:1};//2")
        let updated = try await cache.resolve(server: server) { have in asked.append(have); return (second.version, have == second.version ? nil : second.js) }
        XCTAssertEqual(updated, second)
        XCTAssertEqual(cache.load(server: server), second)
        XCTAssertEqual(asked, [nil, first.version, first.version])
        // Per server.
        XCTAssertNil(cache.load(server: other))
    }

    func testWorksFromTheKeptCopyOfflineAndRefusesADamagedOne() async throws {
        let cache = VisualChatRendererCache(directory: directory)
        let kept = bundle("globalThis.BBCanvasRenderer={protocol:1};")
        cache.save(kept, server: server)
        let offline = try await cache.resolve(server: server) { _ in throw URLError(.notConnectedToInternet) }
        XCTAssertEqual(offline, kept)
        // A copy whose text doesn't match its version is never used.
        cache.save(VisualChatRenderer(version: kept.version, js: kept.js + "tampered"), server: other)
        XCTAssertNil(cache.load(server: other))
        do {
            _ = try await cache.resolve(server: other) { _ in ("0000000000000000", "not it") }
            XCTFail("a damaged download must fail")
        } catch {}
        // Told it's current with nothing kept: it asks again for the script.
        var asked: [String?] = []
        let fresh = try await VisualChatRendererCache(directory: directory.appending(path: "x")).resolve(server: server) { have in
            asked.append(have)
            return have == nil && asked.count > 1 ? (kept.version, kept.js) : (kept.version, nil)
        }
        XCTAssertEqual(fresh, kept)
    }
}

final class VisualChatClientTests: XCTestCase {
    func testTheScreenTheAgentHearsAbout() {
        XCTAssertEqual(VisualChatClient.of(screen: CGSize(width: 466, height: 678), phone: true, board: CGSize(width: 466, height: 560)),
                       VisualChatClient(kind: .duoFolded, width: 466, height: 560))
        XCTAssertEqual(VisualChatClient.of(screen: CGSize(width: 951, height: 669), phone: true, board: CGSize(width: 951, height: 540)).kind, .duoUnfolded)
        XCTAssertEqual(VisualChatClient.of(screen: CGSize(width: 402, height: 874), phone: true, board: CGSize(width: 402.4, height: 700)),
                       VisualChatClient(kind: .phone, width: 402, height: 700))
        XCTAssertEqual(VisualChatClient.of(screen: CGSize(width: 1032, height: 1376), phone: false, board: CGSize(width: 1032, height: 1200)).kind, .desktop)
        // Within the server's bounds.
        XCTAssertEqual(VisualChatClient.of(screen: .zero, phone: true, board: .zero).width, 200)
    }

    func testThemeColorsAreOpaque() {
        // A translucent color is laid over the ground.
        XCTAssertEqual(VisualChatTheme.hex(UIColor(white: 0, alpha: 0.5), over: .white), "#808080")
        let raw = VisualChatTheme.raw(UITraitCollection(userInterfaceStyle: .dark))
        XCTAssertEqual(raw["colors"]?["background"]?.stringValue, "#000000")
        XCTAssertEqual(raw["colors"]?["mutedForeground"]?.stringValue?.count, 7)
    }
}
