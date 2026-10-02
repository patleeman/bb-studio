import XCTest
@testable import BBStudio

final class SavedViewTests: XCTestCase {
    func testRosterDecodesViewsWithoutLegacyChannelFields() throws {
        let json = #"{"bots":[],"directThreads":{},"views":[{"id":"11111111-1111-4111-8111-111111111111","name":"Work","members":[{"kind":"thread","id":"thr_work"}],"archived":false,"createdAt":1,"updatedAt":2}]}"#
        let roster = try JSONDecoder().decode(BotTeamsList.self, from: Data(json.utf8))
        XCTAssertEqual(roster.views.first?.members, [SavedViewMember(kind: "thread", id: "thr_work")])
        XCTAssertEqual(Route(href: "/plugins/bot-teams/views/view-id"), .savedView(id: "view-id"))
        XCTAssertEqual(Route(href: "/plugins/bot-teams/channels/view-id"), .formerChannel(id: "view-id"))
    }

    func testSendPreservesRetryIdAndExplicitThreadAddressing() async throws {
        let client = BBClient(baseURL: URL(string: "http://localhost")!)
        let requestId = "11111111-1111-4111-8111-111111111111"
        client.transport = { _, path, body in
            XCTAssertEqual(path, "/api/v1/plugins/bot-teams/rpc/viewSend")
            let value = try JSONDecoder().decode(JSONValue.self, from: body!)
            XCTAssertEqual(value["requestId"]?.stringValue, requestId)
            XCTAssertEqual(value["replyThreadId"]?.stringValue, "thr_work")
            XCTAssertEqual(value["mode"]?.stringValue, "steer")
            XCTAssertEqual(value["targets"]?.arrayValue?.first?["kind"]?.stringValue, "thread")
            return (200, Data(#"{"ok":true,"result":{"requestId":"11111111-1111-4111-8111-111111111111","deliveries":[{"threadId":"thr_work","status":"error","error":"Offline"}]}}"#.utf8))
        }
        let result = try await client.sendToView("view", text: "Correction", targets: [SavedViewMember(kind: "thread", id: "thr_work")], replyThreadId: "thr_work", fresh: false, mode: "steer", requestId: requestId)
        XCTAssertEqual(result.deliveries.first?.error, "Offline")
    }
}
