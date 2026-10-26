import XCTest
@testable import BBStudio

/// These fixtures are also strictly validated against the generated JSON schemas by
/// scripts/check-native-payload-fixtures.mjs. Comparisons use actual transport bytes.
final class NativePayloadContractTests: XCTestCase {
    private struct Fixture: Decodable {
        var id: String
        var plugin: String
        var method: String
        var input: JSONValue
        var output: JSONValue
    }

    private func client(_ id: String) throws -> BBClient {
        let url = try XCTUnwrap(Bundle(for: Self.self).url(forResource: "native-payloads", withExtension: "json"))
        let fixtures = try JSONDecoder().decode([Fixture].self, from: Data(contentsOf: url))
        let fixture = try XCTUnwrap(fixtures.first { $0.id == id })
        let client = BBClient(baseURL: URL(string: "https://contracts.invalid")!)
        client.transport = { method, path, body in
            // Host project defaults are a separate boundary; this case tests the plugin request.
            if path == "/api/v1/projects/proj_contract/default-execution-options" {
                return (200, Data("null".utf8))
            }
            XCTAssertEqual(method, "POST")
            XCTAssertEqual(path, "/api/v1/plugins/\(fixture.plugin)/rpc/\(fixture.method)")
            let input = try JSONDecoder().decode(JSONValue.self, from: XCTUnwrap(body))
            XCTAssertEqual(input, fixture.input, "Native request differs from its schema-validated fixture")
            return (200, try JSONEncoder().encode(JSONValue.object(["ok": .bool(true), "result": fixture.output])))
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


    func testVoiceModePayloads() async throws {
        let state = try await client("voice-state").voiceState("thr_voice")
        XCTAssertEqual(state.on, true)
        XCTAssertEqual(state.conversational, true)
        let set = try await client("voice-set").setVoice("thr_voice", on: true)
        XCTAssertEqual(set.speechProblem, "No OpenRouter key.")
        let conversational = try await client("voice-conversational").setVoiceConversational("thr_voice", on: false)
        XCTAssertEqual(conversational.conversational, false)
        let offNote = try await client("voice-turn-note").voiceTurnNote("thr_voice")
        XCTAssertEqual(offNote?.hasPrefix("Conversational replies are off now"), true)
        let noNote = try await client("voice-turn-note-none").voiceTurnNote("thr_voice")
        XCTAssertNil(noNote)
    }

    func testSpeechPayloads() async throws {
        let settings = try await client("speech-state").speechSettings()
        XCTAssertEqual(settings.speed, 1.5)
        XCTAssertEqual(settings.engines?.count, 3)
        let updated = try await client("speech-update").updateSpeech(VoiceRequests.update(speed: 1.5))
        XCTAssertEqual(updated.voice, "alloy")
        let models = try await client("speech-models").speechModels()
        XCTAssertEqual(models.first?.voiceNames?["verse"], "Verse")
        XCTAssertNil(models.last?.voices)
        let url = try await client("speech-prepare").prepareSpeech("Hello there.")
        XCTAssertEqual(url.absoluteString, "https://contracts.invalid/api/v1/plugins/studio/http/speech/audio?key=0123456789abcdef0123456789abcdef01234567")
    }

    func testChatStartEnvelope() async throws {
        let chatClient = try client("chat-start")
        let thread = try await chatClient.startStudioChat(pluginId: "pages", itemId: "pg_contract", projectId: "proj_contract", text: "Discuss")
        XCTAssertEqual(thread.threadId, "thr_chat")
        XCTAssertFalse(thread.usedStandardSettings)
    }
}
