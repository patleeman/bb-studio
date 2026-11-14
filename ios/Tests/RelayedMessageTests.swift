import XCTest
@testable import BBStudio

final class RelayedMessageTests: XCTestCase {
    private struct Cases: Decodable {
        struct Case: Decodable {
            struct Expect: Decodable {
                var kind: String
                var sender: String?
                var senderThreadId: String?
                var urgent: Bool
                var summary: String
                var line: String
                var folds: Bool
            }
            var name: String
            var initiator: String?
            var text: String
            var senderTitle: String?
            var reply: String?
            var expect: Expect?
        }
        var cases: [Case]
    }

    private static let shared = URL(fileURLWithPath: #filePath).deletingLastPathComponent()
        .appending(path: "../../plugins/packages/bb-studio/src/kit/relayed-messages.json").standardizedFileURL

    private func row(_ id: String, _ role: String, _ text: String, kind: String = "conversation", initiator: String? = nil) -> TimelineRow {
        var json: [String: Any] = ["id": id, "kind": kind, "role": role, "text": text, "createdAt": 0]
        if let initiator { json["initiator"] = initiator }
        return try! JSONDecoder().decode(TimelineRow.self, from: JSONSerialization.data(withJSONObject: json))
    }

    private func work(_ id: String) -> TimelineRow {
        let json: [String: Any] = ["id": id, "kind": "work", "workKind": "tool", "toolName": "pages_read", "status": "completed", "createdAt": 0]
        return try! JSONDecoder().decode(TimelineRow.self, from: JSONSerialization.data(withJSONObject: json))
    }

    func testTheSharedCasesMatchStudio() throws {
        let cases = try JSONDecoder().decode(Cases.self, from: Data(contentsOf: Self.shared)).cases
        XCTAssertGreaterThan(cases.count, 20)
        for item in cases {
            let parsed = RelayedMessage.parse(item.text, initiator: item.initiator)
            guard let expect = item.expect else {
                XCTAssertNil(parsed, item.name)
                continue
            }
            guard let parsed else {
                XCTFail("not relayed: \(item.name)")
                continue
            }
            XCTAssertEqual(parsed.kind.rawValue, expect.kind, item.name)
            XCTAssertEqual(parsed.sender, expect.sender, item.name)
            XCTAssertEqual(parsed.senderThreadId, expect.senderThreadId, item.name)
            XCTAssertEqual(parsed.urgent, expect.urgent, item.name)
            XCTAssertEqual(parsed.summary, expect.summary, item.name)
            XCTAssertEqual(parsed.line(title: item.senderTitle), expect.line, item.name)
            XCTAssertEqual(RelayedMessage.folds(parsed, reply: item.reply), expect.folds, item.name)
        }
    }

    func testAPassReplyFoldsIntoTheRelayedRowAndStaysOffTheFloor() {
        let rows = [
            row("m1", "user", "[bb message from thread:thr_lead1]\n\nLEAD x: shipped.", initiator: "agent"),
            work("w1"),
            row("m2", "assistant", "[PASS]"),
            row("m3", "user", "[bb automation due:auto_1] Scan the inbox.", initiator: "user"),
            row("m4", "assistant", "Two new invoices."),
            row("m5", "user", "Thanks", initiator: "user"),
        ]
        let items = TimelineItem.group(rows)
        XCTAssertEqual(RoomFloor.clean(items).map(\.id), items.map(\.id), "the room keeps the [PASS] for the fold")
        let out = ThreadTranscriptRow.thread(items: items, hasOlder: false, unread: nil, match: nil, editableId: nil,
                                             pending: [], interactions: [], working: false, thinking: nil)
        let shown: [(String, Bool, Bool)] = out.compactMap {
            guard case .item(let item, let state) = $0 else { return nil }
            return (item.id, state.relayed != nil, state.quiet)
        }
        XCTAssertEqual(shown.map(\.0), ["m1", "m3", "m4", "m5"], "the work and the [PASS] fold into the relayed row")
        XCTAssertEqual(shown.map(\.1), [true, true, false, false])
        XCTAssertEqual(shown.map(\.2), [true, false, false, false], "a real reply shows after its row")
        XCTAssertEqual(RoomFloor.rows(out, lying: true).compactMap { row -> String? in
            if case .item(let item, _) = row { return item.id }
            return nil
        }, ["m4", "m5"], "relayed rows stay off the floor")
        XCTAssertEqual(RoomFloor.rows(out, lying: false).count, out.count, "and show when the chat stands")
    }
}
