import XCTest
@testable import BBStudio

final class ComposerTests: XCTestCase {
    func testSmartReactionRules() {
        XCTAssertEqual(Directive.reactions(in: "Answer\n::reactions{items=\"👍 Ship it|🧪 Tests, then ship\"}"),
            ["👍 Ship it", "🧪 Tests, then ship"])
        XCTAssertEqual(Directive.reactions(in: "::reactions{items=\"👍|👍 Agree|👍  Agree|❓ Why\"}"),
            ["👍 Agree", "❓ Why"])
        XCTAssertEqual(Directive.parseReactions("✅\n Do   it"), ["✅ Do it"])
        XCTAssertEqual(Directive.reactions(in: "::reactions{items=\" | \"}"), [])
        let many = (1...9).map { "🔢 Option \($0)" }.joined(separator: "|")
        XCTAssertEqual(Directive.reactions(in: "::reactions{items=\"\(many)\"}").count, 5)
        XCTAssertEqual(Directive.reactions(in: "```\n::reactions{items=\"👍 Agree\"}\n```"), [])
        XCTAssertEqual(Directive.reactions(in: "::reactions{items=\"👍 Agree\"}\nLater text"), [])
        let long = "🐢 " + String(repeating: "slow ", count: 20)
        XCTAssertEqual(Directive.reactions(in: "::reactions{items=\"\(long)|❓ Why\"}"), ["❓ Why"])
    }

    func testNextRowParsing() {
        let next = Directive.next(in: "Done.\n::next{reply=\"👍 Ship it|🧪 Add tests first\" explore=\"🐛 Something\" do=\"📄 Write up the plan as a page\"}")
        XCTAssertEqual(next.reply, ["👍 Ship it", "🧪 Add tests first"])
        XCTAssertEqual(next.ask, ["📄 Write up the plan as a page"])
        // Explore and btw notes need an explainer, so they're left out; a reply alone is fine.
        XCTAssertEqual(Directive.next(in: "::next{btw=\"🐛 It breaks\" explore=\"🐛 Why\"}").isEmpty, true)
        XCTAssertEqual(Directive.next(in: "::next{do=\"🧵 Start a thread\"}"), .init(reply: [], ask: ["🧵 Start a thread"]))
        // No emoji gets 🔎; emoji without a space, variation selectors, keycaps and flags split; dupes and empties drop.
        XCTAssertEqual(Directive.parseNextItems("Ship it|🐛Retry| 🏗️  How it  works |1️⃣ First|🇺🇸 Flag||👍 ship IT|3 tries|🐛", max: 9),
            ["🔎 Ship it", "🐛 Retry", "🏗️ How it works", "1️⃣ First", "🇺🇸 Flag", "🔎 3 tries"])
        XCTAssertEqual(Directive.parseNextItems((1...9).map { "🔢 Option \($0)" }.joined(separator: "|"), max: 5).count, 5)
        let long = Directive.parseNextItems("🐢 " + String(repeating: "slow ", count: 30), max: 5)
        XCTAssertEqual(long.count, 1)
        XCTAssertTrue(long[0].hasSuffix("slow…"))
        XCTAssertLessThanOrEqual(long[0].count, 82)
        // A stray quote or brace doesn't crash, and the directive must be the last line outside code.
        _ = Directive.next(in: "::next{reply=\"👍 Ship \"it\"|❓ Why\" do=\"📄 {x}\"}")
        _ = Directive.next(in: "::next{reply=\"👍 Ship it}")
        XCTAssertEqual(Directive.parseNextItems("👍 \"Ship\" {it}", max: 5), ["👍 Ship it"])
        XCTAssertTrue(Directive.next(in: "```\n::next{reply=\"👍 Ship it\"}\n```").isEmpty)
        XCTAssertTrue(Directive.next(in: "::next{reply=\"👍 Ship it\"}\nLater").isEmpty)
        // ::reactions still works alongside, and neither reads the other's line.
        XCTAssertEqual(Directive.reactions(in: "::reactions{items=\"👍 Agree|❓ Why\"}"), ["👍 Agree", "❓ Why"])
        XCTAssertEqual(Directive.reactions(in: "::next{reply=\"👍 Agree\"}"), [])
        XCTAssertTrue(Directive.next(in: "::reactions{items=\"👍 Agree\"}").isEmpty)
    }

    func testCommandAndReactionParsing() {
        XCTAssertEqual(CommandSuggestions.query(in: "/review"), "review")
        XCTAssertEqual(CommandSuggestions.query(in: "Please /review"), "review")
        XCTAssertNil(CommandSuggestions.query(in: "path/to/file"))
        XCTAssertEqual(ReactionSettings.parseItems("👍 Agree; 👎 Disagree\n✅ Do it"),
            ["👍 Agree", "👎 Disagree", "✅ Do it"])
        var settings = ReactionSettings.defaults
        XCTAssertEqual(settings.draft("👍 Agree", selection: "first\nsecond"),
            "> first\n> second\n\n👍 Agree")
        settings.quotePosition = "after"
        XCTAssertEqual(settings.draft("👍 Agree", selection: "first"), "👍 Agree\n\n> first")
        settings.quoteSelection = false
        XCTAssertEqual(settings.draft("👍 Agree", selection: "first"), "👍 Agree")
    }

    func testStudioMentionUsesProviderItemId() throws {
        let results = try JSONDecoder().decode(MentionResults.self, from: Data(#"{"groups":[{"pluginId":"pages","providerId":"page","label":"Pages","items":[{"itemId":"page:pg_123","title":"QA page"}]}]}"#.utf8))
        let mention = Mention.plugin(results.groups[0].pluginId, results.groups[0].items[0])
        XCTAssertEqual(mention.resource["pluginId"]?.stringValue, "pages")
        XCTAssertEqual(mention.resource["itemId"]?.stringValue, "page:pg_123")
    }

    func testPluginRPCBodiesMatchServerSchemas() async throws {
        let client = BBClient(baseURL: URL(string: "http://localhost")!)
        client.transport = { _, path, body in
            let value = try JSONDecoder().decode(JSONValue.self, from: body ?? Data())
            switch path {
            case "/api/v1/plugins/talk/rpc/recording_rename":
                XCTAssertEqual(value["id"]?.stringValue, "rec_aaaaaaaaaaaa")
                XCTAssertEqual(value["title"]?.stringValue, "QA recording")
            case "/api/v1/plugins/excalidraw/rpc/renameDrawing":
                XCTAssertEqual(value["id"]?.stringValue, "drawing-id")
                XCTAssertEqual(value["name"]?.stringValue, "QA drawing")
            case "/api/v1/plugins/studio/rpc/tagItems":
                XCTAssertEqual(value["items"]?.arrayValue?.first?["id"]?.stringValue, "pg_aaaaaaaaaaaa")
                XCTAssertEqual(value["items"]?.arrayValue?.first?["pluginId"]?.stringValue, "pages")
            case "/api/v1/plugins/pages/rpc/chats":
                XCTAssertEqual(value["pageId"]?.stringValue, "pg_aaaaaaaaaaaa")
                return (200, Data(#"{"ok":true,"result":{"chats":[]}}"#.utf8))
            default: XCTFail("Unexpected path: \(path)")
            }
            return (200, Data(#"{"ok":true,"result":{}}"#.utf8))
        }
        try await client.renameRecording("rec_aaaaaaaaaaaa", title: "QA recording")
        try await client.renameDrawing("drawing-id", name: "QA drawing")
        let item = StudioItem(pluginId: "pages", itemId: "pg_aaaaaaaaaaaa", kind: "page",
            title: "QA page", createdAt: 0, updatedAt: 0)
        try await client.tagStudioItems([item], add: ["tag_aaa"], remove: [])
        let chats = try await client.pageChats("pg_aaaaaaaaaaaa")
        XCTAssertTrue(chats.isEmpty)
    }

    func testLivePluginInputsReachHandlers() async throws {
        guard let address = ProcessInfo.processInfo.environment["BBGO_LIVE_RPC"], let url = URL(string: address) else {
            throw XCTSkip("Set BBGO_LIVE_RPC to audit the live server")
        }
        let client = BBClient(baseURL: url)
        do {
            try await client.renameRecording("rec_aaaaaaaaaaaa", title: "QA recording")
            XCTFail("The nonexistent recording should fail")
        } catch let error as BBError { XCTAssertNotEqual(error.status, 400) }
        do {
            try await client.renameDrawing("drawing_missing", name: "QA drawing")
            XCTFail("The nonexistent drawing should fail")
        } catch let error as BBError { XCTAssertNotEqual(error.status, 400) }
        let item = StudioItem(pluginId: "pages", itemId: "pg_aaaaaaaaaaaa", kind: "page",
            title: "QA page", createdAt: 0, updatedAt: 0)
        try await client.tagStudioItems([item], add: [], remove: [])
        let chats = try await client.pageChats("pg_aaaaaaaaaaaa")
        XCTAssertTrue(chats.isEmpty)
    }
}
