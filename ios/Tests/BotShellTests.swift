import XCTest
@testable import BBStudio

final class BotShellTests: XCTestCase {
    private var server: URL!

    override func setUp() {
        server = URL(string: "https://bot-shell-\(UUID().uuidString.lowercased()).invalid")!
    }

    override func tearDown() {
        BotSpacesSupport.store(.unknown, serverURL: server)
    }

    private static func spaces(current: String = "bot_a", bNeeds: Bool = false) throws -> BotSpaces {
        let json = #"""
            {"bots":[
              {"id":"bot_a","name":"Ada","avatar":"A","primary":true,"mainThreadId":"thr_a_main","needsYou":false,"activity":{"turn":false,"workers":0}},
              {"id":"bot_b","name":"Bea","avatar":"B","primary":false,"mainThreadId":"thr_b_main","needsYou":\#(bNeeds)},
              {"id":"bot_c","name":"Cy","avatar":"C","primary":false,"mainThreadId":null,"needsYou":false}
            ],"currentBotId":"\#(current)"}
            """#
        return BotSpaces(try JSONDecoder().decode(Studio.BotSpacesOutput.self, from: Data(json.utf8)))
    }

    private static func conversation(_ id: String, _ title: String, main: Bool = false, parent: String? = nil, parentTitle: String = "Main",
                                     latest: String? = nil, running: Bool = false, needs: String? = nil, updated: Double = 1000) -> String {
        let forked = parent.map { #"{"threadId":"\#($0)","messageId":"m","title":"\#(parentTitle)"}"# } ?? "null"
        let needsYou = needs.map { #"{"reason":"\#($0)","at":1}"# } ?? "null"
        let latestJSON = latest.map { #""\#($0)""# } ?? "null"
        return #"{"threadId":"\#(id)","title":"\#(title)","isMain":\#(main),"forkedFrom":\#(forked),"updatedAt":\#(updated),"latest":\#(latestJSON),"running":\#(running),"needsYou":\#(needsYou),"mirrored":false}"#
    }

    private static func view(_ botId: String, _ conversations: [String], workers: [String] = []) throws -> BotThreadsView {
        let json = #"{"botId":"\#(botId)","conversations":[\#(conversations.joined(separator: ","))],"workers":[\#(workers.joined(separator: ","))]}"#
        return BotThreadsView(try JSONDecoder().decode(Studio.BotThreadsViewOutput.self, from: Data(json.utf8)))
    }

    private static func worker(_ id: String, _ status: String) -> String {
        #"{"threadId":"\#(id)","title":"\#(id)","status":"\#(status)","ownerConversationId":"thr_a_main","ownerTitle":"Main"}"#
    }

    // MARK: Gate

    func testLaunchLoadsUntilStudioAnswersThenShowsTheRoom() {
        XCTAssertEqual(StudioLaunch.shown(support: .unknown, failed: false, timedOut: false), .loading, "loading while Studio hasn't answered")
        XCTAssertEqual(StudioLaunch.shown(support: .available, failed: false, timedOut: false), .room)
        XCTAssertEqual(StudioLaunch.shown(support: .available, failed: true, timedOut: true), .room, "an answer from before (the cache) wins")
    }

    func testOnlyARealFailureOrTheTimeoutShowsUnreachable() {
        XCTAssertEqual(StudioLaunch.shown(support: .unknown, failed: false, timedOut: true), .unreachable, "no answer in time")
        XCTAssertEqual(StudioLaunch.shown(support: .unknown, failed: true, timedOut: false), .unreachable, "the server answered with an error")
        XCTAssertEqual(StudioLaunch.shown(support: .unavailable, failed: false, timedOut: false), .unreachable, "Studio isn't installed")
        XCTAssertEqual(StudioLaunch.timeout, .seconds(10))
    }

    func testRetriesBackOff() {
        XCTAssertEqual((0..<5).map { StudioLaunch.retryDelay($0) }, [.seconds(5), .seconds(15), .seconds(60), .seconds(60), .seconds(60)])
        XCTAssertEqual(StudioLaunch.retryDelay(0, delays: []), .seconds(60))
    }

    @MainActor
    func testStoreGateFollowsTheStoredSupport() {
        XCTAssertFalse(BotSpacesStore(serverURL: server).useSpaces, "unknown on first launch")
        BotSpacesSupport.store(.unavailable, serverURL: server)
        XCTAssertFalse(BotSpacesStore(serverURL: server).useSpaces)
        BotSpacesSupport.store(.available, serverURL: server)
        XCTAssertTrue(BotSpacesStore(serverURL: server).useSpaces)
    }

    // MARK: Root and Main

    func testShownBotIsTheChoiceElseTheCurrentBot() throws {
        let spaces = try Self.spaces(current: "bot_b")
        XCTAssertEqual(BotShell.shownBot(spaces, chosen: nil)?.id, "bot_b")
        XCTAssertEqual(BotShell.shownBot(spaces, chosen: "bot_c")?.id, "bot_c")
        XCTAssertEqual(BotShell.shownBot(spaces, chosen: "bot_gone")?.id, "bot_b")
        XCTAssertNil(BotShell.shownBot(nil, chosen: "bot_a"))
    }

    func testMainComesFromTheViewElseTheSpace() throws {
        let spaces = try Self.spaces()
        let bot = spaces.bots[0]
        XCTAssertEqual(BotShell.mainThreadId(bot, view: nil), "thr_a_main")
        let view = try Self.view("bot_a", [Self.conversation("thr_x", "Other"), Self.conversation("thr_new_main", "Main", main: true)])
        XCTAssertEqual(BotShell.mainThreadId(bot, view: view), "thr_new_main")
        let other = try Self.view("bot_b", [Self.conversation("thr_b2", "Main", main: true)])
        XCTAssertEqual(BotShell.mainThreadId(bot, view: other), "thr_a_main", "another Bot's view is ignored")
        XCTAssertNil(BotShell.mainThreadId(spaces.bots[2], view: nil))
    }

    @MainActor
    func testLaunchLandsOnHomeWithMainAsTheConversationOnce() throws {
        let store = BotSpacesStore(serverURL: server)
        let shell = Router()
        shell.land(store) { _, main in main }
        XCTAssertFalse(shell.landed, "nothing to land on before spaces load")
        store.seedForDemo(try Self.spaces(), views: [:])
        shell.land(store) { _, main in main }
        XCTAssertEqual(shell.path, [], "the app opens on Home")
        XCTAssertEqual(shell.conversation, "thr_a_main", "Main is the open Duo's conversation")
        shell.openConversation("thr_other")
        shell.path = []
        shell.land(store) { _, main in main }
        XCTAssertEqual(shell.conversation, "thr_other", "landing happens once")
    }

    // MARK: Rows

    func testRowsShowRunningAndTheLatestWords() throws {
        let view = try Self.view("bot_a", [
            Self.conversation("thr_n", "Main", main: true, latest: "Done", running: true, needs: "Push to origin?"),
            Self.conversation("thr_r", "Busy", latest: nil, running: true),
            Self.conversation("thr_q", "Quiet", latest: "Last reply"),
        ])
        let lines = BotShell.lines(view)
        XCTAssertEqual(lines.map(\.running), [true, true, false])
        XCTAssertEqual(lines[0].text, "Done", "no needs-you reason: the latest words")
        XCTAssertEqual(lines[1].text, "Working…")
        XCTAssertEqual(lines[2].text, "Last reply")
    }

    // MARK: Switching

    @MainActor
    func testSwitchingWatchesTheShownBotAndOpensItsHome() throws {
        let store = BotSpacesStore(serverURL: server)
        store.seedForDemo(try Self.spaces(), views: [:])
        let shell = Router()
        shell.land(store) { _, main in main }
        shell.openConversation("thr_a_main")
        shell.show("bot_b", store: store)
        XCTAssertEqual(shell.shownBotId, "bot_b")
        XCTAssertEqual(shell.path, [], "another Bot opens on its Home")
        XCTAssertNil(shell.conversation)
        XCTAssertEqual(store.watched, ["bot_a", "bot_b"])
        shell.show("bot_c", store: store)
        XCTAssertEqual(store.watched, ["bot_a", "bot_c"], "the current Bot stays watched")
        shell.show("bot_gone", store: store)
        XCTAssertEqual(shell.shownBotId, "bot_c")
    }

    @MainActor
    func testBotLinksOpenThatBotsMain() throws {
        let store = BotSpacesStore(serverURL: server)
        store.seedForDemo(try Self.spaces(current: "bot_b"), views: [:])
        let shell = Router()
        shell.follow(.bot(nil), store: store)
        XCTAssertEqual(shell.shownBotId, "bot_a")
        XCTAssertEqual(shell.path, [.conversation(id: "thr_a_main")])
        shell.follow(.bot("bot_b"), store: store)
        XCTAssertEqual(shell.path, [.conversation(id: "thr_b_main")])
        shell.follow(.list, store: store)
        XCTAssertEqual(shell.path, [], "the list is Home")
        shell.follow(.settings, store: store)
        XCTAssertEqual(shell.path, [.settings], "Settings is pushed, not a sheet")
        shell.follow(.place(.memory, botId: nil), store: store)
        XCTAssertEqual(shell.tab, .memory, "Memory is a tab")
        shell.follow(.place(.archive, botId: nil), store: store)
        XCTAssertEqual(shell.tab, .home)
        XCTAssertEqual(shell.path, [.place(.archive)], "Archive is pushed on Home")
    }

    func testShortAge() {
        let now = Date(timeIntervalSince1970: 1_000_000)
        let ms = now.timeIntervalSince1970 * 1000
        XCTAssertEqual(BotShell.shortAge(ms - 10_000, now: now), "now")
        XCTAssertEqual(BotShell.shortAge(ms - 5 * 60_000, now: now), "5m")
        XCTAssertEqual(BotShell.shortAge(ms - 2 * 3_600_000, now: now), "2h")
        XCTAssertEqual(BotShell.shortAge(ms - 3 * 86_400_000, now: now), "3d")
        XCTAssertEqual(BotShell.shortAge(ms - 15 * 86_400_000, now: now), "2w")
    }
}
