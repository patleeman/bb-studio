import XCTest

/// Shared origins for tests. Offline fixtures never use the configured QA server.
class ServerIsolatedUITestCase: XCTestCase {
    private(set) var qaServer = ""

    func requireQAServer() throws {
        let env = ProcessInfo.processInfo.environment
        let value = env["TEST_RUNNER_BBGO_QA_SERVER"] ?? env["BBGO_QA_SERVER"]
        guard let value, !value.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty else {
            throw XCTSkip("Set TEST_RUNNER_BBGO_QA_SERVER (BBGO_QA_SERVER in the runner) to an isolated staged BB. No default server is allowed.")
        }
        let url = try XCTUnwrap(URLComponents(string: value), "Invalid QA server URL")
        XCTAssertTrue(["http", "https"].contains(url.scheme ?? "") && url.host != nil,
                      "QA server must be an absolute HTTP(S) URL")
        guard ["http", "https"].contains(url.scheme ?? ""), url.host != nil else {
            throw NSError(domain: "StagedServerUITestCase", code: 1)
        }
        qaServer = value.hasSuffix("/") ? String(value.dropLast()) : value
    }
}

/// Server-backed suites opt in before app launch or API calls.
class StagedServerUITestCase: ServerIsolatedUITestCase {
    override func setUpWithError() throws {
        try super.setUpWithError()
        try requireQAServer()
    }
}

extension XCUIApplication {
    /// Local demo data must never use a saved or environment-selected BB server.
    func launchOffline() {
        launchStaged(server: "https://offline-fixtures.invalid")
    }

    /// Replace any previous server argument, including one left by a relaunch.
    func launchStaged(server: String) {
        precondition(!server.isEmpty, "QA server must be resolved before launch")
        var arguments = launchArguments
        while let index = arguments.firstIndex(of: "-serverURL") {
            arguments.remove(at: index)
            if index < arguments.count { arguments.remove(at: index) }
        }
        launchArguments = arguments + ["-serverURL", server]
        launch()
    }
}
