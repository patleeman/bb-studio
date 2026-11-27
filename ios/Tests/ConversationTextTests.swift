import XCTest
@testable import BBStudio

@MainActor
final class ConversationTextTests: XCTestCase {
    func testTheThemeIsTheBotsSceneThenThePhonesSceneThenAuroraFjord() {
        let catalog = LookCatalog.shared
        XCTAssertEqual(BotTheme.resolve(botThemeId: "forest", phoneThemeId: "grid", catalog: catalog).id, "forest")
        XCTAssertEqual(BotTheme.resolve(botThemeId: "dracula", phoneThemeId: "grid", catalog: catalog).id, "grid")
        XCTAssertEqual(BotTheme.resolve(botThemeId: nil, phoneThemeId: "on-air", catalog: catalog).id, "aurora-fjord")
        XCTAssertEqual(BotTheme.resolve(botThemeId: "nord", phoneThemeId: nil, catalog: catalog).id, "aurora-fjord")
        XCTAssertEqual(BotTheme.resolve(botThemeId: "cabin-aurora", phoneThemeId: nil, catalog: catalog).id, "aurora-fjord")
        XCTAssertEqual(BotTheme.resolve(botThemeId: "zen-garden", phoneThemeId: nil, catalog: catalog).id, "kyoto-garden")
        XCTAssertEqual(BotTheme.resolve(botThemeId: "no-such-theme", phoneThemeId: nil, catalog: catalog).kind, .scene)
    }

    private func row(_ id: String, _ role: String, _ text: String, kind: String = "conversation", at: Double = 0, initiator: String? = nil) -> TimelineRow {
        var json: [String: Any] = ["id": id, "kind": kind, "role": role, "text": text, "createdAt": at]
        if let initiator { json["initiator"] = initiator }
        return try! JSONDecoder().decode(TimelineRow.self, from: JSONSerialization.data(withJSONObject: json))
    }

    private func worker(_ id: String, _ title: String, _ status: String) -> BotWorker {
        let json: [String: Any] = ["threadId": id, "title": title, "status": status, "updatedAt": 1_794_600_000_000.0, "mirrored": false, "sameTitle": 1]
        return try! JSONDecoder().decode(BotWorker.self, from: JSONSerialization.data(withJSONObject: json))
    }

    func testTheRoomChatHidesBareStatusTokens() {
        let rows = [
            row("a", "assistant", "Checked the inbox. Nothing new."),
            row("p", "assistant", "[PASS]"),
            row("b", "assistant", "**[PASS]**"),
            row("c", "assistant", "Done with the sweep.\n\n[DONE]"),
            row("d", "assistant", "[fail]\n"),
            row("e", "assistant", "Tests: [PASS] on all three"),
            row("w", "assistant", "", kind: "work"),
        ]
        let items = ConversationText.clean(rows.map(TimelineItem.message))
        XCTAssertEqual(items.map(\.id), ["a", "p", "b", "c", "e", "w"], "a [PASS] stays for the relayed fold")
        let shown = ConversationText.rows(ThreadTranscriptRow.thread(items: items, hasOlder: false, unread: nil, match: nil, editableId: nil,
                                                              pending: [], interactions: [], working: false, thinking: nil))
        XCTAssertEqual(shown.map(\.id), ["a", "c", "e", "w"], "and the room still hides it")
        XCTAssertEqual(items.first { $0.id == "c" }?.rows.first?.text, "Done with the sweep.")
        XCTAssertEqual(items.first { $0.id == "e" }?.rows.first?.text, "Tests: [PASS] on all three", "a token inside a sentence stays")
        XCTAssertTrue(ConversationText.isStatusToken(" `[SKIPPED]` "))
        XCTAssertFalse(ConversationText.isStatusToken("[PASS] and more"))
    }

    func testTheRoomChatShowsBBsMessagesAsCardsAndHidesItsBareCheck() {
        let finished = try! JSONDecoder().decode(TimelineRow.self, from: JSONSerialization.data(withJSONObject: [
            "id": "s", "kind": "conversation", "role": "user", "initiator": "system", "text": "[bb system] @thread:thr_a completed",
            "systemMessageKind": "child-completed", "systemMessageSubject": ["kind": "thread", "threadId": "thr_a", "threadName": "Review"],
            "createdAt": 0] as [String: Any]))
        let items: [TimelineItem] = [.message(row("u", "user", "Get the PRs moving")), .message(finished),
                                     .message(row("k", "assistant", "✓")), .message(row("n", "user", "Note", initiator: "system")),
                                     .message(row("a", "assistant", "On it."))]
        let rows = ConversationText.rows(ThreadTranscriptRow.thread(items: items, hasOlder: false, unread: nil, match: nil, editableId: nil,
                                                             pending: [], interactions: [], working: false, thinking: nil))
        XCTAssertEqual(rows.map(\.id), ["u", "child:s", "a"])
        guard case .child(let event, _) = rows[1] else { return XCTFail("BB's message is a card") }
        XCTAssertEqual(event.title, "Review")
        XCTAssertEqual(event.threadId, "thr_a")
    }

    func testRowsOfOneTurnSitCloserThanTurns() {
        let items: [TimelineItem] = [.message(row("u", "user", "Hi")), .activity([row("w", "assistant", "", kind: "work")]),
                                     .message(row("a", "assistant", "Done.")), .message(row("b", "assistant", "More.")),
                                     .message(row("v", "user", "Thanks"))]
        let rows = ThreadTranscriptRow.thread(items: items, hasOlder: false, unread: nil, match: nil, editableId: nil,
                                              pending: [], interactions: [], working: false, thinking: nil)
        let same = rows.map { row -> Bool in
            if case .item(_, let state) = row { return state.sameTurn }
            return false
        }
        XCTAssertEqual(same, [false, false, true, true, false])
    }

    func testAQuietThoughtIsHidden() {
        func thought(_ id: String, detail: String?, ms: Double, status: String = "completed") -> TimelineRow {
            var json: [String: Any] = ["id": id, "kind": "system", "systemKind": "operation", "operationKind": "reasoning",
                                       "status": status, "startedAt": 1_000_000, "createdAt": 1_000_000 + ms, "title": "Thought"]
            if let detail { json["detail"] = detail }
            return try! JSONDecoder().decode(TimelineRow.self, from: JSONSerialization.data(withJSONObject: json))
        }
        XCTAssertTrue(thought("a", detail: nil, ms: 9_000).isQuietThought, "nothing in it")
        XCTAssertTrue(thought("b", detail: "Hmm.", ms: 6).isQuietThought, "6 ms")
        XCTAssertFalse(thought("c", detail: "Weighing the two options…", ms: 4_000).isQuietThought)
        XCTAssertFalse(thought("d", detail: nil, ms: 0, status: "pending").isQuietThought, "still thinking")
    }

    func testChoosingAThemeSetsTheBotsAppearanceAndKeepsTheRest() async throws {
        let client = BBClient(baseURL: URL(string: "https://theme.invalid")!)
        let sent = LockedBox<[String: Any]>([:])
        client.transport = { _, path, body in
            guard path.hasSuffix("/rpc/bot_set_appearance") else { return (404, Data()) }
            sent.set((try? JSONSerialization.jsonObject(with: body ?? Data()) as? [String: Any]) ?? [:])
            return (200, Data(#"{"ok":true,"result":{"bot":{"id":"bot_main"}}}"#.utf8))
        }
        let current = Studio.BotSpacesOutputBotsItemAppearance(themeId: "forest", intensity: 0.6, glass: 0.4, motion: 1)
        try await client.setBotTheme(botId: "bot_main", themeId: "aurora-fjord", keeping: current)
        let input = sent.get()
        XCTAssertEqual(input["botId"] as? String, "bot_main")
        let appearance = try XCTUnwrap(input["appearance"] as? [String: Any])
        XCTAssertEqual(appearance["themeId"] as? String, "aurora-fjord", "the Bot's appearance, which desktop and the room read")
        XCTAssertEqual(appearance["intensity"] as? Double, 0.6, "its other settings stay")
        XCTAssertEqual(appearance["glass"] as? Double, 0.4)
    }

}

final class LockedBox<Value>: @unchecked Sendable {
    private let lock = NSLock()
    private var value: Value
    init(_ value: Value) { self.value = value }
    func get() -> Value { lock.withLock { value } }
    func set(_ next: Value) { lock.withLock { value = next } }
}
