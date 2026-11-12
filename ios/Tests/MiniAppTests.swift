import XCTest
@testable import BBStudio

/// Studio mini apps on the phone: decoding, the frame URL and host page, and
/// the relay that answers the frame's calls through Studio's RPC.
final class MiniAppTests: XCTestCase {
    private func json(_ text: String) throws -> OrderedJSON { try OrderedJSON.parse(Data(text.utf8)) }
    private let miniId = "mini_0123456789abcdef"
    private let clientId = "client-0001"

    private func call(_ method: String, _ params: String) throws -> MiniRelay.Call {
        try MiniRelay.call(method, params: json(params), miniId: miniId, clientId: clientId).get()
    }

    // MARK: Decoding

    func testDecodesMinisGet() throws {
        let data = Data(#"""
            {"mini":{"id":"mini_0123456789abcdef","name":"  ","projectId":null,"versionId":"ver_1","updatedAt":2,"archived":false,
              "createdAt":1,"updatedBy":"agent","threadId":"thr_1","files":{"main.jsx":"export default () => null"},
              "manifest":{"entry":"main.jsx","libs":[],"collections":{"tasks":{"indexes":[]}},"capabilities":["fetch:*.github.com"],"size":{},"description":"Tracks tasks"},
              "versions":[],"granted":[],"pending":["fetch:*.github.com","bb.open","secret:token"],"secrets":[],
              "collections":[{"name":"tasks","count":3},{"name":"notes","count":1}]}}
            """#.utf8)
        struct Get: Decodable { var mini: MiniApp? }
        let mini = try XCTUnwrap(try JSONDecoder().decode(Get.self, from: data).mini)
        XCTAssertEqual(mini.displayName, "Untitled mini app")
        XCTAssertEqual(mini.versionId, "ver_1")
        XCTAssertEqual(mini.manifest?.description, "Tracks tasks")
        XCTAssertEqual(mini.recordCount, 4)
        XCTAssertEqual(mini.accessText,
            "This mini app asks for access: Reach any address under github.com over the internet, through Studio; "
                + "Open threads and Studio items in BB; Send the secret “token” you store for it, as a request header. The app never sees the value.")
        XCTAssertNil(try JSONDecoder().decode(Get.self, from: Data(#"{"mini":null}"#.utf8)).mini)
    }

    func testNoBannerWithoutPendingAccess() {
        let mini = MiniApp(id: miniId, name: "Board", projectId: nil, versionId: nil, updatedAt: 0, archived: false, threadId: nil,
            manifest: nil, granted: ["fetch:api.example.com"], pending: [], collections: [])
        XCTAssertNil(mini.accessText)
        XCTAssertEqual(MiniApp.describe("fetch:api.example.com"), "Reach api.example.com over the internet, through Studio")
    }

    func testIds() {
        XCTAssertTrue(MiniApp.isId("mini_0123456789abcdef"))
        XCTAssertFalse(MiniApp.isId("mini_0123456789ABCDEF"))
        XCTAssertFalse(MiniApp.isId("mini_0123"))
        XCTAssertEqual(ReplyItem(Directive(line: #"::mini{id="mini_0123456789abcdef"}"#)!), .mini("mini_0123456789abcdef"))
        XCTAssertNil(ReplyItem(Directive(line: #"::mini{id="art_0123456789abcdef"}"#)!))
        XCTAssertEqual(Route(href: "/plugins/studio/studio/minis/mini_0123456789abcdef"), .mini(id: "mini_0123456789abcdef"))
    }

    // MARK: Frame

    func testFrameURLAndHostPage() throws {
        let client = BBClient(baseURL: URL(string: "https://bb.example.ts.net")!)
        let url = client.miniFrameURL(miniId, versionId: "ver_1", dark: true)
        XCTAssertEqual(url.absoluteString, "https://bb.example.ts.net/api/v1/plugins/studio/http/minis/frame?mini=mini_0123456789abcdef&version=ver_1&theme=dark")
        let relative = MiniRelay.relative(url)
        XCTAssertEqual(relative, "/api/v1/plugins/studio/http/minis/frame?mini=mini_0123456789abcdef&version=ver_1&theme=dark")
        let page = MiniRelay.hostDocument(frame: relative, dark: false)
        XCTAssertTrue(page.contains(#"sandbox="allow-scripts allow-forms allow-modals allow-downloads""#))
        XCTAssertTrue(page.contains(#"src="/api/v1/plugins/studio/http/minis/frame?mini=mini_0123456789abcdef&amp;version=ver_1&amp;theme=dark""#))
        XCTAssertFalse(page.contains("allow-same-origin"))
    }

    func testOnlyTheHostPageAndThisFrameLoad() {
        let server = URL(string: "https://bb.example.ts.net")!
        let frame = URL(string: "https://bb.example.ts.net/api/v1/plugins/studio/http/minis/frame?mini=\(miniId)&version=v&theme=light")!
        XCTAssertTrue(MiniRelay.allows(server, mainFrame: true, server: server, miniId: miniId))
        XCTAssertTrue(MiniRelay.allows(URL(string: "https://bb.example.ts.net/")!, mainFrame: true, server: server, miniId: miniId))
        XCTAssertTrue(MiniRelay.allows(frame, mainFrame: false, server: server, miniId: miniId))
        XCTAssertFalse(MiniRelay.allows(frame, mainFrame: true, server: server, miniId: miniId))
        XCTAssertFalse(MiniRelay.allows(URL(string: "https://bb.example.ts.net/api/v1/plugins/studio/http/minis/frame?mini=mini_ffffffffffffffff&version=v")!,
            mainFrame: false, server: server, miniId: miniId))
        XCTAssertFalse(MiniRelay.allows(URL(string: "https://evil.example/api/v1/plugins/studio/http/minis/frame?mini=\(miniId)")!,
            mainFrame: false, server: server, miniId: miniId))
        XCTAssertFalse(MiniRelay.allows(URL(string: "https://bb.example.ts.net/projects")!, mainFrame: true, server: server, miniId: miniId))
        XCTAssertFalse(MiniRelay.allows(nil, mainFrame: false, server: server, miniId: miniId))
    }

    // MARK: Calls

    func testRecordReadsMapToStudioRPC() throws {
        let find = try call("db.find", #"{"collection":"tasks","query":{"where":{"done":false},"order":"-createdAt","limit":20}}"#)
        XCTAssertEqual(find.method, "minis.db.find")
        XCTAssertEqual(find.pick, "records")
        XCTAssertEqual(find.input.jsonText,
            #"{"id":"mini_0123456789abcdef","collection":"tasks","query":{"where":{"done":false},"order":"-createdAt","limit":20}}"#)

        // Count sends only the filter, and none when there is none.
        let count = try call("db.count", #"{"collection":"tasks","query":{"where":{"done":true},"limit":5}}"#)
        XCTAssertEqual(count.method, "minis.db.count")
        XCTAssertEqual(count.pick, "count")
        XCTAssertEqual(count.input.jsonText, #"{"id":"mini_0123456789abcdef","collection":"tasks","query":{"where":{"done":true}}}"#)
        XCTAssertEqual(try call("db.count", #"{"collection":"tasks","query":{}}"#).input.jsonText,
            #"{"id":"mini_0123456789abcdef","collection":"tasks","query":{}}"#)

        let get = try call("db.get", #"{"collection":"tasks","id":"t1"}"#)
        XCTAssertEqual(get.method, "minis.db.get")
        XCTAssertEqual(get.pick, "record")
        XCTAssertEqual(get.input.jsonText, #"{"id":"mini_0123456789abcdef","collection":"tasks","recordId":"t1"}"#)

        // A missing query is an empty one, and a missing collection an empty name the server refuses.
        XCTAssertEqual(try call("db.find", "{}").input.jsonText, #"{"id":"mini_0123456789abcdef","collection":"","query":{}}"#)
    }

    func testRecordWritesCarryTheClientAndKeepFieldOrder() throws {
        let insert = try call("db.insert", #"{"collection":"tasks","data":{"title":"Ship","done":false,"assignee":{"name":"Pat"}}}"#)
        XCTAssertEqual(insert.method, "minis.db.insert")
        XCTAssertEqual(insert.pick, "record")
        XCTAssertEqual(insert.input.jsonText,
            #"{"id":"mini_0123456789abcdef","clientId":"client-0001","collection":"tasks","data":{"title":"Ship","done":false,"assignee":{"name":"Pat"}}}"#)
        XCTAssertEqual(try call("db.insert", #"{"collection":"tasks","data":{},"id":"t9"}"#).input["recordId"], .string("t9"))
        XCTAssertNil(try call("db.insert", #"{"collection":"tasks","data":{},"id":""}"#).input["recordId"])

        let update = try call("db.update", #"{"collection":"tasks","id":"t1","data":{"title":"B"},"rev":3}"#)
        XCTAssertEqual(update.method, "minis.db.update")
        XCTAssertEqual(update.input.jsonText,
            #"{"id":"mini_0123456789abcdef","clientId":"client-0001","collection":"tasks","recordId":"t1","data":{"title":"B"},"rev":3}"#)
        XCTAssertNil(try call("db.update", #"{"collection":"tasks","id":"t1","data":{},"rev":"3"}"#).input["rev"])

        let patch = try call("db.patch", #"{"collection":"tasks","id":"t1","fields":{"done":true,"note":null}}"#)
        XCTAssertEqual(patch.method, "minis.db.patch")
        XCTAssertEqual(patch.input.jsonText,
            #"{"id":"mini_0123456789abcdef","clientId":"client-0001","collection":"tasks","recordId":"t1","fields":{"done":true,"note":null}}"#)

        let remove = try call("db.remove", #"{"collection":"tasks","id":7}"#)
        XCTAssertEqual(remove.method, "minis.db.remove")
        XCTAssertNil(remove.pick, "remove answers with the whole result, {removed}")
        XCTAssertEqual(remove.input["recordId"], .string("7"))
    }

    func testNetworkAndBBCallsAreRefusedOnThePhone() {
        for (method, what) in [("fetch", "reach the internet"), ("bb.threads.list", "read your threads"),
                               ("bb.studio.list", "search Studio"), ("bb.open", "open BB items")] {
            let result = MiniRelay.call(method, params: .object([]), miniId: miniId, clientId: clientId)
            XCTAssertEqual(result, .failure(MiniRelay.Refusal(message: "Open this mini app in BB on your computer to \(what).")), method)
        }
        XCTAssertEqual(MiniRelay.call("db.drop", params: .object([]), miniId: miniId, clientId: clientId),
            .failure(MiniRelay.Refusal(message: "Unknown call db.drop.")))
        XCTAssertTrue(MiniRelay.sendRefused.hasPrefix("Open this mini app in BB on your computer"))
    }

    func testRepliesAndTheme() throws {
        XCTAssertEqual(MiniRelay.reply(.number(4), value: try json(#"[{"id":"t1","data":{"b":1,"a":2}}]"#)).jsonText,
            #"{"type":"bb-mini","op":"reply","id":4,"ok":true,"value":[{"id":"t1","data":{"b":1,"a":2}}]}"#)
        XCTAssertEqual(MiniRelay.reply(.number(5), error: "No").jsonText, #"{"type":"bb-mini","op":"reply","id":5,"ok":false,"error":"No"}"#)
        let theme = MiniRelay.theme(dark: true)
        XCTAssertEqual(theme["op"], .string("theme"))
        XCTAssertEqual(theme["theme"], .string("dark"))
        XCTAssertEqual(MiniRelay.theme(dark: false)["theme"], .string("light"))
    }

    func testActionResults() throws {
        XCTAssertEqual(MiniRelay.result(try json(#"{"op":"result","id":"cmd1","ok":true,"value":{"n":1}}"#), clientId: clientId).jsonText,
            #"{"commandId":"cmd1","clientId":"client-0001","ok":true,"value":{"n":1}}"#)
        XCTAssertEqual(MiniRelay.result(try json(#"{"op":"result","id":"cmd2","ok":false,"error":"Nope"}"#), clientId: clientId).jsonText,
            #"{"commandId":"cmd2","clientId":"client-0001","ok":false,"error":"Nope"}"#)
        XCTAssertEqual(MiniRelay.result(try json(#"{"op":"result","id":"cmd3","ok":false}"#), clientId: clientId)["error"],
            .string("The action failed."))
    }

    // MARK: Realtime

    func testRealtimeEventsForThisCopy() {
        let other: JSONValue = ["type": "state", "miniId": "mini_ffffffffffffffff", "state": 1, "version": 1, "origin": "x"]
        XCTAssertNil(MiniRelay.event(other, miniId: miniId, clientId: clientId))

        // Our own save comes back with our origin; the frame already has it.
        let ours: JSONValue = ["type": "state", "miniId": .string(miniId), "state": ["n": 1], "version": 2, "origin": .string(clientId)]
        XCTAssertNil(MiniRelay.event(ours, miniId: miniId, clientId: clientId))
        let theirs: JSONValue = ["type": "state", "miniId": .string(miniId), "state": ["n": 1], "version": 2, "origin": "agent"]
        XCTAssertEqual(MiniRelay.event(theirs, miniId: miniId, clientId: clientId),
            .post(.object([.init("type", .string("bb-mini")), .init("op", .string("state")), .init("state", .object([.init("n", .number(1))]))])))

        let records: JSONValue = ["type": "records", "miniId": .string(miniId), "collection": "tasks", "origin": .string(clientId),
                                  "changes": [["op": "remove", "id": "t1"]]]
        guard case .post(let posted)? = MiniRelay.event(records, miniId: miniId, clientId: clientId) else { return XCTFail("records") }
        XCTAssertEqual(posted.jsonText, #"{"type":"bb-mini","op":"records","collection":"tasks","changes":[{"id":"t1","op":"remove"}]}"#)

        let command: JSONValue = ["type": "do", "miniId": .string(miniId), "clientId": .string(clientId), "commandId": "c1", "action": "add", "args": [1]]
        guard case .post(let doing)? = MiniRelay.event(command, miniId: miniId, clientId: clientId) else { return XCTFail("do") }
        XCTAssertEqual(doing.jsonText, #"{"type":"bb-mini","op":"do","id":"c1","action":"add","args":[1]}"#)
        let elsewhere: JSONValue = ["type": "do", "miniId": .string(miniId), "clientId": "other", "commandId": "c1", "action": "add", "args": []]
        XCTAssertNil(MiniRelay.event(elsewhere, miniId: miniId, clientId: clientId))

        XCTAssertEqual(MiniRelay.event(["type": "source", "miniId": .string(miniId), "versionId": "v2"], miniId: miniId, clientId: clientId), .reload)
        XCTAssertEqual(MiniRelay.event(["type": "grants", "miniId": .string(miniId)], miniId: miniId, clientId: clientId), .reload)
        XCTAssertEqual(MiniRelay.event(["type": "changed", "miniId": .string(miniId)], miniId: miniId, clientId: clientId), .changed)
    }

    // MARK: Reply cards

    func testCardHeightFitsTheContentBetweenTheManifestsBounds() throws {
        let size = MiniApp.Manifest.Size(minHeight: 200, maxHeight: 500)
        XCTAssertEqual(MiniSizing.height(content: 320, size: size), 320)
        XCTAssertEqual(MiniSizing.height(content: 90, size: size), 200)
        XCTAssertEqual(MiniSizing.height(content: 1400, size: size), 500)
        // Before the frame measures itself, as the desktop: at least 240.
        XCTAssertEqual(MiniSizing.height(content: nil, size: size), 240)
        XCTAssertEqual(MiniSizing.height(content: nil, size: .init(minHeight: 300, maxHeight: nil)), 300)
        // Without bounds, the desktop's 120 to 720.
        XCTAssertEqual(MiniSizing.height(content: 40, size: nil), 120)
        XCTAssertEqual(MiniSizing.height(content: 4000, size: .init(minHeight: nil, maxHeight: nil)), 720)
        XCTAssertEqual(MiniSizing.height(content: .infinity, size: nil), 240)

        // The frame scrolls inside only past the maximum.
        XCTAssertFalse(MiniSizing.scrolls(content: 500, size: size))
        XCTAssertTrue(MiniSizing.scrolls(content: 501, size: size))
        XCTAssertFalse(MiniSizing.scrolls(content: nil, size: size))
        XCTAssertTrue(MiniSizing.scrolls(content: 800, size: nil))

        let manifest = try JSONDecoder().decode(MiniApp.Manifest.self, from: Data(#"{"size":{"minHeight":160,"maxHeight":480}}"#.utf8))
        XCTAssertEqual(manifest.size, .init(minHeight: 160, maxHeight: 480))
        XCTAssertNil(try JSONDecoder().decode(MiniApp.Manifest.self, from: Data("{}".utf8)).size)
    }

    func testSizeMessages() throws {
        XCTAssertEqual(MiniRelay.size(try json(#"{"type":"bb-mini","op":"size","height":312.4}"#)), 312)
        XCTAssertNil(MiniRelay.size(try json(#"{"type":"bb-mini","op":"size","height":"312"}"#)))
        XCTAssertNil(MiniRelay.size(try json(#"{"type":"bb-mini","op":"size"}"#)))
        XCTAssertNil(MiniRelay.size(try json(#"{"type":"bb-mini","op":"touch","height":1}"#)))
        XCTAssertEqual(MiniRelay.size(try json(#"{"type":"bb-mini","op":"size","height":-4}"#)), 0)
    }

    func testDistanceFromTheScreen() {
        let viewport = CGRect(x: 0, y: 1000, width: 400, height: 800)
        XCTAssertEqual(MiniCardLiveness<Int>.distance(of: CGRect(x: 0, y: 1200, width: 400, height: 300), in: viewport), 0)
        XCTAssertEqual(MiniCardLiveness<Int>.distance(of: CGRect(x: 0, y: 700, width: 400, height: 400), in: viewport), 0, "partly on screen")
        XCTAssertEqual(MiniCardLiveness<Int>.distance(of: CGRect(x: 0, y: 2100, width: 400, height: 300), in: viewport), 300, "below")
        XCTAssertEqual(MiniCardLiveness<Int>.distance(of: CGRect(x: 0, y: 400, width: 400, height: 300), in: viewport), 300, "above")
    }

    func testCardsRunNearTheScreenAndStopFarAway() {
        var cards = MiniCardLiveness<String>(cap: 3, near: 400, far: 1200)
        cards.report("a", distance: 900)
        XCTAssertEqual(cards.live, [], "not near yet: no web view")
        cards.report("a", distance: 400)
        XCTAssertEqual(cards.live, ["a"])
        // Running cards keep running until they're far, so the edge doesn't flap.
        cards.report("a", distance: 1000)
        XCTAssertEqual(cards.live, ["a"])
        cards.report("a", distance: 1300)
        XCTAssertEqual(cards.live, [], "far away: torn down")
        cards.report("a", distance: 1000)
        XCTAssertEqual(cards.live, [], "starts again only once near")
        cards.report("a", distance: 0)
        XCTAssertEqual(cards.live, ["a"])
        // Gone (scrolled out of the thread's lazy stack, or collapsed): torn down.
        cards.report("a", distance: nil)
        XCTAssertEqual(cards.live, [])
        XCTAssertEqual(cards.count, 0)
    }

    func testAtMostThreeCardsRunAtOnce() {
        var cards = MiniCardLiveness<String>()
        XCTAssertEqual(cards.cap, 3)
        for id in ["a", "b", "c", "d"] { cards.report(id, distance: 0) }
        XCTAssertEqual(cards.live, ["a", "b", "c"], "the first three on screen")

        // The user taps the paused one: it runs instead of the oldest.
        cards.pick("d")
        XCTAssertEqual(cards.live.count, 3)
        XCTAssertTrue(cards.live.contains("d"))
        XCTAssertFalse(cards.live.contains("c"), "c was reported last of the others")

        // One scrolls off: the paused one on screen takes its place.
        cards.report("a", distance: 300)
        XCTAssertEqual(cards.live, ["b", "c", "d"])
        // On-screen cards go before ones that are only near.
        cards.report("e", distance: 200)
        XCTAssertFalse(cards.live.contains("e"))
        cards.report("b", distance: nil)
        cards.report("c", distance: nil)
        XCTAssertEqual(cards.live, ["a", "d", "e"])
    }

    func testRunningCardsKeepTheirPlaceOverNearerOnes() {
        var cards = MiniCardLiveness<String>(cap: 2)
        cards.report("a", distance: 0)
        cards.report("b", distance: 0)
        cards.report("a", distance: 700)
        cards.report("c", distance: 100)
        XCTAssertEqual(cards.live, ["a", "b"], "scrolling doesn't swap a running app for a nearer one off screen")
        cards.report("a", distance: 1300)
        XCTAssertEqual(cards.live, ["b", "c"])
        // A pick for a card that isn't there does nothing.
        cards.pick("z")
        XCTAssertEqual(cards.live, ["b", "c"])
    }

    func testCrashesReloadUntilTheyRepeat() {
        let start = Date(timeIntervalSince1970: 1000)
        var deaths: [Date] = []
        for second in [0.0, 10, 20] {
            let (reload, recent) = MiniRelay.reloadAfterCrash(deaths, now: start + second)
            XCTAssertTrue(reload)
            deaths = recent
        }
        XCTAssertFalse(MiniRelay.reloadAfterCrash(deaths, now: start + 30).reload, "a fourth death within a minute stops")
        let later = MiniRelay.reloadAfterCrash(deaths, now: start + 75)
        XCTAssertTrue(later.reload, "deaths more than a minute old don't count")
        XCTAssertEqual(later.recent.count, 2)
    }
}
