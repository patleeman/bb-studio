import XCTest
@testable import BBStudio

/// New conversation's draft: one per Bot and one for a plain thread, per
/// server, kept until it's sent or cleared.
final class NewConversationDraftTests: XCTestCase {
    private let a = URL(string: "https://new-drafts-a.invalid")!
    private let b = URL(string: "https://new-drafts-b.invalid")!
    private var bot = ""

    override func setUp() { bot = "bot_test\(UUID().uuidString.prefix(8))" }
    override func tearDown() {
        for server in [a, b] {
            NewConversationDraft.clear(botId: bot, serverURL: server)
            NewConversationDraft.clear(botId: nil, serverURL: server)
        }
    }

    func testEachBotAndAPlainThreadKeepTheirOwn() {
        NewConversationDraft.save(text: "for the Bot", botId: bot, serverURL: a)
        NewConversationDraft.save(text: "a plain thread", botId: nil, serverURL: a)
        XCTAssertEqual(NewConversationDraft.load(botId: bot, serverURL: a).text, "for the Bot")
        XCTAssertEqual(NewConversationDraft.load(botId: nil, serverURL: a).text, "a plain thread")
        XCTAssertEqual(NewConversationDraft.load(botId: "", serverURL: a).text, "a plain thread", "an empty Bot id is no Bot")
        XCTAssertNil(NewConversationDraft.load(botId: bot, serverURL: b).text, "another server has none")
    }

    func testTheKeyNeverMeetsAThreadsDraft() {
        XCTAssertNotEqual(NewConversationDraft.key(botId: bot), bot)
        XCTAssertFalse(NewConversationDraft.key(botId: nil).hasPrefix("thr_"))
    }

    func testPhotosAndFilesComeBackAndClearingRemovesEverything() {
        let file = PendingAttachment(data: Data("notes".utf8), name: "notes.txt", mimeType: "text/plain")
        NewConversationDraft.save(text: "with a file", botId: bot, serverURL: a)
        NewConversationDraft.save(attachments: [file], botId: bot, serverURL: a)
        XCTAssertEqual(NewConversationDraft.load(botId: bot, serverURL: a).attachments.map(\.id), [file.id])

        NewConversationDraft.clear(botId: bot, serverURL: a)
        let cleared = NewConversationDraft.load(botId: bot, serverURL: a)
        XCTAssertNil(cleared.text)
        XCTAssertTrue(cleared.attachments.isEmpty)
    }

    func testEmptyTextIsNoDraft() {
        NewConversationDraft.save(text: "something", botId: bot, serverURL: a)
        NewConversationDraft.save(text: "  \n", botId: bot, serverURL: a)
        XCTAssertNil(NewConversationDraft.load(botId: bot, serverURL: a).text)
    }

    func testOpeningKeepsTheDraftAndWhatWasHandedIn() {
        XCTAssertEqual(NewConversationDraft.opening(saved: nil, prefill: ""), "")
        XCTAssertEqual(NewConversationDraft.opening(saved: nil, prefill: "[Page](/p) "), "[Page](/p) ")
        XCTAssertEqual(NewConversationDraft.opening(saved: "Plan the trip", prefill: ""), "Plan the trip")
        XCTAssertEqual(NewConversationDraft.opening(saved: "Plan the trip", prefill: "[Page](/p) "), "Plan the trip\n\n[Page](/p) ")
        XCTAssertEqual(NewConversationDraft.opening(saved: "Plan the trip\n", prefill: "[Page](/p) "), "Plan the trip\n\n[Page](/p) ")
        XCTAssertEqual(NewConversationDraft.opening(saved: "Plan the trip\n\n[Page](/p) ", prefill: "[Page](/p) "),
                       "Plan the trip\n\n[Page](/p) ", "opened again with the same link: not twice")
        XCTAssertEqual(NewConversationDraft.opening(saved: "  ", prefill: "hello"), "hello")
    }

    func testSwitchingBotsMovesTheMessageWithoutLosingTheOtherBotsDraft() {
        let other = bot + "-other"
        defer { NewConversationDraft.clear(botId: other, serverURL: a) }
        let file = PendingAttachment(data: Data("notes".utf8), name: "notes.txt", mimeType: "text/plain")
        NewConversationDraft.save(text: "for the first Bot", botId: bot, serverURL: a)

        // Switched to a Bot with nothing waiting: the message moves, the first Bot keeps none.
        var shown = NewConversationDraft.switched(text: "for the first Bot", attachments: [file], from: bot, to: other, serverURL: a)
        XCTAssertEqual(shown.text, "for the first Bot")
        XCTAssertEqual(shown.attachments.map(\.id), [file.id])
        XCTAssertNil(NewConversationDraft.load(botId: bot, serverURL: a).text, "not left under the Bot it was opened for")
        XCTAssertTrue(NewConversationDraft.load(botId: bot, serverURL: a).attachments.isEmpty)
        XCTAssertEqual(NewConversationDraft.load(botId: other, serverURL: a).text, "for the first Bot")
        XCTAssertEqual(NewConversationDraft.load(botId: other, serverURL: a).attachments.map(\.id), [file.id])

        // Back to a Bot that has a draft of its own: both are kept, its own first.
        NewConversationDraft.save(text: "already waiting", botId: bot, serverURL: a)
        shown = NewConversationDraft.switched(text: "typed here", attachments: [], from: other, to: bot, serverURL: a)
        XCTAssertEqual(shown.text, "already waiting\n\ntyped here")
        XCTAssertEqual(NewConversationDraft.load(botId: bot, serverURL: a).text, "already waiting\n\ntyped here")
        XCTAssertNil(NewConversationDraft.load(botId: other, serverURL: a).text)

        // To no Bot (a plain thread) and the same key again: nothing moves.
        shown = NewConversationDraft.switched(text: "same", attachments: [], from: "", to: nil, serverURL: a)
        XCTAssertEqual(shown.text, "same")
    }
}
