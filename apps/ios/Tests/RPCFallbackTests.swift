import XCTest
@testable import BBStudio

/// Studio's kinds are called on Studio only; there is no fallback to the retired plugins.
final class RPCFallbackTests: XCTestCase {
    private actor Calls {
        var paths: [String] = []
        func append(_ path: String) { paths.append(path) }
    }


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

    func testSidebarPreferencesComeFromBBsThreadList() async throws {
        let prefs = Data(#"{"ok":true,"result":{"preferences":{"organizationMode":"project"}}}"#.utf8)
        let (client, calls) = client { _ in (200, prefs) }
        let read = try await client.sidebarPreferences()
        XCTAssertEqual(read.organizationMode, "project")
        let paths = await calls.paths
        XCTAssertEqual(paths, ["/api/v1/plugins/thread-list/rpc/listPreferences"])
    }

    func testItemChatFailureSurfacesStudiosError() async throws {
        let (failing, calls) = client { _ in (500, Data(#"{"ok":false,"error":{"message":"boom"}}"#.utf8)) }
        do {
            _ = try await failing.lastStudioChat(pluginId: "artifacts", itemId: "a1")
            XCTFail("A failing Studio must throw")
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

    func testArtifactsGoToStudio() async throws {
        let found = Data(#"{"ok":true,"result":{"artifact":null,"versions":[]}}"#.utf8)
        let (current, currentCalls) = client { _ in (200, found) }
        _ = try await current.artifact("art_1")
        let currentPaths = await currentCalls.paths
        XCTAssertEqual(currentPaths, ["/api/v1/plugins/studio/rpc/artifacts.get"])
    }

    func testArtifactFailureInStudioDoesNotFallBack() async throws {
        let (failing, calls) = client { _ in (500, Data(#"{"ok":false,"error":{"message":"boom"}}"#.utf8)) }
        do {
            _ = try await failing.artifact("art_1")
            XCTFail("A failing Studio must throw")
        } catch {
            XCTAssertEqual((error as? BBError)?.message, "boom")
        }
        let paths = await calls.paths
        XCTAssertEqual(paths.count, 1)
    }

    func testDrawingsGoToStudio() async throws {
        let found = Data(#"{"ok":true,"result":{"drawings":[]}}"#.utf8)
        let (current, currentCalls) = client { _ in (200, found) }
        _ = try await current.drawings()
        let currentPaths = await currentCalls.paths
        XCTAssertEqual(currentPaths, ["/api/v1/plugins/studio/rpc/drawings.listDrawings"])
        XCTAssertTrue(current.drawingThumbnailPath("drw_1", updatedAt: 2).hasPrefix("/api/v1/plugins/studio/http/drawings/thumbnail"))
    }

    func testPagesGoToStudio() async throws {
        let found = Data(#"{"ok":true,"result":{"pages":[]}}"#.utf8)
        let (current, currentCalls) = client { _ in (200, found) }
        _ = try await current.pages()
        let currentPaths = await currentCalls.paths
        XCTAssertEqual(currentPaths, ["/api/v1/plugins/studio/rpc/pages.tree"])
        XCTAssertEqual(current.webURL(forPage: "pg_1").path(), "/plugins/studio/studio/pages/pg_1")
    }
}
