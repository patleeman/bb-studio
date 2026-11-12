import SwiftUI
import XCTest
@testable import BBStudio

final class BotConversationsTests: XCTestCase {
    private func makeClient(_ answer: @escaping (String, [String: Any]) -> Any) -> (BBClient, () -> [(String, [String: Any])]) {
        let client = BBClient(baseURL: URL(string: "https://conversations-\(UUID().uuidString.lowercased()).invalid")!)
        let lock = NSLock()
        nonisolated(unsafe) var calls: [(String, [String: Any])] = []
        client.transport = { _, path, body in
            let method = String(path.split(separator: "/").last ?? "")
            let input = body.flatMap { try? JSONSerialization.jsonObject(with: $0) as? [String: Any] } ?? [:]
            lock.withLock { calls.append((method, input)) }
            return (200, try JSONSerialization.data(withJSONObject: ["ok": true, "result": answer(method, input)]))
        }
        return (client, { lock.withLock { calls } })
    }

    private static func row(_ json: String) throws -> TimelineRow {
        try JSONDecoder().decode(TimelineRow.self, from: Data(json.utf8))
    }

    private static func view(_ workers: [(String, String, String)]) throws -> BotThreadsView {
        let list = workers.map { #"{"threadId":"\#($0.0)","title":"\#($0.0)","status":"\#($0.1)","ownerConversationId":"\#($0.2)"}"# }
        let json = #"{"botId":"bot_a","conversations":[],"workers":[\#(list.joined(separator: ","))]}"#
        return BotThreadsView(try JSONDecoder().decode(Studio.BotThreadsViewOutput.self, from: Data(json.utf8)))
    }

    func testReplyInThreadCreatesThenReuses() async throws {
        let (client, calls) = makeClient { _, _ in ["threadId": "thr_side", "projectId": "proj", "created": true] }
        let opened = try await client.threadReply(threadId: "thr_main", messageId: "thr_main:assistant:1", sourceSeqEnd: 42)
        XCTAssertEqual(opened, BotMessageThread(threadId: "thr_side", created: true))
        let call = try XCTUnwrap(calls().first)
        XCTAssertEqual(call.0, "bot_thread_reply")
        XCTAssertEqual(call.1["threadId"] as? String, "thr_main")
        XCTAssertEqual(call.1["messageId"] as? String, "thr_main:assistant:1")
        XCTAssertEqual(call.1["sourceSeqEnd"] as? Int, 42)
        let side = BotSideThread(messageId: "thr_main:assistant:1", threadId: "thr_side", replies: 0, lastReplyAt: nil, working: false)
        XCTAssertEqual(ConversationReplies.existing(["thr_main:assistant:1": side], messageId: "thr_main:assistant:1"), "thr_side", "a second tap reuses it")
        XCTAssertNil(ConversationReplies.existing(["thr_main:assistant:1": side], messageId: "other"))
    }

    func testReplyOmitsAMissingSequence() async throws {
        let (client, calls) = makeClient { _, _ in ["threadId": "thr_side", "projectId": NSNull(), "created": false] }
        let opened = try await client.threadReply(threadId: "thr_main", messageId: "m", sourceSeqEnd: nil)
        XCTAssertFalse(opened.created)
        XCTAssertNil(calls().first?.1["sourceSeqEnd"])
    }

    func testIndicatorModel() throws {
        let now = Date()
        var side = BotSideThread(messageId: "m", threadId: "t", replies: 2, lastReplyAt: (now.timeIntervalSince1970 - 300) * 1000, working: false)
        side.lastReplyRole = "assistant"
        let label = try XCTUnwrap(ConversationReplies.indicator(side, now: now))
        XCTAssertTrue(label.hasPrefix("2 replies · Last reply "), label)
        XCTAssertFalse(label.contains("💬"))
        side.working = true
        XCTAssertEqual(ConversationReplies.indicator(side, now: now), "Replying…")
        side.working = false
        XCTAssertEqual(ConversationReplies.replier(side), .bot)
        side.lastReplyRole = "user"
        XCTAssertEqual(ConversationReplies.replier(side), .you)
        let fresh = BotSideThread(messageId: "m", threadId: "t", replies: 0, lastReplyAt: nil, working: false)
        XCTAssertNil(ConversationReplies.indicator(fresh, now: now), "an empty thread shows nothing")
        XCTAssertNil(ConversationReplies.replier(fresh))
        XCTAssertNil(ConversationReplies.indicator(nil))
        let decoded = try JSONDecoder().decode(BotSideThread.self, from: Data(#"{"messageId":"m","threadId":"t","botId":"bot_a","replies":1,"lastReplyAt":null,"lastReplyRole":"user","working":false}"#.utf8))
        XCTAssertEqual(decoded.lastReplyRole, "user")
        XCTAssertEqual(decoded.botId, "bot_a")
    }

    func testOnlyAssistantRepliesGetThreadsAndForks() throws {
        let reply = try Self.row(#"{"id":"a1","kind":"conversation","role":"assistant","text":"Done.","sourceSeqEnd":7}"#)
        let mine = try Self.row(#"{"id":"u1","kind":"conversation","role":"user","text":"Hi","sourceSeqEnd":3}"#)
        let pass = try Self.row(#"{"id":"p1","kind":"conversation","role":"assistant","text":"[PASS]","sourceSeqEnd":9}"#)
        let unsequenced = try Self.row(#"{"id":"a2","kind":"conversation","role":"assistant","text":"Done."}"#)
        XCTAssertTrue(ConversationReplies.canThread(reply))
        XCTAssertTrue(ConversationReplies.canFork(reply))
        XCTAssertFalse(ConversationReplies.canThread(mine))
        XCTAssertFalse(ConversationReplies.canThread(pass))
        XCTAssertTrue(ConversationReplies.canThread(unsequenced))
        XCTAssertFalse(ConversationReplies.canFork(unsequenced), "BB needs the turn's sequence to fork")
    }

    func testForkSendsTheParentMessage() async throws {
        let (client, calls) = makeClient { _, _ in ["threadId": "thr_fork", "projectId": "proj"] }
        let id = try await client.forkConversation(threadId: "thr_main", messageId: "m3", sourceSeqEnd: 12)
        XCTAssertEqual(id, "thr_fork")
        let call = try XCTUnwrap(calls().first)
        XCTAssertEqual(call.0, "bot_fork_conversation")
        XCTAssertEqual(call.1["messageId"] as? String, "m3")
        XCTAssertEqual(call.1["sourceSeqEnd"] as? Int, 12)
        XCTAssertTrue(call.1["turnId"] is NSNull)
    }

    func testForkRecordsItsParentInTheDemoStudio() throws {
        let state = BotSpacesDemo.State()
        let body = try JSONSerialization.data(withJSONObject: ["threadId": BotDemo.threadId, "messageId": "m1", "turnId": NSNull(), "sourceSeqEnd": 1])
        let answer = try XCTUnwrap(state.respond("POST", "/api/v1/plugins/studio/rpc/bot_fork_conversation", body))
        let fork = try XCTUnwrap(((try JSONSerialization.jsonObject(with: answer.1) as? [String: Any])?["result"] as? [String: Any])?["threadId"] as? String)
        let view = BotThreadsView(try JSONDecoder().decode(Studio.BotThreadsViewOutput.self, from: state.viewJSON("bot_juniper")))
        let parent = try XCTUnwrap(view.conversations.first { $0.threadId == fork }?.forkedFrom)
        XCTAssertEqual(parent.threadId, BotDemo.threadId)
        XCTAssertEqual(parent.messageId, "m1")
        XCTAssertTrue(view.threads(of: BotDemo.threadId).contains { $0.threadId == fork }, "it lists under its parent")
        let sides = try JSONSerialization.data(withJSONObject: ["threadId": BotDemo.threadId])
        let listed = try XCTUnwrap(state.respond("POST", "/api/v1/plugins/studio/rpc/bot_side_threads", sides))
        XCTAssertTrue(String(decoding: listed.1, as: UTF8.self).contains(fork), "the replies row shows under the message too")
    }

    func testModelChip() async throws {
        let (client, calls) = makeClient { _, _ in ["model": ["providerId": "claude-code", "model": "claude-opus-5-5", "reasoningLevel": "high", "modelName": "Opus 5.5"]] }
        let model = try await client.conversationModel(threadId: "thr_main")
        XCTAssertEqual(model?.chip, "Opus 5.5")
        XCTAssertEqual(calls().first?.0, "thread_model")
        XCTAssertEqual(ConversationModel(providerId: "codex", model: "gpt-6", reasoningLevel: nil, modelName: " ").chip, "gpt-6", "the id when it has no name")
        XCTAssertNil(ConversationModel(providerId: nil, model: nil, reasoningLevel: nil, modelName: nil).chip)
        let (empty, _) = makeClient { _, _ in ["model": NSNull()] }
        let none = try await empty.conversationModel(threadId: "thr_main")
        XCTAssertNil(none)
    }

    func testFinish() async throws {
        let (client, calls) = makeClient { _, _ in ["state": "finishing"] }
        let state = try await client.finishConversation(threadId: "thr_side")
        XCTAssertEqual(state, "finishing")
        XCTAssertEqual(calls().first?.0, "bot_finish")
        XCTAssertEqual(calls().first?.1["threadId"] as? String, "thr_side")
        let json = #"{"botId":"b","conversations":[{"threadId":"m","title":"Main","isMain":true},{"threadId":"o","title":"Other","isMain":false}],"workers":[]}"#
        let view = BotThreadsView(try JSONDecoder().decode(Studio.BotThreadsViewOutput.self, from: Data(json.utf8)))
        XCTAssertFalse(ConversationFinish.can(view.conversations[0]), "Main never finishes")
        XCTAssertTrue(ConversationFinish.can(view.conversations[1]))
        XCTAssertFalse(ConversationFinish.can(nil))
    }

    func testNewConversationUsesTheBotsDefaultModel() async throws {
        let (client, calls) = makeClient { method, _ in
            method == "bot_get" ? ["bot": ["defaultModel": ["providerId": "codex", "model": "gpt-6", "reasoningLevel": "low"]]] as [String: Any]
                : ["threadId": "thr_new", "projectId": "proj"]
        }
        let id = try await client.startConversation(botId: "bot_a", projectId: "proj", text: "Plan the trip")
        XCTAssertEqual(id, "thr_new")
        let start = try XCTUnwrap(calls().first { $0.0 == "bot_conversation_start" })
        XCTAssertEqual(start.1["botId"] as? String, "bot_a")
        let request = try XCTUnwrap(start.1["request"] as? [String: Any])
        XCTAssertEqual(request["projectId"] as? String, "proj")
        XCTAssertEqual(request["model"] as? String, "gpt-6")
        XCTAssertEqual(((request["input"] as? [[String: Any]])?.first)?["text"] as? String, "Plan the trip")
    }

    func testQuietCheckRendersForPass() throws {
        let pass = try Self.row(#"{"id":"p1","kind":"conversation","role":"assistant","text":"[PASS]"}"#)
        XCTAssertTrue(pass.isPassReply)
        let controller = UIHostingController(rootView: QuietCheckMarker())
        let size = controller.sizeThatFits(in: CGSize(width: 320, height: 200))
        XCTAssertGreaterThan(size.height, 0)
        XCTAssertLessThan(size.height, 30, "a small marker, not a message")
    }

    func testWorkersLineCount() throws {
        let view = try Self.view([("w1", "running", "c"), ("w2", "needs-you", "c"), ("w3", "done", "c"), ("w4", "running", "other")])
        let line = WorkersLine(conversationId: "c", view: view)
        XCTAssertEqual(line.count, 2, "running and needs-you workers from this conversation")
        XCTAssertEqual(line.label, "2 workers from here")
        XCTAssertEqual(line.workers.first?.threadId, "w2", "needs you first")
        XCTAssertTrue(line.needsYou && line.running)
        XCTAssertEqual(WorkersLine(conversationId: "other", view: view).label, "1 worker from here")
        XCTAssertTrue(WorkersLine(conversationId: "none", view: view).isEmpty)
        XCTAssertTrue(WorkersLine(conversationId: "c", view: nil).isEmpty)
    }
}
