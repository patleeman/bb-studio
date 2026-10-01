import XCTest
@testable import BBStudio

final class PushRegistrationTests: XCTestCase {
    func testTokenChangeRemovesPreviousSubscription() async throws {
        let suite = "PushRegistrationTests-\(UUID())"
        let defaults = UserDefaults(suiteName: suite)!
        defer { defaults.removePersistentDomain(forName: suite) }
        let registration = PushRegistration(defaults: defaults)
        let client = BBClient(baseURL: URL(string: "https://example.test")!)
        let requests = Requests()
        client.transport = { _, path, body in
            let value = try JSONDecoder().decode(JSONValue.self, from: body ?? Data())
            let count = await requests.record(path: path, value: value)
            if path.hasSuffix("pushSubscriptions.add") {
                let id = count == 1 ? "old" : "new"
                return (200, Data("{\"ok\":true,\"result\":{\"id\":\"\(id)\",\"created\":true}}".utf8))
            }
            return (200, Data(#"{"ok":true,"result":{"ok":true}}"#.utf8))
        }

        try await registration.register(apnsToken: "first", label: "Phone", client: client)
        try await registration.register(apnsToken: "second", label: "Phone", client: client)
        let calls = await requests.calls
        XCTAssertEqual(calls.map(\.path), [
            "/api/v1/plugins/push-notifications/rpc/pushSubscriptions.add",
            "/api/v1/plugins/push-notifications/rpc/pushSubscriptions.add",
            "/api/v1/plugins/push-notifications/rpc/pushSubscriptions.remove",
        ])
        XCTAssertEqual(calls.last?.value["id"]?.stringValue, "old")
    }

    func testQALaunchesAreExcluded() {
        XCTAssertFalse(PushRegistration.allowed(arguments: ["app", "-skipPushPrompt", "YES"], environment: [:]))
        XCTAssertFalse(PushRegistration.allowed(arguments: ["app", "-qaPageDemo"], environment: [:]))
        XCTAssertFalse(PushRegistration.allowed(arguments: ["app"], environment: ["BBGO_QA_THREAD": "scratch"]))
        XCTAssertFalse(PushRegistration.allowed(arguments: ["app"], environment: ["XCTestConfigurationFilePath": "test"]))
        XCTAssertTrue(PushRegistration.allowed(arguments: ["app"], environment: [:]))
    }

    func testFailedRemovalRetriesOnNextRegistration() async throws {
        let suite = "PushRegistrationRetryTests-\(UUID())"
        let defaults = UserDefaults(suiteName: suite)!
        defer { defaults.removePersistentDomain(forName: suite) }
        let registration = PushRegistration(defaults: defaults)
        let client = BBClient(baseURL: URL(string: "https://example.test")!)
        let requests = Requests()
        client.transport = { _, path, body in
            let value = try JSONDecoder().decode(JSONValue.self, from: body ?? Data())
            let count = await requests.record(path: path, value: value)
            if path.hasSuffix("pushSubscriptions.add") {
                let id = count == 1 ? "old" : "new"
                return (200, Data("{\"ok\":true,\"result\":{\"id\":\"\(id)\",\"created\":true}}".utf8))
            }
            if count == 1 { throw URLError(.timedOut) }
            return (200, Data(#"{"ok":true,"result":{"ok":true}}"#.utf8))
        }

        try await registration.register(apnsToken: "first", label: "Phone", client: client)
        try await registration.register(apnsToken: "second", label: "Phone", client: client)
        try await registration.register(apnsToken: "second", label: "Phone", client: client)
        let removals = await requests.calls.filter { $0.path.hasSuffix("pushSubscriptions.remove") }
        XCTAssertEqual(removals.count, 2)
        XCTAssertTrue(removals.allSatisfy { $0.value["id"]?.stringValue == "old" })
    }
}

private actor Requests {
    struct Call { let path: String; let value: JSONValue }
    private(set) var calls: [Call] = []
    func record(path: String, value: JSONValue) -> Int {
        calls.append(Call(path: path, value: value))
        return calls.filter { $0.path == path }.count
    }
}
