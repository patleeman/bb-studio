import XCTest
@testable import BBStudio

/// These request/response examples mirror the web office UI while backend
/// stages 5–6 land. Move them to schema fixtures once those contracts exist.
final class OfficeProvisionalAPITests: XCTestCase {
    private func client(method expected: String, input: JSONValue, result: String) -> BBClient {
        let client = BBClient(baseURL: URL(string: "https://office.invalid")!)
        client.transport = { method, path, body in
            XCTAssertEqual(method, "POST")
            XCTAssertEqual(path, "/api/v1/plugins/studio/rpc/\(expected)")
            XCTAssertEqual(try JSONDecoder().decode(JSONValue.self, from: XCTUnwrap(body)), input)
            return (200, Data("{\"ok\":true,\"result\":\(result)}".utf8))
        }
        return client
    }
    func testTeamUsesOfficeShapes() async throws {
        let team = try await client(method: "team_list", input: ["spaceId": "sp_one"], result: #"{"bots":[{"id":"bot_one","name":"Writer","state":"needs_you","activeTaskCount":2}]}"#).officeTeam("sp_one")
        XCTAssertEqual(team.first?.state, .needsYou)
        XCTAssertEqual(team.first?.activeTaskCount, 2)
        let talk = try await client(method: "talk_list", input: ["spaceId": "sp_one"], result: #"{"conversations":[{"id":"dm_one","title":"Writing","memberBotIds":["bot_one"],"isDirect":true,"needsYou":false,"unread":true,"href":"/talk/dm_one"}]}"#).officeTalk("sp_one")
        XCTAssertEqual(talk.first?.memberBotIds, ["bot_one"])
        XCTAssertEqual(talk.first?.isDirect, true)
    }
    func testDirectMessageUsesBotIdentityAndAcceptsUnspecifiedResult() async throws {
        try await client(method: "talk_dm", input: ["botId": "bot_one"], result: "{}").officeDirectMessage(botId: "bot_one")
    }
    func testStartAndDelegateReturnNavigationTargets() async throws {
        let start = try await client(method: "office_start", input: ["spaceId": "sp_one", "request": "Write a plan"], result: #"{"threadId":"thr_one"}"#).officeStart(spaceId: "sp_one", request: "Write a plan")
        XCTAssertEqual(start.threadId, "thr_one")
        let input: JSONValue = ["botId": "bot_one", "brief": "Review", "context": ["pages:pg_one"], "folderId": "proj_one", "schedule": "daily"]
        let task = try await client(method: "delegate", input: input, result: #"{"taskId":"tsk_one"}"#).officeDelegate(botId: "bot_one", brief: "Review", context: ["pages:pg_one"], folderId: "proj_one", schedule: "daily")
        XCTAssertEqual(task.taskId, "tsk_one")
    }
    func testBotDeskDecodesProfileAndMemory() async throws {
        let result = #"{"bot":{"id":"bot_one","name":"Writer","state":"working","activeTaskCount":1,"trust":"ask","spaceId":"sp_one","model":"example"},"tasks":[],"directConversationId":"dm_one","directThreadId":"thr_one","profileHref":"/bots/bot_one","memory":{"mission":"Write","memory":"Keep it short"}}"#
        let desk = try await client(method: "bot_desk", input: ["botId": "bot_one"], result: result).officeBotDesk("bot_one")
        XCTAssertEqual(desk.bot.trust, .ask)
        XCTAssertEqual(desk.directConversationId, "dm_one")
        XCTAssertEqual(desk.memory?.memory, "Keep it short")
    }
}
