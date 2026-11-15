import XCTest
@testable import BBStudio

@MainActor
final class TasksTests: XCTestCase {
    private let now = Date(timeIntervalSince1970: 1_800_000_000)

    private func task(_ id: String = "task_1", owner: String = "patrick", state: TaskItem.State = .todo, kind: TaskItem.Kind = .do,
                      options: [String] = [], needs: String? = nil, due: Date? = nil, queue: String? = "surfaced", stale: Bool = false,
                      automation: TaskItem.Automation? = nil, card: String? = nil, created: Date? = nil) -> TaskItem {
        var t = TaskItem(id: id, title: "T \(id)", owner: owner, state: state, kind: kind, options: options, needs: needs, due: due, queue: queue,
                         cardKind: card, automation: automation, stale: stale, createdAt: created ?? now.addingTimeInterval(-3600))
        if [.done, .dropped, .failed].contains(state) { t.closedAt = now.addingTimeInterval(-60) }
        return t
    }

    func testDecodesTheServersTaskList() throws {
        let json = #"""
        {"tasks":[{"id":"wc_1","title":"Fork","why":"","owner":"thread:thr_w","state":"in_progress","kind":"do","options":[],"needs":null,"priority":"urgent",
          "conversation":"thr_main","project":null,"area":null,"timing":{"due":null,"trigger":{"type":"time","at":1800000000000},"snoozed":false},
          "attention":{"queue":null,"push":false},"progress":{"step":"3/5","line":"Tests"},"workers":["thr_w"],"outputs":[],"source":null,"parentId":null,
          "schedule":null,"card":{"kind":"worker","messageId":null,"messageSeq":null,"dismissedAt":null},
          "automation":{"id":"aut","kind":"watcher","role":"finding","count":3,"severity":"critical"},"stale":true,"origin":"work",
          "createdAt":1,"updatedAt":2,"closedAt":null,"closedBy":null}],
         "threads":[{"owner":"thread:thr_w","name":"Fork worker","threadId":"thr_w"}],"held":[]}
        """#
        let list = try JSONDecoder().decode(TaskList.self, from: Data(json.utf8))
        let t = try XCTUnwrap(list.tasks.first)
        XCTAssertEqual(t.owner, "thread:thr_w")
        XCTAssertEqual(t.state, .inProgress)
        XCTAssertEqual(t.priority, .urgent)
        XCTAssertEqual(t.conversation, "thr_main")
        XCTAssertEqual(t.step, "3/5")
        XCTAssertEqual(t.cardKind, "worker")
        XCTAssertEqual(t.automation?.severity, "critical")
        XCTAssertEqual(t.automation?.count, 3)
        XCTAssertTrue(t.stale)
        XCTAssertEqual(t.trigger, .time(Date(milliseconds: 1_800_000_000_000)))
        XCTAssertEqual(list.threads, [TaskThreadName(owner: "thread:thr_w", name: "Fork worker", threadId: "thr_w")])
    }

    func testStatusFollowsTheDesktop() {
        XCTAssertEqual(TaskRules.status(task(state: .waiting, needs: "Pick")).id, "needs-you")
        XCTAssertEqual(TaskRules.status(task(state: .waiting, kind: .waitingOutside)).id, "waiting-outside")
        XCTAssertEqual(TaskRules.status(task()).id, "todo")
        var snoozed = task()
        snoozed.snoozed = true
        XCTAssertEqual(TaskRules.status(snoozed).id, "snoozed")
        XCTAssertEqual(TaskRules.status(task(owner: "cos", state: .inProgress)).id, "running")
        XCTAssertEqual(TaskRules.status(task(owner: "cos", state: .todo)).id, "scheduled")
        XCTAssertEqual(TaskRules.status(task(owner: "thread:t", state: .waiting)).id, "waiting")
        let ended = TaskRules.status(task(owner: "thread:t", state: .inProgress, stale: true))
        XCTAssertEqual(ended.id, "ended")
        XCTAssertEqual(ended.label, "Ended")
        XCTAssertTrue(ended.stale)
        XCTAssertEqual(TaskRules.status(task(state: .failed)).label, "Failed")
        XCTAssertEqual(TaskRules.status(task(state: .dropped)).label, "Dismissed")
        XCTAssertEqual(TaskRules.status(task(state: .done)).label, "Done")
        var recurring = task(owner: "cos", state: .inProgress, automation: .init(kind: "checkin", role: "schedule", count: 0))
        XCTAssertEqual(TaskRules.status(recurring).label, "Active")
        recurring.schedulePaused = true
        XCTAssertEqual(TaskRules.status(recurring).label, "Paused")
    }

    func testKindAndSeverity() {
        XCTAssertEqual(TaskRules.kind(task(card: "worker")).label, "Worker")
        XCTAssertEqual(TaskRules.kind(task(kind: .decide)).label, "Decide")
        XCTAssertEqual(TaskRules.kind(task(automation: .init(kind: "watcher", role: "finding", count: 2))).label, "Finding")
        XCTAssertEqual(TaskRules.kind(task(automation: .init(kind: "runner", role: "run", count: 0))).label, "Run")
        XCTAssertEqual(TaskRules.severity(task(automation: .init(kind: "watcher", role: "finding", count: 2, severity: "critical")))?.label, "Critical")
        XCTAssertEqual(TaskRules.severity(task(automation: .init(kind: "watcher", role: "finding", count: 2, severity: "warn")))?.tone, .warning)
        XCTAssertNil(TaskRules.severity(task()))
    }

    func testSectionsPutNeedsYouFirstInToday() {
        let calendar = Calendar(identifier: .gregorian)
        let tasks = [
            task("a", queue: "surfaced", created: now.addingTimeInterval(-10)),
            task("b", state: .waiting, needs: "Pick", queue: "surfaced", created: now),
            task("c", due: now, queue: "queued"),
            task("d", due: now.addingTimeInterval(4 * 86_400), queue: "queued"),
            task("e", owner: "cos", state: .inProgress, queue: nil),
            task("f", state: .waiting, kind: .waitingOutside),
            task("g", state: .done),
            task("h", owner: "cos", state: .inProgress, automation: .init(kind: "checkin", role: "schedule", count: 0)),
        ]
        let sections = TaskRules.sections(tasks, now: now, calendar: calendar)
        XCTAssertEqual(sections[.today]?.map(\.id), ["b", "c", "a"])
        XCTAssertEqual(sections[.later]?.map(\.id), ["d"])
        XCTAssertEqual(sections[.agents]?.map(\.id), ["e"])
        XCTAssertEqual(sections[.waiting]?.map(\.id), ["f"])
        XCTAssertEqual(sections[.done]?.map(\.id), ["g"])
        XCTAssertEqual(sections[.scheduled]?.map(\.id), ["h"])
        var timed = task("i", owner: "cos", state: .todo, queue: "queued")
        timed.trigger = .time(now.addingTimeInterval(3600))
        XCTAssertEqual(TaskRules.section(timed, now: now, calendar: calendar), .scheduled)
    }

    func testInFlightOrderAndDetail() {
        let order = TaskRules.inFlightOrder([
            task("done", state: .done),
            task("agent", owner: "cos", state: .inProgress),
            task("mine"),
            task("needs", state: .waiting, needs: "Answer"),
        ])
        XCTAssertEqual(order.map(\.id), ["needs", "mine", "agent", "done"])
        var running = task(owner: "cos", state: .inProgress)
        running.step = "2/4"
        running.line = "Tests"
        XCTAssertEqual(TaskRules.detail(running), "2/4 · Tests")
        XCTAssertEqual(TaskRules.detail(task(state: .waiting, needs: "Answer")), "Answer")
        running.state = .done
        XCTAssertEqual(TaskRules.detail(running), "Tests")
    }

    func testRoomLine() {
        XCTAssertEqual(TaskRules.roomLine(task(state: .waiting, needs: "Pick one"), now: now), "Pick one")
        XCTAssertEqual(TaskRules.roomLine(task(due: now), now: now), "Today")
        XCTAssertNil(TaskRules.roomLine(task(kind: .decide, options: ["A", "B"]), now: now))
        let critical = task(state: .waiting, needs: "Check it", automation: .init(kind: "watcher", role: "finding", count: 1, severity: "critical"))
        XCTAssertEqual(TaskRules.roomLine(critical, now: now), "Critical · Check it")
    }

    func testSnoozeOnlyForTheUsersTodos() {
        XCTAssertTrue(task().canSnooze)
        var work = task(card: "worker")
        work.origin = "work"
        XCTAssertFalse(work.canSnooze)
        XCTAssertFalse(task(owner: "cos").canSnooze)
        XCTAssertFalse(task(state: .done).canSnooze)
        XCTAssertTrue(task(automation: .init(kind: "watcher", role: "finding", count: 1)).canSnooze)
    }

    func testNamesAndHandOffTargets() {
        var names = TaskNames(bot: "Juniper", leads: [(id: "thr_lead", title: "Larkspur lead")],
                              threads: [TaskThreadName(owner: "thread:thr_w", name: "Fork worker", threadId: "thr_w"),
                                        TaskThreadName(owner: "thread:thr_gone", name: "Gone", threadId: nil)],
                              botThreadId: "thr_main")
        XCTAssertEqual(names.label("patrick"), "You")
        XCTAssertEqual(names.label("cos"), "Juniper")
        XCTAssertEqual(names.label("thread:thr_main"), "Juniper")
        XCTAssertEqual(names.label("thread:thr_lead"), "Larkspur lead")
        XCTAssertEqual(names.label("thread:thr_w"), "Fork worker")
        var t = task(owner: "thread:thr_w")
        t.workers = ["thr_w", "thr_gone"]
        t.conversation = "thr_main"
        XCTAssertEqual(names.targets(for: t).map(\.owner), ["cos", "thread:thr_lead"])
        t.owner = "patrick"
        XCTAssertEqual(names.targets(for: t).map(\.owner), ["cos", "thread:thr_lead", "thread:thr_w"])
        t.owner = "cos"
        XCTAssertFalse(names.targets(for: t).contains { $0.owner == "cos" })
        t.title = "Fork worker"
        t.owner = "thread:thr_w"
        t.cardKind = "worker"
        XCTAssertEqual(names.short(t), "Its worker")
        names.botThreadId = nil
        XCTAssertEqual(names.threadId("cos"), nil)
    }

    func testHistoryLinesNewestFirst() {
        let names = TaskNames(bot: "Juniper")
        let at = { (s: Double) in Date(timeIntervalSince1970: s) }
        let lines = names.history([
            ("created", at(1), #"{"owner":"cos","by":"cos"}"#),
            ("handed_off", at(2), #"{"owner":"patrick","from":"cos","by":"cos","needs":"Pick one"}"#),
            ("acted", at(3), #"{"action":"choose","option":"A"}"#),
            ("progress", at(3.2), #"{"line":"Chose: A"}"#),
            ("handed_off", at(4), #"{"owner":"patrick","from":"cos","by":"patrick"}"#),
            ("found_again", at(5), #"{"count":3,"line":"$41"}"#),
            ("unknown", at(6), "{}"),
        ])
        XCTAssertEqual(lines.map(\.text), ["Found again (3 times in all): $41", "You took it back from Juniper", "You chose A",
                                           "Juniper handed it to you: Pick one", "Juniper created it"])
    }

    func testActionRequests() {
        func body(_ action: TaskAction) -> [String: JSONValue] {
            guard case .object(let object) = TaskRequests.act("task_9", action) else { return [:] }
            return object
        }
        XCTAssertEqual(body(.handOff("cos"))["action"]?.stringValue, "hand_off")
        XCTAssertEqual(body(.handOff("thread:thr_w"))["to"]?.stringValue, "thread:thr_w")
        XCTAssertEqual(body(.choose("A"))["option"]?.stringValue, "A")
        XCTAssertEqual(body(.takeBack)["action"]?.stringValue, "take_back")
        XCTAssertEqual(body(.reopen)["id"]?.stringValue, "task_9")
        XCTAssertEqual(body(.snooze(.tonight))["snooze"]?.stringValue, "tonight")
        XCTAssertNotNil(body(.snooze(.at(now)))["at"])
        XCTAssertNil(body(.snooze(.at(now)))["snooze"])
        XCTAssertEqual(LoopNotifications.taskAction(.snooze(.home)), .snooze(.home))
        XCTAssertNil(LoopNotifications.taskAction(.nudge))
    }

    func testWorkAndLoopDirectives() {
        XCTAssertEqual(Directive(line: #"::work{id="wc_13f58f01-6922-498f-bbc8-17287a1ae520"}"#).flatMap(LoopDirective.init),
                       .card(id: "wc_13f58f01-6922-498f-bbc8-17287a1ae520"))
        XCTAssertEqual(Directive(line: #"::loop{id="task_auto-aut-0ctdvm7eml" row="2"}"#).flatMap(LoopDirective.init), .row(id: "task_auto-aut-0ctdvm7eml"))
        XCTAssertEqual(Directive(line: #"::work{id="wc_1" row="1"}"#).flatMap(LoopDirective.init), .card(id: "wc_1"))
        XCTAssertEqual(LoopDirective.all(in: "Done.\n\n::work{id=\"wc_1\"}"), [.card(id: "wc_1")])
        XCTAssertEqual(LoopMessage.parts("Hi\n::work{id=\"wc_1\"}\nBye"), [.text("Hi"), .card("wc_1"), .text("Bye")])
    }

    func testPushRouteOpensTheTasksConversation() {
        let route = NotificationActions.taskRoute(["loopId": "wc_1", "conversationId": "thr_conv", "threadId": "thr_main"])
        XCTAssertEqual(route?.id, "wc_1")
        XCTAssertEqual(route?.conversation, "thr_conv")
        XCTAssertEqual(NotificationActions.taskRoute(["loopId": "loop_1", "threadId": "thr_main"])?.conversation, "thr_main")
        XCTAssertEqual(NotificationActions.taskRoute(["loopId": "loop_1", "conversationId": "", "threadId": "thr_main"])?.conversation, "thr_main")
        XCTAssertNil(NotificationActions.taskRoute(["threadId": "thr_main"]))
    }

    func testTheMenuPlaceIsTasks() {
        XCTAssertEqual(RoomPlace.tasks.title, "Tasks")
        XCTAssertEqual(RoomPlace.menu.first, .tasks)
    }

    func testLoopMapsToATask() {
        var loop = LoopItem(Studio.LoopsGetOutputLoop())
        loop.id = "loop_1"
        loop.title = "Pay it"
        loop.owner = "user"
        loop.status = .snoozed
        loop.kind = .waiting
        let t = TaskItem(loop: loop)
        XCTAssertTrue(t.isMine)
        XCTAssertEqual(t.kind, .waitingOutside)
        XCTAssertEqual(t.state, .waiting)
        XCTAssertTrue(t.snoozed)
        XCTAssertEqual(t.queue, "queued")
    }

    private actor Paths {
        var paths: [String] = []
        func add(_ path: String) { paths.append(path) }
    }

    func testAnOldServerFallsBackToTodos() async {
        let client = BBClient(baseURL: URL(string: "https://tasks-old.invalid")!)
        client.transport = { _, _, _ in (404, Data(#"{"ok":false,"error":{"message":"Unknown method"}}"#.utf8)) }
        let model = TasksModel(client: client)
        await model.refresh()
        XCTAssertEqual(model.supported, false)
        XCTAssertNil(model.list)
    }

    func testActingRefreshesTheListAndInFlight() async throws {
        let client = BBClient(baseURL: URL(string: "https://tasks.invalid")!)
        let paths = Paths()
        let task = #"{"id":"wc_1","title":"Fork","owner":"cos","state":"in_progress","origin":"work","createdAt":1,"updatedAt":2,"conversation":"thr_main","card":{"kind":"worker"}}"#
        client.transport = { _, path, _ in
            await paths.add(path)
            let result: String = switch path.split(separator: "/").last.map(String.init) ?? "" {
            case "tasks.act": #"{"task":\#(task),"note":"The Bot chat could not be told"}"#
            case "tasks.get": #"{"task":\#(task),"history":[],"todo":false,"threads":[]}"#
            default: #"{"tasks":[\#(task)],"threads":[]}"#
            }
            return (200, Data(#"{"ok":true,"result":\#(result)}"#.utf8))
        }
        let model = TasksModel(client: client)
        await model.loadFlight("thr_main")
        XCTAssertEqual(model.flights["thr_main"]?.tasks.map(\.id), ["wc_1"])
        let note = try await model.perform("wc_1", .takeBack)
        XCTAssertEqual(note, "The Bot chat could not be told")
        let seen = await paths.paths.map { String($0.split(separator: "/").last ?? "") }
        XCTAssertEqual(seen, ["tasks.inFlight", "tasks.act", "tasks.get", "tasks.list", "tasks.inFlight"])
        XCTAssertEqual(model.supported, true)
    }
}
