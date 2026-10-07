import XCTest
@testable import BBStudio

/// Fallbacks to older plugins happen only when BB says the plugin or method is missing.
final class RPCFallbackTests: XCTestCase {
    private actor Calls {
        var paths: [String] = []
        func append(_ path: String) { paths.append(path) }
    }

    private static let missingMethod = Data(#"{"ok":false,"error":{"code":"unknown_method","message":"no rpc method"}}"#.utf8)
    private static let missingPlugin = Data(#"{"ok":false,"error":"unknown plugin \"x\""}"#.utf8)

    private func client(_ answer: @escaping @Sendable (String) throws -> (Int, Data)) -> (BBClient, Calls) {
        let client = BBClient(baseURL: URL(string: "https://rpc.invalid")!)
        let calls = Calls()
        client.transport = { _, path, _ in
            await calls.append(path)
            return try answer(path)
        }
        return (client, calls)
    }

    func testMissingRPCMeansNotFoundOrNotRunning() {
        XCTAssertTrue(BBClient.isMissingRPC(BBError(status: 404, message: "")))
        XCTAssertTrue(BBClient.isMissingRPC(BBError(status: 503, message: "")))
        XCTAssertFalse(BBClient.isMissingRPC(BBError(status: 500, message: "")))
        XCTAssertFalse(BBClient.isMissingRPC(URLError(.timedOut)))
    }

    func testSidebarPreferencesFallBackOnlyWhenStudioSidebarIsMissing() async throws {
        let prefs = Data(#"{"ok":true,"result":{"preferences":{"organizationMode":"project"}}}"#.utf8)
        let (missing, calls) = client { path in
            path.contains("thread-list-plus") ? (404, Self.missingPlugin) : (200, prefs)
        }
        let fallback = try await missing.sidebarPreferences()
        XCTAssertEqual(fallback.organizationMode, "project")
        let paths = await calls.paths
        XCTAssertEqual(paths.last, "/api/v1/plugins/thread-list/rpc/listPreferences")
    }

    func testSidebarPreferencesTimeoutThrowsWithoutFallingBack() async throws {
        let (slow, calls) = client { path in
            if path.contains("thread-list-plus") { throw URLError(.timedOut) }
            return (200, Data(#"{"ok":true,"result":{"preferences":{"organizationMode":"project"}}}"#.utf8))
        }
        do {
            _ = try await slow.sidebarPreferences()
            XCTFail("A timeout must not fall back to BB's Thread List")
        } catch {
            XCTAssertEqual((error as? URLError)?.code, .timedOut)
        }
        let paths = await calls.paths
        XCTAssertEqual(paths.count, 1)
    }

    func testItemChatFallsBackToStudioChatWhenStudioPredatesTheMerge() async throws {
        let (old, calls) = client { path in
            switch path {
            case "/api/v1/plugins/studio/rpc/chat.home": (404, Self.missingMethod)
            case "/api/v1/plugins/studio-chat/rpc/home": (200, Data(#"{"ok":true,"result":{"thread":{"threadId":"thr_1"}}}"#.utf8))
            default: (500, Data())
            }
        }
        let thread = try await old.lastStudioChat(pluginId: "artifacts", itemId: "a1")
        XCTAssertEqual(thread, "thr_1")
        let paths = await calls.paths
        XCTAssertEqual(paths, ["/api/v1/plugins/studio/rpc/chat.home", "/api/v1/plugins/studio-chat/rpc/home"])
    }

    func testItemChatFailureDoesNotFallBack() async throws {
        let (failing, calls) = client { _ in (500, Data(#"{"ok":false,"error":{"message":"boom"}}"#.utf8)) }
        do {
            _ = try await failing.lastStudioChat(pluginId: "artifacts", itemId: "a1")
            XCTFail("A failing Studio must not fall back")
        } catch {
            XCTAssertEqual((error as? BBError)?.message, "boom")
        }
        let paths = await calls.paths
        XCTAssertEqual(paths.count, 1)
    }

    @MainActor
    func testMissingPagesPluginSaysToInstallItInsteadOfRawServerText() async {
        let original = BBClient.storedServerURL
        defer { BBClient.storedServerURL = original }
        let server = URL(string: "https://missing-plugin.invalid")!
        BBClient.storedServerURL = server
        let store = PagesStore()
        let client = BBClient(baseURL: server)
        client.transport = { _, _, _ in (404, Data(#"{"error":{"message":"unknown plugin: pages"}}"#.utf8)) }
        await store.load(client)
        XCTAssertEqual(store.error, "Install Studio Pages to use this.")

        client.transport = { _, _, _ in (500, Data(#"{"error":{"message":"tree exploded"}}"#.utf8)) }
        await store.load(client)
        XCTAssertEqual(store.error, "tree exploded")
    }
}
