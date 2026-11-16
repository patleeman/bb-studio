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
        XCTAssertEqual(seen, ["tasks.flight", "tasks.act", "tasks.get", "tasks.board", "tasks.flight"])
        XCTAssertEqual(model.supported, true)
        XCTAssertEqual(model.usesRows, true)
    }

    private static func wire(_ id: String, owner: String = TaskItem.user, state: String = "todo", kind: String = "do", needs: String? = nil, step: String? = nil,
                             line: String? = nil, parent: String? = nil, closedAt: Double? = nil, role: String? = nil, stale: Bool = false) -> String {
        func text(_ value: String?) -> String { value.map { "\"\($0)\"" } ?? "null" }
        let automation = role.map { #"{"id":"aut","kind":"checkin","role":"\#($0)","count":0}"# } ?? "null"
        return #"{"id":"\#(id)","title":"T \#(id)","owner":"\#(owner)","state":"\#(state)","kind":"\#(kind)","needs":\#(text(needs)),"progress":{"step":\#(text(step)),"line":\#(text(line))},"parentId":\#(text(parent)),"automation":\#(automation),"stale":\#(stale),"conversation":"thr_main","createdAt":1000,"updatedAt":2000,"closedAt":\#(closedAt.map { "\($0)" } ?? "null"),"workers":[]}"#
    }

    private static let flightJSON = #"""
    {"rows":[
      {"id":"wc_lead","home":"thr_main","under":null,"depth":0,"open":true,"workers":["thr_w1"],"hasWorkers":true,"needsYou":true,"startedAt":1500},
      {"id":"wc_sub","home":"thr_main","under":"wc_lead","depth":1,"open":true,"workers":["thr_w2"],"hasWorkers":true,"needsYou":true},
      {"id":"wc_slow","home":"thr_main","under":null,"depth":0,"open":true,"workers":[],"hasWorkers":false,"needsYou":false,"stalled":true},
      {"id":"wc_done","home":"thr_main","under":null,"depth":0,"open":false,"workers":[],"hasWorkers":false,"needsYou":false}],
     "tasks":[\#(wire("wc_lead", owner: "thread:thr_lead", state: "waiting", step: "3/5 Tests")),\#(wire("wc_sub", state: "waiting", needs: "Light or dark?", parent: "wc_lead")),
              \#(wire("wc_slow", owner: "cos", state: "in_progress", step: "Step 2 of 4: build")),\#(wire("wc_done", owner: "cos", state: "done", closedAt: 3000))],
     "counts":{"open":2,"running":1,"waiting":1,"todo":0,"needsYou":1,"done":1,"workers":2},
     "threads":[{"owner":"thread:thr_lead","name":"Launch lead","threadId":"thr_lead"}],
     "workers":[{"threadId":"thr_w1","name":"Fork worker","status":"running","archived":false}],
     "done":["wc_done"]}
    """#

    func testDecodesTheFlightFeedIntoATree() throws {
        let flight = try JSONDecoder().decode(TaskList.self, from: Data(Self.flightJSON.utf8))
        XCTAssertEqual(flight.rows?.map(\.id), ["wc_lead", "wc_sub", "wc_slow", "wc_done"])
        XCTAssertEqual(flight.counts, TaskCounts(open: 2, running: 1, waiting: 1, needsYou: 1, done: 1, workers: 2))
        XCTAssertEqual(flight.done, ["wc_done"])
        XCTAssertEqual(flight.rows?.first?.startedAt, Date(milliseconds: 1500))
        XCTAssertEqual(flight.rows?[2].stalled, true)
        let nodes = TaskTree.nodes(flight)
        XCTAssertEqual(nodes.map(\.id), ["wc_lead", "wc_slow", "wc_done"], "a subtask sits under its parent, not beside it")
        let lead = nodes[0]
        XCTAssertEqual(lead.children.map(\.id), ["wc_sub"])
        XCTAssertEqual(lead.workers.map(\.name), ["Fork worker"])
        XCTAssertEqual(lead.children[0].workers.map(\.name), ["A worker thread"], "an unnamed worker still shows")
        XCTAssertEqual(lead.belowText, "1 subtask · 2 workers")
        XCTAssertNil(nodes[1].belowText)
        XCTAssertEqual(lead.look, .needsYou, "a waiting parent whose subtask needs you needs you")
        XCTAssertEqual(nodes[1].look, .waiting, "a stalled running task reads as waiting")
        XCTAssertFalse(nodes[1].isRunning)
        XCTAssertEqual(nodes[2].look, .done)
    }

    private func nested(parent: String, child: String) -> (TasksBoardShape, [TaskItem]) {
        var top = task("top", owner: parent, state: .inProgress)
        top.parentId = nil
        var sub = task("sub", owner: child, state: .inProgress)
        sub.parentId = "top"
        let board = TaskList(tasks: [top, sub], threads: [], rows: [TaskRowRef(id: "top"), TaskRowRef(id: "sub", under: "top", depth: 1)])
        return (TasksBoardShape(TaskTree.nodes(board)), [top, sub])
    }

    func testANestedTaskHidesOnlyInsideItsTopTasksFold() {
        let (tree, both) = nested(parent: "cos", child: "thread:thr_lead")
        XCTAssertTrue(tree.folds(both[0]), "an agent's task folds its subtask under it")
        XCTAssertEqual(tree.shown(both).map(\.id), ["top"], "the subtask is in the fold, not a row of its own")
    }

    func testAnAgentsSubtaskUnderYourToDoStillShows() {
        let (tree, both) = nested(parent: TaskItem.user, child: "cos")
        XCTAssertFalse(tree.folds(both[0]), "your own to-do draws no fold")
        XCTAssertEqual(tree.shown(both).map(\.id), ["top", "sub"], "so the agent's subtask is its own row")
    }

    func testASubtaskWhoseTopTaskIsFilteredOutStillShows() {
        let (tree, both) = nested(parent: "cos", child: "thread:thr_lead")
        XCTAssertEqual(tree.shown([both[1]]).map(\.id), ["sub"], "an owner chip that leaves out the top task keeps its subtask")
    }

    func testAMissingFeedIsTriedAgainAfterAWhile() {
        let now = Date(timeIntervalSince1970: 1_000_000)
        XCTAssertTrue(TasksModel.tries(nil, missingSince: nil, now: now), "a new server tries the feed")
        XCTAssertTrue(TasksModel.tries(true, missingSince: nil, now: now))
        XCTAssertFalse(TasksModel.tries(false, missingSince: now.addingTimeInterval(-60), now: now), "a 404 a minute ago keeps the old calls")
        XCTAssertTrue(TasksModel.tries(false, missingSince: now.addingTimeInterval(-TasksModel.feedRetry), now: now), "a Studio that was reloading gets its feed back")
    }

    func testAWorkerRowSaysWhetherItRuns() {
        XCTAssertEqual(TaskWorkerInfo(threadId: "thr_a", name: "Fork", status: "running").spoken, "Fork, running")
        XCTAssertEqual(TaskWorkerInfo(threadId: "thr_a", name: "Fork", status: "idle").spoken, "Fork, idle")
        XCTAssertEqual(TaskWorkerInfo(threadId: "thr_a", name: "Fork", status: nil, archived: true).spoken, "Fork, archived")
    }

    func testTheOldFeedMakesFlatRows() {
        let list = TaskList(tasks: [task("a", owner: "cos", state: .inProgress), task("b", state: .waiting), task("c", owner: "cos", state: .done)], threads: [])
        let nodes = TaskTree.nodes(list)
        XCTAssertEqual(nodes.map(\.id), ["a", "b", "c"])
        XCTAssertEqual(nodes.map(\.row.open), [true, true, false])
        XCTAssertEqual(nodes.map(\.row.needsYou), [false, true, false])
        XCTAssertTrue(nodes.allSatisfy { $0.children.isEmpty && $0.workers.isEmpty })
    }

    func testFlightRowsSayWhatTheyAreDoingOrWaitingOn() throws {
        let flight = try JSONDecoder().decode(TaskList.self, from: Data(Self.flightJSON.utf8))
        let nodes = TaskTree.nodes(flight)
        let lead = TaskTree.text(nodes[0], owner: "Launch lead", now: Date(milliseconds: 10_000))
        XCTAssertEqual(lead.value, "needs-you")
        XCTAssertEqual(lead.right, "Needs you")
        let slow = TaskTree.text(nodes[1], owner: "Juniper")
        XCTAssertEqual(slow.value, "stalled")
        XCTAssertEqual(slow.right, "Stalled")
        XCTAssertTrue(slow.aria.hasPrefix("T wc_slow, stalled, Juniper"), slow.aria)
        var running = nodes[1]
        running.row.stalled = false
        let text = TaskTree.text(running, owner: nil, now: Date(milliseconds: 1000 + 5 * 60_000))
        XCTAssertEqual(text.right, "2 of 4")
        XCTAssertEqual(text.line, "build")
        XCTAssertEqual(text.elapsed, "5m", "timed from startedAt, else when it was made")
        XCTAssertEqual(text.aria, "T wc_slow, running, step 2 of 4, build, for 5m")
        XCTAssertEqual(StepProgress("3/5 Tests")?.label, "3 of 5")
        XCTAssertEqual(StepProgress("3/5 Tests")?.rest, "Tests")
        XCTAssertNil(StepProgress("7/5"))
        XCTAssertNil(StepProgress("Tests"))
        var outside = task("w", owner: "cos", state: .waiting)
        outside.waitingOn = .init(kind: "ci", ref: "#42", text: nil)
        XCTAssertEqual(TaskTree.waitLabel(outside).long, "Waiting on CI: #42")
        outside.waitingOn = .init(kind: "outside", ref: nil, text: "Sam")
        XCTAssertEqual(TaskTree.waitLabel(outside).short, "waiting on Sam")
        outside.waitingOn = .init(kind: "task", ref: "t2", text: nil)
        XCTAssertEqual(TaskTree.waitLabel(outside, titleOf: { $0 == "t2" ? "Ship it" : nil }).long, "Waiting on Ship it")
        outside.waitingOn = nil
        outside.state = .todo
        XCTAssertEqual(TaskTree.waitLabel(outside).short, "queued")
        let ended = TaskTree.text(FlightNode(row: TaskRowRef(id: "e"), task: task("e", owner: "cos", state: .inProgress, stale: true)), owner: nil)
        XCTAssertEqual(ended.value, "ended")
        XCTAssertFalse(InFlightBar.live(FlightNode(row: TaskRowRef(id: "e"), task: task("e", owner: "cos", state: .inProgress, stale: true)), rowsFeed: true),
                       "an ended task folds into done with the new feed")
        XCTAssertTrue(InFlightBar.live(FlightNode(row: TaskRowRef(id: "e"), task: task("e", owner: "cos", state: .inProgress, stale: true)), rowsFeed: false),
                      "and stays open with the old one, as before")
    }

    private static let areasJSON = #"""
    {"areas":[
      {"id":"area_ok","name":"Launch","covers":"","owner":{"kind":"lead","thread":"thr_lead"},"ownerName":"Launch lead","cadence":null,"status":"ok","reason":null,"now":null,
       "open":[{"title":"Approve the quote","since":null,"sinceAt":null,"needsUser":true,"taskId":"task_mine"},
               {"title":"Confirm the numbers","since":null,"sinceAt":1799913600000,"needsUser":true,"taskId":"task_agent"},
               {"title":"Slides","since":null,"sinceAt":null,"needsUser":false,"taskId":null}],
       "runs":[],"lastRun":null,"nextRun":null,"nextLabel":null,"paused":false,"links":[],"statusFile":null,"fileError":null,"updatedAt":1},
      {"id":"area_home","name":"Home","covers":"","owner":{"kind":"bot","botId":"bot_1"},"ownerName":"Juniper","cadence":null,"status":"flagged","reason":null,"now":null,
       "open":[{"title":"Renew the insurance","since":"last week","sinceAt":null,"needsUser":true,"taskId":null}],
       "runs":[],"lastRun":null,"nextRun":null,"nextLabel":null,"paused":false,"links":[],"statusFile":null,"fileError":null,"updatedAt":1}]}
    """#

    func testAreaAsksAreTheOpenItemsThatNeedYouUnlessTheyAreAlreadyYourTask() throws {
        let areas = try JSONDecoder().decode(AreaList.self, from: Data(Self.areasJSON.utf8)).areas
        XCTAssertEqual(areas.map(\.id), ["area_ok", "area_home"])
        XCTAssertEqual(areas[0].ownerThread, "thr_lead")
        XCTAssertNil(areas[1].ownerThread)
        let tasks = [task("task_mine"), task("task_agent", owner: "cos", state: .inProgress)]
        let asks = AreaRules.asks(areas, tasks: tasks)
        XCTAssertEqual(asks.map(\.title), ["Renew the insurance", "Confirm the numbers"], "problems first; the user's own task isn't asked twice; only items that need the user")
        XCTAssertEqual(asks.map(\.area), ["Home", "Launch"])
        XCTAssertEqual(asks[1].ownerThread, "thr_lead")
        XCTAssertEqual(Set(asks.map(\.id)).count, 2)
        var calendar = Calendar(identifier: .gregorian)
        calendar.timeZone = TimeZone(identifier: "UTC")!
        XCTAssertEqual(AreaRules.age(asks[0], now: now, calendar: calendar), "last week", "the notes' own words when there is no date")
        XCTAssertEqual(AreaRules.age(asks[1], now: now, calendar: calendar), "1 day")
        XCTAssertEqual(AreaRules.label(asks[1], now: now, calendar: calendar), "Confirm the numbers, needs you, from Launch, 1 day")
        var ask = asks[1]
        ask.sinceAt = now.addingTimeInterval(-600)
        XCTAssertEqual(AreaRules.age(ask, now: now, calendar: calendar), "today")
        ask.sinceAt = now.addingTimeInterval(-3 * 86_400)
        XCTAssertEqual(AreaRules.age(ask, now: now, calendar: calendar), "3 days")
        ask.sinceAt = Date(milliseconds: 1_799_000_000_000)
        XCTAssertEqual(AreaRules.age(ask, now: now, calendar: calendar), "Jan 3")
        XCTAssertEqual(AreaRules.asks(areas, tasks: [task("task_mine", owner: "cos")]).count, 3, "a task that is no longer yours is asked again")
    }

    private func server(_ name: String, unknown: Set<String>, paths: Paths) -> BBClient {
        let client = BBClient(baseURL: URL(string: "https://\(name).invalid")!)
        let board = #"{"rows":[{"id":"t_open","home":null,"under":null,"depth":0,"open":true,"workers":[],"hasWorkers":false,"needsYou":false}],"tasks":[\#(Self.wire("t_open", owner: "cos", state: "in_progress"))],"counts":{"open":1,"running":1,"waiting":0,"todo":0,"needsYou":0,"done":0,"workers":0},"threads":[],"workers":[]}"#
        let list = #"{"tasks":[\#(Self.wire("t_open", owner: "cos", state: "in_progress")),\#(Self.wire("t_hidden", owner: "cos", state: "in_progress")),\#(Self.wire("t_old", state: "done", closedAt: 5)),\#(Self.wire("t_daily", owner: "cos", state: "in_progress", role: "schedule"))],"threads":[],"held":[]}"#
        client.transport = { _, path, _ in
            let method = String(path.split(separator: "/").last ?? "")
            await paths.add(path)
            if unknown.contains(method) { return (404, Data(#"{"ok":false,"error":{"message":"Unknown method"}}"#.utf8)) }
            let result: String = switch method {
            case "tasks.board": board
            case "tasks.flight": board.replacingOccurrences(of: #""workers":[]}"#, with: #""workers":[],"done":[]}"#)
            case "areas.list": Self.areasJSON
            default: list
            }
            return (200, Data(#"{"ok":true,"result":\#(result)}"#.utf8))
        }
        return client
    }

    private func methods(_ paths: Paths) async -> [String] {
        await paths.paths.map { String($0.split(separator: "/").last ?? "") }
    }

    func testANewStudioFeedsTheTasksScreenFromTheBoard() async {
        let paths = Paths()
        let model = TasksModel(client: server("tasks-board", unknown: [], paths: paths))
        await model.refresh(full: true)
        let seen = await methods(paths)
        XCTAssertEqual(seen, ["tasks.board", "tasks.list", "areas.list"])
        XCTAssertEqual(model.usesRows, true)
        XCTAssertEqual(model.tasks.map(\.id), ["t_open", "t_old", "t_daily"], "open tasks from the board, done and recurring from the list; a task the board leaves out stays out")
        XCTAssertEqual(model.areaAsks.count, 3)
        await model.loadFlight("thr_main")
        XCTAssertNotNil(model.flights["thr_main"]?.rows)
        await model.refresh()
        let after = await methods(paths)
        XCTAssertEqual(Array(after.dropFirst(3)), ["tasks.flight", "tasks.board"], "with the Tasks screen closed, the room's poll asks only the board")
        model.tasksShown = 1
        await model.refresh()
        let shown = await methods(paths)
        XCTAssertEqual(Array(shown.dropFirst(5)), ["tasks.board", "tasks.list", "areas.list"], "while the Tasks screen shows, it keeps all three fresh")
        model.tasksShown = 0
        async let first: Void = model.refresh()
        async let second: Void = model.refresh()
        _ = await (first, second)
        let shared = await methods(paths)
        XCTAssertEqual(Array(shared.dropFirst(8)), ["tasks.board"], "two refreshes at once share one fetch")
    }

    func testAnOlderStudioFallsBackToTheOldFeedsAndRemembers() async {
        let paths = Paths()
        let model = TasksModel(client: server("tasks-before-board", unknown: ["tasks.flight", "tasks.board", "areas.list"], paths: paths))
        await model.loadFlight("thr_main")
        XCTAssertEqual(model.usesRows, false)
        XCTAssertNil(model.flights["thr_main"]?.rows, "the old feed's rows")
        XCTAssertEqual(model.flights["thr_main"]?.tasks.count, 4)
        await model.refresh(full: true)
        await model.refresh(full: true)
        await model.loadFlight("thr_main")
        let seen = await methods(paths)
        XCTAssertEqual(seen, ["tasks.flight", "tasks.inFlight", "areas.list", "tasks.list", "tasks.list", "tasks.inFlight"],
                       "unknown methods are asked once per server")
        XCTAssertEqual(model.supported, true)
        XCTAssertEqual(model.areas, [])
        XCTAssertEqual(model.tasks.count, 4, "today's behaviour: the whole list")
    }

    func testAMissingStudioIsNotMistakenForAnOlderOne() async {
        let paths = Paths()
        let model = TasksModel(client: server("tasks-board-down", unknown: [], paths: paths))
        let client = BBClient(baseURL: URL(string: "https://tasks-board-down.invalid")!)
        client.transport = { _, _, _ in (503, Data(#"{"ok":false,"error":{"message":"Studio is not running"}}"#.utf8)) }
        let down = TasksModel(client: client)
        await down.refresh()
        XCTAssertNil(down.usesRows, "a 503 decides nothing")
        XCTAssertNotNil(down.listError)
        await model.refresh()
        XCTAssertEqual(model.usesRows, true)
    }
}
