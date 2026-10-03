import Foundation
import os

/// Finished segments wait here on disk until `segment_put` succeeds, so audio
/// recorded on a flaky connection (or before a crash) still reaches Talk.
/// `segment_put` is idempotent per session and index, so retries are safe.
@MainActor
final class TalkOutbox: ObservableObject {
    static let shared = TalkOutbox()

    struct Persistence {
        var move: (URL, URL) throws -> Void = { try FileManager.default.moveItem(at: $0, to: $1) }
        var writeMetadata: (Data, URL) throws -> Void = { try $0.write(to: $1, options: .atomic) }
    }

    private struct Entry: Codable {
        var recordingId: String
        var sessionId: String
        var index: Int
        var startedAt: Int
        var durationMs: Int
        var serverURL: URL?
        var mimeType: String?
        var failure: String?
    }

    private struct Finish: Codable, Hashable {
        var recordingId: String
        var serverURL: URL?
    }

    @Published private(set) var pending = 0
    @Published private(set) var legacyPending = 0
    @Published private(set) var recoveryError: String?
    @Published private(set) var recoveryFiles: [URL] = []
    let captureJournal: TalkCaptureJournal
    private var activeSessions: Set<String> = []

    private let currentClient: @MainActor () -> BBClient
    private let defaults: UserDefaults
    private let directory: URL
    private let persistence: Persistence
    private let automaticUploads: Bool
    private var running: Task<Void, Never>?

    init(directory: URL? = nil, defaults: UserDefaults = .standard, persistence: Persistence = Persistence(), automaticUploads: Bool = true, journal: TalkCaptureJournal? = nil,
         currentClient: @escaping @MainActor () -> BBClient = { AppModel.shared.client }) {
        self.currentClient = currentClient
        self.defaults = defaults
        self.persistence = persistence
        self.automaticUploads = automaticUploads
        self.directory = directory ?? FileManager.default.urls(for: .applicationSupportDirectory, in: .userDomainMask)[0]
            .appendingPathComponent("TalkOutbox", isDirectory: true)
        self.captureJournal = journal ?? TalkCaptureJournal(directory: self.directory.appendingPathComponent("Captures", isDirectory: true))
        try? FileManager.default.createDirectory(at: self.directory, withIntermediateDirectories: true)
        // Legacy data has no trustworthy origin. Keep it untouched until the
        // user selects its server and explicitly resumes it in Settings.
        if defaults.data(forKey: "talkFinishAfterUploadByServer") == nil {
            finishing = Set((defaults.stringArray(forKey: "talkFinishAfterUpload") ?? []).map {
                Finish(recordingId: $0, serverURL: nil)
            })
        }
        recoverCaptures()
        updateCounts()
    }

    func add(_ segment: CapturedSegment, recordingId: String, sessionId: String, serverURL: URL) throws {
        if entries().contains(where: { $0.1.recordingId == recordingId && $0.1.sessionId == sessionId && $0.1.index == segment.index && $0.1.serverURL == serverURL }) {
            try captureJournal.acknowledged(segment.url)
            return
        }
        let name = String(format: "%.0f-%@-%06d", Date().timeIntervalSince1970 * 1000, sessionId, segment.index) + "-\(UUID())"
        let extensionName = segment.url.pathExtension == "pcm" ? "wav" : "m4a"
        let audio = directory.appendingPathComponent("\(name).\(extensionName)")
        let metadata = directory.appendingPathComponent("\(name).json")
        let stagedAudio = directory.appendingPathComponent("\(name).audio.pending")
        let stagedMetadata = directory.appendingPathComponent("\(name).metadata.pending")
        let entry = Entry(
            recordingId: recordingId, sessionId: sessionId, index: segment.index, startedAt: segment.startedAt,
            durationMs: segment.durationMs, serverURL: serverURL, mimeType: segment.url.pathExtension == "pcm" ? "audio/wav" : "audio/mp4")
        do {
            // Keep the capture's source until both files are committed. Only
            // the final .json makes a segment visible to the uploader.
            try FileManager.default.createDirectory(at: directory, withIntermediateDirectories: true)
            try persistence.writeMetadata(JSONEncoder().encode(entry), stagedMetadata)
            if segment.url.pathExtension == "pcm" {
                try TalkCaptureJournal.wave(Data(contentsOf: segment.url)).write(to: stagedAudio, options: .atomic)
            } else {
                try FileManager.default.copyItem(at: segment.url, to: stagedAudio)
            }
            try persistence.move(stagedAudio, audio)
            try persistence.move(stagedMetadata, metadata)
        } catch {
            for file in [stagedAudio, stagedMetadata, audio, metadata] {
                try? FileManager.default.removeItem(at: file)
            }
            throw error
        }
        try captureJournal.acknowledged(segment.url)
        try? FileManager.default.removeItem(at: segment.url)
        updateCounts()
        kick()
    }

    func beginCapture(recordingId: String, sessionId: String, serverURL: URL) throws -> TalkCaptureJournal.Session {
        let session = TalkCaptureJournal.Session(recordingId: recordingId, sessionId: sessionId, serverURL: serverURL)
        try captureJournal.begin(session)
        activeSessions.insert(sessionId)
        return session
    }

    /// Called at process startup, before any new capture starts. Live sessions
    /// are excluded when the user retries recovery later.
    func recoverCaptures() {
        recoveryError = nil
        reconcileStaging()
        for session in captureJournal.sessions() where !activeSessions.contains(session.sessionId) {
            do {
                for (metadata, audio) in try captureJournal.segments(session) {
                    if metadata.queued { captureJournal.discardEmpty(audio); continue }
                    // A crash after outbox commit but before journal acknowledgement.
                    if entries().contains(where: { $0.1.sessionId == session.sessionId && $0.1.index == metadata.index && $0.1.serverURL == session.serverURL }) {
                        try captureJournal.acknowledged(audio)
                        continue
                    }
                    let duration = try TalkCaptureJournal.duration(of: audio)
                    if duration == 0 { captureJournal.discardEmpty(audio); continue }
                    try add(CapturedSegment(url: audio, index: metadata.index, startedAt: metadata.startedAt, durationMs: duration),
                            recordingId: session.recordingId, sessionId: session.sessionId, serverURL: session.serverURL)
                }
                // Persist the finish request first: a crash before removing the
                // journal simply repeats the idempotent recovery next launch.
                finishWhenSent(session.recordingId, serverURL: session.serverURL)
            } catch { recoveryError = "Some audio could not be recovered: \(error.localizedDescription)" }
        }
        reconcileStaging()
        updateCounts()
        let journalFiles = captureJournal.sessions().filter { !activeSessions.contains($0.sessionId) }
            .flatMap { (try? captureJournal.segments($0).map(\.1)) ?? [] }
        recoveryFiles = captureJournal.recoveryCandidates().filter { !activeSessions.contains($0.deletingLastPathComponent().lastPathComponent) }
            + journalFiles + unmatchedAudio() + entries().filter { $0.1.failure != nil || !FileManager.default.fileExists(atPath: audioURL($0.0, entry: $0.1).path) }.map { audioURL($0.0, entry: $0.1) }
        // Pre-journal temporary captures have no trustworthy server or recording ID.
        recoveryFiles += ((try? FileManager.default.contentsOfDirectory(at: FileManager.default.temporaryDirectory, includingPropertiesForKeys: nil)) ?? [])
            .filter { $0.lastPathComponent.hasPrefix("talk-") && !$0.lastPathComponent.hasPrefix("talk-play-") && $0.pathExtension == "m4a" }
        recoveryFiles = Array(Set(recoveryFiles)).sorted { $0.path < $1.path }
        if !recoveryFiles.isEmpty, recoveryError == nil { recoveryError = "Older or rejected audio is preserved below. Unidentified files hold queued recordings open; export them for review." }
        kick()
    }

    /// Only Settings' per-file destructive confirmation calls this. Recovery
    /// never calls it automatically, and an export does not imply permission.
    func discardLocalCopy(_ requested: URL) throws {
        func canonical(_ url: URL) -> URL { url.standardizedFileURL.resolvingSymlinksInPath() }
        for path in [requested, requested.deletingLastPathComponent()] {
            guard (try? path.resourceValues(forKeys: [.isSymbolicLinkKey]).isSymbolicLink) != true else {
                throw BBError(status: 0, message: "Recovery disposal cannot follow symbolic links.")
            }
        }
        let file = canonical(requested)
        guard recoveryFiles.contains(where: { canonical($0).path == file.path }) else {
            throw BBError(status: 0, message: "This file is not available for recovery disposal.")
        }
        let parent = file.deletingLastPathComponent()
        var metadata: URL?
        if parent.path == canonical(directory).path {
            guard ["m4a", "wav"].contains(file.pathExtension) || file.lastPathComponent.hasSuffix(".audio.pending") else {
                throw BBError(status: 0, message: "Only recovered audio can be discarded.")
            }
            if let entry = entries().first(where: { canonical(audioURL($0.0, entry: $0.1)).path == file.path }) {
                guard !activeSessions.contains(entry.1.sessionId) else { throw activeCaptureError }
                metadata = directory.appendingPathComponent("\(entry.0).json")
            } else if file.lastPathComponent.hasSuffix(".audio.pending") {
                let name = String(file.lastPathComponent.dropLast(".audio.pending".count))
                metadata = directory.appendingPathComponent("\(name).metadata.pending")
                if let data = try? Data(contentsOf: metadata!), let entry = try? JSONDecoder().decode(Entry.self, from: data), activeSessions.contains(entry.sessionId) { throw activeCaptureError }
            } else {
                metadata = file.deletingPathExtension().appendingPathExtension("json")
            }
        } else if parent.deletingLastPathComponent().path == canonical(captureJournal.directory).path {
            guard !activeSessions.contains(parent.lastPathComponent) else { throw activeCaptureError }
            guard ["pcm", "wav", "m4a"].contains(file.pathExtension) else { throw activeCaptureError }
            metadata = file.deletingPathExtension().appendingPathExtension("json")
        } else if parent.path == canonical(FileManager.default.temporaryDirectory).path,
                  file.lastPathComponent.hasPrefix("talk-"), !file.lastPathComponent.hasPrefix("talk-play-"), file.pathExtension == "m4a" {
            // Older pre-journal capture; no origin is assigned or uploaded.
        } else {
            throw BBError(status: 0, message: "The file is outside this app's audio recovery directories.")
        }
        if let metadata, canonical(metadata).deletingLastPathComponent().path != parent.path {
            throw BBError(status: 0, message: "Recovery metadata points outside its audio directory.")
        }
        try removeIfPresent(file)
        if let metadata { try removeIfPresent(metadata) }
        recoverCaptures()
    }

    private var activeCaptureError: BBError { BBError(status: 0, message: "An active capture cannot be discarded.") }

    private func removeIfPresent(_ file: URL) throws {
        do { try FileManager.default.removeItem(at: file) }
        catch let error as CocoaError where error.code == .fileNoSuchFile || error.code == .fileReadNoSuchFile {}
    }

    private func reconcileStaging() {
        let files = (try? FileManager.default.contentsOfDirectory(at: directory, includingPropertiesForKeys: nil)) ?? []
        for metadata in files where metadata.lastPathComponent.hasSuffix(".metadata.pending") {
            guard let data = try? Data(contentsOf: metadata), let stagedEntry = try? JSONDecoder().decode(Entry.self, from: data) else { continue }
            let name = String(metadata.lastPathComponent.dropLast(".metadata.pending".count))
            let audio = audioURL(name, entry: stagedEntry)
            let staged = directory.appendingPathComponent("\(name).audio.pending")
            do {
                if let existing = entries().first(where: { $0.1.sessionId == stagedEntry.sessionId && $0.1.index == stagedEntry.index && $0.1.recordingId == stagedEntry.recordingId && $0.1.serverURL == stagedEntry.serverURL }) {
                    // Identity is known and the durable queue has another copy.
                    try? FileManager.default.removeItem(at: staged)
                    if existing.0 != name { try? FileManager.default.removeItem(at: audio) }
                    try? FileManager.default.removeItem(at: metadata)
                    continue
                }
                if !FileManager.default.fileExists(atPath: audio.path) { try persistence.move(staged, audio) }
                try persistence.move(metadata, directory.appendingPathComponent("\(name).json"))
            } catch { recoveryError = "An interrupted audio upload still needs recovery: \(error.localizedDescription)" }
        }
    }

    private func unmatchedAudio() -> [URL] {
        let entries = entries()
        let known = Set(entries.map { audioURL($0.0, entry: $0.1).lastPathComponent })
        let knownMetadata = Set(entries.map { "\($0.0).json" })
        let files = (try? FileManager.default.contentsOfDirectory(at: directory, includingPropertiesForKeys: nil)) ?? []
        return Array(Set(files.compactMap { file -> URL? in
            let name = file.lastPathComponent
            if (["m4a", "wav"].contains(file.pathExtension) || name.hasSuffix(".audio.pending")), !known.contains(name) { return file }
            if name.hasSuffix(".metadata.pending") {
                return directory.appendingPathComponent(String(name.dropLast(".metadata.pending".count)) + ".audio.pending")
            }
            if file.pathExtension == "json", !knownMetadata.contains(name) {
                return file.deletingPathExtension().appendingPathExtension("m4a")
            }
            return nil
        }))
    }

    private func block(_ name: String, entry: Entry, reason: String) {
        var blocked = entry
        blocked.failure = reason
        try? JSONEncoder().encode(blocked).write(to: directory.appendingPathComponent("\(name).json"), options: .atomic)
        recoveryError = "Audio was not accepted by BB and is preserved for export: \(reason)"
        recoveryFiles = Array(Set(recoveryFiles + [audioURL(name, entry: entry)]))
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
        for session in captureJournal.sessions() where session.recordingId == recordingId && session.serverURL == serverURL {
            do {
                try captureJournal.end(session)
                activeSessions.remove(session.sessionId)
            } catch { recoveryError = error.localizedDescription }
        }
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
        guard automaticUploads, running == nil, pending > 0 || !finishing.isEmpty else { return }
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
            if !entries().contains(where: { $0.1.serverURL == selected && $0.1.failure == nil }) && !finishing.contains(where: { $0.serverURL == selected && canFinish($0.recordingId, serverURL: selected) }) { return }
            try? await Task.sleep(for: .seconds(backoff))
            backoff = min(backoff * 2, 30)
        }
    }

    func canFinish(_ recordingId: String, serverURL: URL) -> Bool {
        unmatchedAudio().isEmpty && captureJournal.unidentifiedAudio().isEmpty
            && !entries().contains { $0.1.recordingId == recordingId && $0.1.serverURL == serverURL }
            && !captureJournal.hasUnqueuedAudio(recordingId: recordingId, serverURL: serverURL)
    }

    private func markFinished(using client: BBClient) async {
        for finish in finishing where finish.serverURL == client.baseURL && canFinish(finish.recordingId, serverURL: client.baseURL) {
            guard currentClient().baseURL == client.baseURL else { return }
            guard !captureJournal.hasUnqueuedAudio(recordingId: finish.recordingId, serverURL: client.baseURL) else { continue }
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
              let (name, entry) = entries().first(where: { $0.1.serverURL == client.baseURL && $0.1.failure == nil }) {
            guard let audio = try? Data(contentsOf: audioURL(name, entry: entry)) else {
                block(name, entry: entry, reason: "An audio file is missing. This recording has not been finalized.")
                return
            }
            do {
                try await client.putSegment(
                    recordingId: entry.recordingId, sessionId: entry.sessionId, index: entry.index,
                    startedAt: entry.startedAt, durationMs: entry.durationMs, mimeType: entry.mimeType ?? "audio/mp4", audio: audio)
                remove(name)
                backoff = 2
            } catch let error as BBError where error.status == 400 || error.message.contains("No recording") {
                Logger(subsystem: "nyc.plee.bbgo", category: "talk").error("segment rejected: \(error.message, privacy: .public)")
                block(name, entry: entry, reason: error.message)
                return
            } catch {
                return
            }
        }
    }

    private func audioURL(_ name: String, entry: Entry) -> URL {
        directory.appendingPathComponent("\(name).\(entry.mimeType == "audio/wav" ? "wav" : "m4a")")
    }

    private func remove(_ name: String) {
        if let entry = entries().first(where: { $0.0 == name })?.1 {
            try? FileManager.default.removeItem(at: audioURL(name, entry: entry))
        }
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
