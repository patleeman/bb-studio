import XCTest
@testable import BBStudio

/// Code review fixes: links that come before the Bots load (M7), plain bb
/// thread links in Spaces mode (L9), and late Memory searches (L10).
@MainActor
final class ReviewFixesTests: XCTestCase {
    private static let spacesJSON = #"{"bots":[{"id":"bot_a","name":"Ada","primary":true,"mainThreadId":"thr_main"}],"currentBotId":"bot_a"}"#
    private static let viewJSON = #"{"botId":"bot_a","conversations":[{"threadId":"thr_main","title":"Main","isMain":true,"updatedAt":1,"running":false},{"threadId":"thr_side","title":"Side","updatedAt":1,"running":false}],"workers":[{"threadId":"thr_worker","status":"running","title":"W"}],"hiddenWorkers":0,"hiddenToday":0,"olderConversations":0}"#

    private func seeded() throws -> BotSpacesStore {
        let store = BotSpacesStore(serverURL: URL(string: "https://review.invalid")!)
        let spaces = BotSpaces(try JSONDecoder().decode(Studio.BotSpacesOutput.self, from: Data(Self.spacesJSON.utf8)))
        let view = BotThreadsView(try JSONDecoder().decode(Studio.BotThreadsViewOutput.self, from: Data(Self.viewJSON.utf8)))
        store.seedForDemo(spaces, views: ["bot_a": view])
        return store
    }

    func testALinkWaitsForTheBotsThenOpensAndCanOpenAgain() throws {
        let empty = BotSpacesStore(serverURL: URL(string: "https://review.invalid")!)
        let shell = Router()
        shell.open(.place(.memory, botId: nil))
        XCTAssertFalse(shell.consume(empty), "kept until the Bots load")
        XCTAssertEqual(shell.path, [])

        let store = try seeded()
        shell.land(store) { _, main in main }
        XCTAssertTrue(shell.consume(store))
        XCTAssertEqual(shell.path, [.place(.memory)], "the link opens over Home")
        XCTAssertNil(shell.pending, "followed once")

        shell.openConversation("thr_main")
        shell.open(.place(.memory, botId: nil))
        XCTAssertTrue(shell.consume(store), "the same link works a second time")
        XCTAssertEqual(shell.path, [.place(.memory)])
    }

    func testOnlyBotThreadsOpenInTheShell() throws {
        let empty = BotSpacesStore(serverURL: URL(string: "https://review.invalid")!)
        XCTAssertNil(empty.knows(threadId: "thr_x"), "nothing loaded: can't tell")
        let store = try seeded()
        XCTAssertEqual(store.knows(threadId: "thr_main"), true)
        XCTAssertEqual(store.knows(threadId: "thr_side"), true)
        XCTAssertEqual(store.knows(threadId: "thr_worker"), true)
        XCTAssertEqual(store.knows(threadId: "thr_plain_bb"), false)
    }
}

/// Review M9: forks show under their message and stay reachable.
final class ForkLineTests: XCTestCase {
    private func side(_ message: String, _ thread: String, kind: String?, replies: Int = 0, conversations: Int? = nil) -> BotSideThread {
        BotSideThread(messageId: message, threadId: thread, replies: replies, lastReplyAt: nil, working: false, kind: kind, conversations: conversations)
    }

    func testAForkOnlyMessageShowsForkedHereAndNoRepliesLine() {
        let threads = BotSideThread.byMessage([side("m1", "fork1", kind: "fork", conversations: 1)])
        XCTAssertEqual(ConversationReplies.forkIndicator(threads["m1"]), "Forked here · 1 conversation")
        XCTAssertNil(ConversationReplies.indicator(threads["m1"]), "no replies line for a fork")
        XCTAssertNil(ConversationReplies.existing(threads, messageId: "m1"), "Reply in thread never continues a fork")
        XCTAssertEqual(threads["m1"]?.fork?.threadId, "fork1")
    }

    func testAReplyThreadAndForksAtOneMessageShowBothLines() {
        let threads = BotSideThread.byMessage([
            side("m1", "fork1", kind: "fork", conversations: 3),
            side("m1", "reply1", kind: "reply", replies: 2),
        ])
        XCTAssertEqual(ConversationReplies.indicator(threads["m1"]), "2 replies")
        XCTAssertEqual(ConversationReplies.existing(threads, messageId: "m1"), "reply1")
        XCTAssertEqual(ConversationReplies.forkIndicator(threads["m1"]), "Forked here · 3 conversations")
        XCTAssertEqual(threads["m1"]?.fork?.threadId, "fork1")
    }

    func testOlderStudiosWithoutKindAreReplies() {
        let threads = BotSideThread.byMessage([side("m1", "t1", kind: nil, replies: 1)])
        XCTAssertEqual(ConversationReplies.indicator(threads["m1"]), "1 reply")
        XCTAssertNil(ConversationReplies.forkIndicator(threads["m1"]))
    }

    func testAForkJustMadeShowsBeforeStudioListsIt() {
        var threads = BotSideThread.adding(fork: "fork9", at: "m2", to: [:])
        XCTAssertEqual(ConversationReplies.forkIndicator(threads["m2"]), "Forked here · 1 conversation")
        threads = BotSideThread.adding(fork: "fork9", at: "m3", to: BotSideThread.byMessage([side("m3", "reply3", kind: "reply", replies: 1)]))
        XCTAssertEqual(ConversationReplies.existing(threads, messageId: "m3"), "reply3")
        XCTAssertEqual(threads["m3"]?.fork?.threadId, "fork9")
    }

    func testTheSideThreadsWireCarriesKindAndConversations() throws {
        let json = #"[{"messageId":"m1","threadId":"f","replies":0,"working":false,"kind":"fork","conversations":2}]"#
        let decoded = try JSONDecoder().decode([BotSideThread].self, from: Data(json.utf8))
        XCTAssertEqual(ConversationReplies.forkIndicator(BotSideThread.byMessage(decoded)["m1"]), "Forked here · 2 conversations")
    }
}
