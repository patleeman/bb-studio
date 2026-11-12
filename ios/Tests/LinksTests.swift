import XCTest
@testable import BBStudio

final class LinksTests: XCTestCase {
    private func entity(_ text: String, origin: URL? = nil) -> LinkRef? {
        guard case .entity(let ref)? = Links.parse(text, origin: origin) else { return nil }
        return ref
    }

    func testSchemeLinksForEveryKind() {
        XCTAssertEqual(entity("bb://conversation/thr_abc"), LinkRef(kind: .conversation, id: "thr_abc"))
        XCTAssertEqual(entity("bb://worker/thr_w"), LinkRef(kind: .worker, id: "thr_w"))
        XCTAssertEqual(entity("bb://bot/bot_1"), LinkRef(kind: .bot, id: "bot_1"))
        XCTAssertNil(entity("bb://bot"), "a Bot link needs its id")
        XCTAssertEqual(entity("bb://memory"), LinkRef(kind: .memory, id: nil))
        XCTAssertEqual(entity("bb://memory/bot_1"), LinkRef(kind: .memory, id: "bot_1"))
        for kind in [LinkKind.library, .automations, .todos, .archive, .vscode, .terminal] {
            XCTAssertEqual(entity("bb://\(kind.rawValue)")?.kind, kind)
        }
        XCTAssertEqual(entity("bb://record/mem_1"), LinkRef(kind: .record, id: "mem_1"))
        XCTAssertEqual(entity("bb://board/thr_v"), LinkRef(kind: .board, id: "thr_v"))
        XCTAssertEqual(entity("bb://browser/https%3A%2F%2Fexample.com%2Fa"), LinkRef(kind: .browser, id: "https://example.com/a"))
        XCTAssertEqual(entity("bb://file/docs%2Fplan.md"), LinkRef(kind: .file, id: "docs/plan.md"))
        XCTAssertEqual(entity("bb://workflow/wfr_12ab"), LinkRef(kind: .workflow, id: "wfr_12ab"))
        XCTAssertEqual(entity("BB://Page/pg_abc?x=1#y"), nil, "kinds are lower case")
        XCTAssertEqual(entity("bb://page/pg_abc?x=1#y"), LinkRef(kind: .page, id: "pg_abc"))
    }

    func testItemKindsComeFromTheId() {
        XCTAssertEqual(entity("bb://page/dsn_0123456789abcdef"), LinkRef(kind: .design, id: "dsn_0123456789abcdef"), "the id decides the kind")
        XCTAssertEqual(entity("bb://whiteboard/drw_0123456789abcdef")?.kind, .whiteboard)
        XCTAssertEqual(entity("bb://whiteboard/0f8fad5b-d9cb-469f-a165-70867728950e")?.kind, .whiteboard)
        XCTAssertEqual(entity("bb://app/mini_0123456789abcdef")?.kind, .app)
        XCTAssertEqual(entity("bb://dashboard/dsh_0123456789abcdef")?.kind, .dashboard)
        XCTAssertEqual(entity("bb://artifact/art_0123456789abcdef")?.kind, .artifact)
        XCTAssertEqual(entity("bb://recording/rec_abcd1234")?.kind, .recording)
        XCTAssertNil(entity("bb://design/nope"), "an id no kind has")
    }

    func testDirectivesReferencesAndPaths() {
        XCTAssertEqual(entity(#"::page{id="pg_x"}"#), LinkRef(kind: .page, id: "pg_x"))
        XCTAssertEqual(entity(#"::drawing{id="drw_0123456789abcdef"}"#)?.kind, .whiteboard)
        XCTAssertEqual(entity(#"::loop{id="loop_1"}"#), LinkRef(kind: .todos, id: nil))
        XCTAssertEqual(entity(#"::bot-thread{threadId='thr_t'}"#), LinkRef(kind: .conversation, id: "thr_t"))
        XCTAssertNil(Links.parse(#"::unknown{id="x"}"#))
        XCTAssertEqual(entity("page:pg_x"), LinkRef(kind: .page, id: "pg_x"))
        XCTAssertEqual(entity("thread:thr_x"), LinkRef(kind: .conversation, id: "thr_x"))
        XCTAssertEqual(entity("/projects/p/threads/thr_x/files"), LinkRef(kind: .conversation, id: "thr_x"))
        XCTAssertEqual(entity("/plugins/studio/studio/apps/dsh_0123456789abcdef"), LinkRef(kind: .dashboard, id: "dsh_0123456789abcdef"))
        XCTAssertEqual(entity("/plugins/studio/studio/pages/pg_x/"), LinkRef(kind: .page, id: "pg_x"))
        XCTAssertEqual(entity("/plugins/studio/studio"), LinkRef(kind: .library, id: nil))
        XCTAssertEqual(entity("/plugins/studio/studio/conversations/bot_1"), LinkRef(kind: .archive, id: "bot_1"))
        XCTAssertEqual(entity("/plugins/studio/studio/bot/bot_1/loops"), LinkRef(kind: .todos, id: "bot_1"))
        XCTAssertEqual(entity("/plugins/studio/studio/bot/bot_1"), LinkRef(kind: .bot, id: "bot_1"))
        XCTAssertNil(entity("/plugins/studio/studio/bot/new"))
        XCTAssertEqual(entity("/plugins/studio-visual-chat/canvas/thr_v"), LinkRef(kind: .board, id: "thr_v"))
        XCTAssertNil(entity("/plugins/studio-visual-chat/canvas/new"))
        XCTAssertEqual(entity("bb://plugins/studio/studio/record/mem_1"), LinkRef(kind: .record, id: "mem_1"), "a bb:// path falls back to the address")
    }

    func testWebLinksActionsAndOrigin() {
        let origin = URL(string: "https://bb.example.ts.net")!
        XCTAssertEqual(entity("https://bb.example.ts.net/threads/thr_x", origin: origin), LinkRef(kind: .conversation, id: "thr_x"))
        XCTAssertEqual(Links.parse("https://example.com/a", origin: origin), .external(URL(string: "https://example.com/a")!))
        XCTAssertEqual(Links.parse("mailto:a@example.com"), .external(URL(string: "mailto:a@example.com")!))
        XCTAssertEqual(Links.parse("bb://accounts"), .action("accounts"))
        XCTAssertEqual(Links.parse("bb://edit-space/"), .action("edit-space"))
        XCTAssertEqual(entity("file:///tmp/a%20b.txt"), LinkRef(kind: .file, id: "/tmp/a b.txt"))
        XCTAssertNil(Links.parse("   "))
        XCTAssertNil(Links.parse("ftp://x"))
    }

    func testBBStudioMirrorsBB() {
        XCTAssertEqual(entity("bbstudio://memory"), entity("bb://memory"))
        XCTAssertEqual(entity("bbstudio://worker/thr_w"), entity("bb://worker/thr_w"))
        XCTAssertEqual(entity("bbstudio://record/mem_1"), entity("bb://record/mem_1"))
        XCTAssertNil(Links.parse("bbstudio://accounts"), "actions are bb:// only")
        XCTAssertEqual(LinkRef(kind: .browser, id: "https://a.b/c d").link, "bb://browser/https%3A%2F%2Fa.b%2Fc%20d")
    }

    func testAppLinksRouteNewKindsAlwaysAndOldOnesInSpaces() {
        func target(_ text: String, spaces: Bool) -> LinkRef? {
            guard case .entity(let ref)? = AppModel.linkTarget(URL(string: text)!, inSpaces: spaces) else { return nil }
            return ref
        }
        XCTAssertEqual(target("bbstudio://memory", spaces: false), LinkRef(kind: .memory, id: nil))
        XCTAssertEqual(target("bbstudio://worker/thr_w", spaces: false), LinkRef(kind: .worker, id: "thr_w"))
        XCTAssertNil(target("bbstudio://page/pg_x", spaces: false), "old hosts keep their old screens without spaces")
        XCTAssertEqual(target("bbstudio://page/pg_x", spaces: true), LinkRef(kind: .page, id: "pg_x"))
        XCTAssertNil(target("bbstudio://thread/thr_x", spaces: false))
        XCTAssertEqual(target("bbstudio://thread/thr_x", spaces: true), LinkRef(kind: .conversation, id: "thr_x"), "a thread opens in the Bot's list")
        XCTAssertNil(target("bbstudio://file/a", spaces: true), "files open from their thread")
        XCTAssertNil(target("bbstudio://bot", spaces: true), "the bare Bot link keeps its old meaning")
        XCTAssertNil(target("bbstudio://capture", spaces: true))
    }

    func testDestinations() {
        XCTAssertEqual(Links.destination(LinkRef(kind: .worker, id: "t")), .thread("t", worker: true))
        XCTAssertEqual(Links.destination(LinkRef(kind: .archive, id: "bot_1")), .botPage(.archive, botId: "bot_1"))
        XCTAssertEqual(Links.destination(LinkRef(kind: .app, id: "mini_1")), .route(.mini(id: "mini_1")))
        XCTAssertEqual(Links.destination(LinkRef(kind: .board, id: "thr_v")), .route(.visualChat(threadId: "thr_v")))
        XCTAssertEqual(Links.destination(LinkRef(kind: .record, id: "mem_1")), .record("mem_1"))
        XCTAssertEqual(Links.destination(LinkRef(kind: .browser, id: "https://a.b")), .safari(URL(string: "https://a.b")!))
        XCTAssertEqual(Links.destination(LinkRef(kind: .diff, id: "a.swift")), .threadFiles)
        if case .elsewhere = Links.destination(LinkRef(kind: .vscode, id: nil)) {} else { XCTFail("VS Code opens on the Mac") }
        XCTAssertTrue(Links.needsResolution(LinkRef(kind: .page, id: "pg_x")))
        XCTAssertFalse(Links.needsResolution(LinkRef(kind: .memory, id: nil)))
        XCTAssertFalse(Links.needsResolution(LinkRef(kind: .browser, id: "https://a.b")))
    }

    func testResolveSendsKindIdAndThread() async throws {
        let client = BBClient(baseURL: URL(string: "https://links-\(UUID().uuidString.lowercased()).invalid")!)
        nonisolated(unsafe) var sent: [String: Any] = [:]
        client.transport = { _, _, body in
            sent = body.flatMap { try? JSONSerialization.jsonObject(with: $0) as? [String: Any] } ?? [:]
            return (200, Data(#"{"ok":true,"result":{"found":false,"title":null,"spec":null}}"#.utf8))
        }
        let resolution = try await client.resolveLink(LinkRef(kind: .page, id: "pg_x"), threadId: nil)
        XCTAssertFalse(resolution.found)
        XCTAssertEqual(sent["kind"] as? String, "page")
        XCTAssertEqual(sent["id"] as? String, "pg_x")
        XCTAssertTrue(sent["threadId"] is NSNull, "threadId is nullable, sent as null")
    }
}
