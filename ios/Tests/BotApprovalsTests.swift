import XCTest
@testable import BBStudio

final class BotApprovalsTests: XCTestCase {
    private final class Calls: @unchecked Sendable {
        private let lock = NSLock()
        private var list: [(method: String, path: String, input: [String: Any])] = []
        func add(_ method: String, _ path: String, _ input: [String: Any]) { lock.withLock { list.append((method, path, input)) } }
        var all: [(method: String, path: String, input: [String: Any])] { lock.withLock { list } }
        var names: [String] { all.map { String($0.path.split(separator: "?").first?.split(separator: "/").last ?? "") } }
    }

    private func makeClient(_ answer: @escaping (String, String, [String: Any]) throws -> (Int, Any)) -> (BBClient, Calls) {
        let client = BBClient(baseURL: URL(string: "https://approvals-\(UUID().uuidString.lowercased()).invalid")!)
        let calls = Calls()
        client.transport = { method, path, body in
            let input = body.flatMap { try? JSONSerialization.jsonObject(with: $0) as? [String: Any] } ?? [:]
            calls.add(method, path, input)
            let name = String(path.split(separator: "?").first?.split(separator: "/").last ?? "")
            let (status, result) = try answer(method, name, input)
            if path.contains("/rpc/") {
                let envelope: [String: Any] = status == 200 ? ["ok": true, "result": result] : ["ok": false, "error": ["message": result]]
                return (status, try JSONSerialization.data(withJSONObject: envelope))
            }
            return (status, try JSONSerialization.data(withJSONObject: result))
        }
        return (client, calls)
    }

    private static let pushView: [String: Any] = [
        "id": "int_push", "state": "pending", "title": "Push to origin", "short": "git push origin main",
        "lines": ["Command: git push origin main", "Cwd: /repo"], "decisions": ["allow_once", "deny", "allow_for_session"],
    ]

    private static let listed: [String: Any] = ["approvals": [["worker": ["threadId": "thr_w", "title": "Fork", "projectId": "p"], "approval": pushView]]]

    func testCardModelReadsStudiosApproval() async throws {
        let (client, calls) = makeClient { _, _, _ -> (Int, Any) in (200, Self.listed) }
        let approvals = try await client.conversationApprovals(threadId: "thr_main")
        XCTAssertEqual(calls.names, ["bot_conversation_approvals"])
        XCTAssertEqual(calls.all.first?.input["threadId"] as? String, "thr_main")
        let approval = try XCTUnwrap(approvals.first)
        XCTAssertEqual(approval.id, "thr_w:int_push")
        XCTAssertEqual(approval.worker, WorkerApproval.Worker(threadId: "thr_w", title: "Fork"))
        XCTAssertEqual(approval.title, "Push to origin")
        XCTAssertEqual(approval.detail, "Command: git push origin main\nCwd: /repo")
        XCTAssertEqual(approval.decisions, [.deny, .allowForSession, .allowOnce], "desktop's order")
        XCTAssertEqual(approval.decisions.map(\.label), ["Deny", "Approve for this worker", "Approve"])
        XCTAssertEqual(approval.askLine, "asks for your approval")
        XCTAssertNil(approval.state.settledLabel)
    }

    func testCardModelFallbacksAndSettledLabels() throws {
        let wire = try JSONDecoder().decode(Studio.BotConversationApprovalsOutputApprovalsItem.self, from: Data(
            #"{"worker":{"threadId":"thr_w","title":"  ","projectId":null},"approval":{"id":"i","state":"approved-session","title":"","short":"","lines":[],"decisions":[]}}"#.utf8))
        let approval = try XCTUnwrap(WorkerApproval(wire))
        XCTAssertEqual(approval.worker.title, "Worker")
        XCTAssertEqual(approval.title, "Approve an action")
        XCTAssertNil(approval.detail)
        XCTAssertEqual(approval.state, .approvedSession)
        XCTAssertEqual(approval.askLine, "asked for approval")
        XCTAssertEqual(WorkerApproval.State.approved.settledLabel, "Approved")
        XCTAssertEqual(WorkerApproval.State.approvedSession.settledLabel, "Approved for this worker")
        XCTAssertEqual(WorkerApproval.State.denied.settledLabel, "Denied")
        XCTAssertEqual(WorkerApproval.State.gone.settledLabel, "No longer waiting")
        let noWorker = try JSONDecoder().decode(Studio.BotConversationApprovalsOutputApprovalsItem.self, from: Data(#"{"approval":{"id":"i"}}"#.utf8))
        XCTAssertNil(WorkerApproval(noWorker))
    }

    @MainActor
    func testApproveResolvesThroughStudioAndSettles() async throws {
        let (client, calls) = makeClient { _, name, _ -> (Int, Any) in
            if name == "bot_worker_approval_resolve" {
                var view = Self.pushView
                view["state"] = "approved"
                return (200, ["approval": view])
            }
            return (200, Self.listed)
        }
        let model = ConversationApprovals()
        model.settleDelay = .milliseconds(50)
        await model.load("thr_main", client: client)
        XCTAssertTrue(model.waiting)
        let state = await model.decide("thr_w:int_push", .allowOnce, client: client)
        XCTAssertEqual(state, .approved)
        let resolve = try XCTUnwrap(calls.all.last)
        XCTAssertEqual(resolve.input["threadId"] as? String, "thr_w", "the worker's thread, not the conversation")
        XCTAssertEqual(resolve.input["interactionId"] as? String, "int_push")
        XCTAssertEqual(resolve.input["decision"] as? String, "allow_once")
        XCTAssertEqual(model.cards.first?.approval.state, .approved)
        XCTAssertNil(model.cards.first?.busy)
        XCTAssertFalse(model.waiting)
        await model.load("thr_main", client: client)
        XCTAssertEqual(model.cards.first?.approval.state, .approved, "a reload doesn't bring the buttons back")
        try await Task.sleep(for: .milliseconds(300))
        XCTAssertTrue(model.cards.isEmpty, "the settled card goes after a moment")
    }

    @MainActor
    func testDenyWithoutAStateFromStudioIsDenied() async throws {
        let (client, _) = makeClient { _, name, _ -> (Int, Any) in
            if name == "bot_worker_approval_resolve" { return (200, ["approval": NSNull()]) }
            return (200, Self.listed)
        }
        let model = ConversationApprovals()
        await model.load("thr_main", client: client)
        let state = await model.decide("thr_w:int_push", .deny, client: client)
        XCTAssertEqual(state, .denied)
    }

    @MainActor
    func testRefusedResolveShowsStudiosReasonAndKeepsTheButtons() async throws {
        let (client, _) = makeClient { _, name, _ -> (Int, Any) in
            if name == "bot_worker_approval_resolve" { return (400, "That approval isn't waiting any more.") }
            return (200, Self.listed)
        }
        let model = ConversationApprovals()
        await model.load("thr_main", client: client)
        let state = await model.decide("thr_w:int_push", .allowOnce, client: client)
        XCTAssertNil(state)
        let card = try XCTUnwrap(model.cards.first)
        XCTAssertEqual(card.error, "That approval isn't waiting any more.")
        XCTAssertEqual(card.approval.state, .pending)
        XCTAssertNil(card.busy)
    }

    @MainActor
    func testOfflineApproveFailsVisiblyAndNeverQueues() async throws {
        nonisolated(unsafe) var offline = false
        let (client, calls) = makeClient { _, name, _ -> (Int, Any) in
            if name == "bot_worker_approval_resolve", offline { throw URLError(.notConnectedToInternet) }
            return (200, Self.listed)
        }
        let model = ConversationApprovals()
        await model.load("thr_main", client: client)
        offline = true
        let state = await model.decide("thr_w:int_push", .allowOnce, client: client)
        XCTAssertNil(state)
        let card = try XCTUnwrap(model.cards.first)
        XCTAssertEqual(card.error, "Not sent. You're offline. Try again once BB is reachable.")
        XCTAssertEqual(card.approval.state, .pending)
        offline = false
        await model.load("thr_main", client: client)
        try await Task.sleep(for: .milliseconds(200))
        XCTAssertEqual(calls.names.filter { $0 == "bot_worker_approval_resolve" }.count, 1, "nothing is sent later")
        XCTAssertTrue(Outbox.shared.messages(for: "thr_main").isEmpty)
        XCTAssertTrue(Outbox.shared.messages(for: "thr_w").isEmpty)
    }

    func testUnreachableIsNotSentButATimeoutMayHaveLanded() {
        let server = URL(string: "https://mac.example.test")!
        XCTAssertEqual(WorkerApproval.failure(URLError(.cannotConnectToHost), server: server),
                       "Not sent. Can't reach BB at mac.example.test. Is Tailscale connected? Try again once BB is reachable.")
        XCTAssertEqual(WorkerApproval.failure(URLError(.timedOut), server: server), "Can't reach BB at mac.example.test. Is Tailscale connected?")
    }

    func testNotificationApproveForAWorkerCallsStudio() async throws {
        let (client, calls) = makeClient { _, _, _ -> (Int, Any) in (200, ["approval": NSNull()]) }
        try await NotificationActions.resolveApproval(["threadId": "thr_main", "workerId": "thr_w"], threadId: "thr_main", interactionId: "int_push",
                                                      approve: true, plan: false, client: client)
        XCTAssertEqual(calls.names, ["bot_worker_approval_resolve"])
        XCTAssertEqual(calls.all.first?.input["threadId"] as? String, "thr_w")
        XCTAssertEqual(calls.all.first?.input["interactionId"] as? String, "int_push")
        XCTAssertEqual(calls.all.first?.input["decision"] as? String, "allow_once")
    }

    func testNotificationDenyOnAWorkersOwnPushAsksStudioWhatTheThreadIs() async throws {
        let (client, calls) = makeClient { _, name, _ -> (Int, Any) in
            if name == "bot_thread_info" { return (200, ["info": ["threadId": "thr_w", "kind": "worker", "status": "needs-you", "waitingOn": "approval"]]) }
            return (200, ["approval": NSNull()])
        }
        try await NotificationActions.resolveApproval(["threadId": "thr_w"], threadId: "thr_w", interactionId: "int_push",
                                                      approve: false, plan: false, client: client)
        XCTAssertEqual(calls.names, ["bot_thread_info", "bot_worker_approval_resolve"])
        XCTAssertEqual(calls.all.last?.input["decision"] as? String, "deny")
    }

    func testNotificationApproveOnAnOrdinaryThreadKeepsBBsResolve() async throws {
        let pending: [[String: Any]] = [["id": "int_a", "threadId": "thr_a", "status": "pending",
                                         "payload": ["kind": "approval", "availableDecisions": ["allow_once", "deny"]]]]
        let (client, calls) = makeClient { _, name, _ -> (Int, Any) in
            switch name {
            case "bot_thread_info": return (200, ["info": ["threadId": "thr_a", "kind": "conversation"]])
            case "interactions": return (200, pending)
            default: return (200, pending[0])
            }
        }
        try await NotificationActions.resolveApproval(["threadId": "thr_a"], threadId: "thr_a", interactionId: "int_a",
                                                      approve: true, plan: false, client: client)
        XCTAssertEqual(calls.names, ["bot_thread_info", "interactions", "resolve"])
    }

    func testNotificationPlanAndAMissingStudioKeepBBsResolve() async throws {
        let pending: [[String: Any]] = [["id": "int_a", "threadId": "thr_a", "status": "pending",
                                         "payload": ["kind": "approval", "availableDecisions": ["allow_once", "deny"]]]]
        let (client, calls) = makeClient { _, name, _ -> (Int, Any) in
            switch name {
            case "bot_thread_info": return (404, "unknown plugin")
            case "interactions": return (200, pending)
            default: return (200, pending[0])
            }
        }
        try await NotificationActions.resolveApproval(["threadId": "thr_a", "workerId": "thr_w"], threadId: "thr_a", interactionId: "int_a",
                                                      approve: true, plan: true, client: client)
        XCTAssertEqual(calls.names, ["interactions", "resolve"], "a plan review stays BB's")
        try await NotificationActions.resolveApproval(["threadId": "thr_a"], threadId: "thr_a", interactionId: "int_a",
                                                      approve: false, plan: false, client: client)
        XCTAssertEqual(calls.names.suffix(3), ["bot_thread_info", "interactions", "resolve"])
    }

    func testNotificationActionOfflineFailsAndSaysSo() async throws {
        let (client, calls) = makeClient { _, _, _ -> (Int, Any) in throw URLError(.notConnectedToInternet) }
        do {
            try await NotificationActions.resolveApproval(["threadId": "thr_main", "workerId": "thr_w"], threadId: "thr_main",
                                                          interactionId: "int_push", approve: true, plan: false, client: client)
            XCTFail("offline must fail")
        } catch {
            XCTAssertEqual(NotificationActions.approvalFailure(error, approve: true),
                           "Approve didn't go through, and nothing was queued. You're offline. Tap to open the thread.")
        }
        XCTAssertEqual(calls.names, ["bot_worker_approval_resolve"], "tried once, never retried")
    }

    func testWorkerApprovalsCategoryKeepsApproveAndDeny() throws {
        let category = try XCTUnwrap(NotificationActions.categories().first { $0.identifier == "BB_APPROVAL" })
        XCTAssertEqual(category.actions.map(\.identifier), [NotificationActions.approve, NotificationActions.deny])
        XCTAssertEqual(category.actions.map(\.title), ["Approve", "Deny"])
    }

    func testWidgetShowsAWorkersApprovalAndRoutesItToStudio() {
        let approval = WorkerApproval(worker: .init(threadId: "thr_w", title: "Fork"), interactionId: "int_push",
                                      title: "Push to origin", short: "git push origin main")
        let widget = BotApproval(worker: approval)
        XCTAssertEqual(widget?.summary, "Fork: git push origin main")
        XCTAssertEqual(widget?.workerThreadId, "thr_w")
        XCTAssertEqual(widget?.canApprove, true)
        XCTAssertEqual(widget?.canDeny, true)
        var settled = approval
        settled.state = .approved
        XCTAssertNil(BotApproval(worker: settled))
    }
}
