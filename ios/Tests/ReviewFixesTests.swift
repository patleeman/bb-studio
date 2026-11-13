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
        let shell = BotShellModel()
        let link = BotShellLink.page(.memory, botId: nil)
        XCTAssertTrue(shell.consume(link: link, route: nil, store: empty) == (false, false), "kept until the Bots load")
        XCTAssertNil(shell.selection)

        let store = try seeded()
        shell.land(store)
        XCTAssertTrue(shell.consume(link: link, route: nil, store: store) == (true, false))
        XCTAssertEqual(shell.selection, .page(.memory), "the link wins over landing on Main")

        shell.openConversation("thr_main")
        XCTAssertTrue(shell.consume(link: link, route: nil, store: store) == (true, false), "the same link works a second time")
        XCTAssertEqual(shell.selection, .page(.memory))
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

    func testALateMemorySearchDoesNotReplaceTheCurrentOne() {
        let asked = MemoryQuery(query: "old", topic: nil, sort: "newest")
        XCTAssertFalse(asked.matches(query: "new", topic: nil, sort: "newest"))
        XCTAssertFalse(asked.matches(query: "old", topic: "work", sort: "newest"))
        XCTAssertFalse(asked.matches(query: "old", topic: nil, sort: "oldest"))
        XCTAssertTrue(asked.matches(query: "old", topic: nil, sort: "newest"))
    }
}
