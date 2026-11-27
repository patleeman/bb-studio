import XCTest
@testable import BBStudio

/// The Strands screen (`strands.overview`), where it's reached, and the old
/// to-do cards it replaces, now read-only.
@MainActor
final class StrandsOverviewTests: XCTestCase {
    /// A Bot's overview as Studio answers it, out of order on purpose: Studio sorts, and so does the phone.
    static let overviewJSON = #"""
    {"conversations":[
      {"threadId":"thr_quiet","title":"Budget sign-off","isMain":false,"lastActiveAt":1800000900000,
       "strands":[{"id":"str_budget","title":"Q4 budget","summary":"Sent Dana the numbers","named":true,"state":"quiet","detail":null,"asks":[],"workers":[],
                   "lastAt":1800000900000,"firstAt":1800000000000,"firstSeq":1,"latestSeq":3,"latestTurnId":"t3","messages":3,"unsure":0,"pinned":false,"origin":"jev","taskId":null}]},
      {"threadId":"thr_main","title":"Main","isMain":true,"lastActiveAt":1800000500000,
       "strands":[{"id":"str_fork","title":"Studio fork","summary":null,"named":true,"state":"needs-you","detail":"Wants to push",
                   "asks":[{"id":"ask_push","kind":"approval","threadId":"thr_w1","label":"Approve: git push","details":["git push origin main"],"turnId":null,"decisions":["allow_once","deny"]},
                           {"id":"ask_two","kind":"question","threadId":"thr_main","label":"Which branch?","details":[],"turnId":"t9","decisions":[]}],
                   "workers":[{"threadId":"thr_w1","title":"Fork worker","status":"needs-you","endedAt":null}],
                   "lastAt":1800000500000,"firstAt":1,"firstSeq":2,"latestSeq":40,"latestTurnId":"t9","messages":12,"unsure":0,"pinned":false,"origin":"jev","taskId":null},
                  {"id":"str_cal","title":"Calendar","summary":null,"named":true,"state":"needs-you","detail":"A tool wants your calendar","asks":[],"workers":[],
                   "lastAt":1,"firstAt":1,"firstSeq":1,"latestSeq":38,"latestTurnId":null,"messages":2,"unsure":0,"pinned":false,"origin":"jev","taskId":null},
                  {"id":"str_stills","title":"Theme stills","summary":"Rendering","named":true,"state":"running","detail":null,"asks":[],"workers":[],
                   "lastAt":1,"firstAt":1,"firstSeq":5,"latestSeq":44,"latestTurnId":null,"messages":4,"unsure":0,"pinned":false,"origin":"jev","taskId":null},
                  {"id":"str_notes","title":"Release notes","summary":null,"named":true,"state":"quiet","detail":null,"asks":[],"workers":[],
                   "lastAt":1,"firstAt":1,"firstSeq":1,"latestSeq":12,"latestTurnId":null,"messages":3,"unsure":0,"pinned":true,"origin":"user","taskId":null}]},
      {"threadId":"thr_launch","title":"Launch prep","isMain":false,"lastActiveAt":1800000100000,
       "strands":[{"id":"str_q","title":"Question bank","summary":null,"named":true,"state":"needs-you","detail":null,"asks":[],"workers":[],
                   "lastAt":1,"firstAt":1,"firstSeq":1,"latestSeq":6,"latestTurnId":null,"messages":2,"unsure":1,"pinned":false,"origin":"jev","taskId":null}]}
    ],"needs":3,"running":1}
    """#

    private func overview() throws -> StrandOverview {
        try JSONDecoder().decode(StrandOverview.self, from: Data(Self.overviewJSON.utf8))
    }

    // MARK: The model

    func testDecodesStudiosOverviewWithTheSameStrandShapeAsTheList() throws {
        let overview = try overview()
        XCTAssertEqual(overview.needs, 3)
        XCTAssertEqual(overview.running, 1)
        XCTAssertEqual(overview.conversations.count, 3)
        let main = try XCTUnwrap(overview.conversations.first { $0.isMain })
        XCTAssertEqual(main.title, "Main")
        XCTAssertEqual(main.strands.map(\.state), [.needsYou, .needsYou, .running, .quiet])
        XCTAssertEqual(main.strands[0].asks.map(\.kind), [.approval, .question])
        XCTAssertEqual(main.strands[0].asks[0].details, ["git push origin main"])
        XCTAssertEqual(main.strands[0].workers.first?.status, .needsYou)
        XCTAssertEqual(main.strands[0].latestSeq, 40)
        // The generated contract reads the same answer.
        let wire = try JSONDecoder().decode(Studio.StrandsOverviewOutput.self, from: Data(Self.overviewJSON.utf8))
        XCTAssertEqual(wire.conversations?.count, 3)
        XCTAssertEqual(Studio.Method.strands_overview, "strands.overview")
    }

    func testNeedsYouFirstThenMainThenTheMostRecent() throws {
        XCTAssertEqual(try overview().conversations.map(\.threadId), ["thr_main", "thr_launch", "thr_quiet"])
        let quietMain = StrandOverview.Conversation(threadId: "m", title: "Main", isMain: true, lastActiveAt: 1, strands: [Strand(id: "a", title: "A", state: .quiet)])
        let newer = StrandOverview.Conversation(threadId: "n", title: "N", lastActiveAt: 5, strands: [Strand(id: "b", title: "B", state: .running)])
        let older = StrandOverview.Conversation(threadId: "o", title: "O", lastActiveAt: 2, strands: [Strand(id: "c", title: "C", state: .running)])
        XCTAssertEqual(StrandOverviewRules.sorted([older, newer, quietMain]).map(\.threadId), ["m", "n", "o"])
    }

    func testTheHeaderLineLeavesOutTheZeroParts() {
        XCTAssertEqual(StrandOverviewRules.line(needs: 3, running: 2), "3 need you · 2 running")
        XCTAssertEqual(StrandOverviewRules.line(needs: 1, running: 0), "1 needs you")
        XCTAssertEqual(StrandOverviewRules.line(needs: 0, running: 4), "4 running")
        XCTAssertEqual(StrandOverviewRules.line(needs: 0, running: 0), "")
        XCTAssertEqual(StrandOverviewRules.line(nil), "")
    }

    func testTheMainTagOnlyWhenTheTitleIsntAlreadyMain() {
        func row(_ title: String, main: Bool) -> StrandOverview.Conversation { .init(threadId: "t", title: title, isMain: main, strands: []) }
        XCTAssertFalse(StrandOverviewRules.showsMainTag(row("Main", main: true)), "no Main Main")
        XCTAssertFalse(StrandOverviewRules.showsMainTag(row("  main ", main: true)), "trimmed, any case")
        XCTAssertTrue(StrandOverviewRules.showsMainTag(row("Daily", main: true)), "a Main with its own name says Main")
        XCTAssertFalse(StrandOverviewRules.showsMainTag(row("Main", main: false)), "only on Main")
    }

    func testACardShowsTwoAsksThenTheOtherStrandsAsChips() throws {
        let main = try XCTUnwrap(try overview().conversations.first)
        let card = StrandOverviewRules.card(main)
        XCTAssertEqual(card.asks.map(\.text), ["Studio fork · Approve: git push", "Studio fork · Which branch?"], "up to 2 asks, each its own row")
        XCTAssertEqual(card.more, 1, "the calendar's ask is one more that needs you")
        XCTAssertEqual(card.chips.map(\.id), ["str_stills", "str_notes"], "the strands that don't need you")
        let launch = StrandOverviewRules.card(try XCTUnwrap(try overview().conversations.first { $0.threadId == "thr_launch" }))
        XCTAssertEqual(launch.asks.map(\.text), ["Question bank · Needs you"], "a strand without an ask or a detail still shows")
        XCTAssertEqual(StrandOverviewRules.AskRow(strand: Strand(id: "x", title: "Calendar", state: .needsYou, detail: "A tool wants your calendar"), ask: nil).text,
                       "Calendar · A tool wants your calendar", "the strand's detail when it has no ask")
        XCTAssertEqual(StrandOverviewRules.stateLabel(.quiet), "quiet")
    }

    private func model(_ answer: @escaping @Sendable (String) -> (Int, Data)) -> StrandOverviewModel {
        let client = BBClient(baseURL: URL(string: "https://strands-overview.invalid")!)
        client.transport = { _, path, _ in answer(path) }
        return StrandOverviewModel(client: { client })
    }

    func testLoadsTheOverviewAndCountsWhatNeedsYou() async throws {
        let json = Self.overviewJSON
        let model = model { path in
            XCTAssertTrue(path.hasSuffix("/rpc/strands.overview"))
            return (200, Data(#"{"ok":true,"result":\#(json)}"#.utf8))
        }
        XCTAssertEqual(model.shown("bot_1"), .loading)
        await model.load("bot_1")
        guard case .cards(let overview) = model.shown("bot_1") else { return XCTFail("cards") }
        XCTAssertEqual(overview.conversations.count, 3)
        XCTAssertEqual(model.needs("bot_1"), 3, "the ⋯ menu's count")
        XCTAssertEqual(model.needs(nil), 0)
    }

    func testNoOpenStrands() async {
        let model = model { _ in (200, Data(#"{"ok":true,"result":{"conversations":[],"needs":0,"running":0}}"#.utf8)) }
        await model.load("bot_1")
        XCTAssertEqual(model.shown("bot_1"), .empty)
        XCTAssertEqual(StrandOverviewModel.emptyText, "No open strands")
    }

    func testAFailedLoadSaysWhy() async {
        let model = model { _ in (500, Data(#"{"ok":false,"error":{"message":"boom"}}"#.utf8)) }
        await model.load("bot_1")
        guard case .failed(let message) = model.shown("bot_1") else { return XCTFail("failed") }
        XCTAssertFalse(message.isEmpty)
    }

    // MARK: Where it's reached

    func testStrandsIsFirstInTheMenuAndAtTheFootOfTheList() {
        XCTAssertEqual(RoomPlace.strands.title, "Strands")
        XCTAssertEqual(RoomPlace.strands.symbol, "list.bullet.rectangle")
        XCTAssertEqual(RoomPlace.homeList, [.strands, .memory, .library, .schedules, .theme])
        XCTAssertNil(RoomPlace(rawValue: "tasks"), "Tasks is gone")
        XCTAssertEqual(BotPage.allCases.first, .strands)
        XCTAssertEqual(BotPage.strands.title, "Strands")
        XCTAssertNil(BotPage(rawValue: "todos"))
    }

    func testTodosLinksOpenStrands() {
        XCTAssertEqual(Links.destination(LinkRef(kind: .todos, id: nil)), .botPage(.strands, botId: nil))
        XCTAssertEqual(Links.destination(LinkRef(kind: .todos, id: "bot_1")), .botPage(.strands, botId: "bot_1"))
        XCTAssertEqual(Links.destination(LinkRef(kind: .todo, id: nil)), .botPage(.strands, botId: nil))
        XCTAssertEqual(Links.destination(LinkRef(kind: .todo, id: "wc_1")), .todo("wc_1"), "a card's link still opens its read-only card")
        func entity(_ text: String) -> LinkRef? {
            guard case .entity(let ref)? = Links.parse(text) else { return nil }
            return ref
        }
        XCTAssertEqual(entity("bb://todos"), LinkRef(kind: .todos, id: nil))
        XCTAssertEqual(entity("bb://strands"), LinkRef(kind: .todos, id: nil))
        XCTAssertEqual(entity("/plugins/studio/studio/bot/bot_1/loops"), LinkRef(kind: .todos, id: "bot_1"))
        XCTAssertEqual(entity("/plugins/studio/studio/bot/bot_1/strands"), LinkRef(kind: .todos, id: "bot_1"))
        XCTAssertEqual(entity(#"::loop{id="loop_1"}"#), LinkRef(kind: .todo, id: "loop_1"))
    }

    func testTheLoopsAppLinkOpensStrands() {
        let app = AppModel.shared
        let saved = app.router.tab
        defer { app.router.tab = saved }
        for link in ["bbstudio://loops", "bbstudio://strands"] {
            app.handle(URL(string: link)!)
            XCTAssertEqual(app.router.tab, .bot, link)
            XCTAssertEqual(app.router.pending, .place(.strands, botId: nil), link)
        }
    }

    // MARK: The old to-do cards, read-only

    func testAnOldTaskCardShowsTitleStateLineNeedsAndOutputs() throws {
        let json = #"""
        {"id":"wc_1","title":"Render the stills","why":"For the release page","owner":"thread:thr_w2","state":"waiting","kind":"do","options":[],
         "needs":null,"priority":"normal","conversation":"thr_main","project":null,"area":null,"timing":null,"attention":null,
         "progress":{"step":"Step 2 of 4","line":"Cropping"},"workers":["thr_w2"],
         "outputs":[{"kind":"page","ref":"bb://page/pg_stills","title":"Stills","url":null},{"kind":"link","ref":null,"title":"","url":"https://example.com/stills"}],
         "source":null,"parentId":null,"schedule":null,"card":{"kind":"worker"},"automation":null,"waitingOn":null,"stale":false,"origin":"work",
         "createdAt":1800000000000,"updatedAt":1800000000000,"closedAt":null,"closedBy":null}
        """#
        let task = TaskItem(try JSONDecoder().decode(Studio.TasksGetOutputTask.self, from: Data(json.utf8)))
        XCTAssertEqual(task.outputs.map(\.title), ["Stills", "https://example.com/stills"], "an output without a title shows its link")
        let names = TaskNames(bot: "Juniper", leads: [], threads: [TaskThreadName(owner: "thread:thr_w2", name: "Stills worker", threadId: "thr_w2")], botThreadId: nil)
        let content = TaskCardContent(task, names: names)
        XCTAssertEqual(content.title, "Render the stills")
        XCTAssertEqual(content.why, "For the release page")
        XCTAssertEqual(content.state.label, "Waiting")
        XCTAssertEqual(content.line, "Step 2 of 4 · Cropping")
        XCTAssertNil(content.needs)
        XCTAssertEqual(content.outputs.count, 2)
        XCTAssertEqual(TaskCardContent.target(content.outputs[0]), .entity(LinkRef(kind: .page, id: "pg_stills")))
        XCTAssertEqual(TaskCardContent.target(content.outputs[1]), .external(URL(string: "https://example.com/stills")!))

        var mine = task
        mine.owner = TaskItem.user
        mine.needs = "Pick the crop"
        let asks = TaskCardContent(mine, names: names)
        XCTAssertEqual(asks.owner, "You")
        XCTAssertEqual(asks.needs, "Pick the crop", "what it needs")
        XCTAssertEqual(asks.state.id, "needs-you")
        XCTAssertNil(asks.line, "the needs box carries the line")
    }
}
