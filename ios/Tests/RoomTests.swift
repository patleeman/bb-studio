import XCTest
@testable import BBStudio

@MainActor
final class RoomTests: XCTestCase {
    func testTheSceneLightSitsInTheTopCornerOfThePresencesPage() throws {
        let phone = try XCTUnwrap(RoomSceneLight.spot(window: CGSize(width: 440, height: 956), safeTop: 62, safeTrailing: 0, pages: nil, rail: false))
        XCTAssertEqual(phone, SceneLight(x: 440 - RoomSceneLight.phoneCorner, y: 62 + 80), "the phone: under the menu, in the top corner")
        let folded = try XCTUnwrap(RoomSceneLight.spot(window: CGSize(width: 466, height: 678), safeTop: 0, safeTrailing: 0, pages: nil, rail: true))
        XCTAssertEqual(folded, SceneLight(x: 466 - FoldedChrome.column - RoomSceneLight.corner, y: RoomSceneLight.corner), "the folded Duo: left of the rail")
        let unfolded = try XCTUnwrap(RoomSceneLight.spot(window: CGSize(width: 951, height: 669), safeTop: 0, safeTrailing: 0, pages: .sideBySide, rail: true))
        XCTAssertLessThan(unfolded.x, 951 / 2 - DuoPages.hinge / 2, "unfolded: on the presence's page, left of the hinge")
        XCTAssertEqual(unfolded.y, RoomSceneLight.corner)
        XCTAssertEqual(SceneLight.scale, 0.6, accuracy: 0.001, "smaller than desktop's")
        XCTAssertNil(RoomSceneLight.spot(window: .zero, safeTop: 0, safeTrailing: 0, pages: nil, rail: false))
    }

    func testTheFrostCoversTheConversationPageFromTheHinge() {
        let wide = RoomFrost.seam(951)
        XCTAssertEqual(wide, (951 / 2 + DuoPages.hinge / 2) / 951, accuracy: 0.0001)
        XCTAssertLessThan(wide + 0.02, 0.736, "the scene's moon (0.736 of the width) is under the frosted page")
        XCTAssertGreaterThanOrEqual(wide - 0.02, (951 / 2 - DuoPages.hinge / 2) / 951, "the presence page stays sharp: the frost fades in inside the hinge")
        XCTAssertEqual(RoomFrost.seam(0), 0.5)
    }

    func testTheThemeIsTheBotsSceneThenThePhonesSceneThenAuroraFjord() {
        let catalog = LookCatalog.shared
        XCTAssertEqual(RoomTheme.resolve(botThemeId: "forest", phoneThemeId: "grid", catalog: catalog).id, "forest")
        XCTAssertEqual(RoomTheme.resolve(botThemeId: "dracula", phoneThemeId: "grid", catalog: catalog).id, "grid")
        XCTAssertEqual(RoomTheme.resolve(botThemeId: nil, phoneThemeId: "on-air", catalog: catalog).id, "aurora-fjord")
        XCTAssertEqual(RoomTheme.resolve(botThemeId: "nord", phoneThemeId: nil, catalog: catalog).id, "aurora-fjord")
        XCTAssertEqual(RoomTheme.resolve(botThemeId: "cabin-aurora", phoneThemeId: nil, catalog: catalog).id, "aurora-fjord")
        XCTAssertEqual(RoomTheme.resolve(botThemeId: "zen-garden", phoneThemeId: nil, catalog: catalog).id, "kyoto-garden")
        XCTAssertEqual(RoomTheme.resolve(botThemeId: "no-such-theme", phoneThemeId: nil, catalog: catalog).kind, .scene)
    }

    private func row(_ id: String, _ role: String, _ text: String, kind: String = "conversation", at: Double = 0, initiator: String? = nil) -> TimelineRow {
        var json: [String: Any] = ["id": id, "kind": kind, "role": role, "text": text, "createdAt": at]
        if let initiator { json["initiator"] = initiator }
        return try! JSONDecoder().decode(TimelineRow.self, from: JSONSerialization.data(withJSONObject: json))
    }

    func testEachConversationHasItsOwnLightAndNeighboursDiffer() {
        let order = ["thr_main", "thr_a", "thr_b", "thr_c", "thr_d", "thr_e"]
        let lights = RoomLight.lights(order: order, main: "thr_main")
        XCTAssertEqual(lights["thr_main"], .natural, "Main keeps the scene's own light")
        for (a, b) in zip(order, order.dropFirst()) { XCTAssertNotEqual(lights[a], lights[b], "\(a) and \(b) look different") }
        XCTAssertEqual(RoomLight.lights(order: order, main: "thr_main"), lights, "the same every time")
        XCTAssertEqual(RoomLight.natural(for: "thr_a"), RoomLight.natural(for: "thr_a"))
        XCTAssertNotEqual(RoomLight.natural(for: "thr_a"), .natural)
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
        let items = RoomText.clean(rows.map(TimelineItem.message))
        XCTAssertEqual(items.map(\.id), ["a", "p", "b", "c", "e", "w"], "a [PASS] stays for the relayed fold")
        let shown = RoomText.rows(ThreadTranscriptRow.thread(items: items, hasOlder: false, unread: nil, match: nil, editableId: nil,
                                                              pending: [], interactions: [], working: false, thinking: nil))
        XCTAssertEqual(shown.map(\.id), ["a", "c", "e", "w"], "and the room still hides it")
        XCTAssertEqual(items.first { $0.id == "c" }?.rows.first?.text, "Done with the sweep.")
        XCTAssertEqual(items.first { $0.id == "e" }?.rows.first?.text, "Tests: [PASS] on all three", "a token inside a sentence stays")
        XCTAssertTrue(RoomText.isStatusToken(" `[SKIPPED]` "))
        XCTAssertFalse(RoomText.isStatusToken("[PASS] and more"))
    }

    func testTheRoomChatShowsBBsMessagesAsCardsAndHidesItsBareCheck() {
        let finished = try! JSONDecoder().decode(TimelineRow.self, from: JSONSerialization.data(withJSONObject: [
            "id": "s", "kind": "conversation", "role": "user", "initiator": "system", "text": "[bb system] @thread:thr_a completed",
            "systemMessageKind": "child-completed", "systemMessageSubject": ["kind": "thread", "threadId": "thr_a", "threadName": "Review"],
            "createdAt": 0] as [String: Any]))
        let items: [TimelineItem] = [.message(row("u", "user", "Get the PRs moving")), .message(finished),
                                     .message(row("k", "assistant", "✓")), .message(row("n", "user", "Note", initiator: "system")),
                                     .message(row("a", "assistant", "On it."))]
        let rows = RoomText.rows(ThreadTranscriptRow.thread(items: items, hasOlder: false, unread: nil, match: nil, editableId: nil,
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

    func testTheDuoUnfoldedHasTwoPagesAndOnlyThere() {
        XCTAssertEqual(DuoPages(window: CGSize(width: 951, height: 669), phone: true), .sideBySide)
        XCTAssertNil(DuoPages(window: CGSize(width: 669, height: 951), phone: true), "upright, the hinge across: one column, as on a phone")
        XCTAssertNil(DuoPages(window: CGSize(width: 466, height: 678), phone: true), "folded")
        XCTAssertNil(DuoPages(window: CGSize(width: 678, height: 466), phone: true), "folded, landscape")
        XCTAssertNil(DuoPages(window: CGSize(width: 468, height: 669), phone: true), "beside another app")
        XCTAssertNil(DuoPages(window: CGSize(width: 956, height: 440), phone: true), "a large iPhone in landscape")
        XCTAssertNil(DuoPages(window: CGSize(width: 1180, height: 820), phone: false), "an iPad keeps the split view")
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

    func testThePagerGoesMainFirstThenByRecentActivityAndLocksAnAxis() {
        func conversation(_ id: String, _ at: Double, main: Bool = false) -> BotConversation {
            let json: [String: Any] = ["threadId": id, "title": id, "isMain": main, "updatedAt": at, "running": false, "mirrored": false]
            return try! JSONDecoder().decode(BotConversation.self, from: JSONSerialization.data(withJSONObject: json))
        }
        let order = RoomPager.order(main: "main", conversations: [conversation("old", 10), conversation("main", 5, main: true), conversation("new", 30)])
        XCTAssertEqual(order, ["main", "new", "old"])
        XCTAssertEqual(RoomPager.step(order, from: "main", by: 1), "new")
        XCTAssertNil(RoomPager.step(order, from: "main", by: -1), "nothing before Main")
        XCTAssertNil(RoomPager.axis(CGSize(width: 4, height: 3)), "too short to tell")
        XCTAssertEqual(RoomPager.axis(CGSize(width: 40, height: 10)), .horizontal)
        XCTAssertEqual(RoomPager.axis(CGSize(width: 12, height: 40)), .vertical, "a scroll stays a scroll")
        XCTAssertEqual(RoomPager.page(after: CGSize(width: -80, height: 0), predicted: CGSize(width: -90, height: 0)), 1)
        XCTAssertEqual(RoomPager.page(after: CGSize(width: 20, height: 0), predicted: CGSize(width: 30, height: 0)), 0, "a short drag springs back")
    }
}

final class LockedBox<Value>: @unchecked Sendable {
    private let lock = NSLock()
    private var value: Value
    init(_ value: Value) { self.value = value }
    func get() -> Value { lock.withLock { value } }
    func set(_ next: Value) { lock.withLock { value = next } }
}

@MainActor
final class RoomHomeTests: XCTestCase {
    func testPlacesOpenOverTheConversationAndCloseBackToIt() {
        let room = Router()
        room.showPlace(.conversations)
        XCTAssertEqual(room.place, .conversations, "the list opens over the conversation")
        room.closePlace()
        XCTAssertNil(room.place)
        let before = room.focusRequests
        room.focusInput()
        XCTAssertEqual(room.focusRequests, before + 1)
    }

    func testItOpensOnTheLastConversationWhileListed() {
        let bot = "bot_home_test_\(UUID().uuidString)"
        XCTAssertEqual(RoomHome.opening(main: "main", order: ["main", "a"], botId: bot), "main")
        RoomHome.remember("a", botId: bot)
        XCTAssertEqual(RoomHome.opening(main: "main", order: ["main", "a"], botId: bot), "a")
        XCTAssertEqual(RoomHome.opening(main: "main", order: ["main"], botId: bot), "main", "not once it's gone")
    }
}
