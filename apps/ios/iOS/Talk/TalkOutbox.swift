import Foundation
import os

/// Finished segments wait here on disk until `segment_put` succeeds, so audio
/// recorded on a flaky connection (or before a crash) still reaches Talk.
/// `segment_put` is idempotent per session and index, so retries are safe.
@MainActor
final class TalkOutbox: ObservableObject {
    static let shared = TalkOutbox()

    private struct Entry: Codable {
        var recordingId: String
        var sessionId: String
        var index: Int
        var startedAt: Int
        var durationMs: Int
    }

    @Published private(set) var pending = 0

    private var client: BBClient { AppModel.shared.client }
    private let directory: URL
    private var running: Task<Void, Never>?

    private init() {
        directory = FileManager.default.urls(for: .applicationSupportDirectory, in: .userDomainMask)[0]
            .appendingPathComponent("TalkOutbox", isDirectory: true)
        try? FileManager.default.createDirectory(at: directory, withIntermediateDirectories: true)
        pending = entries().count
    }

    func add(_ segment: CapturedSegment, recordingId: String, sessionId: String) {
        let name = String(format: "%.0f-%@-%06d", Date().timeIntervalSince1970 * 1000, sessionId, segment.index)
        let audio = directory.appendingPathComponent("\(name).m4a")
        let entry = Entry(
            recordingId: recordingId, sessionId: sessionId, index: segment.index, startedAt: segment.startedAt,
            durationMs: segment.durationMs)
        do {
            try FileManager.default.moveItem(at: segment.url, to: audio)
            try JSONEncoder().encode(entry).write(to: directory.appendingPathComponent("\(name).json"))
        } catch {
            return
        }
        pending = entries().count
        kick()
    }

    /// Recordings to mark finishing once all their audio has uploaded. Talk
    /// deletes a recording that finishes before any audio arrives.
    private var finishing: Set<String> {
        get { Set(UserDefaults.standard.stringArray(forKey: "talkFinishAfterUpload") ?? []) }
        set { UserDefaults.standard.set(Array(newValue), forKey: "talkFinishAfterUpload") }
    }

    func finishWhenSent(_ recordingId: String) {
        finishing.insert(recordingId)
        kick()
    }

    /// Waits until the recording is marked finishing, or the deadline passes.
    /// Returns whether it was.
    func waitForFinish(_ recordingId: String, until deadline: Date) async -> Bool {
        kick()
        while finishing.contains(recordingId), Date() < deadline {
            try? await Task.sleep(for: .milliseconds(300))
        }
        return !finishing.contains(recordingId)
    }

    func kick() {
        guard running == nil, pending > 0 || !finishing.isEmpty else { return }
        running = Task {
            await run()
            running = nil
        }
    }

    private func run() async {
        var backoff: Double = 2
        while true {
            await upload(&backoff)
            await markFinished()
            if entries().isEmpty && finishing.isEmpty { return }
            try? await Task.sleep(for: .seconds(backoff))
            backoff = min(backoff * 2, 30)
        }
    }

    private func markFinished() async {
        let waiting = Set(entries().map(\.1.recordingId))
        for id in finishing where !waiting.contains(id) {
            do {
                try await client.setRecordingState(id, "finishing")
                finishing.remove(id)
            } catch let error as BBError where error.status == 400 || error.message.hasPrefix("No recording") {
                finishing.remove(id)
            } catch {
                return
            }
        }
    }

    private func upload(_ backoff: inout Double) async {
        while let (name, entry) = entries().first {
            guard let audio = try? Data(contentsOf: directory.appendingPathComponent("\(name).m4a")) else {
                remove(name)
                continue
            }
            do {
                try await client.putSegment(
                    recordingId: entry.recordingId, sessionId: entry.sessionId, index: entry.index,
                    startedAt: entry.startedAt, durationMs: entry.durationMs, mimeType: "audio/mp4", audio: audio)
                remove(name)
                backoff = 2
            } catch let error as BBError where error.status == 400 || error.message.contains("No recording") {
                Logger(subsystem: "nyc.plee.bbgo", category: "talk").error("segment rejected: \(error.message, privacy: .public)")
                // Rejected, or deleted in Talk: the audio has nowhere to go.
                remove(name)
            } catch {
                return
            }
        }
    }

    private func remove(_ name: String) {
        try? FileManager.default.removeItem(at: directory.appendingPathComponent("\(name).m4a"))
        try? FileManager.default.removeItem(at: directory.appendingPathComponent("\(name).json"))
        pending = entries().count
    }

    private func entries() -> [(String, Entry)] {
        let files = (try? FileManager.default.contentsOfDirectory(atPath: directory.path)) ?? []
        return files.filter { $0.hasSuffix(".json") }.sorted().compactMap { file in
            let name = String(file.dropLast(5))
            guard let data = try? Data(contentsOf: directory.appendingPathComponent(file)),
                let entry = try? JSONDecoder().decode(Entry.self, from: data)
            else { return nil }
            return (name, entry)
        }
    }
}
