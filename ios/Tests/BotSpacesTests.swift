import XCTest
@testable import BBStudio

final class BotSpacesTests: XCTestCase {
    private var server: URL!

    override func setUp() {
        server = URL(string: "https://bot-spaces-\(UUID().uuidString.lowercased()).invalid")!
    }

    override func tearDown() {
        BotSpacesSupport.store(.unknown, serverURL: server)
        BotSpacesCache.clear(botIds: ["bot_a", "bot_b"], serverURL: server)
    }

    private final class Calls: @unchecked Sendable {
        private let lock = NSLock()
        private var counts: [String: Int] = [:]
        private var bodies: [String: [JSONValue]] = [:]

        func record(_ method: String, _ body: JSONValue) {
            lock.lock()
            counts[method, default: 0] += 1
            bodies[method, default: []].append(body)
            lock.unlock()
        }

        func count(_ method: String) -> Int {
            lock.lock()
            defer { lock.unlock() }
            return counts[method] ?? 0
        }

        func viewRequests() -> [String] {
            lock.lock()
            defer { lock.unlock() }
            return (bodies["bot_threads_view"] ?? []).compactMap { $0["botId"]?.stringValue }
        }
    }

    private static let spacesJSON = #"""
        {"bots":[
          {"id":"bot_a","name":"Ada","avatar":"A","shape":"square","color":"#5b8def","primary":true,"mainThreadId":"thr_a_main","needsYou":false,"appearance":null,
           "presence":{"form":"orb","color":{"source":"custom","hex":"#112233"},"motion":1.5},"activity":{"turn":true,"workers":0}},
          {"id":"bot_b","name":"Bea","avatar":"B","shape":null,"color":null,"primary":false,"mainThreadId":null,"needsYou":true,"appearance":null}
        ],"currentBotId":"bot_a"}
        """#

    private static func viewJSON(_ botId: String, title: String = "Main") -> String {
        #"{"botId":"\#(botId)","conversations":[{"threadId":"thr_\#(botId)_main","title":"\#(title)","isMain":true,"forkedFrom":null,"projectId":null,"updatedAt":2000,"latest":null,"running":false,"needsYou":null,"mirrored":false}],"workers":[],"hiddenWorkers":0,"hiddenToday":0,"olderConversations":0}"#
    }

    private func client(spaces: @escaping @Sendable () -> (Int, String) = { (200, spacesJSON) }, calls: Calls) -> BBClient {
        let client = BBClient(baseURL: server)
        client.transport = { _, path, body in
            let method = String(path.split(separator: "/").last ?? "")
            let input = try body.map { try JSONDecoder().decode(JSONValue.self, from: $0) } ?? .null
            calls.record(method, input)
            switch method {
            case "bot_spaces":
                let (status, json) = spaces()
                if status != 200 { return (status, Data(json.utf8)) }
                return (200, Data(#"{"ok":true,"result":\#(json)}"#.utf8))
            case "bot_threads_view":
                let botId = input["botId"]?.stringValue ?? "bot_a"
                return (200, Data(#"{"ok":true,"result":\#(Self.viewJSON(botId, title: "Fresh"))}"#.utf8))
            default:
                return (404, Data(#"{"ok":false,"error":{"code":"unknown_method","message":"no"}}"#.utf8))
            }
        }
        return client
    }

    @MainActor
    private func waitUntil(_ condition: @MainActor () -> Bool, timeout: Duration = .seconds(3)) async {
        let deadline = ContinuousClock.now + timeout
        while !condition(), ContinuousClock.now < deadline {
            try? await Task.sleep(for: .milliseconds(10))
        }
    }

    @MainActor
    private func settle() async {
        try? await Task.sleep(for: .milliseconds(250))
    }

    private func signal(_ botId: String, _ changes: [String] = ["conversations"]) -> RealtimeEvent {
        .pluginSignal(pluginId: "studio", channel: "bot-threads-changed", payload: .object([
            "botId": .string(botId), "changes": .array(changes.map(JSONValue.string)),
        ]))
    }

    // MARK: Decoding

    func testDecodingIgnoresUnknownFieldsAndToleratesNewOptionalOnes() throws {
        let json = #"""
            {"botId":"bot_a","conversations":[
              {"threadId":"thr_1","title":"Main","isMain":true,"forkedFrom":null,"projectId":null,"updatedAt":1,"latest":null,"running":true,
               "needsYou":{"reason":"Asked you a question","at":5},"mirrored":false,"parentMessageId":"m1","replies":{"count":3,"lastRole":"assistant"}},
              {"threadId":"thr_2","title":"Thread","isMain":false,"forkedFrom":{"threadId":"thr_1","messageId":"m1","turnId":"t1","title":"Main","kind":"thread"},
               "updatedAt":2,"running":false,"mirrored":false},
              {"title":"no id"}
            ],
            "workers":[
              {"threadId":"w1","title":"Build","status":"needs-you","ownerConversationId":"thr_1","updatedAt":3},
              {"threadId":"w2","title":"Later","status":"paused","updatedAt":4,"sameTitle":0}
            ],
            "hiddenWorkers":2,"hiddenToday":1,"olderConversations":4,"threadsEnabled":true}
            """#
        let view = BotThreadsView(try JSONDecoder().decode(Studio.BotThreadsViewOutput.self, from: Data(json.utf8)))
        XCTAssertEqual(view.conversations.map(\.threadId), ["thr_1", "thr_2"])
        XCTAssertEqual(view.conversations[0].needsYou, BotConversation.NeedsYou(reason: "Asked you a question", at: 5))
        XCTAssertEqual(view.conversations[1].forkedFrom?.turnId, "t1")
        XCTAssertNil(view.conversations[1].projectId)
        XCTAssertNil(view.conversations[1].latest)
        XCTAssertEqual(view.threads(of: "thr_1").map(\.threadId), ["thr_2"])
        XCTAssertEqual(view.workers.map(\.status), [.needsYou, .other("paused")])
        XCTAssertEqual(view.workers[1].sameTitle, 1)
        XCTAssertEqual(view.hiddenToday, 1)
        XCTAssertEqual(view.olderConversations, 4)

        let space = try XCTUnwrap(BotSpaces(try JSONDecoder().decode(Studio.BotSpacesOutput.self, from: Data(Self.spacesJSON.utf8))).bots.first)
        XCTAssertEqual(space.presenceState(live: view), .needs)
        var calm = view
        calm.conversations = calm.conversations.map { var row = $0; row.needsYou = nil; return row }
        calm.workers = []
        XCTAssertEqual(space.presenceState(live: calm), .thinking)
    }

    func testOlderSpacesWithoutPresenceOrActivity() throws {
        let spaces = BotSpaces(try JSONDecoder().decode(Studio.BotSpacesOutput.self, from: Data(Self.spacesJSON.utf8)))
        XCTAssertEqual(spaces.current?.id, "bot_a")
        XCTAssertEqual(spaces.bots[0].presence, BotSpace.Presence(form: "orb", customColor: "#112233", motion: 1.5))
        XCTAssertEqual(spaces.bots[0].presenceState(), .thinking)
        let bea = spaces.bots[1]
        XCTAssertNil(bea.presence)
        XCTAssertEqual(bea.activity, BotSpace.Activity(turn: false, workers: 0))
        XCTAssertEqual(bea.presenceState(), .needs)
        XCTAssertTrue(spaces.anyNeedsYou)
    }

    func testSignalFromOtherChannelsOrWithoutBotIsIgnored() {
        XCTAssertNil(Studio.BotThreadsChangedEvent(signal: .pluginSignal(pluginId: "studio", channel: "pages", payload: ["botId": "bot_a"])))
        XCTAssertNil(Studio.BotThreadsChangedEvent(signal: .pluginSignal(pluginId: "other", channel: "bot-threads-changed", payload: ["botId": "bot_a"])))
        XCTAssertNil(Studio.BotThreadsChangedEvent(signal: .pluginSignal(pluginId: "studio", channel: "bot-threads-changed", payload: .object([:]))))
        XCTAssertEqual(Studio.BotThreadsChangedEvent(signal: signal("bot_a", ["presence", "brand-new"]))?.changes, [.presence, .unknown("brand-new")])
    }

    // MARK: Cache

    func testCacheRoundTripIsScopedToTheServer() throws {
        let spaces = BotSpaces(try JSONDecoder().decode(Studio.BotSpacesOutput.self, from: Data(Self.spacesJSON.utf8)))
        var view = BotThreadsView(try JSONDecoder().decode(Studio.BotThreadsViewOutput.self, from: Data(Self.viewJSON("bot_a").utf8)))
        view.workers = [BotWorker(try JSONDecoder().decode(Studio.BotThreadsViewOutputWorkersItem.self, from: Data(#"{"threadId":"w","status":"queued"}"#.utf8)))!]
        view.conversations[0].forkedFrom = BotConversation.Parent(threadId: "thr_p", messageId: "m", turnId: nil, title: "Parent")
        BotSpacesCache.saveSpaces(spaces, serverURL: server)
        BotSpacesCache.saveView(view, botId: "bot_a", serverURL: server)
        XCTAssertEqual(BotSpacesCache.loadSpaces(serverURL: server), spaces)
        XCTAssertEqual(BotSpacesCache.loadView("bot_a", serverURL: server), view)
        XCTAssertEqual(BotSpacesCache.loadView("bot_a", serverURL: server)?.workers.first?.status, .other("queued"))
        let other = URL(string: "https://bot-spaces-other.invalid")!
        XCTAssertNil(BotSpacesCache.loadSpaces(serverURL: other))
        XCTAssertNil(BotSpacesCache.loadView("bot_a", serverURL: other))
        BotSpacesCache.clear(botIds: ["bot_a"], serverURL: server)
        XCTAssertNil(BotSpacesCache.loadSpaces(serverURL: server))
        XCTAssertNil(BotSpacesCache.loadView("bot_a", serverURL: server))
    }

    @MainActor
    func testCachedListShowsBeforeTheNetworkAnswers() async throws {
        let spaces = BotSpaces(try JSONDecoder().decode(Studio.BotSpacesOutput.self, from: Data(Self.spacesJSON.utf8)))
        let view = BotThreadsView(try JSONDecoder().decode(Studio.BotThreadsViewOutput.self, from: Data(Self.viewJSON("bot_a", title: "Cached").utf8)))
        BotSpacesCache.saveSpaces(spaces, serverURL: server)
        BotSpacesCache.saveView(view, botId: "bot_a", serverURL: server)
        BotSpacesSupport.store(.available, serverURL: server)

        let store = BotSpacesStore(serverURL: server)
        store.restore()
        XCTAssertEqual(store.support, .available)
        XCTAssertEqual(store.spaces?.bots.map(\.id), ["bot_a", "bot_b"])
        XCTAssertEqual(store.view(for: "bot_a")?.conversations.first?.title, "Cached")

        let calls = Calls()
        store.attach(client: client(calls: calls), realtime: nil)
        await store.refresh()
        XCTAssertEqual(store.view(for: "bot_a")?.conversations.first?.title, "Fresh")
        XCTAssertEqual(BotSpacesCache.loadView("bot_a", serverURL: server)?.conversations.first?.title, "Fresh")
    }

    // MARK: Signals

    @MainActor
    func testSignalsRefetchOnlyTheMatchingBotAndCoalesce() async {
        let calls = Calls()
        let store = BotSpacesStore(serverURL: server)
        store.coalesceDelay = .milliseconds(50)
        store.attach(client: client(calls: calls), realtime: nil)
        await store.refresh()
        XCTAssertEqual(calls.count("bot_spaces"), 1)
        XCTAssertEqual(calls.viewRequests(), ["bot_a"])
        XCTAssertEqual(store.watched, ["bot_a"])

        store.handle(signal("bot_b"))
        await waitUntil { calls.count("bot_spaces") == 2 }
        await settle()
        XCTAssertEqual(calls.count("bot_spaces"), 2)
        XCTAssertEqual(calls.viewRequests(), ["bot_a"])

        for _ in 0..<5 { store.handle(signal("bot_a", ["workers", "needs-you"])) }
        await waitUntil { calls.viewRequests().count == 2 }
        await settle()
        XCTAssertEqual(calls.count("bot_spaces"), 3)
        XCTAssertEqual(calls.viewRequests(), ["bot_a", "bot_a"])

        store.handle(.pluginSignal(pluginId: "studio", channel: "pages", payload: ["botId": "bot_a"]))
        store.handle(.changed(entity: "thread", id: "thr_x", changes: ["status"]))
        await settle()
        XCTAssertEqual(calls.count("bot_spaces"), 3)
        XCTAssertEqual(calls.viewRequests().count, 2)
    }

    @MainActor
    func testReconnectRefetchesSpacesAndEveryWatchedBot() async {
        let calls = Calls()
        let store = BotSpacesStore(serverURL: server)
        store.coalesceDelay = .milliseconds(50)
        store.attach(client: client(calls: calls), realtime: nil)
        await store.refresh()
        store.watch("bot_b")
        await waitUntil { store.view(for: "bot_b") != nil }
        XCTAssertEqual(calls.viewRequests().sorted(), ["bot_a", "bot_b"])

        store.handle(.connected)
        store.handle(signal("bot_b"))
        await waitUntil { calls.viewRequests().count == 4 }
        await settle()
        XCTAssertEqual(calls.count("bot_spaces"), 2)
        XCTAssertEqual(calls.viewRequests().sorted(), ["bot_a", "bot_a", "bot_b", "bot_b"])

        store.unwatch("bot_b")
        store.handle(signal("bot_b"))
        await waitUntil { calls.count("bot_spaces") == 3 }
        await settle()
        XCTAssertEqual(calls.viewRequests().count, 4)
    }

    // MARK: Feature gate

    @MainActor
    func testGateIsAvailableWithTheMethod() async {
        let calls = Calls()
        let store = BotSpacesStore(serverURL: server)
        XCTAssertEqual(store.support, .unknown)
        XCTAssertFalse(store.useSpaces)
        store.attach(client: client(calls: calls), realtime: nil)
        await store.refresh()
        XCTAssertEqual(store.support, .available)
        XCTAssertTrue(store.useSpaces)
        XCTAssertEqual(BotSpacesSupport.stored(serverURL: server), .available)
        XCTAssertEqual(BotSpacesStore(serverURL: server).support, .available)
        XCTAssertEqual(BotSpacesSupport.stored(serverURL: URL(string: "https://bot-spaces-elsewhere.invalid")!), .unknown)
    }

    @MainActor
    func testGateIsUnavailableOnAnOlderStudioAndRecheckedOnReconnect() async {
        let calls = Calls()
        let hasMethod = LockedFlag()
        let store = BotSpacesStore(serverURL: server)
        store.coalesceDelay = .milliseconds(50)
        BotSpacesCache.saveView(BotThreadsView(Studio.BotThreadsViewOutput(botId: "bot_a")), botId: "bot_a", serverURL: server)
        store.attach(client: client(spaces: {
            hasMethod.value ? (200, Self.spacesJSON) : (404, #"{"ok":false,"error":{"code":"unknown_method","message":"plugin \"studio\" has no rpc method \"bot_spaces\""}}"#)
        }, calls: calls), realtime: nil)
        store.watch("bot_a", fetch: false)
        await store.refresh()
        XCTAssertEqual(store.support, .unavailable)
        XCTAssertFalse(store.useSpaces)
        XCTAssertNil(store.spaces)
        XCTAssertTrue(store.views.isEmpty)
        XCTAssertEqual(calls.count("bot_threads_view"), 0)
        XCTAssertEqual(BotSpacesSupport.stored(serverURL: server), .unavailable)
        XCTAssertNil(BotSpacesCache.loadView("bot_a", serverURL: server))

        store.handle(signal("bot_a"))
        await settle()
        XCTAssertEqual(calls.count("bot_spaces"), 1)

        hasMethod.value = true
        store.handle(.connected)
        await waitUntil { store.support == .available && store.view(for: "bot_a") != nil }
        XCTAssertEqual(store.support, .available)
        XCTAssertEqual(store.spaces?.current?.id, "bot_a")
        XCTAssertEqual(calls.viewRequests(), ["bot_a"])
    }

    @MainActor
    func testStudioNotRunningKeepsTheLastAnswer() async {
        let calls = Calls()
        BotSpacesSupport.store(.available, serverURL: server)
        let store = BotSpacesStore(serverURL: server)
        store.attach(client: client(spaces: { (503, #"{"ok":false,"error":{"message":"studio is not running"}}"#) }, calls: calls), realtime: nil)
        await store.refresh()
        XCTAssertEqual(store.support, .available)
        XCTAssertNotNil(store.error)
        XCTAssertEqual(BotSpacesSupport.stored(serverURL: server), .available)
    }

    @MainActor
    func testResponsesForAnotherServerAreIgnored() async {
        let calls = Calls()
        let store = BotSpacesStore(serverURL: URL(string: "https://bot-spaces-selected.invalid")!)
        store.attach(client: client(calls: calls), realtime: nil)
        await store.refresh()
        XCTAssertEqual(calls.count("bot_spaces"), 0)
        XCTAssertEqual(store.support, .unknown)
    }
}
