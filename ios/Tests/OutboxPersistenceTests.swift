import XCTest
@testable import BBStudio

@MainActor
final class OutboxPersistenceTests: XCTestCase {
    private let origin = URL(string: "https://outbox.invalid")!

    private func fixture() throws -> (URL, Outbox.Store) {
        let root = FileManager.default.temporaryDirectory.appendingPathComponent("Outbox-\(UUID())")
        try FileManager.default.createDirectory(at: root, withIntermediateDirectories: true)
        addTeardownBlock { try FileManager.default.removeItem(at: root) }
        return (root, Outbox.Store(file: root.appendingPathComponent("Durable/messages.json"),
                                   legacy: root.appendingPathComponent("outbox.json")))
    }

    private func message() -> Outbox.Message {
        Outbox.Message(threadId: "thread", text: "Offline words", mentions: [], serverURL: origin)
    }

    func testMigratesLegacyIDsOnceAndKeepsTheEmptyDurableStoreAuthoritative() throws {
        let (_, store) = try fixture()
        let message = message()
        try JSONEncoder().encode([message]).write(to: store.legacy)
        XCTAssertEqual(try store.load().map(\.id), [message.id])
        try store.save([])
        // An old cache surviving migration must not resurrect a sent message.
        XCTAssertTrue(try store.load().isEmpty)
        XCTAssertTrue(FileManager.default.fileExists(atPath: store.legacy.path))
    }

    func testMigrationWriteFailurePreservesLegacyAndCanRecover() throws {
        let (root, store) = try fixture()
        let message = message()
        try JSONEncoder().encode([message]).write(to: store.legacy)
        let blocker = root.appendingPathComponent("Durable")
        try Data("not a directory".utf8).write(to: blocker)
        let client = BBClient(baseURL: URL(string: "https://other.invalid")!)
        let outbox = Outbox(currentClient: { client }, store: store)
        XCTAssertNotNil(outbox.storageError)
        XCTAssertFalse(outbox.add(threadId: "thread", text: "Do not lose this", mentions: []))
        XCTAssertEqual(try JSONDecoder().decode([Outbox.Message].self, from: Data(contentsOf: store.legacy)).map(\.id), [message.id])
        try FileManager.default.removeItem(at: blocker)
        // Keep the recovered message paused, so this storage test never sends.
        outbox.retryStorage()
        XCTAssertNil(outbox.storageError)
        XCTAssertEqual(outbox.messages.map(\.id), [message.id])
        XCTAssertEqual(try store.load().map(\.id), [message.id])
    }

    func testUnreadableDurableStoreCannotBeReplacedByAnAddOrTheLegacyCache() throws {
        let (_, store) = try fixture()
        try store.save([])
        let corrupt = Data("not json".utf8)
        try corrupt.write(to: store.file)
        try JSONEncoder().encode([message()]).write(to: store.legacy)
        let client = BBClient(baseURL: origin)
        let outbox = Outbox(currentClient: { client }, store: store)
        XCTAssertNotNil(outbox.storageError)
        XCTAssertFalse(outbox.add(threadId: "thread", text: "Keep draft", mentions: []))
        XCTAssertEqual(try Data(contentsOf: store.file), corrupt)
        try store.save([])
        outbox.retryStorage()
        XCTAssertNil(outbox.storageError)
        XCTAssertTrue(outbox.add(threadId: "thread", text: "Saved draft", mentions: []))
        XCTAssertEqual(try store.load().map(\.text), ["Saved draft"])
    }

    func testFailedAddAndRemoveDoNotAcknowledgeAnUnsavedChange() {
        let client = BBClient(baseURL: origin)
        let message = message()
        var fail = true
        let outbox = Outbox(messages: [message], currentClient: { client }, persist: { _ in
            if fail { throw CocoaError(.fileWriteOutOfSpace) }
        })
        XCTAssertFalse(outbox.add(threadId: "thread", text: "Keep draft", mentions: []))
        XCTAssertEqual(outbox.messages, [message])
        XCTAssertNotNil(outbox.storageError)
        outbox.remove(message.id)
        XCTAssertEqual(outbox.messages, [message])
        fail = false
        outbox.remove(message.id)
        XCTAssertTrue(outbox.messages.isEmpty)
        XCTAssertNil(outbox.storageError)
    }

    func testFailedAttemptCheckpointDoesNotContactBB() async {
        let client = BBClient(baseURL: origin)
        client.transport = { _, _, _ in XCTFail("No send before a durable checkpoint"); throw URLError(.badURL) }
        let outbox = Outbox(messages: [message()], currentClient: { client }, persist: { _ in
            throw CocoaError(.fileWriteOutOfSpace)
        })
        await outbox.send(using: client)
        XCTAssertNotNil(outbox.storageError)
        XCTAssertNil(outbox.messages.first?.attemptedAt)
    }

    func testAcceptedIDSurvivesFailedCleanupAndRestartWithoutSendingAgain() async throws {
        let (_, store) = try fixture()
        let message = message()
        let client = BBClient(baseURL: origin)
        let sends = LockedCounter()
        client.transport = { _, _, _ in
            _ = sends.next()
            return (200, Data(#"{"ok":true}"#.utf8))
        }
        let outbox = Outbox(messages: [message], currentClient: { client }, persist: { next in
            if next.isEmpty { throw CocoaError(.fileWriteOutOfSpace) }
            try store.save(next)
        })
        await outbox.send(using: client)
        XCTAssertNotNil(outbox.storageError)
        XCTAssertEqual(try store.load().first?.id, message.id)
        XCTAssertEqual(try store.load().first?.delivered, true)
        let reopened = Outbox(currentClient: { client }, store: store)
        await reopened.send(using: client)
        XCTAssertTrue(reopened.messages.isEmpty)
        XCTAssertTrue(try store.load().isEmpty)
        XCTAssertEqual(sends.next(), 2, "Only the original POST may be sent")
    }

    func testFailedAcknowledgementDoesNotResendInThisProcess() async {
        let client = BBClient(baseURL: origin)
        let sends = LockedCounter()
        client.transport = { _, _, _ in
            _ = sends.next()
            return (200, Data(#"{"ok":true}"#.utf8))
        }
        var fail = true
        let outbox = Outbox(messages: [message()], currentClient: { client }, persist: { next in
            if fail && next.contains(where: { $0.delivered == true }) { throw CocoaError(.fileWriteOutOfSpace) }
        })
        await outbox.send(using: client)
        XCTAssertNotNil(outbox.storageError)
        await outbox.send(using: client)
        XCTAssertEqual(sends.next(), 2)
        fail = false
        outbox.retryStorage()
        XCTAssertTrue(outbox.messages.isEmpty)
        XCTAssertNil(outbox.storageError)
    }

    func testUncertainRestartWaitsForReviewThenReconcilesHistoryAndQueue() async throws {
        for foundInQueue in [false, true] {
            let (_, store) = try fixture()
            var message = message()
            message.attemptedAt = Date(timeIntervalSince1970: 100)
            try store.save([message]) // Terminated after POST, before saving a receipt.
            let client = BBClient(baseURL: origin)
            let reads = LockedCounter()
            client.transport = { method, path, _ in
                XCTAssertEqual(method, "GET", "A matching accepted message must never POST again")
                _ = reads.next()
                if path.hasSuffix("/queued-messages") {
                    return (200, Data((foundInQueue
                        ? #"[{"id":"queued","createdAt":100000,"content":[{"type":"text","text":"Offline words"}]}]"# : "[]").utf8))
                }
                return (200, Data((foundInQueue ? #"{"rows":[],"maxSeq":1}"#
                    : #"{"rows":[{"id":"accepted","kind":"conversation","role":"user","text":"Offline words","createdAt":100000}],"maxSeq":1}"#).utf8))
            }
            let finished = expectation(description: "Reconciled and removed")
            let outbox = Outbox(currentClient: { client }, persist: { next in
                try store.save(next)
                if next.isEmpty { finished.fulfill() }
            }, store: store)
            XCTAssertNotNil(outbox.messages.first?.failure)
            await outbox.send(using: client)
            XCTAssertEqual(reads.next(), 1, "Interrupted requests cannot retry automatically")
            outbox.retry(message.id)
            await fulfillment(of: [finished], timeout: 2)
            XCTAssertTrue(outbox.messages.isEmpty)
            XCTAssertTrue(try store.load().isEmpty)
            XCTAssertEqual(reads.next(), 4)
        }
    }

    func testFailedReconciliationDoesNotResendOrScheduleAnUncertainPost() async {
        var message = message()
        message.attemptedAt = Date()
        let client = BBClient(baseURL: origin)
        let failed = expectation(description: "Reconciliation failure saved")
        client.transport = { method, _, _ in
            XCTAssertEqual(method, "GET")
            throw URLError(.notConnectedToInternet)
        }
        let outbox = Outbox(messages: [message], currentClient: { client }, persist: { next in
            if next.first?.failure != nil { failed.fulfill() }
        })
        outbox.retry(message.id)
        await fulfillment(of: [failed], timeout: 2)
        XCTAssertEqual(outbox.messages.first?.id, message.id)
        XCTAssertNotNil(outbox.messages.first?.attemptedAt)
        XCTAssertNotNil(outbox.messages.first?.failure)
    }

    func testKnownOfflineFailureCanRetryButDuplicateIDsOnlySendOnce() async {
        let client = BBClient(baseURL: origin)
        let sends = LockedCounter()
        let offline = LockedFlag()
        offline.value = true
        client.transport = { _, _, _ in
            _ = sends.next()
            if offline.value { throw URLError(.notConnectedToInternet) }
            return (200, Data(#"{"ok":true}"#.utf8))
        }
        let message = message()
        let outbox = Outbox(messages: [message, message], currentClient: { client }, persist: { _ in })
        await outbox.send(using: client)
        XCTAssertNil(outbox.messages.first?.attemptedAt)
        XCTAssertNil(outbox.messages.first?.failure)
        offline.value = false
        await outbox.send(using: client)
        XCTAssertTrue(outbox.messages.isEmpty)
        XCTAssertEqual(sends.next(), 3)
    }

    func testUncertainSendWithAFailedErrorWriteStaysHeldAfterSavingAndRestart() async throws {
        let (_, store) = try fixture()
        let client = BBClient(baseURL: origin)
        let calls = LockedCounter()
        client.transport = { _, _, _ in
            _ = calls.next()
            throw URLError(.timedOut)
        }
        var fail = true
        let outbox = Outbox(messages: [message()], currentClient: { client }, persist: { next in
            if fail && next.first?.failure != nil { throw CocoaError(.fileWriteOutOfSpace) }
            try store.save(next)
        })
        await outbox.send(using: client)
        XCTAssertNotNil(outbox.storageError)
        XCTAssertNotNil(try store.load().first?.attemptedAt)
        fail = false
        outbox.retryStorage()
        await outbox.send(using: client)
        XCTAssertNil(outbox.storageError)
        XCTAssertNotNil(outbox.messages.first?.failure)
        XCTAssertEqual(calls.next(), 2)
        let reopened = Outbox(currentClient: { client }, store: store)
        XCTAssertNotNil(reopened.messages.first?.failure)
        await reopened.send(using: client)
        XCTAssertEqual(calls.next(), 3, "Only the original timed-out POST was attempted")
    }

    func testExplicitRetryUsesTheSameClientIDAndIgnoresAnOlderIdenticalMessage() async {
        var message = message()
        message.attemptedAt = Date(timeIntervalSince1970: 100)
        let id = message.id
        let client = BBClient(baseURL: origin)
        let sends = LockedCounter()
        client.transport = { method, path, _ in
            if method == "POST" {
                _ = sends.next()
                return (200, Data(#"{"ok":true}"#.utf8))
            }
            if path.hasSuffix("/queued-messages") { return (200, Data("[]".utf8)) }
            return (200, Data(#"{"rows":[{"id":"old","kind":"conversation","role":"user","text":"Offline words","createdAt":1000}],"maxSeq":1}"#.utf8))
        }
        let finished = expectation(description: "Retry sent and removed")
        let outbox = Outbox(messages: [message], currentClient: { client }, persist: { next in
            for entry in next { XCTAssertEqual(entry.id, id) }
            if next.isEmpty { finished.fulfill() }
        })
        await outbox.send(using: client)
        XCTAssertEqual(sends.next(), 1)
        outbox.retry(id)
        await fulfillment(of: [finished], timeout: 2)
        XCTAssertEqual(sends.next(), 3)
        XCTAssertTrue(outbox.messages.isEmpty)
    }

    private actor Gate {
        private var released = false
        private var continuation: CheckedContinuation<Void, Never>?
        func wait() async {
            if !released { await withCheckedContinuation { continuation = $0 } }
        }
        func release() { released = true; continuation?.resume(); continuation = nil }
    }

    func testOverlappingFlushesCannotSendTheSameClientIDTwice() async {
        let client = BBClient(baseURL: origin)
        let gate = Gate()
        let started = expectation(description: "Sending")
        let calls = LockedCounter()
        client.transport = { _, _, _ in
            _ = calls.next()
            started.fulfill()
            await gate.wait()
            return (200, Data(#"{"ok":true}"#.utf8))
        }
        let outbox = Outbox(messages: [message()], currentClient: { client }, persist: { _ in })
        let first = Task { await outbox.send(using: client) }
        await fulfillment(of: [started], timeout: 2)
        await outbox.send(using: client)
        await gate.release()
        await first.value
        XCTAssertEqual(calls.next(), 2)
        XCTAssertTrue(outbox.messages.isEmpty)
    }

}
