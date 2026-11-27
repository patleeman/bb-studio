import XCTest
@testable import BBStudio

/// What is left of the Attention Router on iOS: old `::loop` and `::work`
/// cards render read-only, `::loops{…}` renders nothing, and an older
/// Studio's lock-screen buttons still run (`tasks.act`, else `loops.act`).
@MainActor
final class LoopsTests: XCTestCase {
    // MARK: Directives

    func testParsesLoopDirectives() {
        XCTAssertEqual(Directive(line: #"::loop{id="loop_abc-1"}"#).flatMap(LoopDirective.init), .card(id: "loop_abc-1"))
        XCTAssertEqual(Directive(line: #"::loop{id="loop_a" row="1"}"#).flatMap(LoopDirective.init), .row(id: "loop_a"))
        XCTAssertEqual(Directive(line: #"::work{id="wc_1"}"#).flatMap(LoopDirective.init), .card(id: "wc_1"))
        XCTAssertNil(Directive(line: #"::loops{more="3"}"#).flatMap(LoopDirective.init), "N more in Todos is gone")
        XCTAssertNil(Directive(line: #"::loops{open="pane"}"#).flatMap(LoopDirective.init), "so is opening the list")
        XCTAssertNil(Directive(line: #"::loop{id="bad id"}"#).flatMap(LoopDirective.init))
        XCTAssertNil(Directive(line: #"::loop{}"#).flatMap(LoopDirective.init))
        XCTAssertNil(Directive(line: #"::page{id="pg_1"}"#).flatMap(LoopDirective.init))
    }

    func testFindsLoopsOutsideCodeOnly() {
        let text = "Here:\n::loop{id=\"loop_1\"}\n```\n::loop{id=\"loop_code\"}\n```\n  ::loop{id=\"loop_2\"}  "
        XCTAssertEqual(LoopDirective.all(in: text), [.card(id: "loop_1"), .card(id: "loop_2")])
        XCTAssertFalse(LoopDirective.isMorning(LoopDirective.all(in: text)))
        XCTAssertTrue(LoopDirective.isMorning(LoopDirective.all(in: LoopsDemo.morningText)))
        XCTAssertFalse(LoopDirective.isMorning(LoopDirective.all(in: "Done.\n::loops{more=\"3\"}")), "a lone ::loops line is no morning card")
    }

    func testSplitsAReplyIntoBubblesAndCards() {
        let parts = LoopMessage.parts("Closed it.\n\n::loop{id=\"loop_v\"}\n\nAnything else?")
        XCTAssertEqual(parts, [.text("Closed it."), .card("loop_v"), .text("Anything else?")])
        XCTAssertEqual(LoopMessage.parts("::loop{id=\"loop_v\"}"), [.card("loop_v")])
    }

    func testMarkdownRendersOldCardsAndDropsTheListLinks() {
        let blocks = MarkdownBlock.parse("Before\n::loop{id=\"loop_md\"}\n::loops{more=\"2\"}\n::loops{open=\"pane\"}")
        let loops = blocks.compactMap { block -> LoopDirective? in if case .loop(let loop) = block { loop } else { nil } }
        XCTAssertEqual(loops, [.card(id: "loop_md")], "::loops lines render nothing")
        XCTAssertEqual(blocks.count, 2, "the paragraph and the card")
    }

    func testParsesTheMorningCardShapeWithoutTheTodosLink() {
        let parsed = MorningCard.parse(LoopsDemo.morningText)
        XCTAssertEqual(parsed.title, "Monday, Nov 2")
        XCTAssertEqual(parsed.sections.map(\.title), ["Calendar", "On today's list", "Good to know"])
        XCTAssertEqual(parsed.sections[0].lines.first, .event(time: "9:30 AM", text: "Standup · Zoom"))
        XCTAssertEqual(parsed.sections[1].lines.first, .loop("loop_tax"))
        XCTAssertEqual(parsed.sections[1].lines.last, .loop("loop_vendor"), "no N more in Todos")
        XCTAssertEqual(parsed.sections[2].lines, [.text("Rain from 3 PM. Take an umbrella."), .text("Mom's birthday is Saturday.")])
    }

    func testOptionsSplitIntoTitleAndDetail() {
        let option = LoopOption("Bayside Decks · $4,200 · starts Nov 9")
        XCTAssertEqual(option.title, "Bayside Decks")
        XCTAssertEqual(option.detail, "$4,200 · starts Nov 9")
        XCTAssertEqual(LoopOption("Yes").title, "Yes")
        XCTAssertNil(LoopOption("Yes").detail)
    }

    func testSnoozePresetTimes() throws {
        var calendar = Calendar(identifier: .gregorian)
        calendar.timeZone = try XCTUnwrap(TimeZone(identifier: "America/New_York"))
        // Wednesday 2026-11-04 14:00 New York.
        let now = try XCTUnwrap(calendar.date(from: DateComponents(year: 2026, month: 11, day: 4, hour: 14)))
        func hm(_ date: Date?) -> [Int] { [calendar.component(.weekday, from: date!), calendar.component(.hour, from: date!)] }
        XCTAssertEqual(LoopSnooze.laterToday.date(now: now, calendar: calendar), now.addingTimeInterval(3 * 3600))
        XCTAssertEqual(hm(LoopSnooze.tonight.date(now: now, calendar: calendar)), [4, 19])
        XCTAssertEqual(hm(LoopSnooze.tomorrow.date(now: now, calendar: calendar)), [5, 8])
        XCTAssertEqual(hm(LoopSnooze.weekend.date(now: now, calendar: calendar)), [7, 10])
        XCTAssertNil(LoopSnooze.home.date(now: now, calendar: calendar))
        XCTAssertEqual(LoopSnooze.presets.map(\.preset), [.later_today, .tonight, .tomorrow_morning, .this_weekend, .home])
    }

    func testEventWords() {
        XCTAssertEqual(LoopFormat.event("reply:sam"), "When Sam replies")
        XCTAssertEqual(LoopFormat.event("done:the build"), "When the build is done")
    }

    // MARK: An older Studio's lock-screen buttons

    func testNotificationCategoriesStayRegistered() {
        XCTAssertEqual(LoopCategories.identifier(kind: "do", options: []), "BB_LOOP.do")
        XCTAssertEqual(LoopCategories.identifier(kind: nil, options: []), "BB_LOOP")
        XCTAssertEqual(LoopCategories.identifier(kind: "decide", options: ["A", "B", "C", "D"]), "BB_LOOP.decide.A\u{1F}B\u{1F}C")
        XCTAssertEqual(LoopCategories.actions(kind: "do", options: []).map(\.title), ["Done", "Snooze until tonight", "Snooze until I'm home"])
        // None of them opens the app: iOS runs the handler in the background.
        XCTAssertTrue(LoopCategories.actions(kind: nil, options: []).allSatisfy { !$0.options.contains(.foreground) })
        let fixed = Set(LoopCategories.fixed().map(\.identifier))
        XCTAssertEqual(fixed, ["BB_LOOP", "BB_LOOP.do", "BB_LOOP.read", "BB_LOOP.waiting", "BB_LOOP.decide"])
        XCTAssertTrue(NotificationActions.categories().contains { $0.identifier == "BB_LOOP" }, "an older Studio's pushes still render")
    }

    func testNotificationButtonsMapToActions() {
        XCTAssertEqual(LoopNotifications.action(LoopCategories.done, options: []), .done)
        XCTAssertEqual(LoopNotifications.action(LoopCategories.gotIt, options: []), .gotIt)
        XCTAssertEqual(LoopNotifications.action(LoopCategories.snoozeTonight, options: []), .snooze(.tonight))
        XCTAssertEqual(LoopNotifications.action(LoopCategories.snoozeHome, options: []), .snooze(.home))
        XCTAssertEqual(LoopNotifications.action("BB_LOOP_CHOOSE_1", options: ["A", "B"]), .choose("B"))
        XCTAssertNil(LoopNotifications.action("BB_LOOP_CHOOSE_5", options: ["A"]))
        XCTAssertNil(LoopNotifications.action("BB_APPROVE", options: []))
        XCTAssertEqual(LoopNotifications.taskAction(.snooze(.home)), .snooze(.home))
        XCTAssertNil(LoopNotifications.taskAction(.nudge))
    }

    func testAToDoPushNamesItsConversation() {
        let route = NotificationActions.taskRoute(["loopId": "wc_1", "conversationId": "thr_launch", "threadId": "thr_main"])
        XCTAssertEqual(route?.id, "wc_1")
        XCTAssertEqual(route?.conversation, "thr_launch", "a tap opens the conversation")
        XCTAssertNil(NotificationActions.taskRoute(["threadId": "thr_main"]), "a push without a to-do opens its thread as any push does")
    }
}
