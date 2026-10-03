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
        var serverURL: URL?
    }

    private struct Finish: Codable, Hashable {
        var recordingId: String
        var serverURL: URL?
    }

    @Published private(set) var pending = 0
    @Published private(set) var legacyPending = 0

    private let currentClient: @MainActor () -> BBClient
    private let defaults: UserDefaults
    private let directory: URL
    private var running: Task<Void, Never>?

    init(directory: URL? = nil, defaults: UserDefaults = .standard,
         currentClient: @escaping @MainActor () -> BBClient = { AppModel.shared.client }) {
        self.currentClient = currentClient
        self.defaults = defaults
        self.directory = directory ?? FileManager.default.urls(for: .applicationSupportDirectory, in: .userDomainMask)[0]
            .appendingPathComponent("TalkOutbox", isDirectory: true)
        try? FileManager.default.createDirectory(at: self.directory, withIntermediateDirectories: true)
        // Legacy data has no trustworthy origin. Keep it untouched until the
        // user selects its server and explicitly resumes it in Settings.
        if defaults.data(forKey: "talkFinishAfterUploadByServer") == nil {
            finishing = Set((defaults.stringArray(forKey: "talkFinishAfterUpload") ?? []).map {
                Finish(recordingId: $0, serverURL: nil)
            })
        }
        updateCounts()
    }

    func add(_ segment: CapturedSegment, recordingId: String, sessionId: String, serverURL: URL) {
        let name = String(format: "%.0f-%@-%06d", Date().timeIntervalSince1970 * 1000, sessionId, segment.index)
        let audio = directory.appendingPathComponent("\(name).m4a")
        let entry = Entry(
            recordingId: recordingId, sessionId: sessionId, index: segment.index, startedAt: segment.startedAt,
            durationMs: segment.durationMs, serverURL: serverURL)
        do {
            try FileManager.default.moveItem(at: segment.url, to: audio)
            try JSONEncoder().encode(entry).write(to: directory.appendingPathComponent("\(name).json"))
        } catch {
            return
        }
        updateCounts()
        kick()
    }

    /// Called only after the user confirms which server owns the older audio.
    func resumeLegacy(on serverURL: URL) throws {
        for (name, var entry) in entries() where entry.serverURL == nil {
            entry.serverURL = serverURL
            try JSONEncoder().encode(entry).write(to: directory.appendingPathComponent("\(name).json"), options: .atomic)
        }
        finishing = Set(finishing.map { finish in
            Finish(recordingId: finish.recordingId, serverURL: finish.serverURL ?? serverURL)
        })
        updateCounts()
        kick()
    }

    /// Recordings to mark finishing once all their audio has uploaded. Talk
    /// deletes a recording that finishes before any audio arrives.
    private var finishing: Set<Finish> {
        get {
            defaults.data(forKey: "talkFinishAfterUploadByServer")
                .flatMap { try? JSONDecoder().decode(Set<Finish>.self, from: $0) } ?? []
        }
        set {
            if let data = try? JSONEncoder().encode(newValue) {
                defaults.set(data, forKey: "talkFinishAfterUploadByServer")
            }
        }
    }

    func finishWhenSent(_ recordingId: String, serverURL: URL) {
        finishing.insert(Finish(recordingId: recordingId, serverURL: serverURL))
        kick()
    }

    /// Waits until the recording is marked finishing, or the deadline passes.
    /// Returns whether it was.
    func waitForFinish(_ recordingId: String, serverURL: URL, until deadline: Date) async -> Bool {
        let finish = Finish(recordingId: recordingId, serverURL: serverURL)
        kick()
        while finishing.contains(finish), Date() < deadline, !Task.isCancelled {
            try? await Task.sleep(for: .milliseconds(300))
        }
        return !finishing.contains(finish)
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
            let client = currentClient()
            await upload(&backoff, using: client)
            await markFinished(using: client)
            let selected = currentClient().baseURL
            if !entries().contains(where: { $0.1.serverURL == selected }) && !finishing.contains(where: { $0.serverURL == selected }) { return }
            try? await Task.sleep(for: .seconds(backoff))
            backoff = min(backoff * 2, 30)
        }
    }

    private func markFinished(using client: BBClient) async {
        let waiting = Set(entries().filter { $0.1.serverURL == client.baseURL }.map(\.1.recordingId))
        for finish in finishing where finish.serverURL == client.baseURL && !waiting.contains(finish.recordingId) {
            guard currentClient().baseURL == client.baseURL else { return }
            do {
                try await client.setRecordingState(finish.recordingId, "finishing")
                finishing.remove(finish)
            } catch let error as BBError where error.status == 400 || error.message.hasPrefix("No recording") {
                finishing.remove(finish)
            } catch {
                return
            }
        }
    }

    private func upload(_ backoff: inout Double, using client: BBClient) async {
        while currentClient().baseURL == client.baseURL,
              let (name, entry) = entries().first(where: { $0.1.serverURL == client.baseURL }) {
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
        updateCounts()
    }

    private func updateCounts() {
        let items = entries()
        pending = items.count
        legacyPending = Set(items.filter { $0.1.serverURL == nil }.map(\.1.recordingId))
            .union(finishing.filter { $0.serverURL == nil }.map(\.recordingId)).count
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
