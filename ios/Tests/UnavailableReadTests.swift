import XCTest
@testable import BBStudio

final class UnavailableReadTests: XCTestCase {
    private struct Value: Decodable { var count: Int }

    func testMalformedSuccessfulRPCPreservesDecodingError() async throws {
        let client = BBClient(baseURL: URL(string: "https://unavailable-read.invalid")!)
        client.transport = { _, _, _ in (200, Data(#"{"ok":true,"result":{"count":"wrong"}}"#.utf8)) }
        do {
            let _: Value = try await client.rpc("studio", "test")
            XCTFail("Malformed data must fail")
        } catch DecodingError.typeMismatch(_, let context) {
            XCTAssertEqual(context.codingPath.map(\.stringValue), ["result", "count"])
        } catch { XCTFail("Lost decoding error: \(error)") }
        do {
            let _: Value? = try await client.rpcIfPresent("studio", "test")
            XCTFail("Malformed optional data must fail")
        } catch { XCTAssertTrue(error is DecodingError) }
    }

    func testHTTPFailureWinsOverSuccessfulEnvelope() async throws {
        let client = BBClient(baseURL: URL(string: "https://unavailable-status.invalid")!)
        client.transport = { _, _, _ in (503, Data(#"{"ok":true,"result":{"count":1}}"#.utf8)) }
        do {
            let _: Value = try await client.rpc("studio", "test")
            XCTFail("503 must fail")
        } catch { XCTAssertEqual((error as? BBError)?.status, 503) }
        do {
            let _: Value? = try await client.rpcIfPresent("studio", "test")
            XCTFail("503 must fail for optional data")
        } catch { XCTAssertEqual((error as? BBError)?.status, 503) }
    }

    func testOptionalRPCRequiresExplicitNull() async throws {
        let client = BBClient(baseURL: URL(string: "https://unavailable-null.invalid")!)
        client.transport = { _, _, _ in (200, Data(#"{"ok":true}"#.utf8)) }
        do {
            let _: Value? = try await client.rpcIfPresent("studio", "test")
            XCTFail("A missing result must not become no data")
        } catch { XCTAssertTrue(error is DecodingError) }
        client.transport = { _, _, _ in (200, Data(#"{"ok":true,"result":null}"#.utf8)) }
        let result: Value? = try await client.rpcIfPresent("studio", "test")
        XCTAssertNil(result)
    }

    func testFailedDefaultsStartTheChatWithStandardSettings() async throws {
        let client = BBClient(baseURL: URL(string: "https://unavailable-defaults.invalid")!)
        let sent = Box()
        client.transport = { _, path, body in
            if path.hasSuffix("default-execution-options") { return (503, Data(#"{"error":"offline"}"#.utf8)) }
            sent.body = body
            return (200, Data(#"{"ok":true,"result":{"threadId":"thr_standard"}}"#.utf8))
        }
        let started = try await client.startStudioChat(pluginId: "studio", itemId: "a", projectId: "p", text: "Discuss")
        XCTAssertEqual(started, .init(threadId: "thr_standard", usedStandardSettings: true))
        let request = try JSONDecoder().decode(JSONValue.self, from: XCTUnwrap(sent.body))["request"]
        XCTAssertEqual(request?["providerId"], .string("claude-code"))
        XCTAssertEqual(request?["projectId"], .string("p"))
    }

    func testReadDefaultsStartTheChatWithoutANotice() async throws {
        let client = BBClient(baseURL: URL(string: "https://defaults.invalid")!)
        client.transport = { _, path, _ in
            if path.hasSuffix("default-execution-options") { return (200, Data(#"{"providerId":"codex","model":"gpt-5"}"#.utf8)) }
            return (200, Data(#"{"ok":true,"result":{"threadId":"thr_defaults"}}"#.utf8))
        }
        let started = try await client.startStudioChat(pluginId: "studio", itemId: "a", projectId: "p", text: "Discuss")
        XCTAssertEqual(started, .init(threadId: "thr_defaults", usedStandardSettings: false))
    }

    func testCancelledDefaultsReadStartsNothing() async throws {
        let client = BBClient(baseURL: URL(string: "https://cancelled-defaults.invalid")!)
        client.transport = { _, path, _ in
            guard path.hasSuffix("default-execution-options") else {
                XCTFail("A cancelled start must not start work: \(path)")
                return (200, Data(#"{"ok":true,"result":{"threadId":"thr_wrong"}}"#.utf8))
            }
            throw CancellationError()
        }
        do {
            _ = try await client.startStudioChat(pluginId: "studio", itemId: "a", projectId: "p", text: "Discuss")
            XCTFail("Cancellation must stop the start")
        } catch { XCTAssertTrue(error is CancellationError) }
    }

    func testBot503WithContradictoryNullDoesNotClearIdentity() async throws {
        let client = BBClient(baseURL: URL(string: "https://unavailable-bot.invalid")!)
        client.transport = { _, _, _ in
            (200, Data(#"{"ok":true,"result":{"bot":{"id":"bot_main","name":"Dot","avatar":"D","state":"active","threadId":"thr_cached","createdAt":1,"updatedAt":1},"run":null}}"#.utf8))
        }
        _ = try await client.bot()
        client.transport = { _, _, _ in (503, Data(#"{"ok":true,"result":{"bot":null,"run":null}}"#.utf8)) }
        do {
            _ = try await client.bot()
            XCTFail("A 503 cannot mean no Bot")
        } catch { XCTAssertEqual((error as? BBError)?.status, 503) }
        XCTAssertEqual(client.cachedBotThreadId, "thr_cached")
    }
}

private final class Box: @unchecked Sendable { var body: Data? }
