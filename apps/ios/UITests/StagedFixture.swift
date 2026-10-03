import Foundation

/// Test infrastructure only. An omitted fixture never falls back to a user's BB.
enum StagedFixture {
    static var serverURL: String { ProcessInfo.processInfo.environment["BB_QA_SERVER_URL"] ?? "http://127.0.0.1:1" }
    static var isIsolated: Bool {
        guard let url = URL(string: serverURL) else { return false }
        return url.scheme == "http" && ["127.0.0.1", "localhost"].contains(url.host ?? "") &&
            url.port != nil && url.port != 38886 && url.port != 1 &&
            ProcessInfo.processInfo.environment["BB_QA_PRIVATE_SIM"] == "YES"
    }
    static var projectId: String { ProcessInfo.processInfo.environment["BB_QA_PROJECT_ID"] ?? "missing-staged-project" }
    static var threadId: String { ProcessInfo.processInfo.environment["BBGO_QA_THREAD"] ?? "missing-staged-thread" }
}
