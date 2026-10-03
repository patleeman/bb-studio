import XCTest
@testable import BBStudio

final class MobileSafetyTests: XCTestCase {
    func testClearCannotRemoveAnotherServersNotificationWithSameThreadID() {
        XCTAssertTrue(NotificationActions.matchesClear(["serverId": "a", "threadId": "thr_a"], threadIds: ["thr_a"], serverId: "a"))
        XCTAssertFalse(NotificationActions.matchesClear(["serverId": "b", "threadId": "thr_a"], threadIds: ["thr_a"], serverId: "a"))
        XCTAssertFalse(NotificationActions.matchesClear(["threadId": "thr_a"], threadIds: ["thr_a"], serverId: "a"))
    }

    func testStaleApprovalDoesNotResolveReplacement() async throws {
        let requests = SafetyRequests()
        let client = BBClient(baseURL: URL(string: "https://a.test")!)
        client.transport = { method, path, _ in
            await requests.record(method + " " + path)
            return (200, Data(#"[{"id":"replacement","threadId":"thr_a","status":"pending","payload":{"kind":"approval","availableDecisions":["allow_once","deny"]}}]"#.utf8))
        }
        do {
            try await client.resolve(threadId: "thr_a", interactionId: "old", decision: "allow_once")
            XCTFail("A stale approval must fail")
        } catch let error as BBError { XCTAssertEqual(error.status, 404) }
        let calls = await requests.calls
        XCTAssertEqual(calls, ["GET /api/v1/threads/thr_a/interactions"])
    }

    func testUnavailableApprovalDecisionIsRejected() async throws {
        let requests = SafetyRequests()
        let client = BBClient(baseURL: URL(string: "https://a.test")!)
        client.transport = { method, path, _ in
            await requests.record(method + " " + path)
            return (200, Data(#"[{"id":"original","threadId":"thr_a","status":"pending","payload":{"kind":"approval","availableDecisions":["deny"]}}]"#.utf8))
        }
        do {
            try await client.resolve(threadId: "thr_a", interactionId: "original", decision: "allow_once")
            XCTFail("Unavailable decisions must fail")
        } catch let error as BBError { XCTAssertEqual(error.status, 400) }
        let calls = await requests.calls
        XCTAssertEqual(calls.count, 1)
    }

    func testNotificationQuestionLookupDoesNotFallBackToAnotherQuestion() async throws {
        let client = BBClient(baseURL: URL(string: "https://a.test")!)
        client.transport = { _, _, _ in
            (200, Data(#"[{"id":"new","threadId":"thr_a","status":"pending","payload":{"kind":"user_question","questions":[]}}]"#.utf8))
        }
        do {
            _ = try await client.pendingInteraction(threadId: "thr_a", interactionId: "old")
            XCTFail("Stale text replies and choice buttons must not find the new question")
        } catch let error as BBError { XCTAssertEqual(error.status, 404) }
        let current = try await client.pendingInteraction(threadId: "thr_a", interactionId: "new")
        XCTAssertEqual(current.id, "new")
    }

    func testNotificationOriginRequiresExactServerIdentity() async throws {
        let client = BBClient(baseURL: URL(string: "https://a.test")!)
        client.transport = { _, _, _ in (200, Data(#"{"serverId":"server-a"}"#.utf8)) }
        try await client.validateNotificationOrigin("server-a")
        for origin in [nil, "server-b"] as [String?] {
            do {
                try await client.validateNotificationOrigin(origin)
                XCTFail("Unknown or different origins must fail")
            } catch let error as BBError { XCTAssertEqual(error.status, 409) }
        }
    }

    @MainActor
    func testOutboxQuarantinesLegacyAndBindsNewMessagesToTheirOriginalServer() async throws {
        let a = BBClient(baseURL: URL(string: "https://a.test")!)
        let b = BBClient(baseURL: URL(string: "https://b.test")!)
        let requests = SafetyRequests()
        a.transport = { _, _, _ in
            await requests.record("a")
            return (200, Data(#"{"ok":true,"delivery":"sent"}"#.utf8))
        }
        b.transport = { _, _, _ in
            await requests.record("b")
            return (200, Data(#"{"ok":true,"delivery":"sent"}"#.utf8))
        }
        var selected = a
        let legacy = try JSONDecoder().decode(Outbox.Message.self, from: Data(#"{"id":"00000000-0000-0000-0000-000000000001","threadId":"thr_a","text":"Legacy","mentions":[],"createdAt":0}"#.utf8))
        let outbox = Outbox(messages: [legacy], currentClient: { selected }, persist: { _ in })
        selected = b
        outbox.add(threadId: "thr_a", text: "Late failure on A", mentions: [], serverURL: a.baseURL)
        await outbox.send(using: b)
        XCTAssertEqual(outbox.messages.count, 2)
        XCTAssertEqual(outbox.messages(for: "thr_a").count, 1)
        XCTAssertNotNil(outbox.messages.first?.failure)
        XCTAssertNil(outbox.messages.first?.serverURL)
        let before = await requests.calls
        XCTAssertTrue(before.isEmpty)
        selected = a
        await outbox.send(using: a)
        XCTAssertEqual(outbox.messages.count, 1, "Legacy content still requires explicit review")
        outbox.retry(legacy.id)
        let deadline = Date().addingTimeInterval(2)
        while !outbox.messages.isEmpty, Date() < deadline { try await Task.sleep(for: .milliseconds(10)) }
        let after = await requests.calls
        XCTAssertEqual(after, ["a", "a"])
        XCTAssertTrue(outbox.messages.isEmpty)
    }

    @MainActor
    func testLegacyAudioAndFinishStayOnOriginalServer() async throws {
        let directory = FileManager.default.temporaryDirectory.appendingPathComponent(UUID().uuidString)
        try FileManager.default.createDirectory(at: directory, withIntermediateDirectories: true)
        defer { try? FileManager.default.removeItem(at: directory) }
        let suite = "TalkOutboxSafety-\(UUID())"
        let defaults = UserDefaults(suiteName: suite)!
        defer { defaults.removePersistentDomain(forName: suite) }
        try Data(#"{"recordingId":"rec_a","sessionId":"session","index":0,"startedAt":0,"durationMs":1000}"#.utf8)
            .write(to: directory.appendingPathComponent("legacy.json"))
        try Data([1, 2, 3]).write(to: directory.appendingPathComponent("legacy.m4a"))
        defaults.set(["rec_a"], forKey: "talkFinishAfterUpload")
        let a = BBClient(baseURL: URL(string: "https://a.test")!)
        let b = BBClient(baseURL: URL(string: "https://b.test")!)
        let requests = SafetyRequests()
        b.transport = { _, _, _ in
            await requests.record("b")
            throw BBError(status: 400, message: "No recording")
        }
        let outbox = TalkOutbox(directory: directory, defaults: defaults, currentClient: { b })
        outbox.kick()
        try await Task.sleep(for: .milliseconds(100))
        let calls = await requests.calls
        XCTAssertTrue(calls.isEmpty)
        XCTAssertEqual(outbox.pending, 1)
        XCTAssertEqual(outbox.legacyPending, 1)
        XCTAssertTrue(FileManager.default.fileExists(atPath: directory.appendingPathComponent("legacy.m4a").path))
        let metadata = try JSONDecoder().decode(JSONValue.self, from: Data(contentsOf: directory.appendingPathComponent("legacy.json")))
        XCTAssertNil(metadata["serverURL"])
        try outbox.resumeLegacy(on: a.baseURL)
        XCTAssertEqual(outbox.legacyPending, 0)
        let recovered = try JSONDecoder().decode(JSONValue.self, from: Data(contentsOf: directory.appendingPathComponent("legacy.json")))
        XCTAssertEqual(recovered["serverURL"]?.stringValue, a.baseURL.absoluteString)
        try await Task.sleep(for: .milliseconds(50))
        let afterRecovery = await requests.calls
        XCTAssertTrue(afterRecovery.isEmpty, "A's recovered audio must still wait while B is selected")
    }

    @MainActor
    func testSwitchDuringSendKeepsClientAndPausesRemainingMessages() async throws {
        let a = BBClient(baseURL: URL(string: "https://a.test")!)
        let b = BBClient(baseURL: URL(string: "https://b.test")!)
        let gate = SafetyGate()
        a.transport = { _, _, _ in
            await gate.wait()
            return (200, Data(#"{"ok":true}"#.utf8))
        }
        b.transport = { _, _, _ in XCTFail("Never send A's messages to B"); throw URLError(.badURL) }
        var selected = a
        let entries = ["First", "Second"].map {
            Outbox.Message(threadId: "thr_a", text: $0, mentions: [], serverURL: a.baseURL)
        }
        let outbox = Outbox(messages: entries, currentClient: { selected }, persist: { _ in })
        let task = Task { await outbox.send(using: a) }
        while !(await gate.started) { await Task.yield() }
        selected = b
        await gate.release()
        await task.value
        XCTAssertEqual(outbox.messages.map(\.text), ["Second"])
        XCTAssertEqual(outbox.messages.first?.serverURL, a.baseURL)
    }
}

private actor SafetyRequests {
    private(set) var calls: [String] = []
    func record(_ value: String) { calls.append(value) }
}

private actor SafetyGate {
    private(set) var started = false
    private var continuation: CheckedContinuation<Void, Never>?
    func wait() async {
        started = true
        await withCheckedContinuation { continuation = $0 }
    }
    func release() { continuation?.resume(); continuation = nil }
}
