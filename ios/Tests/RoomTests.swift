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

    func testTheFloorShowsTheLastSixTextMessages() {
        var rows = (1...9).map { row("m\($0)", $0 % 2 == 0 ? "user" : "assistant", "Message \($0)") }
        rows.insert(row("t1", "assistant", "", kind: "work"), at: 8)
        rows.append(row("sys", "user", "Worker finished", initiator: "system"))
        rows.append(row("card", "assistant", "::loop{id=\"loop_a\"}"))
        let lines = RoomFloor.lines(rows)
        XCTAssertEqual(lines.map(\.id), ["m4", "m5", "m6", "m7", "m8", "m9"])
        XCTAssertEqual(lines.first?.who, .me)
        XCTAssertEqual(lines.last?.who, .bot)
    }

    func testTheFloorSkipsTheMorningCardAndReadsMarkdownPlain() {
        let morning = row("mc", "assistant", "## Friday, Nov 13\n**On today's list**\n::loop{id=\"loop_a\" row=\"1\"}")
        let rich = row("r", "assistant", "**Yes**, a little.\n\n- Rain mixed with `snow`\n::next{reply=\"ok\"}")
        let lines = RoomFloor.lines([rich, morning])
        XCTAssertEqual(lines.map(\.id), ["r"])
        XCTAssertEqual(lines.first?.text, "Yes, a little. Rain mixed with snow")
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
        XCTAssertEqual(RoomDayView.fit(height: 720).cards, 5)
        XCTAssertEqual(RoomDayView.fit(height: 640).cards, 3)
        XCTAssertEqual(RoomDayView.fit(height: 540).cards, 2)
        XCTAssertLessThan(RoomDayView.fit(height: 540).presence, RoomDayView.fit(height: 720).presence)
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
}
