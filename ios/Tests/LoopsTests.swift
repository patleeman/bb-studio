import CoreLocation
import XCTest
@testable import BBStudio

/// The Attention Router on iOS: `::loop` directives, the card's state
/// machine, lock-screen buttons, place monitoring and the `loops.*` bodies.
@MainActor
final class LoopsTests: XCTestCase {
    // MARK: Directives

    func testParsesLoopDirectives() {
        XCTAssertEqual(Directive(line: #"::loop{id="loop_abc-1"}"#).flatMap(LoopDirective.init), .card(id: "loop_abc-1"))
        XCTAssertEqual(Directive(line: #"::loop{id="loop_a" row="1"}"#).flatMap(LoopDirective.init), .row(id: "loop_a"))
        XCTAssertEqual(Directive(line: #"::loops{more="3"}"#).flatMap(LoopDirective.init), .more(3))
        XCTAssertNil(Directive(line: #"::loops{more="0"}"#).flatMap(LoopDirective.init))
        XCTAssertNil(Directive(line: #"::loop{id="bad id"}"#).flatMap(LoopDirective.init))
        XCTAssertNil(Directive(line: #"::loop{}"#).flatMap(LoopDirective.init))
        XCTAssertNil(Directive(line: #"::page{id="pg_1"}"#).flatMap(LoopDirective.init))
    }

    func testFindsLoopsOutsideCodeOnly() {
        let text = "Here:\n::loop{id=\"loop_1\"}\n```\n::loop{id=\"loop_code\"}\n```\n  ::loop{id=\"loop_2\"}  "
        XCTAssertEqual(LoopDirective.all(in: text), [.card(id: "loop_1"), .card(id: "loop_2")])
        XCTAssertFalse(LoopDirective.isMorning(LoopDirective.all(in: text)))
        XCTAssertTrue(LoopDirective.isMorning(LoopDirective.all(in: LoopsDemo.morningText)))
    }

    func testSplitsAReplyIntoBubblesAndCards() {
        let parts = LoopMessage.parts("Closed it.\n\n::loop{id=\"loop_v\"}\n\nAnything else?")
        XCTAssertEqual(parts, [.text("Closed it."), .card("loop_v"), .text("Anything else?")])
        XCTAssertEqual(LoopMessage.parts("::loop{id=\"loop_v\"}"), [.card("loop_v")])
    }

    func testMarkdownRendersLoopBlocks() {
        let blocks = MarkdownBlock.parse("Before\n::loop{id=\"loop_md\"}\n::loops{more=\"2\"}")
        let loops = blocks.compactMap { block -> LoopDirective? in if case .loop(let loop) = block { loop } else { nil } }
        XCTAssertEqual(loops, [.card(id: "loop_md"), .more(2)])
    }

    func testParsesTheMorningCardShape() {
        let parsed = MorningCard.parse(LoopsDemo.morningText)
        XCTAssertEqual(parsed.title, "Monday, Nov 2")
        XCTAssertEqual(parsed.sections.map(\.title), ["Calendar", "On today's list", "Good to know"])
        XCTAssertEqual(parsed.sections[0].lines.first, .event(time: "9:30 AM", text: "Standup · Zoom"))
        XCTAssertEqual(parsed.sections[1].lines.first, .loop("loop_tax"))
        XCTAssertEqual(parsed.sections[1].lines.last, .more(3))
        XCTAssertEqual(parsed.sections[2].lines, [.text("Rain from 3 PM. Take an umbrella."), .text("Mom's birthday is Saturday.")])
    }

    // MARK: Card state

    private func loop(kind: String = "do", options: [String] = [], owner: String = "patrick", status: String = "surfaced",
                      closedAt: Double? = nil, closedBy: String? = nil, updatedAt: Double = Date().milliseconds) throws -> LoopItem {
        var object: [String: Any] = ["id": "loop_t", "title": "T", "why": "", "source": NSNull(), "kind": kind, "options": options, "owner": owner,
                                     "trigger": ["type": "none"], "priority": "normal", "push": false, "status": status, "due": NSNull(),
                                     "area": NSNull(), "createdAt": 1, "updatedAt": updatedAt]
        object["closedAt"] = closedAt ?? NSNull()
        object["closedBy"] = closedBy ?? NSNull()
        let data = try JSONSerialization.data(withJSONObject: object)
        return LoopItem(try JSONDecoder().decode(Studio.LoopsGetOutputLoop.self, from: data))
    }

    func testDiscussDraftsTheLoopsLineAndTitle() throws {
        var item = try loop()
        item.title = "Reply to Sam\n about the  planning doc"
        XCTAssertEqual(LoopFormat.discussDraft(item), "::loop{id=\"loop_t\"}\nAbout: Reply to Sam about the planning doc\n")
        XCTAssertEqual(Directive(line: "::loop{id=\"loop_t\"}").flatMap(LoopDirective.init), .card(id: "loop_t"))
    }

    func testPhasesFollowTheSettingAndTheLoop() throws {
        XCTAssertEqual(LoopCardState(enabled: false, loop: try loop()).phase, .off)
        XCTAssertEqual(LoopCardState(enabled: nil, loop: nil).phase, .loading)
        XCTAssertEqual(LoopCardState(enabled: true, loop: nil, failure: "gone").phase, .missing("gone"))
        XCTAssertEqual(LoopCardState(enabled: true, loop: try loop()).phase, .open)
        XCTAssertEqual(LoopCardState(enabled: true, loop: try loop(owner: "cos", status: "in_progress")).phase, .handedOff)
        XCTAssertEqual(LoopCardState(enabled: true, loop: try loop(status: "snoozed")).phase, .waiting)
        XCTAssertEqual(LoopCardState(enabled: true, loop: try loop(status: "done", closedAt: 1, closedBy: "patrick")).phase, .closed)
    }

    func testButtonsByKindOnThePhoneAndWide() throws {
        let doCard = LoopCardState(enabled: true, loop: try loop())
        XCTAssertEqual(doCard.buttons(wide: false).shown, [.done, .snooze])
        XCTAssertEqual(doCard.buttons(wide: false).more, [.handOff, .drop])
        XCTAssertEqual(doCard.buttons(wide: true).shown, [.done, .snooze, .handOff, .drop])
        let decide = LoopCardState(enabled: true, loop: try loop(kind: "decide", options: ["A", "B · cheap"]))
        XCTAssertEqual(decide.buttons(wide: false).shown, [.option("A"), .option("B · cheap"), .snooze])
        let many = LoopCardState(enabled: true, loop: try loop(kind: "decide", options: ["A", "B", "C", "D"]))
        XCTAssertEqual(many.buttons(wide: false).shown, [.chooseSheet, .snooze])
        XCTAssertEqual(LoopCardState(enabled: true, loop: try loop(kind: "read")).buttons(wide: false).shown, [.gotIt])
        XCTAssertEqual(LoopCardState(enabled: true, loop: try loop(kind: "waiting")).buttons(wide: false).shown, [.nudge, .drop])
        let stale = LoopCardState(enabled: true, loop: try loop(updatedAt: Date().addingTimeInterval(-4 * 86_400).milliseconds))
        XCTAssertEqual(stale.buttons(wide: false).more.first, .keep)
        XCTAssertEqual(LoopCardState(enabled: true, loop: try loop(owner: "cos")).buttons(wide: false).shown, [])
    }

    func testActionsRunOneAtATimeAndCollapse() throws {
        var state = LoopCardState(enabled: true, loop: try loop(kind: "decide", options: ["Hudson Carpentry · $3,650"]))
        XCTAssertTrue(state.begin(.choose("Hudson Carpentry · $3,650")))
        XCTAssertFalse(state.begin(.drop), "A second tap waits for the first")
        state.finish(.choose("Hudson Carpentry · $3,650"), loop: try loop(kind: "decide", status: "done", closedAt: 2, closedBy: "patrick"))
        XCTAssertEqual(state.phase, .closed)
        XCTAssertEqual(state.closedLabel, "Hudson Carpentry")
        XCTAssertTrue(state.canUndo)
        XCTAssertTrue(state.begin(.undo))
        state.finish(.undo, loop: try loop(kind: "decide"))
        XCTAssertEqual(state.phase, .open)
        XCTAssertNil(state.chosen)
        XCTAssertTrue(state.begin(.done))
        state.fail("Offline")
        XCTAssertEqual(state.error, "Offline")
        XCTAssertNil(state.pending)
        XCTAssertFalse(LoopCardState(enabled: true, loop: try loop(status: "done", closedAt: 1, closedBy: "cos")).canUndo)
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

    // MARK: Requests

    func testActionsBecomeContractRequests() throws {
        func body(_ action: LoopAction) -> (String, JSONValue)? { LoopRequests.request("loop_1", action).map { ($0.method, $0.body) } }
        XCTAssertEqual(body(.done)?.0, "loops.act")
        XCTAssertEqual(body(.done)?.1, .object(["id": .string("loop_1"), "action": .string("done")]))
        XCTAssertEqual(body(.snooze(.tonight))?.1, .object(["id": .string("loop_1"), "action": .string("snooze"), "snooze": .string("tonight")]))
        XCTAssertEqual(body(.handOff(owner: "thread:thr_k"))?.1["owner"], .string("thread:thr_k"))
        XCTAssertEqual(body(.choose("A"))?.1["option"], .string("A"))
        XCTAssertEqual(body(.takeBack)?.0, "loops.update")
        XCTAssertEqual(body(.takeBack)?.1["changes"], .object(["owner": .string("patrick"), "status": .string("surfaced")]))
        XCTAssertEqual(body(.undo)?.1["changes"], .object(["status": .string("surfaced")]))
        XCTAssertEqual(body(.snooze(.at(Date(milliseconds: 1_000))))?.1["changes"]?["trigger"], .object(["type": .string("time"), "at": .number(1_000)]))
        XCTAssertNil(body(.nudge), "Nudge only drafts")
        XCTAssertEqual(LoopRequests.trigger("loop_1", .place("Home", arrive: false), push: true)["changes"],
                       .object(["trigger": .object(["type": .string("place"), "place": .string("Home"), "direction": .string("leave")]),
                                "push": .bool(true), "status": .string("queued")]))
        // Only a name and a direction reach Studio.
        XCTAssertEqual(LoopRequests.place("Home", arrive: true), .object(["place": .string("Home"), "direction": .string("arrive")]))
        XCTAssertEqual(LoopRequests.setPlaces(["Home", "Gym"]), .object(["names": .array([.string("Home"), .string("Gym")])]))
    }

    func testAreaChipsComeFromTheLoops() throws {
        let item = { (id: String, area: String) in #"{"id":"\#(id)","title":"T","why":"","source":null,"kind":"do","options":[],"owner":"patrick","trigger":{"type":"none"},"priority":"normal","push":false,"status":"surfaced","due":null,"area":"\#(area)","createdAt":1,"updatedAt":2,"closedAt":null,"closedBy":null}"# }
        let listed = #"{"needsYouNow":[\#(item("loop_a", "Alpha")),\#(item("loop_b", "Beta"))],"comingUp":[],"agentsOnIt":[],"waitingOnOthers":[],"done":[],"areas":["Alpha","Beta"]}"#
        XCTAssertEqual(try JSONDecoder().decode(LoopGroups.self, from: Data(listed.utf8)).areas, ["Alpha", "Beta"])
        let derived = #"{"needsYouNow":[\#(item("loop_a", "Alpha")),\#(item("loop_b", "Beta")),\#(item("loop_c", "Beta")),\#(item("loop_d", " "))],"comingUp":[],"agentsOnIt":[],"waitingOnOthers":[],"done":[]}"#
        XCTAssertEqual(try JSONDecoder().decode(LoopGroups.self, from: Data(derived.utf8)).areas, ["Beta", "Alpha"])
        XCTAssertEqual(LoopGroups.empty.areas, [])
    }

    func testClientDecodesGroupsAndActs() async throws {
        let client = BBClient(baseURL: URL(string: "https://loops.invalid")!)
        final class Seen: @unchecked Sendable { var calls: [(String, JSONValue)] = [] }
        let seen = Seen()
        let groups = #"{"needsYouNow":[{"id":"loop_a","title":"A","why":"","source":null,"kind":"decide","options":["X","Y"],"owner":"patrick","trigger":{"type":"none"},"priority":"urgent","push":true,"status":"surfaced","due":1700000000000,"area":"Home","createdAt":1,"updatedAt":2,"closedAt":null,"closedBy":null}],"comingUp":[{"id":"loop_b","title":"B","why":"","source":{"kind":"email","ref":"m1"},"kind":"do","options":[],"owner":"patrick","trigger":{"type":"place","place":"home","direction":"arrive"},"priority":"normal","push":false,"status":"queued","due":null,"area":null,"createdAt":1,"updatedAt":2,"closedAt":null,"closedBy":null}],"agentsOnIt":[],"waitingOnOthers":[],"done":[]}"#
        client.transport = { method, path, body in
            let input = try JSONDecoder().decode(JSONValue.self, from: XCTUnwrap(body))
            seen.calls.append((path, input))
            if path.hasSuffix("loops.list") { return (200, Data(#"{"ok":true,"result":\#(groups)}"#.utf8)) }
            let loop = #"{"id":"loop_a","title":"A","why":"","source":null,"kind":"decide","options":["X","Y"],"owner":"patrick","trigger":{"type":"none"},"priority":"normal","push":false,"status":"done","due":null,"area":null,"createdAt":1,"updatedAt":3,"closedAt":3,"closedBy":"patrick"}"#
            return (200, Data(#"{"ok":true,"result":\#(loop)}"#.utf8))
        }
        let list = try await client.loops()
        XCTAssertEqual(list.needsYouNow.first?.kind, .decide)
        XCTAssertEqual(list.needsYouNow.first?.priority, .urgent)
        XCTAssertEqual(list.comingUp.first?.trigger, .place("home", arrive: true))
        XCTAssertEqual(list.comingUp.first?.source?.kind, "email")
        // The generated contract reads the same payload.
        let generated = try JSONDecoder().decode(Studio.LoopsListOutput.self, from: Data(groups.utf8))
        XCTAssertEqual(generated.needsYouNow?.first?.id, "loop_a")
        let closed = try await client.loopAction("loop_a", .choose("Y"))
        XCTAssertEqual(closed?.isClosed, true)
        XCTAssertEqual(seen.calls.last?.0, "/api/v1/plugins/studio/rpc/loops.act")
        XCTAssertEqual(seen.calls.last?.1, .object(["id": .string("loop_a"), "action": .string("choose"), "option": .string("Y")]))
    }

    // MARK: Notifications

    func testNotificationCategoriesByKind() {
        XCTAssertEqual(LoopCategories.identifier(kind: "do", options: []), "BB_LOOP.do")
        XCTAssertEqual(LoopCategories.identifier(kind: nil, options: []), "BB_LOOP")
        XCTAssertEqual(LoopCategories.identifier(kind: "decide", options: ["A", "B", "C", "D"]), "BB_LOOP.decide.A\u{1F}B\u{1F}C")
        XCTAssertEqual(LoopCategories.actions(kind: "do", options: []).map(\.title), ["Done", "Snooze until tonight", "Snooze until I'm home"])
        XCTAssertEqual(LoopCategories.actions(kind: "read", options: []).map(\.title), ["Got it", "Snooze until tonight"])
        XCTAssertEqual(LoopCategories.actions(kind: nil, options: []).map(\.title), ["Done", "Snooze until tonight", "Snooze until I'm home", "Got it"])
        XCTAssertEqual(LoopCategories.actions(kind: "decide", options: ["A", "B", "C", "D"]).map(\.title), ["A", "B", "C", "Snooze until tonight"])
        // None of them opens the app: iOS runs the handler in the background.
        XCTAssertTrue(LoopCategories.actions(kind: nil, options: []).allSatisfy { !$0.options.contains(.foreground) })
        let fixed = Set(LoopCategories.fixed().map(\.identifier))
        XCTAssertEqual(fixed, ["BB_LOOP", "BB_LOOP.do", "BB_LOOP.read", "BB_LOOP.waiting", "BB_LOOP.decide"])
        XCTAssertTrue(NotificationActions.categories().contains { $0.identifier == "BB_LOOP" })
    }

    func testNotificationButtonsMapToLoopActions() {
        XCTAssertEqual(LoopNotifications.action(LoopCategories.done, options: []), .done)
        XCTAssertEqual(LoopNotifications.action(LoopCategories.gotIt, options: []), .gotIt)
        XCTAssertEqual(LoopNotifications.action(LoopCategories.snoozeTonight, options: []), .snooze(.tonight))
        XCTAssertEqual(LoopNotifications.action(LoopCategories.snoozeHome, options: []), .snooze(.home))
        XCTAssertEqual(LoopNotifications.action("BB_LOOP_CHOOSE_1", options: ["A", "B"]), .choose("B"))
        XCTAssertNil(LoopNotifications.action("BB_LOOP_CHOOSE_5", options: ["A"]))
        XCTAssertNil(LoopNotifications.action("BB_APPROVE", options: []))
    }

    // MARK: Places

    private final class MockRegions: RegionMonitoring {
        var delegate: (any CLLocationManagerDelegate)?
        var authorizationStatus: CLAuthorizationStatus = .notDetermined
        var monitoredRegions: Set<CLRegion> = []
        var requests: [String] = []
        func startMonitoring(for region: CLRegion) { monitoredRegions.insert(region) }
        func stopMonitoring(for region: CLRegion) { monitoredRegions.remove(region) }
        func requestWhenInUseAuthorization() { requests.append("whenInUse") }
        func requestAlwaysAuthorization() { requests.append("always") }
        func requestLocation() { requests.append("location") }
    }

    private func places() -> PlacesStore {
        let suite = "loops-tests-\(UUID().uuidString)"
        return PlacesStore(defaults: UserDefaults(suiteName: suite)!, changed: {})
    }

    private func settle(_ condition: () -> Bool) async {
        for _ in 0..<200 where !condition() { try? await Task.sleep(for: .milliseconds(10)) }
    }

    func testMonitorWatchesExactlyTheSavedPlaces() async {
        let store = places()
        let mock = MockRegions()
        let foreign = CLCircularRegion(center: .init(latitude: 1, longitude: 1), radius: 100, identifier: "other.app.region")
        mock.monitoredRegions = [foreign]
        let monitor = PlaceMonitor(makeManager: { mock }, store: { store }, send: { _, _ in }, sendNames: { _ in })
        store.save(Place(id: "h", name: "Home", kind: .home, latitude: 40.7, longitude: -73.9, radius: 150))
        store.save(Place(id: "g", name: "Gym", kind: .saved, latitude: 40.8, longitude: -73.8, radius: 100))
        monitor.sync()
        XCTAssertTrue(mock.delegate === monitor)
        XCTAssertEqual(Set(mock.monitoredRegions.map(\.identifier)), ["other.app.region", "bb.place.h", "bb.place.g"])
        let home = mock.monitoredRegions.first { $0.identifier == "bb.place.h" } as? CLCircularRegion
        XCTAssertEqual(home?.radius, 150)
        XCTAssertEqual(home?.notifyOnEntry, true)
        XCTAssertEqual(home?.notifyOnExit, true)
        // A moved place is watched again; a removed one stops.
        store.save(Place(id: "h", name: "Home", kind: .home, latitude: 40.7, longitude: -73.9, radius: 300))
        store.remove(Place(id: "g", name: "Gym", kind: .saved, latitude: 0, longitude: 0))
        monitor.sync()
        XCTAssertEqual(Set(mock.monitoredRegions.map(\.identifier)), ["other.app.region", "bb.place.h"])
        XCTAssertEqual((mock.monitoredRegions.first { $0.identifier == "bb.place.h" } as? CLCircularRegion)?.radius, 300)
        // Place triggers off: nothing of ours is watched.
        store.enabled = false
        monitor.sync()
        XCTAssertEqual(Set(mock.monitoredRegions.map(\.identifier)), ["other.app.region"])
    }

    func testRegionEventsSendOnlyTheNameAndRetry() async {
        let store = places()
        store.save(Place(id: "o", name: "Office", kind: .office, latitude: 40.7, longitude: -73.9))
        var sent: [(String, Bool)] = []
        var failing = true
        let monitor = PlaceMonitor(makeManager: { MockRegions() }, store: { store }, send: { name, arrive in
            if failing { throw URLError(.notConnectedToInternet) }
            sent.append((name, arrive))
        }, sendNames: { _ in })
        monitor.handle(regionId: "bb.place.o", arrive: false)
        await settle { monitor.unsent.count == 1 && sent.isEmpty }
        XCTAssertEqual(monitor.unsent.map(\.name), ["Office"], "Kept until Studio hears it")
        failing = false
        monitor.handle(regionId: "bb.place.o", arrive: true)
        await settle { sent.count == 2 }
        XCTAssertEqual(sent.map(\.0), ["Office", "Office"])
        XCTAssertEqual(sent.map(\.1), [false, true])
        XCTAssertTrue(monitor.unsent.isEmpty)
        monitor.handle(regionId: "other.app.region", arrive: true)
        monitor.handle(regionId: "bb.place.unknown", arrive: true)
        XCTAssertTrue(monitor.unsent.isEmpty)
    }

    func testLocationAccessTakesTwoSteps() {
        let mock = MockRegions()
        let monitor = PlaceMonitor(makeManager: { mock }, store: { self.places() }, send: { _, _ in }, sendNames: { _ in })
        monitor.requestAccess()
        XCTAssertEqual(mock.requests, ["whenInUse"])
        mock.authorizationStatus = .authorizedWhenInUse
        monitor.requestAccess()
        XCTAssertEqual(mock.requests, ["whenInUse", "always"])
        mock.authorizationStatus = .authorizedAlways
        monitor.requestAccess()
        XCTAssertEqual(mock.requests, ["whenInUse", "always"])
        XCTAssertEqual(PlaceMonitor.access(.denied), .denied)
        XCTAssertEqual(PlaceMonitor.access(.notDetermined), .notAsked)
    }

    func testPlacesKeepOneHomeAndAtMostTwenty() {
        let store = places()
        store.save(Place(name: "Home", kind: .home, latitude: 1, longitude: 1))
        store.save(Place(name: "Home", kind: .home, latitude: 2, longitude: 2))
        XCTAssertEqual(store.places.count, 1)
        XCTAssertEqual(store.home?.latitude, 2)
        for index in 0..<30 { store.save(Place(name: "P\(index)", kind: .saved, latitude: 1, longitude: 1)) }
        XCTAssertEqual(store.places.count, PlacesStore.limit)
        XCTAssertTrue(store.isFull)
        store.save(Place(name: "  ", kind: .saved, latitude: 1, longitude: 1))
        XCTAssertEqual(store.places.count, PlacesStore.limit)
    }

    // MARK: Words

    func testTriggerWords() {
        XCTAssertEqual(LoopFormat.trigger(.place("home", arrive: true)), "When you get home")
        XCTAssertEqual(LoopFormat.trigger(.place("office", arrive: false)), "When you leave the office")
        XCTAssertEqual(LoopFormat.trigger(.event("reply:sam")), "When Sam replies")
        XCTAssertEqual(LoopFormat.trigger(.none), "At the next good moment")
    }

    // MARK: The Bot's ⋯ menu

    func testMenuBadgeShowsOnlyWhileLoopsNeedYou() {
        XCTAssertEqual(BotLoopsMenu.badge(loopsOn: true, count: 6), 6)
        XCTAssertEqual(BotLoopsMenu.badge(loopsOn: true, count: 0), 0, "Hidden at 0")
        XCTAssertEqual(BotLoopsMenu.badge(loopsOn: false, count: 6), 0, "No badge with Loops off")
        XCTAssertEqual(BotLoopsMenu.badge(loopsOn: true, count: -1), 0)
    }

    func testMenuItemAndLabelCarryTheCount() {
        XCTAssertEqual(BotLoopsMenu.title(count: 6), "Todos  6")
        XCTAssertEqual(BotLoopsMenu.title(count: 0), "Todos")
        XCTAssertEqual(BotLoopsMenu.accessibilityLabel(name: "Juniper", badge: 0), "Juniper options")
        XCTAssertEqual(BotLoopsMenu.accessibilityLabel(name: "Juniper", badge: 1), "Juniper options, 1 todo needs you")
        XCTAssertEqual(BotLoopsMenu.accessibilityLabel(name: "Juniper", badge: 6), "Juniper options, 6 todos need you")
    }
}
