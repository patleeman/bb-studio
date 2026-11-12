import XCTest
@testable import BBStudio

final class BotWorkersTests: XCTestCase {
    private func makeClient(_ answer: @escaping (String, [String: Any]) -> (Int, Any)) -> (BBClient, () -> [(String, [String: Any])]) {
        let client = BBClient(baseURL: URL(string: "https://workers-\(UUID().uuidString.lowercased()).invalid")!)
        let lock = NSLock()
        nonisolated(unsafe) var calls: [(String, [String: Any])] = []
        client.transport = { _, path, body in
            let method = String(path.split(separator: "/").last ?? "")
            let input = body.flatMap { try? JSONSerialization.jsonObject(with: $0) as? [String: Any] } ?? [:]
            lock.withLock { calls.append((method, input)) }
            let (status, result) = answer(method, input)
            let envelope: [String: Any] = status == 200 ? ["ok": true, "result": result] : ["ok": false, "error": ["message": result]]
            return (status, try JSONSerialization.data(withJSONObject: envelope))
        }
        return (client, { lock.withLock { calls } })
    }

    private static func worker(_ json: String) throws -> BotWorker {
        let view = #"{"botId":"bot_a","conversations":[],"workers":[\#(json)]}"#
        return try XCTUnwrap(BotThreadsView(try JSONDecoder().decode(Studio.BotThreadsViewOutput.self, from: Data(view.utf8))).workers.first)
    }

    func testSeedFromTheListOwnsByConversationElseMain() throws {
        let owned = try Self.worker(#"{"threadId":"thr_w","title":"Fork","status":"running","ownerConversationId":"thr_c","ownerTitle":"Launch prep","branch":"fork","updatedAt":1}"#)
        let info = WorkerInfo(owned, botName: "Juniper", mainThreadId: "thr_main")
        XCTAssertEqual(info.owner, WorkerInfo.Owner(threadId: "thr_c", title: "Launch prep"))
        XCTAssertEqual(info.branch, "fork")
        XCTAssertEqual(info.askTarget, "Sends to Juniper in Launch prep")
        let orphan = try Self.worker(#"{"threadId":"thr_w","title":"","status":"done","ownerConversationId":null}"#)
        let fallback = WorkerInfo(orphan, botName: "Juniper", mainThreadId: "thr_main")
        XCTAssertEqual(fallback.owner, WorkerInfo.Owner(threadId: "thr_main", title: "Main"))
        XCTAssertEqual(fallback.displayTitle, "Worker")
        XCTAssertNil(fallback.branch)
    }

    func testStateLabelsMatchDesktop() {
        func info(_ status: BotWorker.Status, _ waiting: WorkerInfo.WaitingOn? = nil) -> WorkerInfo {
            WorkerInfo(threadId: "t", title: "W", status: status, waitingOn: waiting, botName: "B", owner: nil)
        }
        XCTAssertEqual(info(.running).stateLabel, "Running")
        XCTAssertEqual(info(.failed).stateLabel, "Failed")
        XCTAssertEqual(info(.done).stateLabel, "Done")
        XCTAssertEqual(info(.needsYou).stateLabel, "Waiting for you")
        XCTAssertEqual(info(.needsYou, .approval).stateLabel, "Waiting for your approval")
        XCTAssertEqual(info(.needsYou, .question).stateLabel, "Waiting on an answer")
        XCTAssertTrue(info(.needsYou, .question).canAnswerHere)
        XCTAssertFalse(info(.needsYou, .approval).canAnswerHere)
        XCTAssertEqual(info(.done).askTarget, "Sends to B in Main")
    }

    func testHeaderAddsTheAgeExceptWhenDone() {
        let now = Date()
        var running = WorkerInfo(threadId: "t", title: "W", status: .running, botName: "B", owner: nil,
                                 updatedAt: (now.timeIntervalSince1970 - 34 * 60) * 1000)
        XCTAssertEqual(running.headerLabel(now: now), "Running · 34m")
        running.status = .done
        XCTAssertEqual(running.headerLabel(now: now), "Done")
    }

    func testMergeKeepsLiveStatusAndTakesWhatItWaitsOn() {
        let seed = WorkerInfo(threadId: "t", title: "W", status: .needsYou, botName: "Juniper", owner: nil)
        let fetched = WorkerInfo(threadId: "t", title: "Old", status: .running, waitingOn: .approval, botName: "Juniper",
                                 owner: .init(threadId: "c", title: "Main"), branch: "b")
        let merged = WorkerInfo.merged(seed: seed, fetched: fetched)
        XCTAssertEqual(merged?.status, .needsYou, "the list is live")
        XCTAssertEqual(merged?.waitingOn, .approval)
        XCTAssertEqual(merged?.title, "W")
        XCTAssertEqual(merged?.branch, "b")
        XCTAssertEqual(merged?.owner?.threadId, "c")
        var done = seed
        done.status = .done
        XCTAssertNil(WorkerInfo.merged(seed: done, fetched: fetched)?.waitingOn, "a stale wait goes with the status")
        XCTAssertEqual(WorkerInfo.merged(seed: nil, fetched: fetched), fetched)
        XCTAssertNil(WorkerInfo.merged(seed: nil, fetched: nil))
    }

    func testReadOnlyHidesInteractionsUntilAnsweringAQuestion() throws {
        let decoder = JSONDecoder()
        let approval = try decoder.decode(PendingInteraction.self, from: Data(#"{"id":"i1","threadId":"t","status":"pending","createdAt":1,"payload":{"kind":"approval","subject":{"kind":"command","command":"git push"},"availableDecisions":["allow_once","deny"]}}"#.utf8))
        let question = try decoder.decode(PendingInteraction.self, from: Data(#"{"id":"i2","threadId":"t","status":"pending","createdAt":2,"payload":{"kind":"user_question"}}"#.utf8))
        let all = [approval, question]
        XCTAssertEqual(WorkerInfo.shownInteractions(all, worker: nil, answering: false), all, "not a worker: unchanged")
        let asking = WorkerInfo(threadId: "t", title: "W", status: .needsYou, waitingOn: .question, botName: "B", owner: nil)
        XCTAssertEqual(WorkerInfo.shownInteractions(all, worker: asking, answering: false), [])
        XCTAssertEqual(WorkerInfo.shownInteractions(all, worker: asking, answering: true).map(\.id), ["i2"], "approvals belong to the conversation")
        var approving = asking
        approving.waitingOn = .approval
        XCTAssertEqual(WorkerInfo.shownInteractions(all, worker: approving, answering: true), [])
    }

    func testCanAsk() {
        XCTAssertFalse(WorkerInfo.canAsk("  \n", busy: false))
        XCTAssertFalse(WorkerInfo.canAsk("Why?", busy: true))
        XCTAssertTrue(WorkerInfo.canAsk("Why?", busy: false))
    }

    func testAskSendsToStudioAndReturnsTheConversation() async throws {
        let (client, calls) = makeClient { _, _ in (200, ["conversationId": "thr_c", "projectId": "proj"]) }
        let asked = try await client.askAboutWorker(threadId: "thr_w", text: "  Why did it stop?  ")
        XCTAssertEqual(asked, WorkerAsked(conversationId: "thr_c", projectId: "proj"))
        let call = try XCTUnwrap(calls().first)
        XCTAssertEqual(call.0, "bot_worker_ask")
        XCTAssertEqual(call.1["threadId"] as? String, "thr_w")
        XCTAssertEqual(call.1["text"] as? String, "Why did it stop?")
    }

    func testAskRefusesEmptyTextWithoutCalling() async {
        let (client, calls) = makeClient { _, _ in (200, [String: Any]()) }
        do {
            _ = try await client.askAboutWorker(threadId: "thr_w", text: "   ")
            XCTFail("empty text sends nothing")
        } catch {}
        XCTAssertTrue(calls().isEmpty)
    }

    func testAskSurfacesStudioRefusal() async {
        let (client, _) = makeClient { _, _ in (400, "That thread isn't a worker.") }
        do {
            _ = try await client.askAboutWorker(threadId: "thr_c", text: "Hi")
            XCTFail("refused")
        } catch {
            XCTAssertTrue(BBClient.describe(error, server: client.baseURL).contains("isn't a worker"), "\(error)")
        }
    }

    func testThreadInfoDecodesAWorkerOnly() async throws {
        let (client, _) = makeClient { _, input in
            let id = input["threadId"] as? String
            if id == "thr_c" { return (200, ["info": ["threadId": "thr_c", "botId": "b", "botName": "Juniper", "kind": "conversation"]]) }
            return (200, ["info": ["threadId": "thr_w", "botId": "b", "botName": "Juniper", "kind": "worker", "title": "Fork",
                                   "status": "needs-you", "waitingOn": "question", "owner": NSNull(), "branch": "fork"]])
        }
        let info = try await client.workerInfo(threadId: "thr_w", mainThreadId: "thr_main")
        XCTAssertEqual(info?.status, .needsYou)
        XCTAssertEqual(info?.waitingOn, .question)
        XCTAssertEqual(info?.owner, WorkerInfo.Owner(threadId: "thr_main", title: "Main"))
        XCTAssertEqual(info?.botName, "Juniper")
        let conversation = try await client.workerInfo(threadId: "thr_c", mainThreadId: nil)
        XCTAssertNil(conversation)
    }

    @MainActor func testContextFindsWorkersOfAnyConversation() throws {
        let worker = try Self.worker(#"{"threadId":"thr_w","title":"Fork","status":"failed","ownerConversationId":"thr_other","ownerTitle":"Other"}"#)
        let context = BotConversationContext(
            threadId: "thr_main", kind: .conversation, botId: "b", botName: "Juniper", look: BotLook(shape: nil, color: nil, emoji: "🌿"),
            mainThreadId: "thr_main", conversation: nil, workers: WorkersLine(conversationId: "thr_main", view: nil), allWorkers: [worker],
            splitsThreads: false, push: { _ in }, openConversation: { _ in }, showList: {}, refresh: {})
        XCTAssertTrue(context.isWorker("thr_w"), "a worker pushed from the workers line")
        XCTAssertFalse(context.isWorker("thr_main"))
        XCTAssertEqual(context.worker("thr_w")?.status, .failed)
        var selected = context
        selected.kind = .worker
        selected.threadId = "thr_hidden"
        XCTAssertTrue(selected.isWorker("thr_hidden"), "selected as a worker, even when the list doesn't show it")
        XCTAssertNil(selected.worker("thr_hidden"))
    }
}
