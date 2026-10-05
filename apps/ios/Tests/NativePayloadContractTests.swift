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


    func testGeneratedTableDecoderPreservesEveryCellValueShape() async throws {
        let client = try client("table-read")
        let response = try await client.studioTable("tbl_contract")
        let table = try XCTUnwrap(response)
        let row = try XCTUnwrap(table.rows?.first)
        let values = try XCTUnwrap(JSONSerialization.jsonObject(with: JSONEncoder().encode(row.values)) as? [String: Any])
        XCTAssertEqual(values["text"] as? String, "Text")
        XCTAssertEqual(values["number"] as? Int, 42)
        XCTAssertEqual(values["check"] as? Bool, true)
        XCTAssertEqual(values["multi"] as? [String], ["a", "b"])
        XCTAssertEqual((values["relation"] as? [String: String])?["itemId"], "pg_contract")
        XCTAssertTrue(values["empty"] is NSNull)
    }

    func testChatStartEnvelope() async throws {
        let chatClient = try client("chat-start")
        let thread = try await chatClient.startStudioChat(pluginId: "pages", itemId: "pg_contract", projectId: "proj_contract", text: "Discuss")
        XCTAssertEqual(thread, "thr_chat")
    }
}
