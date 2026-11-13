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

    func testIdleBotHasNoActivity() throws {
        let bot = try XCTUnwrap(spaces().bots.first)
        XCTAssertNil(BotActivityAttributes.ContentState.make(bot: bot, view: try view()))
    }

    func testRunningTurnThinksWithMainsLatestLine() throws {
        let bot = try XCTUnwrap(spaces(turn: true).bots.first)
        let state = try XCTUnwrap(BotActivityAttributes.ContentState.make(bot: bot, view: try view(mainRunning: true)))
        XCTAssertEqual(state.presence, .thinking)
        XCTAssertEqual(state.workers, 0)
        XCTAssertEqual(state.conversationId, "thr_main")
        XCTAssertEqual(state.conversationTitle, "Main")
        XCTAssertEqual(state.line, "Fable moved the bridge onto the contract.")
        XCTAssertNil(state.needsYou)
    }

    func testWorkersRunningShowsTheCount() throws {
        let bot = try XCTUnwrap(spaces(workers: 2).bots.first)
        let state = try XCTUnwrap(BotActivityAttributes.ContentState.make(
            bot: bot, view: try view(workers: [("Port", "running"), ("Tests", "running"), ("Old", "done")])))
        XCTAssertEqual(state.presence, .working)
        XCTAssertEqual(state.workers, 2)
    }

    func testNeedsYouSpeaksForThatConversationInAmber() throws {
        let bot = try XCTUnwrap(spaces().bots.first)
        let state = try XCTUnwrap(BotActivityAttributes.ContentState.make(bot: bot, view: try view(interviewNeeds: true)))
        XCTAssertEqual(state.presence, .needs)
        XCTAssertEqual(state.conversationId, "thr_iv")
        XCTAssertEqual(state.conversationTitle, "Launch prep")
        XCTAssertEqual(state.line, "Which day works?")
        XCTAssertEqual(state.needsYou, "Asked you a question")
    }

    func testWorkerApprovalBecomesTheNeedsLine() throws {
        let bot = try XCTUnwrap(spaces().bots.first)
        let approval = BotActivityAttributes.Approval(workerThreadId: "w0", interactionId: "int_1", summary: "Push: git push origin main")
        let state = try XCTUnwrap(BotActivityAttributes.ContentState.make(
            bot: bot, view: try view(workers: [("Push", "needs-you")]), approval: approval))
        XCTAssertEqual(state.presence, .needs)
        XCTAssertEqual(state.needsYou, "Approve: Push: git push origin main")
        XCTAssertEqual(state.approval, approval)
    }

    func testWithoutAViewTheBotsOwnActivityCounts() throws {
        let bot = try XCTUnwrap(spaces(workers: 3).bots.first)
        let state = try XCTUnwrap(BotActivityAttributes.ContentState.make(bot: bot, view: nil))
        XCTAssertEqual(state.presence, .working)
        XCTAssertEqual(state.workers, 3)
        XCTAssertEqual(state.conversationId, "thr_main")
        XCTAssertNil(state.line)
    }

    func testOnlyShownChangesCountAsDifferent() throws {
        let bot = try XCTUnwrap(spaces(turn: true).bots.first)
        let a = try XCTUnwrap(BotActivityAttributes.ContentState.make(bot: bot, view: try view(mainRunning: true), now: Date(timeIntervalSince1970: 1)))
        var b = try XCTUnwrap(BotActivityAttributes.ContentState.make(bot: bot, view: try view(mainRunning: true), now: Date(timeIntervalSince1970: 2)))
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
