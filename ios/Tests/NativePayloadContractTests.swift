import XCTest
@testable import BBStudio

/// These fixtures are also strictly validated against the generated JSON schemas by
/// scripts/check-native-payload-fixtures.mjs. Comparisons use actual transport bytes.
final class NativePayloadContractTests: XCTestCase {
    private struct Fixture: Decodable {
        var id: String
        var plugin: String
        var method: String?
        var input: JSONValue?
        var output: JSONValue?
        var event: String?
        var payload: JSONValue?
    }

    private func fixture(_ id: String) throws -> Fixture {
        let url = try XCTUnwrap(Bundle(for: Self.self).url(forResource: "native-payloads", withExtension: "json"))
        let fixtures = try JSONDecoder().decode([Fixture].self, from: Data(contentsOf: url))
        return try XCTUnwrap(fixtures.first { $0.id == id })
    }

    private func client(_ id: String) throws -> BBClient {
        let fixture = try fixture(id)
        let rpcMethod = try XCTUnwrap(fixture.method)
        let fixtureInput = try XCTUnwrap(fixture.input)
        let output = try XCTUnwrap(fixture.output)
        let client = BBClient(baseURL: URL(string: "https://contracts.invalid")!)
        client.transport = { method, path, body in
            // Host project defaults are a separate boundary; this case tests the plugin request.
            if path == "/api/v1/projects/proj_contract/default-execution-options" {
                return (200, Data("null".utf8))
            }
            XCTAssertEqual(method, "POST")
            XCTAssertEqual(path, "/api/v1/plugins/\(fixture.plugin)/rpc/\(rpcMethod)")
            let input = try JSONDecoder().decode(JSONValue.self, from: XCTUnwrap(body))
            XCTAssertEqual(input, fixtureInput, "Native request differs from its schema-validated fixture")
            return (200, try JSONEncoder().encode(JSONValue.object(["ok": .bool(true), "result": output])))
        }
        return client
    }

    func testTalkCreateUploadAndReadPayloads() async throws {
        let createClient = try client("talk-create")
        let recording = try await createClient.createRecording(kind: "dictation", threadId: nil, projectId: nil)
        XCTAssertEqual(recording.id, "rec_aaaaaaaa")
        XCTAssertEqual(recording.pendingCount, 0)
        let uploadClient = try client("talk-segment")
        try await uploadClient.putSegment(recordingId: "rec_aaaaaaaa", sessionId: "session01", index: 0, startedAt: 1_700_000_000_000, durationMs: 1200, mimeType: "audio/mp4", audio: Data([1, 2, 3]))
        let readClient = try client("talk-read")
        let detail = try await readClient.recording("rec_aaaaaaaa")
        XCTAssertEqual(detail.transcript, "Contract transcript")
        XCTAssertEqual(detail.segments.first?.mimeType, "audio/mp4")
    }

    func testChatStartEnvelope() async throws {
        let chatClient = try client("chat-start")
        let thread = try await chatClient.startStudioChat(pluginId: "pages", itemId: "pg_contract", projectId: "proj_contract", text: "Discuss")
        XCTAssertEqual(thread.threadId, "thr_chat")
        XCTAssertFalse(thread.usedStandardSettings)
    }

    func testBotSpacesPayload() async throws {
        let spaces = try await client("bot-spaces").botSpaces()
        XCTAssertEqual(spaces.currentBotId, "bot_main")
        let bot = try XCTUnwrap(spaces.current)
        XCTAssertEqual(bot.id, "bot_main")
        XCTAssertTrue(bot.primary)
        XCTAssertEqual(bot.mainThreadId, "thr_fixture01")
        XCTAssertFalse(bot.needsYou)
        XCTAssertEqual(bot.appearance?.themeId, "data-city")
        XCTAssertEqual(bot.presence?.form, "tesseract")
        XCTAssertNil(bot.presence?.customColor)
        XCTAssertEqual(bot.activity, BotSpace.Activity(turn: false, workers: 1))
        XCTAssertEqual(bot.presenceState(), .working)
    }

    func testBotThreadsViewPayload() async throws {
        let view = try await client("bot-threads-view").botThreadsView(botId: "bot_main")
        XCTAssertEqual(view.botId, "bot_main")
        XCTAssertEqual(view.conversations.map(\.threadId), ["thr_fixture01", "thr_fixture02", "thr_fixture03"])
        XCTAssertEqual(view.main?.threadId, "thr_fixture01")
        let fork = view.conversations[1]
        XCTAssertEqual(fork.forkedFrom?.threadId, "thr_fixture01")
        XCTAssertEqual(fork.forkedFrom?.messageId, "thr_fixture01:user-seed:1")
        XCTAssertNil(fork.forkedFrom?.turnId)
        XCTAssertEqual(view.topLevel.map(\.threadId), ["thr_fixture01", "thr_fixture03"])
        XCTAssertEqual(view.threads(of: "thr_fixture01").map(\.threadId), ["thr_fixture02"])
        XCTAssertEqual(view.workers.count, 6)
        XCTAssertEqual(view.workers.map(\.status), [.running, .done, .done, .done, .failed, .done])
        XCTAssertEqual(view.workers[3].sameTitle, 5)
        XCTAssertEqual(view.workers(of: "thr_fixture01").count, 6)
        XCTAssertEqual(view.hiddenWorkers, 359)
        XCTAssertEqual(view.olderConversations, 0)
    }

    func testBotThreadsChangedEventPayload() throws {
        let fixture = try fixture("bot-threads-changed")
        XCTAssertEqual(fixture.event, Studio.Channel.bot_threads_changed)
        let event = RealtimeEvent.pluginSignal(pluginId: fixture.plugin, channel: try XCTUnwrap(fixture.event), payload: try XCTUnwrap(fixture.payload))
        let signal = try XCTUnwrap(Studio.BotThreadsChangedEvent(signal: event))
        XCTAssertEqual(signal.botId, "bot_main")
        XCTAssertEqual(signal.changes, [.conversations, .needs_you])
    }
}
