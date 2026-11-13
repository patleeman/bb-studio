import XCTest
@testable import BBStudio

@MainActor
final class RoomTests: XCTestCase {
    func testTheInputStandsTheChatUpAndTheChevronOrATapOutsideLaysItDown() {
        let room = RoomModel()
        XCTAssertEqual(room.mode, .rest)
        XCTAssertEqual(room.handle(.tapInput), .focus)
        XCTAssertTrue(room.standing)
        XCTAssertEqual(room.focusRequests, 1)
        XCTAssertEqual(room.handle(.chevron), .dismissKeyboard)
        XCTAssertEqual(room.mode, .rest)
        room.handle(.tapInput)
        XCTAssertEqual(room.handle(.tapOutside), .dismissKeyboard)
        XCTAssertEqual(room.mode, .rest)
        XCTAssertEqual(room.handle(.tapOutside), .none)
        XCTAssertEqual(room.mode, .rest)
        XCTAssertEqual(room.handle(.tapFloor), .none, "the floor stands the chat up to read, with no keyboard")
        XCTAssertTrue(room.standing)
    }

    func testTheMenuOpensPlacesAndPullingDownGoesBackToTheMenu() {
        let room = RoomModel()
        room.handle(.menuButton)
        XCTAssertTrue(room.showsMenu)
        XCTAssertFalse(room.showsDay)
        room.handle(.open(.memory))
        XCTAssertEqual(room.place, .memory)
        room.handle(.closePlace)
        XCTAssertNil(room.place)
        XCTAssertEqual(room.mode, .menu)
        room.handle(.closeMenu)
        XCTAssertEqual(room.mode, .rest)
        XCTAssertEqual(room.handle(.open(.todos)), .none)
        XCTAssertNil(room.place, "a place opens only from the menu")
    }

    func testTheInputDoesNothingFromTheMenu() {
        let room = RoomModel()
        room.handle(.menuButton)
        room.handle(.tapInput)
        XCTAssertEqual(room.mode, .menu)
    }

    func testRecordingFollowsTheMic() {
        XCTAssertEqual(RoomModel.mode(.rest, talk: .recording), .record(locked: false))
        XCTAssertEqual(RoomModel.mode(.rest, talk: .handsFree), .record(locked: true))
        XCTAssertEqual(RoomModel.mode(.record(locked: false), talk: .cancelling), .record(locked: false))
        XCTAssertEqual(RoomModel.mode(.record(locked: true), talk: .sending), .rest)
        XCTAssertEqual(RoomModel.mode(.record(locked: false), talk: .idle), .rest)
        XCTAssertEqual(RoomModel.mode(.talk, talk: .recording), .talk, "the standing chat keeps its own mic")
        XCTAssertEqual(RoomModel.mode(.menu, talk: .idle), .menu)
        let room = RoomModel()
        room.sync(talk: .recording)
        XCTAssertTrue(room.showsDay, "the day stays while recording")
        XCTAssertTrue(room.mode.recording)
    }

    func testHintsSayHowToSendOrCancel() {
        XCTAssertEqual(RoomModel.hint(.recording), "Release to send · slide left to cancel")
        XCTAssertEqual(RoomModel.hint(.handsFree), "Tap the mic to send")
        XCTAssertEqual(RoomModel.hint(.cancelling), "Release to cancel")
        XCTAssertNil(RoomModel.hint(.idle))
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

    func testTheDayLineTakesGoodToKnowFromTodaysMorningCard() {
        let now = Date(timeIntervalSince1970: 1_794_600_000)
        let card = "## Friday, Nov 13\n**On today's list**\n::loop{id=\"loop_a\" row=\"1\"}\n**Good to know**\n- Light snow near 6, roads wet.\n- Second note."
        let today = row("mc", "assistant", card, at: now.timeIntervalSince1970 * 1000 - 3_600_000)
        let line = RoomDay.line(rows: [today], todayCount: 2, status: "Idle", now: now)
        XCTAssertEqual(line, RoomDay.Line(lead: "Two things today.", rest: "Light snow near 6, roads wet."))
        let yesterday = row("mc", "assistant", card, at: now.timeIntervalSince1970 * 1000 - 2 * 86_400_000)
        XCTAssertEqual(RoomDay.line(rows: [yesterday], todayCount: 1, status: "Working · 1 worker", now: now),
                       RoomDay.Line(lead: "One thing today.", rest: "Working · 1 worker"))
        XCTAssertEqual(RoomDay.countLine(0), "Nothing on today's list.")
        XCTAssertEqual(RoomDay.countLine(nil), "Here's your day.")
        XCTAssertEqual(RoomDay.countLine(14), "14 things today.")
    }

    func testShortScreensShowFewerCardsAndASmallerPresence() {
        let phone = RoomDayView.fit(CGSize(width: 402, height: 708))
        let large = RoomDayView.fit(CGSize(width: 440, height: 800))
        let outer = RoomDayView.fit(CGSize(width: 466, height: 540))
        XCTAssertEqual(phone.cards, 5)
        XCTAssertEqual(RoomDayView.fit(CGSize(width: 402, height: 640)).cards, 3)
        XCTAssertEqual(outer.cards, 2)
        XCTAssertLessThan(outer.presence, phone.presence, "smaller on the Duo's outer screen")
        XCTAssertGreaterThan(large.presence, phone.presence, "bigger on a large phone")
    }

    func testAPlaceOpenedFromALinkOrACardClosesToTheRoom() {
        let room = RoomModel()
        room.showPlace(.archive)
        XCTAssertEqual(room.place, .archive)
        room.handle(.closePlace)
        XCTAssertNil(room.place)
        XCTAssertEqual(room.mode, .rest)
        room.handle(.menuButton)
        room.handle(.open(.memory))
        room.handle(.closePlace)
        XCTAssertEqual(room.mode, .menu, "one opened from the menu closes to the menu")
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
        let items = RoomFloor.clean(rows.map(TimelineItem.message))
        XCTAssertEqual(items.map(\.id), ["a", "c", "e", "w"])
        XCTAssertEqual(items.first { $0.id == "c" }?.rows.first?.text, "Done with the sweep.")
        XCTAssertEqual(items.first { $0.id == "e" }?.rows.first?.text, "Tests: [PASS] on all three", "a token inside a sentence stays")
        XCTAssertTrue(RoomFloor.isStatusToken(" `[SKIPPED]` "))
        XCTAssertFalse(RoomFloor.isStatusToken("[PASS] and more"))
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
