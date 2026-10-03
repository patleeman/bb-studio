// Run only in a private review project/simulator against staged BB on port 49486.
import XCTest
import WatchConnectivity
@testable import BBStudio

final class WatchRelayRuntimeTests: XCTestCase {
    private let staged = URL(string: "http://127.0.0.1:49486")!

    private func relay(_ message: [String: Any]) async -> [String: Any] {
        await withCheckedContinuation { continuation in
            PhoneRelay.shared.session(WCSession.default, didReceiveMessage: message) {
                continuation.resume(returning: $0)
            }
        }
    }

    func testMatchingOriginReadsStagedProjectsAndUnpacksResponse() async throws {
        let original = BBClient.storedServerURL
        guard original == staged else { XCTFail("Private simulator must select staged BB before launch"); return }
        defer { BBClient.storedServerURL = original }
        let response = await relay(["serverURL": staged.absoluteString, WatchRelay.method: "GET", WatchRelay.path: "/api/v1/projects"])
        XCTAssertEqual(response[WatchRelay.status] as? Int, 200)
        let body = WatchRelay.unpack(try XCTUnwrap(response[WatchRelay.body] as? Data))
        let json = try XCTUnwrap(JSONSerialization.jsonObject(with: body) as? [[String: Any]])
        XCTAssertTrue(json.contains { $0["name"] as? String == "Orbit" })
        XCTAssertNil(response[WatchRelay.error])
    }

    func testDifferentOrMissingOriginRejectsMutationBeforeForwarding() async {
        let original = BBClient.storedServerURL
        guard original == staged else { XCTFail("Private simulator must select staged BB before launch"); return }
        defer { BBClient.storedServerURL = original }
        for origin in ["http://localhost:49486", ""] {
            let response = await relay(["serverURL": origin, WatchRelay.method: "POST", WatchRelay.path: "/must-not-be-forwarded"])
            XCTAssertEqual(response[WatchRelay.status] as? Int, 409)
            XCTAssertEqual(response["serverURL"] as? String, staged.absoluteString)
            XCTAssertNotNil(response[WatchRelay.error])
            XCTAssertNil(response[WatchRelay.body])
        }
    }
}
