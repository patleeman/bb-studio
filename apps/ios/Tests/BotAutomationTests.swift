import XCTest
@testable import BBStudio

final class BotAutomationTests: XCTestCase {
    private func client(_ answers: [String: String], sent: @escaping @Sendable (String, String) -> Void) -> BBClient {
        let client = BBClient(baseURL: URL(string: "https://automations.invalid")!)
        client.transport = { _, path, body in
            let method = String(path.split(separator: "/").last ?? "")
            sent(method, String(decoding: body ?? Data(), as: UTF8.self))
            return (200, Data(#"{"ok":true,"result":\#(answers[method] ?? "{}")}"#.utf8))
        }
        return client
    }

    private let watcher = #"{"id":"aut_w","kind":"watcher","name":"Release watch","original":false,"instruction":"","schedule":{"type":"interval","every":15,"unit":"minutes","days":[0,1,2,3,4,5,6],"quiet":{"from":"22:00","to":"07:00"}},"scheduleText":"Every 15 min","state":"active","nextRunAt":5,"lastRunAt":null,"lastOutcome":"Woke it: v2","model":null,"script":{"body":"echo hi","interpreter":"bash","timeoutMs":60000,"workingDirectory":null,"envKeys":[]},"target":"main","targetName":"Dot","threadId":"t1"}"#

    func testListsAndCreatesWithTheScheduleStudioTakes() async throws {
        let bodies = Bodies()
        let client = client(["bot_automations": #"{"automations":[\#(watcher)]}"#, "bot_automation_create": watcher]) { bodies.add($0, $1) }
        let list = try await client.botAutomations(botId: "bot_two")
        XCTAssertEqual(list.first?.kind, .watcher)
        XCTAssertEqual(list.first?.schedule.quiet?.from, "22:00")
        var draft = BotAutomationDraft()
        draft.name = "Brief"
        draft.instruction = "Summarize my day."
        draft.schedule = .times(["08:00", "18:30"])
        draft.schedule.quiet = .init(from: "22:00", to: "07:00")
        draft.model = "gpt-mini"
        try await client.createBotAutomation(.checkin, draft, botId: "bot_two")
        let sent = try XCTUnwrap(bodies.last("bot_automation_create"))
        let json = try XCTUnwrap(try JSONSerialization.jsonObject(with: Data(sent.utf8)) as? [String: Any])
        XCTAssertEqual(json["kind"] as? String, "checkin")
        XCTAssertEqual(json["botId"] as? String, "bot_two")
        let schedule = try XCTUnwrap(json["schedule"] as? [String: Any])
        XCTAssertEqual(schedule["times"] as? [String], ["08:00", "18:30"])
        XCTAssertEqual(schedule["days"] as? [Int], [1, 2, 3, 4, 5])
        XCTAssertNil(schedule["every"])
        XCTAssertEqual((json["model"] as? [String: Any])?["model"] as? String, "gpt-mini")
        XCTAssertNil(json["script"])
    }

    func testTheOriginalCheckInSendsOnlyItsSchedule() {
        var draft = BotAutomationDraft()
        draft.name = "x"
        let fields = draft.fields(kind: .checkin, original: true)
        XCTAssertEqual(Set(fields.keys), ["schedule"])
        XCTAssertEqual(BotSchedule.once(Date(timeIntervalSince1970: 2)).json, .object(["type": "once", "at": 2000]))
    }
}

private final class Bodies: @unchecked Sendable {
    private var items: [(String, String)] = []
    private let lock = NSLock()
    func add(_ method: String, _ body: String) { lock.lock(); items.append((method, body)); lock.unlock() }
    func last(_ method: String) -> String? { lock.lock(); defer { lock.unlock() }; return items.last { $0.0 == method }?.1 }
}
