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
        let results = try JSONDecoder().decode(MentionResults.self, from: Data(#"{"groups":[{"pluginId":"studio-tasks","providerId":"task","label":"Tasks","items":[{"itemId":"task:task_123","title":"QA task"}]}]}"#.utf8))
        let mention = Mention.plugin(results.groups[0].pluginId, results.groups[0].items[0])
        XCTAssertEqual(mention.resource["pluginId"]?.stringValue, "studio-tasks")
        XCTAssertEqual(mention.resource["itemId"]?.stringValue, "task:task_123")
    }

    func testPluginRPCBodiesMatchServerSchemas() async throws {
        let client = BBClient(baseURL: URL(string: "http://localhost")!)
        client.transport = { _, path, body in
            let value = try JSONDecoder().decode(JSONValue.self, from: body ?? Data())
            switch path {
            case "/api/v1/plugins/studio/rpc/talk_recording_rename":
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
