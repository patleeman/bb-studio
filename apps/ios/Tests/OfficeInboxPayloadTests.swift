import XCTest
@testable import BBStudio

final class OfficeInboxPayloadTests: XCTestCase {
    private struct Fixture: Decodable {
        var method: String
        var input: JSONValue
        var output: JSONValue
    }
    private func client(_ name: String) throws -> BBClient {
        let url = try XCTUnwrap(Bundle(for: Self.self).url(forResource: "office-payloads", withExtension: "json"))
        let fixture = try XCTUnwrap(JSONDecoder().decode([Fixture].self, from: Data(contentsOf: url)).first { $0.method == name })
        let client = BBClient(baseURL: URL(string: "https://office.invalid")!)
        client.transport = { method, path, body in
            XCTAssertEqual(method, "POST")
            XCTAssertEqual(path, "/api/v1/plugins/studio/rpc/\(fixture.method)")
            XCTAssertEqual(try JSONDecoder().decode(JSONValue.self, from: XCTUnwrap(body)), fixture.input)
            return (200, try JSONEncoder().encode(JSONValue.object(["ok": true, "result": fixture.output])))
        }
        return client
    }
    func testTeamTalkDeskAndDelegationMatchSchemaFixtures() async throws {
        let bots = try await client("team_list").officeTeam("sp_one")
        XCTAssertEqual(bots.first?.state, .needsYou)
        XCTAssertEqual(bots.first?.activeTaskCount, 2)
        XCTAssertEqual(bots.first?.spaceId, "sp_one")
        let conversations = try await client("talk_list").officeTalk("sp_one")
        XCTAssertEqual(conversations.first?.memberBotIds, ["bot_one"])
        XCTAssertEqual(conversations.first?.isDirect, true)
        let dm = try await client("talk_dm").officeDirectMessage(botId: "bot_one")
        XCTAssertEqual(dm.conversationId, "dm_one")
        XCTAssertEqual(dm.threadId, "thr_one")
        let desk = try await client("bot_desk").officeBotDesk("bot_one")
        XCTAssertEqual(desk.bot.trust, .ask)
        XCTAssertEqual(desk.directConversationId, dm.conversationId)
        XCTAssertEqual(desk.directThreadId, dm.threadId)
        XCTAssertEqual(desk.memory?.memory, "Keep it short")
        let delegation = try await client("delegate").officeDelegate(botId: "bot_one", brief: "Review", schedule: .daily, context: ["pages:pg_one"], folderId: "proj_one")
        XCTAssertEqual(delegation.taskId, "tsk_one")
        XCTAssertEqual(delegation.task.id, delegation.taskId)
        XCTAssertEqual(delegation.task.status, .working)
        XCTAssertEqual(delegation.task.recurring, "daily")
    }

    func testOneTimeDelegationOmitsOptionalFields() async throws {
        let client = BBClient(baseURL: URL(string: "https://office.invalid")!)
        client.transport = { _, path, body in
            XCTAssertEqual(path, "/api/v1/plugins/studio/rpc/delegate")
            XCTAssertEqual(try JSONDecoder().decode(JSONValue.self, from: XCTUnwrap(body)), ["botId": "bot_one", "brief": "Review"])
            return (200, Data(#"{"ok":true,"result":{"taskId":"tsk_one","task":{"id":"tsk_one","botId":null,"title":"Review","status":"waiting","note":null,"recurring":null,"href":"/tasks/tsk_one","updatedAt":0}}}"#.utf8))
        }
        let result = try await client.officeDelegate(botId: "bot_one", brief: "Review")
        XCTAssertNil(result.task.recurring)
        XCTAssertNil(result.task.botId)
    }

    func testHomeAllowsUnassignedWorkingTask() async throws {
        let home = try await client("home").officeHome("sp_one")
        XCTAssertNil(home.working.first?.botId)
        XCTAssertEqual(home.working.first?.status, .review)
    }
    func testInboxPageCountsAndMutationsMatchSchemaFixtures() async throws {
        let page = try await client("inbox_list").officeInbox()
        XCTAssertEqual(page.nextCursor, "next")
        XCTAssertEqual(page.events.last?.urgent, true)
        let event = try XCTUnwrap(page.events.first)
        XCTAssertEqual(event.id, "interaction:office")
        XCTAssertFalse(event.isPending)
        XCTAssertNil(event.doneAt)
        XCTAssertEqual(event.actions?.first?.id, "approve")
        let encoded = try JSONDecoder().decode(JSONValue.self, from: JSONEncoder().encode(event))
        XCTAssertNil(encoded["isPending"])
        let counts = try await client("inbox_counts").officeInboxCounts()
        XCTAssertEqual(counts.count().requests, 1)
        XCTAssertEqual(counts.count().unreadReports, 2)
        try await client("inbox_act").officeInboxAct(key: event.key, actionId: "answer", text: "Proceed")
        try await client("inbox_done").officeInboxDone(keys: [event.key])
        try await client("inbox_read").officeInboxRead(keys: [event.key])
    }
}
