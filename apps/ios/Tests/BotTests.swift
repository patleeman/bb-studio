import XCTest
@testable import BBStudio

final class BotTests: XCTestCase {
    private let a = URL(string: "https://bot-a.invalid")!
    private let b = URL(string: "https://bot-b.invalid")!

    /// A client whose transport answers each RPC method from `answers`; anything else is unknown.
    private func client(_ url: URL, _ answers: [String: (Int, String)], sent: (@Sendable (String, String) -> Void)? = nil) -> BBClient {
        let client = BBClient(baseURL: url)
        client.transport = { _, path, body in
            let method = String(path.split(separator: "/").last ?? "")
            sent?(method, String(decoding: body ?? Data(), as: UTF8.self))
            let (status, text) = answers[method] ?? (404, #"{"ok":false,"error":{"code":"unknown_method","message":"no"}}"#)
            return (status, Data(text.utf8))
        }
        return client
    }

    private func bot(_ id: String?, name: String = "Dot", state: String = "active", run: String = "null") -> (Int, String) {
        let thread = id.map { "\"\($0)\"" } ?? "null"
        return (200, #"{"ok":true,"result":{"bot":{"id":"bot_main","name":"\#(name)","avatar":"🟣","state":"\#(state)","threadId":\#(thread),"createdAt":1,"updatedAt":1},"run":\#(run)}}"#)
    }

    func testSkillLearningDecodesAndSaysTheLastReview() async throws {
        let learning = #"{"ok":true,"result":{"enabled":true,"interval":10,"reviewModel":null,"defaultModel":"haiku","models":[],"consolidate":false,"toolTurns":3,"userTurns":1,"reviewing":false,"lastReview":{"at":1000,"result":"Saved 1 skill"},"lastCurator":null}}"#
        let skills = #"{"ok":true,"result":{"skills":[{"name":"deploy","description":"d","updatedAt":1,"state":"stale","pinned":true,"usedAt":1},{"name":"old","description":"d","updatedAt":1}]}}"#
        let c = client(a, ["bot_learning": (200, learning), "bot_skills": (200, skills)])
        let result = try await c.botLearning()
        XCTAssertTrue(result.status(now: Date(timeIntervalSince1970: 3601))?.hasPrefix("Saved 1 skill · ") ?? false)
        let list = try await c.botSkills()
        XCTAssertEqual(list.map(\.state), ["stale", nil])
        XCTAssertEqual(list.first?.pinned, true)
        XCTAssertFalse(list[1].isArchived)
    }

    func testBotIsRememberedPerServerWithNameAndAvatar() async throws {
        let first = try await client(a, ["bot_get": bot("thr_a")]).bot()
        let second = try await client(b, ["bot_get": bot("thr_b", name: "Penny")]).bot()
        XCTAssertEqual(first?.lead.threadId, "thr_a")
        XCTAssertEqual(first?.title, "🟣 Dot")
        XCTAssertEqual(second?.name, "Penny")
        XCTAssertEqual(BBClient(baseURL: a).cachedBotThreadId, "thr_a")
        XCTAssertEqual(BBClient(baseURL: a).cachedBotName, "Dot")
        XCTAssertEqual(BBClient(baseURL: b).cachedBotThreadId, "thr_b")

        let none = try await client(a, ["bot_get": (200, #"{"ok":true,"result":{"bot":null,"run":null}}"#)]).bot()
        XCTAssertNil(none)
        XCTAssertNil(BBClient(baseURL: a).cachedBotThreadId)
        XCTAssertEqual(BBClient(baseURL: a).cachedBotName, "Bot")
        XCTAssertEqual(BBClient(baseURL: b).cachedBotThreadId, "thr_b")
    }

    func testUnknownBotRPCDoesNotCallChiefOfStaffOrClearCachedBot() async throws {
        let server = URL(string: "https://bot-unknown.invalid")!
        _ = try await client(server, ["bot_get": bot("thr_cached")]).bot()
        let calls = Calls()
        let old = client(server, ["bot_get": (404, #"{"ok":false,"error":{"code":"unknown_method","message":"no"}}"#),
                                  "chief_of_staff": (200, #"{"ok":true,"result":{"threadId":"thr_old","run":null}}"#)], sent: { method, body in calls.add(method, body) })
        let info = try await old.bot()
        XCTAssertNil(info)
        XCTAssertEqual(BBClient(baseURL: server).cachedBotThreadId, "thr_cached")
        XCTAssertEqual(calls.all.map(\.0), ["bot_get"])
    }

    // MARK: What the widgets and watch count

    private func waiting(_ id: String, running: Bool = false) throws -> ThreadEntry {
        try JSONDecoder().decode(ThreadEntry.self, from: Data(#"{"id":"\#(id)","projectId":"p","title":"\#(id)","status":"\#(running ? "active" : "idle")","createdAt":1,"updatedAt":1,"hasPendingInteraction":\#(!running)}"#.utf8))
    }

    func testWidgetsCountTheBotsAttention() async throws {
        let summary = ThreadSummary([try waiting("ask1"), try waiting("ask2"), try waiting("run", running: true)])
        let asked = client(URL(string: "https://bot-attention.invalid")!, ["bot_attention": (200, #"{"ok":true,"result":{"attention":{"reason":"Asked you a question","count":1,"since":1}}}"#)])
        let needs = await asked.needsYouCount(fallback: summary)
        XCTAssertEqual(needs, NeedsYouCount(count: 1, reason: "Asked you a question", fromBot: true))
        // The Bot needing nothing is zero, not the BB-wide count.
        let clear = client(URL(string: "https://bot-clear.invalid")!, ["bot_attention": (200, #"{"ok":true,"result":{"attention":null}}"#)])
        let none = await clear.needsYouCount(fallback: summary)
        XCTAssertEqual(none, NeedsYouCount(count: 0, reason: nil, fromBot: true))

        let status = StatusSnapshot(summary, needs: needs, serverURL: a)
        XCTAssertEqual(status.needsYou, 1)
        XCTAssertEqual(status.running, 1)
        XCTAssertEqual(status.reason, "Asked you a question")
        XCTAssertEqual(status.headline, "Asked you a question")
        XCTAssertNil(status.headlineThreadId)
        XCTAssertEqual(status.label, "Asked you a question · 1 running")
        XCTAssertFalse(status.sameCounts(StatusSnapshot(summary, needs: .bot(count: 1, reason: "Waiting for approval"), serverURL: a)))
        XCTAssertEqual(StatusSnapshot(dictionary: status.dictionary)?.reason, "Asked you a question")
        let quiet = StatusSnapshot(summary, needs: none, serverURL: a)
        XCTAssertEqual(quiet.label, "1 running")
        XCTAssertEqual(quiet.headline, "run")
    }

    func testWidgetsFallBackToWaitingThreadsOnAnOlderStudio() async throws {
        let summary = ThreadSummary([try waiting("ask1"), try waiting("ask2")])
        // No bot_attention (unknown method), or the call fails: BB's threads waiting on you.
        for answers in [[:], ["bot_attention": (500, #"{"ok":false,"error":{"code":"internal","message":"boom"}}"#)]] as [[String: (Int, String)]] {
            let needs = await client(URL(string: "https://bot-older.invalid")!, answers).needsYouCount(fallback: summary)
            XCTAssertEqual(needs, NeedsYouCount(count: 2, reason: nil, fromBot: false))
            let status = StatusSnapshot(summary, needs: needs, serverURL: a)
            XCTAssertEqual(status.label, "2 need you")
            XCTAssertEqual(status.headlineThreadId, "ask1")
        }
        // No answer at all counts the same way, and an older phone's snapshot (no reason) still decodes.
        XCTAssertEqual(StatusSnapshot(summary, serverURL: a).needsYou, 2)
        let old = StatusSnapshot(dictionary: ["serverURL": a.absoluteString, "needsYou": 1, "running": 0, "updatedAt": 1.0])
        XCTAssertNil(old?.reason)
        XCTAssertEqual(old?.label, "1 needs you")
        XCTAssertEqual(NeedsYouCount.bot(count: 2, reason: "  "), NeedsYouCount(count: 2, reason: nil, fromBot: true))
    }

    func testNoStudioMeansNoBot() async throws {
        let none = try await client(URL(string: "https://bot-absent.invalid")!, [:]).bot()
        XCTAssertNil(none)
        let server = URL(string: "https://bot-offline.invalid")!
        _ = try await client(server, ["bot_get": bot("thr_cached")]).bot()
        let stopped = client(server, ["bot_get": (503, #"{"ok":false,"error":{"message":"not running"}}"#)])
        do {
            _ = try await stopped.botThreadId()
            XCTFail("A stopped Studio must remain an error")
        } catch {
            XCTAssertEqual((error as? BBError)?.status, 503)
        }
        XCTAssertEqual(BBClient(baseURL: server).cachedBotThreadId, "thr_cached")
    }

    func testStateAndHeartbeatUseBotRPCs() async throws {
        let calls = Calls()
        let client = client(a, [
            "bot_get": bot("thr_a", state: "paused", run: #"{"enabled":false,"cadence":"daily","time":"08:00"}"#),
            "bot_pause": bot("thr_a", state: "paused"), "bot_stop": bot("thr_a", state: "stopped"),
            "bot_set_thread": bot("thr_x"),
            "bot_set_run": bot("thr_a", run: #"{"enabled":true,"cadence":"daily","time":"08:00"}"#),
        ], sent: { method, body in calls.add(method, body) })
        let paused = try await client.setBotState(.pause)
        XCTAssertEqual(paused?.state, .paused)
        _ = try await client.setBotState(.stop)
        _ = try await client.makeBot("thr_x")
        let lead = try await client.setBotHeartbeat(enabled: true, cadence: "daily", time: "08:00", cron: nil)
        XCTAssertEqual(lead.heartbeat, "daily")
        let methods = calls.all.map(\.0)
        XCTAssertEqual(methods.filter { $0 != "bot_get" }, ["bot_pause", "bot_stop", "bot_set_thread", "bot_set_run"])
        XCTAssertTrue(calls.all.first { $0.0 == "bot_set_thread" }!.1.contains(#""threadId":"thr_x""#))
        XCTAssertFalse(calls.all.first { $0.0 == "bot_set_run" }!.1.contains("cron"))
    }

    func testCheckinPresetsMapToStudio() async throws {
        let calls = Calls()
        let client = client(a, [
            "bot_checkin_preset": bot("thr_a", run: #"{"enabled":true,"cadence":"custom","time":"09:00","cron":"0 9-17/2 * * 1-5"}"#),
            "bot_chain": (200, #"{"ok":true,"result":{"threadIds":["thr_0","thr_a"]}}"#),
        ], sent: { method, body in calls.add(method, body) })
        let info = try await client.setBotCheckinPreset(.working)
        XCTAssertEqual(BotCheckinPreset.of(info?.lead), .working)
        XCTAssertEqual(calls.all.first?.0, "bot_checkin_preset")
        XCTAssertEqual(calls.all.first?.1, #"{"preset":"working"}"#)
        XCTAssertEqual(BotCheckinPreset.allCases.map(\.rawValue), ["morning", "evening", "working", "off"])
        XCTAssertEqual(BotCheckinPreset.of(ThreadLead(threadId: "t", heartbeat: "weekdays", time: "08:00")), .morning)
        XCTAssertEqual(BotCheckinPreset.of(ThreadLead(threadId: "t", heartbeat: "weekdays", time: "18:00")), .evening)
        XCTAssertEqual(BotCheckinPreset.of(ThreadLead(threadId: "t")), .off)
        XCTAssertNil(BotCheckinPreset.of(ThreadLead(threadId: "t", heartbeat: "hourly")))
        let chain = try await client.botChain()
        XCTAssertEqual(chain, ["thr_0", "thr_a"])
        // A Studio without bot_chain: the Bot's thread alone.
        let older = self.client(b, ["bot_get": bot("thr_b")])
        let alone = try await older.botChain()
        XCTAssertEqual(alone, ["thr_b"])
    }

    func testActivityDecodes() async throws {
        let client = client(a, ["bot_activity": (200, #"{"ok":true,"result":{"attention":{"reason":"Asked you a question","count":1,"since":5},"inProgress":[{"id":"t1","title":"Approve","status":"active","projectId":"p","updatedAt":1,"relation":"started","waitingFor":"Waiting for approval"}],"scheduled":[{"id":"a1","kind":"heartbeat","name":"Check-in (heartbeat)","cron":"0 9 * * *","enabled":true,"nextRunAt":null}],"completed":[],"latest":null}}"#)])
        let activity = try await client.botActivity()
        XCTAssertEqual(activity.attention, BotActivity.Attention(reason: "Asked you a question", count: 1, since: 5))
        XCTAssertEqual(activity.inProgress.map(\.waitingFor), ["Waiting for approval"])
        XCTAssertEqual(activity.scheduled.first?.kind, "heartbeat")
    }

    func testBotListPutsPrimaryFirstThenByName() async throws {
        func item(_ id: String, _ name: String, primary: Bool, kind: String = "studio") -> String {
            #"{"id":"\#(id)","name":"\#(name)","avatar":"🤖","state":"active","threadId":"thr_\#(id)","primary":\#(primary),"kind":"\#(kind)","createdAt":1,"updatedAt":1}"#
        }
        let list = client(a, ["bot_list": (200, #"{"ok":true,"result":{"bots":["# + [item("z", "zed", primary: false), item("m", "Main", primary: true),
                                                                                 item("a", "Atlas", primary: false, kind: "external")].joined(separator: ",") + "]}}")])
        let bots = try await list.bots()
        XCTAssertEqual(bots.map(\.name), ["Main", "Atlas", "zed"])
        XCTAssertEqual(bots.map(\.primary), [true, false, false])
        XCTAssertEqual(bots.map(\.external), [false, true, false])
        // Only the primary is remembered for widgets, Siri and the watch.
        XCTAssertEqual(BBClient(baseURL: a).cachedBotThreadId, "thr_m")

        // A Studio without bot_list: its one Bot.
        let older = try await client(b, ["bot_get": bot("thr_b")]).bots()
        XCTAssertEqual(older.map(\.lead.threadId), ["thr_b"])
        XCTAssertEqual(older.first?.primary, true)
    }

    func testBotListPropagatesStudioUnavailableInsteadOfFallingBack() async throws {
        let calls = Calls()
        let server = URL(string: "https://bot-list-offline.invalid")!
        _ = try await client(server, ["bot_get": bot("thr_cached")]).bot()
        let stopped = client(server, [
            "bot_list": (503, #"{"ok":false,"error":{"message":"not running"}}"#),
            "bot_get": bot("thr_other"),
        ], sent: { method, body in calls.add(method, body) })
        do {
            _ = try await stopped.bots()
            XCTFail("A stopped Studio must remain an error")
        } catch {
            XCTAssertEqual((error as? BBError)?.status, 503)
        }
        XCTAssertEqual(calls.all.map(\.0), ["bot_list"])
        XCTAssertEqual(BBClient(baseURL: server).cachedBotThreadId, "thr_cached")
    }

    func testBotIdScopesEveryCall() async throws {
        let calls = Calls()
        let other = (200, #"{"ok":true,"result":{"bot":{"id":"bot_2","name":"Scout","avatar":"🔭","state":"active","threadId":"thr_2","primary":false},"run":null}}"#)
        let client = client(a, [
            "bot_get": other, "bot_pause": other, "bot_set": other, "bot_checkin_preset": other, "bot_set_run": other,
            "bot_activity": (200, #"{"ok":true,"result":{"attention":null,"inProgress":[],"scheduled":[],"completed":[]}}"#),
            "bot_attention": (200, #"{"ok":true,"result":{"attention":{"reason":"2 things for you","count":2,"since":1}}}"#),
            "bot_chain": (200, #"{"ok":true,"result":{"threadIds":["thr_2"]}}"#),
            "bot_memory": (200, #"{"ok":true,"result":{"pageId":"pg_1"}}"#),
            "bot_skills": (200, #"{"ok":true,"result":{"skills":[]}}"#),
            "bot_runners": (200, #"{"ok":true,"result":{"runners":[{"id":"r1","name":"Sweep","state":"paused","schedule":{"cadence":"weekdays","time":"09:00"},"lastReport":"ok"}]}}"#),
            "bot_runner_resume": (200, #"{"ok":true,"result":{"id":"r1"}}"#),
            "bot_runner_run_now": (200, #"{"ok":true,"result":{"id":"r1"}}"#),
        ], sent: { method, body in calls.add(method, body) })
        let before = BBClient(baseURL: a).cachedBotThreadId
        _ = try await client.bot("bot_2")
        _ = try await client.setBotState(.pause, botId: "bot_2")
        _ = try await client.setBotProfile(name: "Scout", shape: nil, color: nil, role: "", botId: "bot_2")
        _ = try await client.setBotCheckinPreset(.morning, botId: "bot_2")
        _ = try await client.setBotHeartbeat(enabled: false, cadence: "daily", time: nil, cron: nil, botId: "bot_2")
        _ = try await client.botActivity(botId: "bot_2")
        let attention = try await client.botAttention(botId: "bot_2")
        XCTAssertEqual(attention?.reason, "2 things for you")
        XCTAssertEqual(attention?.count, 2)
        _ = try await client.botChain(botId: "bot_2")
        _ = try await client.botMemoryPageId(botId: "bot_2")
        _ = try await client.botSkills(botId: "bot_2")
        let runners = try await client.botRunners(botId: "bot_2")
        try await client.setRunnerPaused("r1", paused: false, botId: "bot_2")
        try await client.runRunnerNow("r1", botId: "bot_2")
        XCTAssertEqual(runners.first?.paused, true)
        XCTAssertEqual(runners.first?.scheduleLabel, "Weekdays at 09:00")
        XCTAssertEqual(calls.all.count, 14)
        for (method, body) in calls.all {
            XCTAssertTrue(body.contains(#""botId":"bot_2""#), "\(method) without botId: \(body)")
        }
        // Another bot never replaces the primary's cache.
        XCTAssertEqual(BBClient(baseURL: a).cachedBotThreadId, before)

        // The primary is called without a botId.
        let primaryCalls = Calls()
        _ = try await self.client(b, ["bot_get": bot("thr_b")], sent: { primaryCalls.add($0, $1) }).bot()
        XCTAssertEqual(primaryCalls.all.first?.1, "{}")
    }

    func testFirstTimeSetupSendsTheGoalAsSetup() async throws {
        let calls = Calls()
        let client = client(a, ["bot_create": bot("thr_new", name: "Chief of Staff")], sent: { calls.add($0, $1) })
        let goal = BotSetup.goal("  Watch my PRs \n")
        XCTAssertEqual(goal, "Watch my PRs")
        let made = try await client.createBot(name: BotSetup.name(first: true), shape: BotSetup.shape(first: true), color: BotSetup.color(first: true), setup: goal)
        XCTAssertEqual(made?.lead.threadId, "thr_new")
        let body = try XCTUnwrap(calls.all.first?.1)
        XCTAssertTrue(body.contains(#""setup":"Watch my PRs""#), body)
        XCTAssertTrue(body.contains(#""name":"Chief of Staff""#), body)
        XCTAssertTrue(body.contains(#""shape":"blob""#), body)
        XCTAssertTrue(body.contains(##""color":"#5b8def""##), body)
        XCTAssertFalse(body.contains("prompt"), body)
        // Another bot: desktop's New bot defaults.
        XCTAssertEqual(BotSetup.name(first: false), "New bot")
        XCTAssertEqual(BotSetup.shape(first: false), .hexagon)
        XCTAssertEqual(BotSetup.color(first: false), "#c862c6")
        XCTAssertEqual(BotSetup.ideas.map(\.label), ["Watch my projects", "Morning brief", "Plan my week", "Triage threads"])
    }

    func testListPreviewIsPlainText() {
        XCTAssertEqual(BotSummary.plain("**Hi** there\n\n- see [docs](https://x)\n::next{reply=\"a|b\"}"), "Hi there - see docs")
        let bot = BotInfo(name: "B", avatar: "🤖", state: .active, lead: ThreadLead(threadId: nil))
        XCTAssertEqual(bot.status(running: true), "Working…")
        XCTAssertEqual(bot.key, "primary")
    }

    func testBotLeadFromOptionalBot() {
        XCTAssertEqual(BotLead(nil), .none)
        let info = BotInfo(name: "Bot", avatar: "🤖", state: .active, lead: ThreadLead(threadId: "thr_1"))
        XCTAssertEqual(BotLead(info), .bot(info))
    }

    func testCadenceIdKeepsUnknownValues() {
        XCTAssertEqual(ThreadLead.cadenceId(Studio.BotGetOutputRunCadence.every2hours), "every2hours")
        XCTAssertEqual(ThreadLead.cadenceId(Studio.BotGetOutputRunCadence.unknown("every10minutes")), "every10minutes")
        XCTAssertNil(ThreadLead.cadenceId(Optional<Studio.BotGetOutputRunCadence>.none))
    }

    func testHeartbeatTimeRoundTrips() {
        let date = HeartbeatFields.date("07:05")
        XCTAssertEqual(date.map(HeartbeatFields.text), "07:05")
        XCTAssertNil(HeartbeatFields.date("bad"))
    }

    @MainActor func testMenuLabelUsesTheBotsName() {
        let info = BotInfo(name: "Chief of Staff", avatar: "🧭", state: .active, lead: ThreadLead(threadId: "thr_1"))
        XCTAssertEqual(BotModel.label(info), "🧭 Chief of Staff · your Bot")
        XCTAssertEqual(BotModel.label(nil), "Bot · your Bot")
        XCTAssertFalse(BotModel().isBot("thr_x"))
    }
}

private final class Calls: @unchecked Sendable {
    private let lock = NSLock()
    private var calls: [(String, String)] = []
    func add(_ method: String, _ body: String) { lock.lock(); calls.append((method, body)); lock.unlock() }
    var all: [(String, String)] { lock.lock(); defer { lock.unlock() }; return calls }
}
