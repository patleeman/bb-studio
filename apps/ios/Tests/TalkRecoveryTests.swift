import AVFoundation
import XCTest
@testable import BBStudio

@MainActor
final class TalkRecoveryTests: XCTestCase {
    func testMetadataFailureCannotOpenOrOverwriteCaptureAudio() throws {
        let f = try Fixture(); defer { f.clean() }
        let session = try f.begin()
        let failing = TalkCaptureJournal(directory: f.journal.directory) { data, url in
            try Data("{".utf8).write(to: url)
            throw CocoaError(.fileWriteOutOfSpace)
        }
        XCTAssertThrowsError(try failing.open(session, index: 0, startedAt: 1))
        XCTAssertTrue(f.journal.audioFiles().isEmpty)
        let raw = try f.journal.open(session, index: 0, startedAt: 1)
        try Data([1, 2]).write(to: raw)
        XCTAssertThrowsError(try f.journal.open(session, index: 0, startedAt: 2))
        XCTAssertEqual(try Data(contentsOf: raw), Data([1, 2]))
    }

    func testRestartRecoversUnclosedPCMWithOriginalOriginAndValidWAV() throws {
        let f = try Fixture(); defer { f.clean() }
        let session = try f.begin()
        let raw = try f.journal.open(session, index: 0, startedAt: 1234)
        let samples = (0..<16_000).map { Int16($0 % 2 == 0 ? 16_384 : -16_384).littleEndian }
        try samples.withUnsafeBytes { try Data($0).write(to: raw) }
        // No close or enqueue: a fresh instance sees only on-disk capture state.
        let recovered = f.outbox()
        XCTAssertEqual(recovered.pending, 1)
        XCTAssertFalse(FileManager.default.fileExists(atPath: raw.path))
        let files = try FileManager.default.contentsOfDirectory(at: f.outboxDirectory, includingPropertiesForKeys: nil)
        let audio = try XCTUnwrap(files.first { $0.pathExtension == "wav" })
        let wave = f.root.appendingPathComponent("decoded.wav")
        try Data(contentsOf: audio).write(to: wave)
        let decoded = try AVAudioFile(forReading: wave)
        XCTAssertEqual(decoded.length, 16_000)
        XCTAssertEqual(decoded.processingFormat.sampleRate, 16_000)
        let buffer = try XCTUnwrap(AVAudioPCMBuffer(pcmFormat: decoded.processingFormat, frameCapacity: 2))
        try decoded.read(into: buffer, frameCount: 2)
        XCTAssertEqual(buffer.floatChannelData![0][0], 0.5, accuracy: 0.0001)
        XCTAssertEqual(buffer.floatChannelData![0][1], -0.5, accuracy: 0.0001)
        let metadata = try XCTUnwrap(files.first { $0.pathExtension == "json" })
        let entry = try JSONDecoder().decode(JSONValue.self, from: Data(contentsOf: metadata))
        XCTAssertEqual(entry["serverURL"]?.stringValue, f.origin.absoluteString)
        XCTAssertEqual(entry["sessionId"]?.stringValue, session.sessionId)
        XCTAssertEqual(entry["mimeType"]?.stringValue, "audio/wav")
        XCTAssertFalse(recovered.canFinish(session.recordingId, serverURL: f.origin))
    }

    func testAcknowledgementFailureKeepsSourceAndRestartDeduplicatesCommittedAudio() throws {
        let f = try Fixture(); defer { f.clean() }
        let failing = TalkCaptureJournal(directory: f.journal.directory) { data, url in
            if (try? JSONDecoder().decode(TalkCaptureJournal.Segment.self, from: data).queued) == true {
                throw CocoaError(.fileWriteOutOfSpace)
            }
            try data.write(to: url, options: .atomic)
        }
        let session = try f.begin()
        let raw = try failing.open(session, index: 0, startedAt: 1)
        let bytes = Data(repeating: 1, count: 32_000)
        try bytes.write(to: raw)
        let outbox = f.outbox(journal: failing)
        XCTAssertThrowsError(try outbox.add(CapturedSegment(url: raw, index: 0, startedAt: 1, durationMs: 1000), recordingId: session.recordingId, sessionId: session.sessionId, serverURL: f.origin))
        XCTAssertEqual(try Data(contentsOf: raw), bytes)
        let restarted = f.outbox()
        XCTAssertEqual(restarted.pending, 1)
        XCTAssertFalse(FileManager.default.fileExists(atPath: raw.path))
    }

    func testMissingCaptureFileBlocksFinishAndPreservesManifest() throws {
        let f = try Fixture(); defer { f.clean() }
        let session = try f.begin()
        let raw = try f.journal.open(session, index: 0, startedAt: 1)
        try FileManager.default.removeItem(at: raw)
        let outbox = f.outbox()
        outbox.finishWhenSent(session.recordingId, serverURL: f.origin)
        XCTAssertFalse(outbox.canFinish(session.recordingId, serverURL: f.origin))
        XCTAssertNotNil(outbox.recoveryError)
        XCTAssertEqual(f.journal.sessions(), [session])
    }

    func testInterruptedOutboxRenameIsRecoveredWithoutInventingLegacyOrigin() throws {
        let f = try Fixture(); defer { f.clean() }
        try FileManager.default.createDirectory(at: f.outboxDirectory, withIntermediateDirectories: true)
        let audio = f.outboxDirectory.appendingPathComponent("interrupted.audio.pending")
        try Data([1, 2, 3]).write(to: audio)
        try Data(#"{"recordingId":"rec_old","sessionId":"old","index":0,"startedAt":0,"durationMs":1000}"#.utf8)
            .write(to: f.outboxDirectory.appendingPathComponent("interrupted.metadata.pending"))
        let outbox = f.outbox()
        XCTAssertEqual(outbox.pending, 1)
        XCTAssertEqual(outbox.legacyPending, 1)
        XCTAssertTrue(FileManager.default.fileExists(atPath: f.outboxDirectory.appendingPathComponent("interrupted.m4a").path))
    }

    func testUnknownOrphanIsPreservedForExportAndBlocksFinishing() throws {
        let f = try Fixture(); defer { f.clean() }
        try FileManager.default.createDirectory(at: f.outboxDirectory, withIntermediateDirectories: true)
        let orphan = f.outboxDirectory.appendingPathComponent("unknown.audio.pending")
        let bytes = Data([7, 8, 9]); try bytes.write(to: orphan)
        let outbox = f.outbox()
        XCTAssertEqual(outbox.pending, 0)
        XCTAssertTrue(outbox.recoveryFiles.contains(orphan))
        XCTAssertFalse(outbox.canFinish("rec_any", serverURL: f.origin))
        XCTAssertEqual(try Data(contentsOf: orphan), bytes)
    }

    func testExplicitDiscardReleasesOnlySelectedOrphanBarrier() throws {
        let f = try Fixture(); defer { f.clean() }
        try FileManager.default.createDirectory(at: f.outboxDirectory, withIntermediateDirectories: true)
        let first = f.outboxDirectory.appendingPathComponent("first.audio.pending")
        let second = f.outboxDirectory.appendingPathComponent("second.audio.pending")
        try Data([1]).write(to: first); try Data([2]).write(to: second)
        let outbox = f.outbox()
        outbox.recoverCaptures() // Merely viewing or retrying does not discard.
        XCTAssertEqual(try Data(contentsOf: first), Data([1]))
        XCTAssertFalse(outbox.canFinish("rec_any", serverURL: f.origin))
        try outbox.discardLocalCopy(first)
        XCTAssertFalse(FileManager.default.fileExists(atPath: first.path))
        XCTAssertEqual(try Data(contentsOf: second), Data([2]))
        XCTAssertFalse(outbox.canFinish("rec_any", serverURL: f.origin))
        try outbox.discardLocalCopy(second)
        XCTAssertTrue(outbox.canFinish("rec_any", serverURL: f.origin))
    }

    func testDiscardRejectedAndMissingEntriesRemovesTheirBlockingMetadata() throws {
        let f = try Fixture(); defer { f.clean() }
        try FileManager.default.createDirectory(at: f.outboxDirectory, withIntermediateDirectories: true)
        for name in ["rejected", "missing"] {
            let entry: JSONValue = ["recordingId": "rec_a", "sessionId": .string(name), "index": 0, "startedAt": 0,
                                    "durationMs": 1000, "serverURL": .string(f.origin.absoluteString), "failure": "rejected"]
            try JSONEncoder().encode(entry).write(to: f.outboxDirectory.appendingPathComponent("\(name).json"))
        }
        let rejected = f.outboxDirectory.appendingPathComponent("rejected.m4a")
        let missing = f.outboxDirectory.appendingPathComponent("missing.m4a")
        try Data([1, 2]).write(to: rejected)
        let outbox = f.outbox()
        XCTAssertTrue(outbox.recoveryFiles.contains(missing))
        XCTAssertFalse(outbox.canFinish("rec_a", serverURL: f.origin))
        try outbox.discardLocalCopy(rejected)
        XCTAssertEqual(outbox.pending, 1)
        XCTAssertFalse(outbox.canFinish("rec_a", serverURL: f.origin))
        try outbox.discardLocalCopy(missing)
        XCTAssertEqual(outbox.pending, 0)
        XCTAssertTrue(outbox.canFinish("rec_a", serverURL: f.origin))
        XCTAssertFalse(FileManager.default.fileExists(atPath: f.outboxDirectory.appendingPathComponent("missing.json").path))
    }

    func testDiscardMissingJournalFileAllowsExplicitlyIncompleteFinish() throws {
        let f = try Fixture(); defer { f.clean() }
        let session = try f.begin()
        let missing = try f.journal.open(session, index: 0, startedAt: 1)
        try FileManager.default.removeItem(at: missing)
        let outbox = f.outbox()
        XCTAssertTrue(outbox.recoveryFiles.contains(missing))
        XCTAssertFalse(outbox.canFinish(session.recordingId, serverURL: f.origin))
        try outbox.discardLocalCopy(missing)
        XCTAssertTrue(outbox.canFinish(session.recordingId, serverURL: f.origin))
        XCTAssertTrue(f.journal.sessions().isEmpty)
    }

    func testDamagedMetadataWithoutAudioHasAnExplicitResolution() throws {
        let f = try Fixture(); defer { f.clean() }
        try FileManager.default.createDirectory(at: f.outboxDirectory, withIntermediateDirectories: true)
        let metadata = f.outboxDirectory.appendingPathComponent("damaged.json")
        try Data("{".utf8).write(to: metadata)
        let missing = f.outboxDirectory.appendingPathComponent("damaged.m4a")
        let outbox = f.outbox()
        XCTAssertTrue(outbox.recoveryFiles.contains(missing))
        XCTAssertFalse(outbox.canFinish("rec_any", serverURL: f.origin))
        try outbox.discardLocalCopy(missing)
        XCTAssertFalse(FileManager.default.fileExists(atPath: metadata.path))
        XCTAssertTrue(outbox.canFinish("rec_any", serverURL: f.origin))
    }

    func testDiscardRejectsActiveUnrelatedAndSymlinkedFiles() throws {
        let f = try Fixture(); defer { f.clean() }
        let outbox = f.outbox()
        let session = try outbox.beginCapture(recordingId: "live", sessionId: "live", serverURL: f.origin)
        let active = try f.journal.open(session, index: 0, startedAt: 1)
        try Data([1, 2]).write(to: active)
        let unrelated = f.root.appendingPathComponent("unrelated.m4a")
        try Data([3, 4]).write(to: unrelated)
        let link = f.outboxDirectory.appendingPathComponent("linked.m4a")
        try FileManager.default.createSymbolicLink(at: link, withDestinationURL: unrelated)
        outbox.recoverCaptures()
        XCTAssertThrowsError(try outbox.discardLocalCopy(active))
        XCTAssertThrowsError(try outbox.discardLocalCopy(unrelated))
        XCTAssertThrowsError(try outbox.discardLocalCopy(link))
        XCTAssertEqual(try Data(contentsOf: active), Data([1, 2]))
        XCTAssertEqual(try Data(contentsOf: unrelated), Data([3, 4]))
    }

    // MARK: Push-to-talk discard

    func testDiscardRemovesQueuedSegmentsStagingAndLiveCaptureForOnlyThatRecording() throws {
        let f = try Fixture(); defer { f.clean() }
        let outbox = f.outbox()
        let session = try outbox.beginCapture(recordingId: "rec_a", sessionId: "session_a", serverURL: f.origin)
        let first = try f.journal.open(session, index: 0, startedAt: 1)
        try Data(repeating: 1, count: 3200).write(to: first)
        try outbox.add(CapturedSegment(url: first, index: 0, startedAt: 1, durationMs: 100), recordingId: "rec_a", sessionId: "session_a", serverURL: f.origin)
        let unsent = try f.journal.open(session, index: 1, startedAt: 2)
        try Data(repeating: 2, count: 3200).write(to: unsent)
        // An interrupted commit for the same recording, and another recording's queued audio.
        try JSONEncoder().encode(f.entry("rec_a", session: "session_a", index: 2)).write(to: f.outboxDirectory.appendingPathComponent("staged.metadata.pending"))
        try Data([1]).write(to: f.outboxDirectory.appendingPathComponent("staged.audio.pending"))
        let other = try outbox.beginCapture(recordingId: "rec_b", sessionId: "session_b", serverURL: f.origin)
        let kept = try f.journal.open(other, index: 0, startedAt: 1)
        try Data(repeating: 3, count: 3200).write(to: kept)
        try outbox.add(CapturedSegment(url: kept, index: 0, startedAt: 1, durationMs: 100), recordingId: "rec_b", sessionId: "session_b", serverURL: f.origin)
        XCTAssertEqual(outbox.pending, 2)

        outbox.discard("rec_a", serverURL: f.origin)
        XCTAssertEqual(outbox.pending, 1)
        XCTAssertEqual(f.journal.sessions(), [other])
        XCTAssertFalse(FileManager.default.fileExists(atPath: unsent.path))
        let left = try FileManager.default.contentsOfDirectory(atPath: f.outboxDirectory.path).filter { $0 != "Captures" }
        XCTAssertFalse(left.contains { $0.hasPrefix("staged") })
        XCTAssertEqual(outbox.pendingDeletions(serverURL: f.origin), ["rec_a"])

        // A segment the capture cuts after the discard is dropped, not queued.
        let late = f.root.appendingPathComponent("late.pcm")
        try Data(repeating: 4, count: 3200).write(to: late)
        try outbox.add(CapturedSegment(url: late, index: 3, startedAt: 3, durationMs: 100), recordingId: "rec_a", sessionId: "session_a", serverURL: f.origin)
        XCTAssertEqual(outbox.pending, 1)
        XCTAssertFalse(FileManager.default.fileExists(atPath: late.path))
    }

    func testRecoveryDoesNotResurrectADiscardedRecording() throws {
        let f = try Fixture(); defer { f.clean() }
        // A crash after the discard was recorded but before its files were removed.
        let session = try f.begin()
        let raw = try f.journal.open(session, index: 0, startedAt: 1)
        try Data(repeating: 1, count: 32_000).write(to: raw)
        try FileManager.default.createDirectory(at: f.outboxDirectory, withIntermediateDirectories: true)
        try JSONEncoder().encode(f.entry("rec_a", session: "older", index: 0)).write(to: f.outboxDirectory.appendingPathComponent("queued.json"))
        try Data([1]).write(to: f.outboxDirectory.appendingPathComponent("queued.wav"))
        try JSONEncoder().encode(f.entry("rec_a", session: "older", index: 1)).write(to: f.outboxDirectory.appendingPathComponent("staged.metadata.pending"))
        try Data([1]).write(to: f.outboxDirectory.appendingPathComponent("staged.audio.pending"))
        let discarded: JSONValue = [["recordingId": "rec_a", "serverURL": .string(f.origin.absoluteString)]]
        f.defaults.set(try JSONEncoder().encode(discarded), forKey: "talkDiscardByServer")

        let restarted = f.outbox()
        XCTAssertEqual(restarted.pending, 0)
        XCTAssertTrue(f.journal.sessions().isEmpty)
        XCTAssertTrue(restarted.recoveryFiles.isEmpty)
        XCTAssertEqual(try FileManager.default.contentsOfDirectory(atPath: f.outboxDirectory.path).filter { $0 != "Captures" }, [])
        XCTAssertEqual(restarted.pendingDeletions(serverURL: f.origin), ["rec_a"])
        XCTAssertTrue(restarted.canFinish("rec_other", serverURL: f.origin))
    }

    func testDiscardIsDeletedOnlyOnItsOwnServerAndRetriedAfterFailure() async throws {
        let f = try Fixture(); defer { f.clean() }
        let other = URL(string: "https://other.invalid")!
        let outbox = f.outbox()
        outbox.discard("rec_a", serverURL: f.origin)
        outbox.discard("rec_b", serverURL: other)

        // Another server never sees rec_a.
        let otherCalls = Calls()
        await outbox.deleteDiscarded(using: f.client(other, calls: otherCalls, ok: true))
        XCTAssertEqual(otherCalls.methods, ["recording_state:rec_b", "recording_delete:rec_b"])
        XCTAssertEqual(outbox.pendingDeletions(serverURL: other), [])
        XCTAssertEqual(outbox.pendingDeletions(serverURL: f.origin), ["rec_a"])

        // Offline: it stays pending, including across a relaunch.
        let failing = Calls()
        await outbox.deleteDiscarded(using: f.client(f.origin, calls: failing, ok: false))
        XCTAssertEqual(failing.methods, ["recording_state:rec_a"])
        let relaunched = f.outbox()
        XCTAssertEqual(relaunched.pendingDeletions(serverURL: f.origin), ["rec_a"])

        let calls = Calls()
        await relaunched.deleteDiscarded(using: f.client(f.origin, calls: calls, ok: true))
        XCTAssertEqual(calls.methods, ["recording_state:rec_a", "recording_delete:rec_a"])
        XCTAssertEqual(relaunched.pendingDeletions(serverURL: f.origin), [])
    }

    func testDiscardOfARecordingTalkNoLongerHasIsDone() async throws {
        let f = try Fixture(); defer { f.clean() }
        let outbox = f.outbox()
        outbox.discard("rec_gone", serverURL: f.origin)
        let client = BBClient(baseURL: f.origin)
        client.transport = { _, _, _ in (500, Data(#"{"ok":false,"error":{"message":"No recording rec_gone."}}"#.utf8)) }
        await outbox.deleteDiscarded(using: client)
        XCTAssertEqual(outbox.pendingDeletions(serverURL: f.origin), [])
    }

    func testDiscardWhileStartingLeavesNothingBehind() async throws {
        let f = try Fixture(); defer { f.clean() }
        let outbox = f.outbox()
        // The start had created the recording and begun capture when the discard landed.
        let session = try outbox.beginCapture(recordingId: "rec_a", sessionId: "session_a", serverURL: f.origin)
        _ = try f.journal.open(session, index: 0, startedAt: 1)
        outbox.discard("rec_a", serverURL: f.origin)
        XCTAssertTrue(f.journal.sessions().isEmpty)
        XCTAssertTrue(f.journal.audioFiles().isEmpty)
        outbox.recoverCaptures()
        XCTAssertEqual(outbox.pending, 0)
        XCTAssertTrue(outbox.recoveryFiles.isEmpty)
        let calls = Calls()
        await outbox.deleteDiscarded(using: f.client(f.origin, calls: calls, ok: true))
        XCTAssertEqual(calls.methods, ["recording_state:rec_a", "recording_delete:rec_a"])
    }

    private final class Calls: @unchecked Sendable {
        private let lock = NSLock()
        private var list: [String] = []
        var methods: [String] { lock.withLock { list } }
        func add(_ method: String) { lock.withLock { list.append(method) } }
    }

    @MainActor private final class Fixture {
        let root = FileManager.default.temporaryDirectory.appendingPathComponent("Journal-\(UUID())")
        let suite = "Journal-\(UUID())"
        let origin = URL(string: "https://a.invalid")!
        var defaults: UserDefaults { UserDefaults(suiteName: suite)! }
        var outboxDirectory: URL { root.appendingPathComponent("outbox") }
        var journal: TalkCaptureJournal { TalkCaptureJournal(directory: root.appendingPathComponent("capture")) }
        init() throws { try FileManager.default.createDirectory(at: root, withIntermediateDirectories: true) }
        func clean() { defaults.removePersistentDomain(forName: suite); try? FileManager.default.removeItem(at: root) }
        func begin() throws -> TalkCaptureJournal.Session {
            let session = TalkCaptureJournal.Session(recordingId: "rec_a", sessionId: "session_a", serverURL: origin)
            try journal.begin(session); return session
        }
        func entry(_ recordingId: String, session: String, index: Int) -> JSONValue {
            ["recordingId": .string(recordingId), "sessionId": .string(session), "index": .from(index), "startedAt": 0,
             "durationMs": 1000, "serverURL": .string(origin.absoluteString), "mimeType": "audio/wav"]
        }
        fileprivate func client(_ url: URL, calls: Calls, ok: Bool) -> BBClient {
            let client = BBClient(baseURL: url)
            client.transport = { _, path, body in
                let id = body.flatMap { try? JSONDecoder().decode(JSONValue.self, from: $0) }?["id"]?.stringValue ?? ""
                calls.add("\(path.split(separator: "/").last ?? ""):\(id)")
                guard ok else { throw URLError(.notConnectedToInternet) }
                if path.hasSuffix("recording_state") {
                    return (200, Data(#"{"ok":true,"result":{"id":"\#(id)","title":"","kind":"dictation","status":"paused","createdAt":0,"durationMs":0,"segmentCount":0,"pendingCount":0,"failedCount":0,"preview":""}}"#.utf8))
                }
                return (200, Data(#"{"ok":true,"result":{"deleted":true}}"#.utf8))
            }
            return client
        }
        func outbox(journal: TalkCaptureJournal? = nil) -> TalkOutbox {
            // Automatic transport is disabled; tests exercise real files only.
            TalkOutbox(directory: outboxDirectory, defaults: defaults, automaticUploads: false, journal: journal ?? self.journal,
                       currentClient: { BBClient(baseURL: URL(string: "https://b.invalid")!) })
        }
    }
}
