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
        XCTAssertEqual(room.handle(.openChat), .none, "a swipe up opens the conversation to read, with no keyboard")
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
        XCTAssertEqual(room.handle(.open(.tasks)), .none)
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

    func testTheHeaderSaysTheDateAndWeatherForMainAndTheRoleForOthers() {
        let now = Date(timeIntervalSince1970: 1_794_600_000)
        let date = now.formatted(.dateTime.weekday(.abbreviated).month(.abbreviated).day())
        let card = "## Friday, Nov 13\n**On today's list**\n::loop{id=\"loop_a\" row=\"1\"}\n**Good to know**\n- Light snow near 6, roads wet.\n- Second note."
        let today = row("mc", "assistant", card, at: now.timeIntervalSince1970 * 1000 - 3_600_000)
        XCTAssertEqual(RoomHeader.subline(main: true, title: "Juniper", rows: [today], now: now), date + " · Light snow near 6")
        let yesterday = row("mc", "assistant", card, at: now.timeIntervalSince1970 * 1000 - 2 * 86_400_000)
        XCTAssertEqual(RoomHeader.subline(main: true, title: "Juniper", rows: [yesterday], now: now), date, "no weather from an old card")
        let note = card.replacingOccurrences(of: "Light snow near 6, roads wet.", with: "Dana's flight lands at 4.")
        XCTAssertEqual(RoomHeader.subline(main: true, title: "Juniper", rows: [row("mc", "assistant", note, at: now.timeIntervalSince1970 * 1000)], now: now), date,
                       "a note that isn't weather stays out")
        XCTAssertEqual(RoomHeader.subline(main: false, title: "BB Studio lead", rows: [today], now: now), "Project lead")
        XCTAssertEqual(RoomHeader.subline(main: false, title: "Launch prep", rows: [], now: now), "Conversation")
        XCTAssertEqual(RoomHeader.weather("Sunny with a high near 50, cooling in the afternoon"), "Sunny with a high near 50")
        XCTAssertNil(RoomHeader.weather("The plumber comes Tuesday"))
    }

    func testTheNowLineSaysWhatTheAgentIsDoingAndWhatItLastFinished() {
        let start = Date(timeIntervalSince1970: 1_794_600_000)
        let own = TaskItem(id: "t_own", title: "Launch prep", owner: "thread:thr_lead", state: .inProgress, conversation: "thr_lead",
                           line: "Waiting on two workers", updatedAt: start)
        let done = TaskItem(id: "t_done", title: "Book the room", owner: "thread:thr_w1", state: .done, conversation: "thr_lead",
                            line: "Booked the room for Friday", closedAt: start)
        let todo = Todos.Item(id: "1", text: "Mocking up the room", status: "in_progress")
        let running = RoomNow.make(threadId: "thr_lead", main: false, running: true, tasks: [own, done], todos: [todo],
                                   rows: [row("u", "user", "Mock it up", at: start.timeIntervalSince1970 * 1000)], workers: [], latest: nil)
        XCTAssertEqual(running.text, "Mocking up the room", "a running turn says its current step")
        XCTAssertEqual(running.since, start)
        XCTAssertEqual(running.last, "Booked the room for Friday")
        XCTAssertTrue(running.active)
        let waiting = RoomNow.make(threadId: "thr_lead", main: false, running: false, tasks: [own, done], todos: [], rows: [], workers: [], latest: nil)
        XCTAssertEqual(waiting.text, "Waiting on two workers", "its own task in progress")
        let busy = RoomNow.make(threadId: "thr_main", main: true, running: false, tasks: [], todos: [], rows: [],
                                workers: [worker("w1", "Theme stills", "running"), worker("w2", "Fork", "running")], latest: nil)
        XCTAssertEqual(busy.text, "Waiting on two workers")
        let idle = RoomNow.make(threadId: "thr_main", main: true, running: false, tasks: [], todos: [], rows: [], workers: [],
                                latest: "**Sent** Dana the numbers")
        XCTAssertEqual(idle, RoomNow(text: "Idle", since: nil, last: "Sent Dana the numbers", active: false))
        XCTAssertEqual(idle.small(), "last: sent Dana the numbers")
        XCTAssertEqual(RoomNow.lowered("BB Studio shipped"), "BB Studio shipped", "a name keeps its capitals")
        XCTAssertEqual(RoomNow.elapsed(start, now: start.addingTimeInterval(20)), "just now")
        XCTAssertEqual(RoomNow.elapsed(start, now: start.addingTimeInterval(14 * 60)), "14 min")
        XCTAssertEqual(RoomNow.elapsed(start, now: start.addingTimeInterval(90 * 60)), "1 h 30 min")
    }

    func testOnItIsTheAgentsOpenTasksAndRunningWorkersOnceAndYoursIsTheUsers() {
        let own = TaskItem(id: "t_own", title: "Launch prep", owner: "thread:thr_lead", state: .inProgress, conversation: "thr_lead")
        let bank = TaskItem(id: "wc_bank", title: "Question bank", owner: "thread:thr_w1", state: .inProgress, conversation: "thr_lead",
                            step: "Drafting answers", workers: ["thr_w1"])
        let mine = TaskItem(id: "t_mine", title: "Pick the slides", state: .waiting, conversation: "thr_lead")
        let closed = TaskItem(id: "t_done", title: "Old", owner: "thread:thr_w1", state: .done, conversation: "thr_lead")
        let rows = RoomOnIt.rows(threadId: "thr_lead", tasks: [own, bank, mine, closed],
                                 workers: [worker("thr_w1", "Question bank", "running"), worker("thr_w2", "Slides", "running"), worker("thr_w3", "Gone", "done")])
        XCTAssertEqual(rows.map(\.id), ["wc_bank", "worker-thr_w2"], "its own task is the Now line; a worker with a task shows once")
        XCTAssertEqual(rows.first?.trailing, "Drafting answers")
        XCTAssertEqual(rows.last?.threadId, "thr_w2", "a worker without a task opens its thread")
        XCTAssertEqual(RoomNow.yours([own, bank, mine, closed]).map(\.id), ["t_mine"])
    }

    func testShortScreensShowFewerRowsAndASmallerPresence() {
        let phone = RoomFit.make(height: 760, width: 402, row: 44, fixed: 260, onIt: 3, yours: 4)
        XCTAssertEqual(phone.onIt + phone.yours, 7, "a phone shows everything")
        let small = RoomFit.make(height: 560, width: 375, row: 44, fixed: 260, onIt: 3, yours: 4)
        XCTAssertGreaterThan(small.onItMore + small.yoursMore, 0, "a short screen says how many more")
        XCTAssertGreaterThanOrEqual(small.yours, 1, "yours always has a row")
        let empty = RoomFit.make(height: 560, width: 375, row: 44, fixed: 260, onIt: 6, yours: 0)
        XCTAssertEqual(empty.yours, 0)
        XCTAssertEqual(empty.yoursMore, 0, "the empty line takes the one row")
        XCTAssertLessThan(RoomFit.presence(CGSize(width: 466, height: 540)), RoomFit.presence(CGSize(width: 402, height: 708)))
        XCTAssertGreaterThan(RoomFit.presence(CGSize(width: 440, height: 860)), RoomFit.presence(CGSize(width: 402, height: 708)))
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
        guard case .bot(.child(let event, _), _) = rows[1] else { return XCTFail("BB's message is a card") }
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
        XCTAssertEqual(DuoPages(window: CGSize(width: 669, height: 951), phone: true), .stacked)
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
