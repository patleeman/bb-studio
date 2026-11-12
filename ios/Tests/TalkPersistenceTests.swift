import XCTest
@testable import BBStudio

@MainActor
final class TalkPersistenceTests: XCTestCase {
    func testAudioMoveFailurePreservesSourceAndBlocksFinishingUntilRetry() async throws {
        try await verifyRecovery(fault: .audioMove)
    }

    func testMetadataWriteFailurePreservesSourceAndBlocksFinishingUntilRetry() async throws {
        try await verifyRecovery(fault: .metadataWrite)
    }

    func testMetadataCommitFailureRollsBackAudioAndPreservesSource() async throws {
        try await verifyRecovery(fault: .metadataMove)
    }

    func testMissingHandoffTimesOutWithoutFinalizingAndCanRecover() async throws {
        let handoff = TalkHandoff { _ in }
        handoff.receive(CapturedSegment(url: URL(fileURLWithPath: "/unused/first"), index: 0, startedAt: 0, durationMs: 100))
        var finalized = false
        do {
            try await handoff.waitUntilDurable(2, timeout: .milliseconds(20))
            finalized = true
        } catch {
            XCTAssertTrue(error.localizedDescription.contains("has not been finalized"))
        }
        XCTAssertFalse(finalized)
        XCTAssertEqual(handoff.savedCount, 1)
        handoff.receive(CapturedSegment(url: URL(fileURLWithPath: "/unused/last"), index: 1, startedAt: 100, durationMs: 100))
        try await handoff.waitUntilDurable(2, timeout: .milliseconds(20))
        XCTAssertEqual(handoff.savedCount, 2)
    }

    private enum Fault { case audioMove, metadataWrite, metadataMove }

    /// Real files and real copy/rename operations; only one selected storage
    /// operation fails. Recovery must retain and then enqueue the same bytes.
    private func verifyRecovery(fault: Fault) async throws {
        let files = FileManager.default
        let root = files.temporaryDirectory.appendingPathComponent("TalkPersistence-\(UUID())")
        let directory = root.appendingPathComponent("outbox")
        try files.createDirectory(at: root, withIntermediateDirectories: true)
        defer { try? files.removeItem(at: root) }
        let source = root.appendingPathComponent("capture.m4a")
        let audio = Data([0, 1, 2, 3, 254, 255])
        try audio.write(to: source)
        let suite = "TalkPersistence-\(UUID())"
        let defaults = UserDefaults(suiteName: suite)!
        defer { defaults.removePersistentDomain(forName: suite) }
        var shouldFail = true
        var persistence = TalkOutbox.Persistence()
        persistence.writeMetadata = { data, url in
            if shouldFail && fault == .metadataWrite {
                // Model a failed write that left partial staging bytes.
                try Data("{".utf8).write(to: url)
                throw CocoaError(.fileWriteOutOfSpace)
            }
            try data.write(to: url, options: .atomic)
        }
        persistence.move = { source, target in
            if shouldFail && ((fault == .audioMove && target.pathExtension == "m4a") ||
                              (fault == .metadataMove && target.pathExtension == "json")) {
                throw CocoaError(.fileWriteNoPermission)
            }
            try files.moveItem(at: source, to: target)
        }
        // Selected B pauses these A-bound uploads, so this test cannot contact a server.
        let selected = BBClient(baseURL: URL(string: "https://b.invalid")!)
        selected.transport = { _, _, _ in XCTFail("The persistence test must not send requests"); throw URLError(.badURL) }
        let outbox = TalkOutbox(directory: directory, defaults: defaults, persistence: persistence, currentClient: { selected })
        let handoff = TalkHandoff { segment in
            try outbox.add(segment, recordingId: "rec_a", sessionId: "session_a", serverURL: URL(string: "https://a.invalid")!)
        }
        handoff.receive(CapturedSegment(url: source, index: 0, startedAt: 0, durationMs: 1000))
        XCTAssertEqual(handoff.failedCount, 1)
        XCTAssertEqual(handoff.savedCount, 0)
        XCTAssertEqual(try Data(contentsOf: source), audio)
        XCTAssertEqual(outbox.pending, 0)
        XCTAssertTrue(try files.contentsOfDirectory(atPath: directory.path).isEmpty)
        var finalized = false
        do {
            try await handoff.waitUntilDurable(1, timeout: .milliseconds(20))
            finalized = true
        } catch {
            XCTAssertTrue(error.localizedDescription.contains("Couldn't save all the audio"))
        }
        XCTAssertFalse(finalized)

        shouldFail = false
        handoff.retry()
        try await handoff.waitUntilDurable(1)
        XCTAssertEqual(handoff.failedCount, 0)
        XCTAssertEqual(handoff.savedCount, 1)
        XCTAssertFalse(files.fileExists(atPath: source.path))
        XCTAssertEqual(outbox.pending, 1)
        let committed = try files.contentsOfDirectory(at: directory, includingPropertiesForKeys: nil)
        XCTAssertEqual(committed.count, 2)
        let committedAudio = try XCTUnwrap(committed.first { $0.pathExtension == "m4a" })
        XCTAssertEqual(try Data(contentsOf: committedAudio), audio)
        let manifest = try XCTUnwrap(committed.first { $0.pathExtension == "json" })
        let entry = try JSONDecoder().decode(JSONValue.self, from: Data(contentsOf: manifest))
        XCTAssertEqual(entry["recordingId"]?.stringValue, "rec_a")
        XCTAssertEqual(entry["serverURL"]?.stringValue, "https://a.invalid")
        await Task.yield()
    }
}
