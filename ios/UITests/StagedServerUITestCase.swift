import XCTest

/// Every UI test class inherits this one (scripts/check-test-timeouts.py
/// fails the build otherwise): shared origins, and the time limit.
/// Offline fixtures never use the configured QA server.
class ServerIsolatedUITestCase: XCTestCase {
    private(set) var qaServer = ""

    /// No UI test runs past 5 minutes, so a hung or crawling test can't hold
    /// a run for half an hour. With `-test-timeouts-enabled YES` (every
    /// script passes it) XCTest fails the test at the limit and records a
    /// spindump; the watchdog stops it anyway when a run left the flag out.
    static let timeLimit: TimeInterval = 300
    /// The watchdog waits this much past the limit, so XCTest's own timeout
    /// (and its spindump) comes first when it's on.
    static let watchdogGrace: TimeInterval = 15

    override func setUpWithError() throws {
        try super.setUpWithError()
        executionTimeAllowance = Self.timeLimit
        let watchdog = TestWatchdog(name: name, after: Self.timeLimit + Self.watchdogGrace)
        addTeardownBlock { watchdog.cancel() }
    }

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
        // Each launch opens on Main, not on a conversation an earlier suite left open.
        if !arguments.contains("-qaRememberConversation"), !arguments.contains("-qaForgetConversation") { arguments.append("-qaForgetConversation") }
        launchArguments = arguments + ["-serverURL", server]
        launch()
        // xcodebuild can still be installing the app when the runner's first
        // test launches it: the install ends that process and the one the
        // system starts after it has none of the test's arguments (it opens on
        // the saved `unit-tests.invalid` and waits there). By the time
        // `launch()` returns the install is over, so a run's first launch is
        // made again.
        if !LaunchRace.settled {
            LaunchRace.settled = true
            terminate()
            launch()
        }
    }
}

/// Whether this run of the runner has launched the app once already.
private enum LaunchRace {
    nonisolated(unsafe) static var settled = false
}

/// Ends the test runner when one test outlives its limit. XCTest's timeout
/// works only with `-test-timeouts-enabled YES`; a run without it (a direct
/// `xcodebuild` or Xcode's test button) would otherwise wait on a hung app
/// for as long as it hangs. It runs off the main thread, which a test stuck
/// waiting for the app to go idle holds. xcodebuild reports the test as
/// failed (the runner crashed) and goes on with the next one.
final class TestWatchdog: @unchecked Sendable {
    private let timer = DispatchSource.makeTimerSource(queue: DispatchQueue(label: "ui-test-watchdog"))

    init(name: String, after limit: TimeInterval) {
        timer.schedule(deadline: .now() + limit)
        timer.setEventHandler {
            let message = "\(name) ran past its \(Int(limit)) s limit (ServerIsolatedUITestCase.timeLimit): stopping the test runner.\n"
            FileHandle.standardError.write(Data(message.utf8))
            fatalError(message)
        }
        timer.resume()
    }

    func cancel() { timer.cancel() }
}
