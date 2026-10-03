import XCTest
@testable import BBStudio

final class OfficePushTests: XCTestCase {
    func testSupportedNotificationActionsMapToInboxActions() throws {
        XCTAssertEqual(OfficeNotificationAction(key: "request", identifier: "BB_APPROVE")?.actionId, "approve")
        XCTAssertEqual(OfficeNotificationAction(key: "request", identifier: "BB_DENY")?.actionId, "deny")
        let answer = try XCTUnwrap(OfficeNotificationAction(key: "request", identifier: "BB_REPLY_TEXT", text: "  Answer \n"))
        XCTAssertEqual(answer.actionId, "answer")
        XCTAssertEqual(answer.text, "Answer")
        XCTAssertNil(OfficeNotificationAction(key: "request", identifier: "BB_REPLY_TEXT", text: " \n"))
        XCTAssertNil(OfficeNotificationAction(key: "request", identifier: "BB_CHOICE_0"))
        XCTAssertNil(OfficeNotificationAction(key: "", identifier: "BB_APPROVE"))
    }

    func testNotificationActionUsesInboxAfterOriginValidation() async throws {
        let client = BBClient()
        client.transport = { _, path, body in
            if path == "/api/v1/plugins/mobile/http/identity" { return (200, Data(#"{"serverId":"office-server"}"#.utf8)) }
            XCTAssertEqual(path, "/api/v1/plugins/studio/rpc/inbox_act")
            let input = try JSONDecoder().decode(JSONValue.self, from: XCTUnwrap(body))
            XCTAssertEqual(input, ["key": "interaction:one", "actionId": "answer", "text": "Yes"])
            return (200, Data(#"{"ok":true,"result":{"ok":true}}"#.utf8))
        }
        let action = try XCTUnwrap(OfficeNotificationAction(key: "interaction:one", identifier: "BB_REPLY_TEXT", text: "Yes"))
        try await action.perform(client: client, serverId: "office-server")
    }

    func testForeignPushCannotSendAction() async throws {
        let client = BBClient()
        client.transport = { _, path, _ in
            XCTAssertEqual(path, "/api/v1/plugins/mobile/http/identity", "Foreign action must not reach inbox_act")
            return (200, Data(#"{"serverId":"office-server"}"#.utf8))
        }
        let action = try XCTUnwrap(OfficeNotificationAction(key: "request", identifier: "BB_APPROVE"))
        do {
            try await action.perform(client: client, serverId: "other-server")
            XCTFail("Expected origin rejection")
        } catch { XCTAssertEqual((error as? BBError)?.status, 409) }
    }

    @MainActor func testValidatedPushRefreshesObservingInboxOnly() async {
        var fetches = 0
        let client = BBClient()
        client.transport = { _, _, _ in (200, Data(#"{"serverId":"office-server"}"#.utf8)) }
        let realtime = BBRealtime(client: client)
        let store = InboxStore(fetch: { _ in
            fetches += 1
            return OfficeInboxPage(events: [])
        }, counts: { OfficeInboxCounts(bySpace: [:]) }, mutate: { _, _ in })
        store.startObserving(realtime)
        defer { store.stopObserving() }
        let rejected = await OfficePush.receive(["inboxKey": "request", "serverId": "other-server"], client: client)
        XCTAssertFalse(rejected)
        XCTAssertEqual(fetches, 0)
        let accepted = await OfficePush.receive(["inboxKey": "request", "serverId": "office-server"], client: client)
        XCTAssertTrue(accepted)
        for _ in 0..<100 where fetches == 0 { await Task.yield() }
        XCTAssertEqual(fetches, 1)
    }
}
