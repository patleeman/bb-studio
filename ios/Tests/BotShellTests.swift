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

    func testGateKeepsTheTabBarUntilSpacesAreAvailable() {
        XCTAssertFalse(BotShell.usesSpaces(support: .unknown, showing: false, idle: true))
        XCTAssertFalse(BotShell.usesSpaces(support: .unavailable, showing: true, idle: true))
        XCTAssertTrue(BotShell.usesSpaces(support: .available, showing: false, idle: true))
        XCTAssertFalse(BotShell.usesSpaces(support: .available, showing: false, idle: false), "never swaps the UI out from under an open thread")
        XCTAssertTrue(BotShell.usesSpaces(support: .available, showing: true, idle: false), "once shown it stays")
    }

    func testLaunchShowsTheRoomWhenSpacesAnswerBeforeTheFallback() {
        var launch = SpacesLaunch()
        XCTAssertEqual(launch.update(support: .unknown, idle: true), .loading, "neutral while support is unknown")
        XCTAssertEqual(launch.update(support: .available, idle: true), .room, "straight to the room, no classic flash")
        launch.timedOut = true
        XCTAssertEqual(launch.update(support: .available, idle: false), .room, "once shown it stays")
    }

    func testLaunchFallsBackToClassicThenSwitchesToTheRoomWhenIdle() {
        var launch = SpacesLaunch()
        XCTAssertEqual(launch.update(support: .unknown, idle: true), .loading)
        launch.timedOut = true
        XCTAssertEqual(launch.update(support: .unknown, idle: true), .classic, "classic after the fallback")
        XCTAssertEqual(launch.update(support: .unknown, idle: true), .classic, "never back to loading")
        XCTAssertEqual(launch.update(support: .available, idle: false), .classic, "a draft, a sheet or an open thread holds the switch")
        XCTAssertEqual(launch.update(support: .available, idle: true), .room, "switches on its own once idle")
        XCTAssertEqual(launch.update(support: .available, idle: false), .room, "and stays while the chat stands up")
    }

    func testLaunchOnAnOlderStudioIsClassicAtOnce() {
        var launch = SpacesLaunch()
        XCTAssertEqual(launch.update(support: .unknown, idle: true), .loading)
        XCTAssertEqual(launch.update(support: .unavailable, idle: true), .classic)
        XCTAssertEqual(launch.update(support: .unknown, idle: true), .classic)
    }

    func testLaunchWithALinkSkipsTheLoadingState() {
        var launch = SpacesLaunch()
        XCTAssertEqual(launch.update(support: .unknown, idle: false), .classic, "a linked thread opens at once")
        XCTAssertEqual(launch.update(support: .unknown, idle: true), .classic)
    }

    func testLaunchWithKnownSupportNeverShowsLoading() {
        XCTAssertEqual(SpacesLaunch().next(support: .available, idle: true), .room)
        XCTAssertEqual(SpacesLaunch().next(support: .unavailable, idle: true), .classic)
    }

    func testRetriesBackOff() {
        XCTAssertEqual((0..<5).map { SpacesLaunch.retryDelay($0) }, [.seconds(5), .seconds(15), .seconds(60), .seconds(60), .seconds(60)])
        XCTAssertEqual(SpacesLaunch.retryDelay(0, delays: []), .seconds(60))
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
    func testLaunchLandsOnMainOnce() throws {
        let store = BotSpacesStore(serverURL: server)
        let shell = BotShellModel()
        shell.land(store)
        XCTAssertFalse(shell.landed, "nothing to land on before spaces load")
        store.seedForDemo(try Self.spaces(), views: [:])
        shell.land(store)
        XCTAssertEqual(shell.selection, .conversation("thr_a_main"))
        XCTAssertEqual(shell.compactColumn, .detail, "Main is pushed over the list")
        shell.selection = nil
        shell.compactColumn = .sidebar
        shell.land(store)
        XCTAssertNil(shell.selection, "Back to the list stays on the list")
    }

    // MARK: Rows

    func testForksHaveNoRowsOfTheirOwn() throws {
        let view = try Self.view("bot_a", [
            Self.conversation("thr_a_main", "Main", main: true),
            Self.conversation("thr_other", "Other"),
            Self.conversation("thr_reply", "Reply", parent: "thr_a_main"),
            Self.conversation("thr_deep", "Deeper", parent: "thr_reply", parentTitle: "Reply"),
            Self.conversation("thr_orphan", "Orphan", parent: "thr_gone", parentTitle: "Gone"),
        ])
        let lines = BotShell.lines(view)
        XCTAssertEqual(lines.map(\.depth), [0, 0, 0, 0, 0], "Studio leaves forks out; any it sends are plain rows")
        XCTAssertTrue(lines.allSatisfy { $0.forkedFrom == nil }, "no ⑂ label")
    }

    func testNeedsYouRowShowsTheReasonOnLineTwo() throws {
        let view = try Self.view("bot_a", [
            Self.conversation("thr_n", "Main", main: true, latest: "Done", running: true, needs: "Push to origin?"),
            Self.conversation("thr_r", "Busy", latest: nil, running: true),
            Self.conversation("thr_q", "Quiet", latest: "Last reply"),
        ])
        let lines = BotShell.lines(view)
        XCTAssertEqual(lines[0].tone, .needsYou)
        XCTAssertEqual(lines[0].text, "Push to origin?")
        XCTAssertEqual(lines[1].tone, .running)
        XCTAssertEqual(lines[1].text, "Working…")
        XCTAssertEqual(lines[2].tone, .quiet)
        XCTAssertEqual(lines[2].text, "Last reply")
    }

    func testWorkersSplitActiveFromDone() throws {
        let view = try Self.view("bot_a", [], workers: [Self.worker("w_done", "done"), Self.worker("w_run", "running"),
                                                        Self.worker("w_need", "needs-you"), Self.worker("w_fail", "failed")])
        let split = BotShell.splitWorkers(view.workers)
        XCTAssertEqual(split.active.map(\.threadId), ["w_need", "w_run"])
        XCTAssertEqual(split.done.map(\.threadId), ["w_done", "w_fail"])
    }

    // MARK: Dots

    func testDotTurnsAmberWhenItsBotNeedsYou() throws {
        let spaces = try Self.spaces(bNeeds: true)
        var dots = BotShell.dots(spaces, shown: nil, views: [:])
        XCTAssertEqual(dots.map(\.active), [true, false, false])
        XCTAssertEqual(dots.map(\.amber), [false, true, false])
        XCTAssertEqual(dots[1].label, "Bea, needs you")
        let view = try Self.view("bot_a", [Self.conversation("thr_a_main", "Main", main: true, needs: "Approve?")])
        dots = BotShell.dots(spaces, shown: "bot_c", views: ["bot_a": view])
        XCTAssertEqual(dots.map(\.amber), [true, true, false], "a needs-you conversation turns its Bot's dot amber")
        XCTAssertEqual(dots.map(\.active), [false, false, true])
    }

    // MARK: Switching

    func testStepMovesOneBotWithoutWrapping() throws {
        let spaces = try Self.spaces()
        XCTAssertEqual(BotShell.step(spaces, from: "bot_a", by: 1), "bot_b")
        XCTAssertEqual(BotShell.step(spaces, from: "bot_b", by: -1), "bot_a")
        XCTAssertNil(BotShell.step(spaces, from: "bot_a", by: -1))
        XCTAssertNil(BotShell.step(spaces, from: "bot_c", by: 1))
    }

    @MainActor
    func testSwitchingWatchesTheShownBotAndUnwatchesTheLastOne() throws {
        let store = BotSpacesStore(serverURL: server)
        store.seedForDemo(try Self.spaces(), views: [:])
        let shell = BotShellModel()
        shell.land(store)
        shell.show("bot_b", store: store, compact: true)
        XCTAssertEqual(shell.shownBotId, "bot_b")
        XCTAssertNil(shell.selection, "on a phone it stays on the list")
        XCTAssertEqual(shell.compactColumn, .sidebar)
        XCTAssertEqual(store.watched, ["bot_a", "bot_b"])
        shell.step(1, store: store, compact: false)
        XCTAssertEqual(shell.shownBotId, "bot_c")
        XCTAssertEqual(store.watched, ["bot_a", "bot_c"], "the current Bot stays watched")
        XCTAssertNil(shell.selection, "Cy has no Main yet")
        shell.step(-1, store: store, compact: false)
        XCTAssertEqual(shell.selection, .conversation("thr_b_main"), "a split view opens the Bot's Main")
        shell.show("bot_gone", store: store, compact: false)
        XCTAssertEqual(shell.shownBotId, "bot_b")
    }

    @MainActor
    func testBotLinksOpenThatBotsMain() throws {
        let store = BotSpacesStore(serverURL: server)
        store.seedForDemo(try Self.spaces(current: "bot_b"), views: [:])
        let shell = BotShellModel()
        shell.open(.primary, store: store)
        XCTAssertEqual(shell.shownBotId, "bot_a")
        XCTAssertEqual(shell.selection, .conversation("thr_a_main"))
        shell.open(.bot("bot_b"), store: store)
        XCTAssertEqual(shell.selection, .conversation("thr_b_main"))
        shell.open(.list, store: store)
        XCTAssertNil(shell.selection)
        XCTAssertEqual(shell.compactColumn, .sidebar)
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
