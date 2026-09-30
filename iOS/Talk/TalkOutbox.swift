import Foundation

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

    func kick() {
        guard running == nil, pending > 0 else { return }
        running = Task {
            await run()
            running = nil
        }
    }

    func drain(until deadline: Date) async {
        kick()
        while pending > 0, Date() < deadline {
            try? await Task.sleep(for: .milliseconds(300))
        }
    }

    private func run() async {
        var backoff: Double = 2
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
                // Rejected, or deleted in Talk: the audio has nowhere to go.
                remove(name)
            } catch {
                try? await Task.sleep(for: .seconds(backoff))
                backoff = min(backoff * 2, 30)
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
