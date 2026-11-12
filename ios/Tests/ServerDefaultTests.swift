import XCTest
@testable import BBStudio

final class ServerDefaultTests: XCTestCase {
    func testTheDefaultServerComesFromTheBuildSetting() {
        let value = (Bundle.main.object(forInfoDictionaryKey: "BBDefaultServerURL") as? String ?? "")
            .trimmingCharacters(in: .whitespacesAndNewlines)
        XCTAssertEqual(ServerScope.defaultURL, value.isEmpty ? ServerScope.unconfiguredURL : URL(string: value)!)
        XCTAssertEqual(BBClient.defaultServerURL, ServerScope.defaultURL)
    }

    func testTheUnconfiguredServerNeverResolves() {
        XCTAssertEqual(ServerScope.unconfiguredURL.host(), "server-not-set.invalid")
    }
}
