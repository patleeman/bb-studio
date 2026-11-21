import XCTest
@testable import BBStudio

/// Plan step 12: the Bot Live Activity's state, the widgets on Bot spaces,
/// the relay token registration and Talk to Bot's thread.
final class NativeSurfacesTests: XCTestCase {
    private let server = URL(string: "https://native-surfaces.invalid")!

    private func spaces(needsYou: Bool = false, turn: Bool = false, workers: Int = 0) throws -> BotSpaces {
        let json = #"""
            {"bots":[
              {"id":"bot_a","name":"Ada","avatar":"A","primary":true,"mainThreadId":"thr_main","needsYou":\#(needsYou),
               "activity":{"turn":\#(turn),"workers":\#(workers)}},
              {"id":"bot_b","name":"Bea","avatar":"B","primary":false,"mainThreadId":"thr_b_main","needsYou":true}
            ],"currentBotId":"bot_a"}
            """#
        return BotSpaces(try JSONDecoder().decode(Studio.BotSpacesOutput.self, from: Data(json.utf8)))
    }

    private func view(mainRunning: Bool = false, mainLatest: String? = "Fable moved the **bridge** onto the [contract](https://x).",
                      interviewNeeds: Bool = false, workers: [(String, String)] = []) throws -> BotThreadsView {
        let latest = mainLatest.map { "\"\($0.replacingOccurrences(of: "\"", with: "\\\""))\"" } ?? "null"
        let needs = interviewNeeds ? #"{"reason":"Asked you a question","at":50}"# : "null"
        let workerJSON = workers.enumerated().map { index, worker in
            #"{"threadId":"w\#(index)","title":"\#(worker.0)","status":"\#(worker.1)","ownerConversationId":"thr_main","updatedAt":\#(10 + index)}"#
        }.joined(separator: ",")
        let json = #"""
            {"botId":"bot_a","conversations":[
              {"threadId":"thr_main","title":"Ada","isMain":true,"projectId":"p1","updatedAt":40,"latest":\#(latest),"running":\#(mainRunning)},
              {"threadId":"thr_iv","title":"Launch prep","isMain":false,"projectId":"p1","updatedAt":30,"latest":"Which day works?","running":false,"needsYou":\#(needs)}
            ],"workers":[\#(workerJSON)],"hiddenWorkers":0,"hiddenToday":0,"olderConversations":0}
            """#
        return BotThreadsView(try JSONDecoder().decode(Studio.BotThreadsViewOutput.self, from: Data(json.utf8)))
    }

    // MARK: Live Activity

    private let now = Date(timeIntervalSince1970: 1_800_000_000)
    private func sent(_ secondsAgo: TimeInterval) -> Date { now - secondsAgo }

    func testIdleBotHasNoActivity() throws {
        let bot = try XCTUnwrap(spaces().bots.first)
        XCTAssertNil(BotActivityAttributes.ContentState.make(bot: bot, view: try view(), turns: [:], now: now))
    }

    /// Workers and turns the phone didn't start never show one: no always-on "N workers" card.
    func testWorkersAndOtherTurnsAloneShowNothing() throws {
        let bot = try XCTUnwrap(spaces(turn: true, workers: 4).bots.first)
        let busy = try view(mainRunning: true, interviewNeeds: true, workers: [("Port", "running"), ("Push", "needs-you")])
        XCTAssertNil(BotActivityAttributes.ContentState.make(bot: bot, view: busy, turns: [:], now: now))
        XCTAssertNil(BotActivityAttributes.ContentState.make(bot: bot, view: nil, turns: [:], now: now))
    }

    func testPhoneTurnThinksWithoutTheOldLine() throws {
        let bot = try XCTUnwrap(spaces(turn: true, workers: 2).bots.first)
        let state = try XCTUnwrap(BotActivityAttributes.ContentState.make(
            bot: bot, view: try view(mainRunning: true, workers: [("Port", "running"), ("Tests", "running")]),
            turns: ["thr_main": sent(60)], now: now))
        XCTAssertEqual(state.presence, .thinking)
        XCTAssertEqual(state.workers, 0)
        XCTAssertEqual(state.conversationId, "thr_main")
        XCTAssertEqual(state.conversationTitle, "Main")
        XCTAssertNil(state.line, "status only: never Main's old latest line")
        XCTAssertNil(state.needsYou)
    }

    func testAPassNeverShows() throws {
        let bot = try XCTUnwrap(spaces(turn: true).bots.first)
        let state = try XCTUnwrap(BotActivityAttributes.ContentState.make(
            bot: bot, view: try view(mainRunning: true, mainLatest: "[PASS]"), turns: ["thr_main": sent(60)], now: now))
        XCTAssertNil(state.line)
    }

    func testAJustSentTurnShowsUntilBBSaysItRuns() throws {
        let bot = try XCTUnwrap(spaces().bots.first)
        let idle = try view()
        let fresh = try XCTUnwrap(BotActivityAttributes.ContentState.make(bot: bot, view: idle, turns: ["thr_main": sent(5)], now: now))
        XCTAssertEqual(fresh.presence, .thinking)
        // Past the grace, still not running: it finished, or never started.
        XCTAssertNil(BotActivityAttributes.ContentState.make(bot: bot, view: idle, turns: ["thr_main": sent(25)], now: now))
        // Seen running and stopped: a quick reply ends it inside the grace.
        XCTAssertNil(BotActivityAttributes.ContentState.make(bot: bot, view: idle, turns: ["thr_main": sent(5)], ran: ["thr_main"], now: now))
    }

    func testAFinishedPhoneTurnEndsTheActivity() throws {
        let bot = try XCTUnwrap(spaces(workers: 3).bots.first)
        let after = try view(workers: [("Port", "running")])
        XCTAssertNil(BotActivityAttributes.ContentState.make(bot: bot, view: after, turns: ["thr_main": sent(120)], ran: ["thr_main"], now: now))
    }

    func testPhoneTurnThatNeedsYouSpeaksInAmber() throws {
        let bot = try XCTUnwrap(spaces().bots.first)
        let state = try XCTUnwrap(BotActivityAttributes.ContentState.make(
            bot: bot, view: try view(interviewNeeds: true), turns: ["thr_iv": sent(120)], now: now))
        XCTAssertEqual(state.presence, .needs)
        XCTAssertEqual(state.conversationId, "thr_iv")
        XCTAssertEqual(state.conversationTitle, "Launch prep")
        XCTAssertNil(state.line)
        XCTAssertEqual(state.needsYou, "Asked you a question")
    }

    func testANeedingTurnLeadsAndCarriesTheApproval() throws {
        let bot = try XCTUnwrap(spaces().bots.first)
        let approval = BotActivityAttributes.Approval(workerThreadId: "w0", interactionId: "int_1", summary: "Push: git push origin main")
        let state = try XCTUnwrap(BotActivityAttributes.ContentState.make(
            bot: bot, view: try view(mainRunning: true, interviewNeeds: true),
            turns: ["thr_main": sent(10), "thr_iv": sent(300)], approval: approval, now: now))
        XCTAssertEqual(state.conversationId, "thr_iv")
        XCTAssertEqual(state.approval, approval)
        let thinking = try XCTUnwrap(BotActivityAttributes.ContentState.make(
            bot: bot, view: try view(mainRunning: true), turns: ["thr_main": sent(10)], approval: approval, now: now))
        XCTAssertNil(thinking.approval, "an approval only goes with needs")
    }

    func testOtherBotsTurnsDontCount() throws {
        let bot = try XCTUnwrap(spaces().bots.first)
        XCTAssertNil(BotActivityAttributes.ContentState.make(bot: bot, view: try view(mainRunning: true), turns: ["thr_b_main": sent(5)], now: now))
    }

    func testWithoutAViewMainFollowsTheBotsTurn() throws {
        let running = try XCTUnwrap(spaces(turn: true, workers: 3).bots.first)
        let state = try XCTUnwrap(BotActivityAttributes.ContentState.make(bot: running, view: nil, turns: ["thr_main": sent(60)], now: now))
        XCTAssertEqual(state.presence, .thinking)
        XCTAssertEqual(state.workers, 0)
        XCTAssertEqual(state.conversationId, "thr_main")
        XCTAssertNil(state.line)
        let idle = try XCTUnwrap(spaces(workers: 3).bots.first)
        XCTAssertNil(BotActivityAttributes.ContentState.make(bot: idle, view: nil, turns: ["thr_main": sent(60)], now: now))
        XCTAssertNil(BotActivityAttributes.ContentState.make(bot: running, view: nil, turns: ["thr_iv": sent(5)], now: now))
    }

    func testPhoneTurnsReportRunningAndNeeds() throws {
        let bot = try XCTUnwrap(spaces().bots.first)
        let turns = BotActivityAttributes.ContentState.phoneTurns(
            bot: bot, view: try view(mainRunning: true, interviewNeeds: true),
            turns: ["thr_main": sent(1), "thr_iv": sent(2), "thr_elsewhere": sent(3)])
        XCTAssertEqual(turns.map(\.threadId).sorted(), ["thr_iv", "thr_main"])
        XCTAssertEqual(turns.first { $0.threadId == "thr_main" }?.running, true)
        XCTAssertEqual(turns.first { $0.threadId == "thr_iv" }?.needsYou, true)
    }

    func testOnlyShownChangesCountAsDifferent() throws {
        let bot = try XCTUnwrap(spaces(turn: true).bots.first)
        let turns = ["thr_main": sent(60)]
        let a = try XCTUnwrap(BotActivityAttributes.ContentState.make(bot: bot, view: try view(mainRunning: true), turns: turns, now: now))
        var b = try XCTUnwrap(BotActivityAttributes.ContentState.make(bot: bot, view: try view(mainRunning: true), turns: turns, now: now + 1))
        XCTAssertFalse(a.differs(from: b))
        b.workers = 1
        XCTAssertTrue(a.differs(from: b))
    }

    /// The content state Studio pushes (docs/live-activity-server.md) decodes as the app's.
    func testServerContentStateDecodes() throws {
        let json = #"""
            {"state":"needs","workers":2,"conversationId":"thr_main","conversationTitle":"Main",
             "line":"Fable moved the bridge onto the Studio contract.","needsYou":"Push bb-studio-native to origin?",
             "approval":{"workerThreadId":"thr_w","interactionId":"int_1","summary":"git push origin bb-studio-native","canApprove":true,"canDeny":true},
             "updatedAt":1794488269}
            """#
        let state = try JSONDecoder().decode(BotActivityAttributes.ContentState.self, from: Data(json.utf8))
        XCTAssertEqual(state.presence, .needs)
        XCTAssertEqual(state.approval?.interactionId, "int_1")
        let minimal = try JSONDecoder().decode(BotActivityAttributes.ContentState.self, from: Data(#"{"state":"working","workers":1,"updatedAt":1}"#.utf8))
        XCTAssertNil(minimal.line)
        let attributes = try JSONDecoder().decode(BotActivityAttributes.self, from: Data(#"{"botId":"bot_a","botName":"Ada","server":"abc"}"#.utf8))
        XCTAssertEqual(attributes.botName, "Ada")
    }

    func testActivityOpensTheConversationOnItsServer() {
        let attributes = BotActivityAttributes(botId: "bot_a", botName: "Ada", server: "ns1")
        let state = BotActivityAttributes.ContentState(state: "thinking", workers: 0, conversationId: "thr_iv", updatedAt: 0)
        XCTAssertEqual(BotActivityLinks.open(attributes, state).absoluteString, "bbstudio://conversation/thr_iv?server=ns1")
    }

    // MARK: Widgets

    func testWidgetFactsListNeedsAndRunning() throws {
        let facts = BotWidgetFacts(spaces: try spaces(), botId: "bot_a",
                                   view: try view(mainRunning: true, interviewNeeds: true, workers: [("Push", "needs-you"), ("Port", "running")]))
        XCTAssertEqual(facts.presence, .needs)
        XCTAssertEqual(facts.needs.map(\.id), ["thr_iv", "w0"])
        XCTAssertEqual(facts.running.map(\.id), ["thr_main", "w1"])
        XCTAssertEqual(facts.running.first?.displayTitle, "Main")
        XCTAssertEqual(facts.reason, "Asked you a question")
        XCTAssertEqual(facts.othersNeedingYou.map(\.id), ["bot_b"])
        XCTAssertEqual(facts.mainThreadId, "thr_main")
    }

    func testWorkWidgetCountsWorkersAsApprovals() throws {
        let facts = BotWidgetFacts(spaces: try spaces(), botId: "bot_a", view: try view(workers: [("Push", "needs-you")]))
        let entry = WorkProvider.entry(facts)
        XCTAssertNil(entry.reason)
        XCTAssertEqual(entry.attention, 0)
        XCTAssertEqual(entry.approvals, 1)
        XCTAssertEqual(entry.space?.name, "Ada")
        XCTAssertEqual(StatusProvider.entry(facts).needsCount, 1)
    }

    func testWidgetFactsFallBackToTheAppsCaches() throws {
        BotSpacesSupport.store(.available, serverURL: server)
        defer { BotSpacesSupport.store(.unknown, serverURL: server) }
        BotSpacesCache.saveSpaces(try spaces(), serverURL: server)
        BotSpacesCache.saveView(try view(), botId: "bot_a", serverURL: server)
        defer { BotSpacesCache.clear(botIds: ["bot_a"], serverURL: server) }
        let facts = try XCTUnwrap(BotWidgetData.cached(serverURL: server, botId: nil))
        XCTAssertEqual(facts.botId, "bot_a")
        XCTAssertEqual(facts.view?.main?.threadId, "thr_main")
        XCTAssertEqual(BotWidgetData.cached(serverURL: server, botId: "bot_b")?.botId, "bot_b")
    }

    // MARK: Relay

    func testRegistersALiveActivityTokenWithTheRelay() async throws {
        let client = BBClient(baseURL: server)
        let seen = Recorder()
        client.transport = { _, path, body in
            seen.record(path, body.flatMap { try? JSONDecoder().decode(JSONValue.self, from: $0) } ?? .null)
            return (200, Data(#"{"ok":true,"result":{"ok":true}}"#.utf8))
        }
        try await client.registerLiveActivity(deviceId: "DEVICE-1234", botId: "bot_a", kind: .push_to_start, token: "ab12")
        let (path, input) = try XCTUnwrap(seen.calls.first)
        XCTAssertEqual(path, "/api/v1/plugins/mobile/rpc/live_activity_register")
        XCTAssertEqual(input["kind"]?.stringValue, "push-to-start")
        XCTAssertEqual(input["botId"]?.stringValue, "bot_a")
        XCTAssertEqual(input["deviceId"]?.stringValue, "DEVICE-1234")
        XCTAssertEqual(input["token"]?.stringValue, "ab12")
    }

    // MARK: Voice

    @MainActor
    func testTalkToBotUsesTheShownBotsMain() throws {
        let store = BotSpacesStore(serverURL: server)
        store.seedForDemo(try spaces(), views: ["bot_a": try view()])
        XCTAssertEqual(AppModel.talkThreadId(store: store, botId: nil), "thr_main")
        store.shownBotId = "bot_b"
        XCTAssertEqual(AppModel.talkThreadId(store: store, botId: nil), "thr_b_main")
        XCTAssertEqual(AppModel.talkThreadId(store: store, botId: "bot_a"), "thr_main")
        XCTAssertNil(AppModel.talkThreadId(store: BotSpacesStore(serverURL: URL(string: "https://none.invalid")!), botId: nil))
    }
}

final class BargeInGateKeptTests: XCTestCase {
    /// B20: a gate tuned on the controller survives the next session's start.
    func testANewSessionKeepsTheTunedGate() {
        var machine = LiveSessionMachine(endsLinesOnPause: true)
        machine.gate = BargeInGate.before
        machine.confirmWindow = 0.8
        _ = machine.start(now: 1)
        XCTAssertEqual(machine.gate, BargeInGate.before)
        XCTAssertEqual(machine.confirmWindow, 0.8)
        _ = machine.stop(now: 2)
        _ = machine.start(now: 3)
        XCTAssertEqual(machine.gate, BargeInGate.before)
    }
}

private final class Recorder: @unchecked Sendable {
    private let lock = NSLock()
    private var stored: [(String, JSONValue)] = []
    var calls: [(String, JSONValue)] { lock.withLock { stored } }
    func record(_ path: String, _ input: JSONValue) { lock.withLock { stored.append((path, input)) } }
}

final class ServerAddressTests: XCTestCase {
    func testBareTailscaleNameGetsHTTPS() {
        XCTAssertEqual(ServerAddress.parse("  Studio.Tailnet.ts.net/ ")?.absoluteString, "https://studio.tailnet.ts.net")
    }

    func testFullURLsKeepSchemeAndPath() {
        XCTAssertEqual(ServerAddress.parse("HTTP://Studio.invalid")?.absoluteString, "http://studio.invalid")
        XCTAssertEqual(ServerAddress.parse("https://host.ts.net/bb/?x=1#y")?.absoluteString, "https://host.ts.net/bb")
    }

    func testRejectsWhatIsNotAnAddress() {
        XCTAssertNil(ServerAddress.parse(""))
        XCTAssertNil(ServerAddress.parse("ftp://host"))
        XCTAssertNil(ServerAddress.parse("two words"))
    }
}
