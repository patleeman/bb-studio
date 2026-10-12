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

    func testOlderStudioAnswersThroughChiefOfStaff() async throws {
        let old = client(a, ["chief_of_staff": (200, #"{"ok":true,"result":{"threadId":"thr_c","run":{"enabled":true,"cadence":"every15minutes","time":"09:30"}}}"#)])
        let info = try await old.bot()
        XCTAssertEqual(info?.name, "Chief of Staff")
        XCTAssertEqual(info?.lead, ThreadLead(threadId: "thr_c", heartbeat: "every15minutes", time: "09:30"))
        let threadId = try await old.botThreadId()
        XCTAssertEqual(threadId, "thr_c")
    }

    func testNoStudioMeansNoBot() async throws {
        let none = try await client(a, [:]).bot()
        XCTAssertNil(none)
        let stopped = client(b, ["bot_get": (503, #"{"ok":false,"error":{"message":"not running"}}"#)])
        let alsoNone = try await stopped.botThreadId()
        XCTAssertNil(alsoNone)
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

    func testActivityDecodes() async throws {
        let client = client(a, ["bot_activity": (200, #"{"ok":true,"result":{"needsYou":[{"id":"t1","title":"Approve","status":"active","projectId":"p","updatedAt":1,"relation":"started","needsYou":true}],"inProgress":[],"scheduled":[{"id":"a1","kind":"heartbeat","name":"Check-in (heartbeat)","cron":"0 9 * * *","enabled":true,"nextRunAt":null}],"completed":[],"latest":null}}"#)])
        let activity = try await client.botActivity()
        XCTAssertEqual(activity.needsYou.map(\.id), ["t1"])
        XCTAssertEqual(activity.scheduled.first?.kind, "heartbeat")
    }

    func testBotLeadFromOptionalBot() {
        XCTAssertEqual(BotLead(nil), .none)
        let info = BotInfo(name: "Bot", avatar: "🤖", state: .active, lead: ThreadLead(threadId: "thr_1"))
        XCTAssertEqual(BotLead(info), .bot(info))
    }

    func testCadenceIdKeepsUnknownValues() {
        XCTAssertEqual(ThreadLead.cadenceId(Studio.ChiefOfStaffOutputRunCadence.every2hours), "every2hours")
        XCTAssertEqual(ThreadLead.cadenceId(Studio.ChiefOfStaffOutputRunCadence.unknown("every10minutes")), "every10minutes")
        XCTAssertNil(ThreadLead.cadenceId(Optional<Studio.ChiefOfStaffOutputRunCadence>.none))
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
