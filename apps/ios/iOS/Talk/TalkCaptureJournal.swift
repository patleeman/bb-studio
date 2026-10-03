import Foundation

/// Headerless 16-bit PCM survives an interrupted writer. Origin and segment
/// identity are committed before capture starts; WAV headers are built later.
final class TalkCaptureJournal: @unchecked Sendable {
    struct Session: Codable, Equatable {
        var recordingId: String
        var sessionId: String
        var serverURL: URL
    }
    struct Segment: Codable {
        var index: Int
        var startedAt: Int
        var queued = false
    }
    let directory: URL
    private let writeMetadata: (Data, URL) throws -> Void

    init(directory: URL, writeMetadata: @escaping (Data, URL) throws -> Void = { try $0.write(to: $1, options: .atomic) }) {
        self.directory = directory
        self.writeMetadata = writeMetadata
    }

    private func folder(_ session: Session) -> URL { directory.appendingPathComponent(session.sessionId, isDirectory: true) }
    func begin(_ session: Session) throws {
        guard !FileManager.default.fileExists(atPath: folder(session).appendingPathComponent("session.json").path) else { throw CocoaError(.fileWriteFileExists) }
        try FileManager.default.createDirectory(at: folder(session), withIntermediateDirectories: true)
        try writeMetadata(JSONEncoder().encode(session), folder(session).appendingPathComponent("session.json"))
    }
    func open(_ session: Session, index: Int, startedAt: Int) throws -> URL {
        let url = folder(session).appendingPathComponent("\(index).pcm")
        let metadata = url.deletingPathExtension().appendingPathExtension("json")
        guard !FileManager.default.fileExists(atPath: url.path), !FileManager.default.fileExists(atPath: metadata.path) else { throw CocoaError(.fileWriteFileExists) }
        do {
            try writeMetadata(JSONEncoder().encode(Segment(index: index, startedAt: startedAt)), metadata)
            guard FileManager.default.createFile(atPath: url.path, contents: Data()) else { throw CocoaError(.fileWriteUnknown) }
        } catch {
            // Capture has not started and no writer has received this path yet.
            try? FileManager.default.removeItem(at: metadata)
            throw error
        }
        return url
    }
    func sessions() -> [Session] {
        let folders = (try? FileManager.default.contentsOfDirectory(at: directory, includingPropertiesForKeys: nil)) ?? []
        return folders.compactMap { try? JSONDecoder().decode(Session.self, from: Data(contentsOf: $0.appendingPathComponent("session.json"))) }
    }
    func segments(_ session: Session) throws -> [(Segment, URL)] {
        try FileManager.default.contentsOfDirectory(at: folder(session), includingPropertiesForKeys: nil)
            .filter { $0.pathExtension == "json" && $0.lastPathComponent != "session.json" }
            .map { (try JSONDecoder().decode(Segment.self, from: Data(contentsOf: $0)), $0.deletingPathExtension().appendingPathExtension("pcm")) }
            .sorted { $0.0.index < $1.0.index }
    }
    func acknowledged(_ audio: URL) throws {
        guard audio.pathExtension == "pcm", audio.deletingLastPathComponent().deletingLastPathComponent().standardizedFileURL.path == directory.standardizedFileURL.path else { return }
        let metadata = audio.deletingPathExtension().appendingPathExtension("json")
        var segment = try JSONDecoder().decode(Segment.self, from: Data(contentsOf: metadata))
        segment.queued = true
        // Commit acknowledgement before deleting either file. If it fails, the
        // only capture copy stays intact, even if the outbox already committed.
        try writeMetadata(JSONEncoder().encode(segment), metadata)
        try? FileManager.default.removeItem(at: audio)
        try? FileManager.default.removeItem(at: metadata)
    }
    func discardEmpty(_ audio: URL) {
        try? FileManager.default.removeItem(at: audio)
        try? FileManager.default.removeItem(at: audio.deletingPathExtension().appendingPathExtension("json"))
    }
    func end(_ session: Session) throws {
        guard try segments(session).allSatisfy({ $0.0.queued }) else {
            throw BBError(status: 0, message: "Audio still needs recovery on this phone.")
        }
        // Unexpected audio is never removed with its containing directory.
        let files = try FileManager.default.contentsOfDirectory(at: folder(session), includingPropertiesForKeys: nil)
        guard !files.contains(where: { $0.pathExtension == "pcm" || $0.pathExtension == "wav" }) else {
            throw BBError(status: 0, message: "Unmatched audio is preserved for export.")
        }
        try FileManager.default.removeItem(at: folder(session))
    }
    func hasUnqueuedAudio(recordingId: String, serverURL: URL) -> Bool {
        sessions().contains { session in
            guard session.recordingId == recordingId, session.serverURL == serverURL else { return false }
            guard let segments = try? segments(session) else { return true }
            let files = (try? FileManager.default.contentsOfDirectory(at: folder(session), includingPropertiesForKeys: nil)) ?? []
            return segments.contains { !$0.0.queued } || files.contains { $0.pathExtension == "pcm" }
        }
    }
    func audioFiles() -> [URL] {
        let enumerator = FileManager.default.enumerator(at: directory, includingPropertiesForKeys: nil)
        return (enumerator?.allObjects as? [URL] ?? []).filter { ["pcm", "wav", "m4a"].contains($0.pathExtension) }
    }
    func recoveryCandidates() -> [URL] {
        let enumerator = FileManager.default.enumerator(at: directory, includingPropertiesForKeys: nil)
        let files = enumerator?.allObjects as? [URL] ?? []
        return files.compactMap { file in
            if ["pcm", "wav", "m4a"].contains(file.pathExtension) { return file }
            if file.pathExtension == "json", file.lastPathComponent != "session.json" {
                return file.deletingPathExtension().appendingPathExtension("pcm")
            }
            return nil
        }
    }
    func unidentifiedAudio() -> [URL] {
        let known = Set(sessions().flatMap { (try? segments($0).map(\.1)) ?? [] })
        return audioFiles().filter { !known.contains($0) }
    }
    static func duration(of raw: URL) throws -> Int {
        let size = try raw.resourceValues(forKeys: [.fileSizeKey]).fileSize ?? 0
        return size / 32 // 16,000 mono samples/s × 2 bytes/sample.
    }
    static func wave(_ raw: Data) throws -> Data {
        // A normal 40-second segment is 1.28 MB; cap damaged/unexpected files.
        guard raw.count <= 5_120_000 else { throw BBError(status: 0, message: "Audio segment is too large to recover automatically. Export it from Settings.") }
        let size = raw.count - raw.count % 2
        var data = Data("RIFF".utf8)
        func append<T: FixedWidthInteger>(_ value: T) { var little = value.littleEndian; withUnsafeBytes(of: &little) { data.append(contentsOf: $0) } }
        append(UInt32(36 + size)); data.append(Data("WAVEfmt ".utf8))
        append(UInt32(16)); append(UInt16(1)); append(UInt16(1)); append(UInt32(16_000))
        append(UInt32(32_000)); append(UInt16(2)); append(UInt16(16))
        data.append(Data("data".utf8)); append(UInt32(size)); data.append(raw.prefix(size))
        return data
    }
}
