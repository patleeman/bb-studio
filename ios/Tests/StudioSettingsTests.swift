import XCTest
@testable import BBStudio

/// Studio's own settings moved out of BB's plugin settings into `settings.get`;
/// the app reads them there, and an older Studio's plugin settings still work.
final class StudioSettingsTests: XCTestCase {
    func testReadsStudioSettingsFromSettingsGet() async throws {
        let client = BBClient(baseURL: URL(string: "https://settings.invalid")!)
        client.transport = { method, path, _ in
            XCTAssertEqual(method, "POST")
            XCTAssertEqual(path, "/api/v1/plugins/studio/rpc/settings.get")
            let body = #"{"ok":true,"result":{"values":{"loopsEnabled":true,"emojiItems":"🔥 Ship it, ❓ Why","quoteSelection":true,"quotePosition":"after"},"changed":["loopsEnabled"],"timeZone":"America/New_York"}}"#
            return (200, Data(body.utf8))
        }
        let values = try await client.studioSettingValues()
        XCTAssertEqual(values["loopsEnabled"], .bool(true))
        let reactions = try await client.reactionSettings()
        XCTAssertEqual(reactions.items, ["🔥 Ship it", "❓ Why"])
        XCTAssertEqual(reactions.quotePosition, "after")
    }

    func testFallsBackToAnOlderStudiosPluginSettings() async throws {
        let client = BBClient(baseURL: URL(string: "https://settings.invalid")!)
        client.transport = { _, path, _ in
            if path == "/api/v1/plugins/studio/rpc/settings.get" {
                return (404, Data(#"{"ok":false,"error":{"code":"unknown_method","message":"plugin \"studio\" has no rpc method \"settings.get\""}}"#.utf8))
            }
            XCTAssertEqual(path, "/api/v1/plugins/studio/settings")
            return (200, Data(#"{"values":{"loopsEnabled":false,"quoteSelection":false}}"#.utf8))
        }
        let values = try await client.studioSettingValues()
        XCTAssertEqual(values["loopsEnabled"], .bool(false))
        let reactions = try await client.reactionSettings()
        XCTAssertFalse(reactions.quoteSelection)
        XCTAssertEqual(reactions.items, ReactionSettings.defaults.items)
    }
}
