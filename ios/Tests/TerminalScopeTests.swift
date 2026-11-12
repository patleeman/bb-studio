import XCTest
@testable import BBStudio

/// The Bot chat's ⋯ menu opens its thread's terminals with the scope a
/// regular thread's ⋯ menu uses: the thread, once it has an environment.
final class TerminalScopeTests: XCTestCase {
    func testAThreadWithAnEnvironmentScopesTerminalsToTheThread() {
        XCTAssertEqual(TerminalScope.forThread("thr_bot", environmentId: "env_a"), .thread("thr_bot"))
        XCTAssertEqual(TerminalScope.forThread("thr_bot", environmentId: "env_a")?.target,
                       ["kind": "thread", "threadId": "thr_bot"])
    }

    func testAThreadWithoutAnEnvironmentOffersNoTerminals() {
        XCTAssertNil(TerminalScope.forThread("thr_bot", environmentId: nil))
    }
}
