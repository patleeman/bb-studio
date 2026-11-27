import XCTest
@testable import BBStudio

final class StrandsTests: XCTestCase {
    private func worker(_ id: String, status: String, owner: String? = "main", spawnedBy: String? = nil, nestUnder: String? = nil) throws -> BotWorker {
        var fields: [String: Any] = ["threadId": id, "title": id.uppercased(), "status": status]
        fields["ownerConversationId"] = owner
        fields["spawnedBy"] = spawnedBy
        fields["nestUnder"] = nestUnder
        let data = try JSONSerialization.data(withJSONObject: fields)
        return try XCTUnwrap(BotWorker(try JSONDecoder().decode(Studio.BotThreadsViewOutputWorkersItem.self, from: data)))
    }

    func testNestsPutWorkersUnderTheirConversationAndUnderTheWorkerThatStartedThem() throws {
        let workers = [
            try worker("a", status: "running"),
            try worker("b", status: "done", spawnedBy: "a"),
            try worker("c", status: "needs-you", owner: "talk"),
            try worker("d", status: "done", owner: "gone"),
            try worker("e", status: "done", owner: "fork", nestUnder: "talk"),
        ]
        let made = BotWorkerNests.make(conversations: ["main", "talk"], workers: workers)
        let main = try XCTUnwrap(made.nests["main"])
        XCTAssertEqual(main.nodes.map(\.worker.threadId), ["a"])
        XCTAssertEqual(main.nodes.first?.children.map(\.worker.threadId), ["b"])
        XCTAssertEqual(main.total, 2)
        XCTAssertEqual(main.running, 1)
        let talk = try XCTUnwrap(made.nests["talk"])
        XCTAssertEqual(talk.nodes.map(\.worker.threadId), ["c", "e"], "a fork's worker nests under the row Studio names")
        XCTAssertEqual(talk.needsYou, 1)
        XCTAssertEqual(talk.label, "2 workers, 1 needs you")
        XCTAssertEqual(made.other?.nodes.map(\.worker.threadId), ["d"])
    }

    func testASpawnLoopDoesNotHang() throws {
        let made = BotWorkerNests.make(conversations: ["main"], workers: [
            try worker("a", status: "done", spawnedBy: "b"), try worker("b", status: "done", spawnedBy: "a"),
        ])
        XCTAssertEqual(made.nests["main"]?.total, 2)
    }

    func testTwoOrMoreFinishedFoldIntoDoneAndOneShowsAsItIs() throws {
        let one = BotWorkerNests.make(conversations: ["main"], workers: [try worker("a", status: "running"), try worker("b", status: "done")])
        XCTAssertEqual(BotWorkerNests.lines(one.nests["main"]!.nodes, parent: "main", openFolds: []).map(\.id), ["w:a", "w:b"])

        let many = BotWorkerNests.make(conversations: ["main"], workers: [
            try worker("a", status: "running"), try worker("b", status: "done"), try worker("c", status: "failed"),
        ])
        let nodes = many.nests["main"]!.nodes
        XCTAssertEqual(BotWorkerNests.lines(nodes, parent: "main", openFolds: []).map(\.id), ["w:a", "f:main"])
        XCTAssertEqual(BotWorkerNests.lines(nodes, parent: "main", openFolds: ["main"]).map(\.id), ["w:a", "f:main", "w:b", "w:c"])
        if case .fold(_, let count, _) = BotWorkerNests.lines(nodes, parent: "main", openFolds: [])[1] { XCTAssertEqual(count, 2) } else { XCTFail("no fold") }
    }

    func testWorkersOfUseNestUnder() throws {
        var view = BotThreadsView(try JSONDecoder().decode(Studio.BotThreadsViewOutput.self, from: Data(#"{"conversations":[],"workers":[]}"#.utf8)))
        view.workers = [try worker("a", status: "running", owner: "fork", nestUnder: "talk"), try worker("b", status: "running", owner: "talk")]
        XCTAssertEqual(view.workers(of: "talk").map(\.threadId), ["a", "b"])
    }

    private let listJSON = #"""
    {"threadId":"main","enabled":true,"backfill":{"done":true,"at":1,"messages":1,"sorted":1},"jevCallsToday":0,"jevDailyCap":1,"sortingTurn":false,
     "strands":[
       {"id":"s1","title":"Plumber quote","summary":"Two quotes","named":true,"state":"needs-you","detail":null,
        "asks":[{"id":"i1","kind":"approval","threadId":"w1","label":"Push","details":["git push"],"turnId":null,"decisions":["deny","allow_once"]}],
        "workers":[],"lastAt":1,"firstAt":null,"firstSeq":null,"latestSeq":4,"latestTurnId":null,"messages":1,"unsure":0,"pinned":false,"origin":"jev","taskId":null},
       {"id":"s2","title":"Theme stills","summary":null,"named":true,"state":"running","detail":null,"asks":[],
        "workers":[{"threadId":"w2","title":"Light","status":"running","endedAt":null},{"threadId":"w3","title":"Old","status":"done","endedAt":0},
                   {"threadId":"w4","title":"Dark","status":"done","endedAt":399000000}],
        "lastAt":2,"firstAt":null,"firstSeq":null,"latestSeq":9,"latestTurnId":null,"messages":2,"unsure":0,"pinned":false,"origin":"jev","taskId":null},
       {"id":"s3","title":"Old trip","summary":null,"named":true,"state":"quiet","detail":null,"asks":[],"workers":[],"lastAt":0,"firstAt":null,"firstSeq":null,
        "latestSeq":1,"latestTurnId":null,"messages":1,"unsure":0,"pinned":false,"origin":"jev","taskId":null},
       {"id":"s4","title":"Future","state":"brand-new"}],
     "earlier":[],"strayWorkers":[{"threadId":"w9","title":"Fixture","status":"running","endedAt":null}]}
    """#

    func testTheBoxLineCountsAndGroups() throws {
        let list = try JSONDecoder().decode(StrandList.self, from: Data(listJSON.utf8))
        XCTAssertTrue(StrandsBoxModel.shown(list))
        XCTAssertEqual(list.strands.last?.state, .other, "an unknown state decodes")
        let counts = StrandsBoxModel.counts(list)
        XCTAssertEqual(counts.needs, 1)
        XCTAssertEqual(counts.running, 2, "a running worker no strand holds counts")
        XCTAssertEqual(StrandsBoxModel.headline(list), "1 needs you · Plumber quote")
        XCTAssertEqual(StrandsBoxModel.groups(list).map(\.label), ["Needs you", "Active", "Quiet"])
        XCTAssertEqual(StrandsBoxModel.groups(list)[1].strands.map(\.id), ["s2", "s4"])
        XCTAssertEqual(StrandsBoxModel.decisionButtons(list.strands[0].asks[0]).map(\.label), ["Approve", "Deny"])
        let rows = StrandsBoxModel.rowWorkers(list.strands[1], now: 400_000_000)
        XCTAssertEqual(rows.map(\.threadId), ["w2", "w4"], "a finished worker leaves its row after 2 days")
    }

    func testNoNeedsShowsTheNewestStrandAndOffShowsNothing() throws {
        var list = try JSONDecoder().decode(StrandList.self, from: Data(listJSON.utf8))
        list.strands.removeFirst()
        XCTAssertEqual(StrandsBoxModel.headline(list), "Theme stills")
        list.enabled = false
        XCTAssertFalse(StrandsBoxModel.shown(list))
        XCTAssertFalse(StrandsBoxModel.shown(StrandList(threadId: "t", enabled: true, strands: [])))
    }

    func testPagingBeginsOnlyOnASidewaysDragAwayFromTheEdge() {
        XCTAssertTrue(TranscriptPaging.begins(velocity: CGPoint(x: -600, y: 40), start: CGPoint(x: 200, y: 300), width: 390))
        XCTAssertFalse(TranscriptPaging.begins(velocity: CGPoint(x: -300, y: 200), start: CGPoint(x: 200, y: 300), width: 390), "too steep")
        XCTAssertFalse(TranscriptPaging.begins(velocity: CGPoint(x: 600, y: 0), start: CGPoint(x: 10, y: 300), width: 390), "the back gesture's edge")
        XCTAssertFalse(TranscriptPaging.begins(velocity: CGPoint(x: 40, y: 0), start: CGPoint(x: 200, y: 300), width: 390), "too slow to tell")
    }
}

final class StrandsDemoTests: XCTestCase {
    func testTheDemoListDecodes() throws {
        let json = BotSpacesDemo.State.strandsJSON("thr_x", now: 1_000_000_000, resolved: false)
        let data = try JSONSerialization.data(withJSONObject: ["result": json])
        struct Envelope: Decodable { var result: StrandList }
        let list = try JSONDecoder().decode(Envelope.self, from: data).result
        XCTAssertTrue(StrandsBoxModel.shown(list))
        XCTAssertEqual(StrandsBoxModel.counts(list).needs, 2)
    }
}

final class StrandTimelineTests: XCTestCase {
    private let tags = StrandTags(tags: [.init(turnId: "a", seq: 10, strandId: "s1"), .init(turnId: "b", seq: 20, strandId: "s2"),
                                         .init(turnId: "c", seq: 30, strandId: "s1")])

    func testARowBelongsToTheTurnThatStartsAtOrBeforeIt() {
        XCTAssertNil(tags.strand(atSeq: 5), "older than every sorted turn")
        XCTAssertEqual(tags.strand(atSeq: 10), "s1")
        XCTAssertEqual(tags.strand(atSeq: 25), "s2")
        XCTAssertEqual(tags.strand(atSeq: 99), "s1")
        XCTAssertNil(tags.strand(atSeq: nil))
    }

    func testDividersWhereTheStrandChangesAndGapsUnderAFilter() throws {
        let named = try JSONDecoder().decode(StrandTags.self, from: Data(#"{"tags":[{"turnId":"a","seq":10,"strandId":"s1"},{"turnId":"b","seq":20,"strandId":"s2"},{"turnId":"c","seq":30,"strandId":"s1"}],"strands":[{"id":"s1","title":"One"},{"id":"s2","title":"Two"}]}"#.utf8))
        let seqs: [Double?] = [11, 12, 21, 31, nil]
        let messages = [true, false, true, true, false]
        let all = StrandTimeline.plan(seqs: seqs, messages: messages, tags: named, only: nil)
        XCTAssertEqual(all.keep, [true, true, true, true, true])
        XCTAssertEqual(all.marks[0], [.divider(strandId: "s1", title: "One")])
        XCTAssertNil(all.marks[1], "same strand, no divider")
        XCTAssertEqual(all.marks[2], [.divider(strandId: "s2", title: "Two")])
        XCTAssertEqual(all.marks[3], [.divider(strandId: "s1", title: "One")])

        let only = StrandTimeline.plan(seqs: seqs, messages: messages, tags: named, only: "s1")
        XCTAssertEqual(only.keep, [true, true, false, true, true], "a row from no turn stays")
        XCTAssertEqual(only.marks[3], [.gap(count: 1)])
        XCTAssertNil(only.marks[0])
    }

    func testASummaryThatSaysNothingIsLeftOut() {
        XCTAssertNil(StrandsBoxModel.summary("Continuation of the main conversation; no details provided."))
        XCTAssertNil(StrandsBoxModel.summary("Continuation of the main conversation."))
        XCTAssertNil(StrandsBoxModel.summary("  "))
        XCTAssertNil(StrandsBoxModel.summary(nil))
        XCTAssertEqual(StrandsBoxModel.summary("Picks a look for the six screens"), "Picks a look for the six screens")
        XCTAssertEqual(StrandsBoxModel.summary("Continuation of the email app work: the inbox and History"),
                       "Continuation of the email app work: the inbox and History", "a continuation that says what")
    }
}
