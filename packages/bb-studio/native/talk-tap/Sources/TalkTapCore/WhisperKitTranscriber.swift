// Local speech to text with WhisperKit (Core ML, on the Neural Engine).
//
// The model is downloaded on first use into modelDir, from Argmax's
// whisperkit-coreml repository on Hugging Face, with the tokenizer beside it.
// Later runs find it there and need no network.
import Foundation
import WhisperKit

public enum WhisperKitLoader {
    static let repo = "argmaxinc/whisperkit-coreml"
    static let completeMarker = ".bb-talk-tap-complete"

    public static func load(model: String, modelDir: String, language: String?, into scheduler: TranscriptionScheduler, sink: EventSink) async {
        do {
            let transcriber = try await makeTranscriber(model: model, modelDir: modelDir, language: language, sink: sink) {
                scheduler.markLoading()
            }
            scheduler.setTranscriber(transcriber)
            sink.emit(.model(progress: 1, stage: "ready"))
        } catch {
            sink.emit(.error(code: .model, message: "loading WhisperKit model \(model) failed: \(error.localizedDescription)"))
            scheduler.markUnavailable()
        }
    }

    public static func makeTranscriber(model: String, modelDir: String, language: String?, sink: EventSink?, downloaded: () -> Void = {}) async throws -> WhisperKitTranscriber {
        let base = URL(fileURLWithPath: modelDir, isDirectory: true)
        try FileManager.default.createDirectory(at: base, withIntermediateDirectories: true)
        let folder: URL
        if let local = localModel(model, in: base) {
            folder = local
        } else {
            folder = try await download(model, to: base, sink: sink)
        }
        downloaded()
        let started = Date()
        let config = WhisperKitConfig(
            model: model,
            downloadBase: base,
            modelRepo: repo,
            modelFolder: folder.path,
            tokenizerFolder: base,
            verbose: false,
            logLevel: .none,
            prewarm: false,
            load: true,
            download: false
        )
        let kit = try await WhisperKit(config)
        log("loaded \(folder.lastPathComponent) in \(String(format: "%.1f", Date().timeIntervalSince(started))) s")
        return WhisperKitTranscriber(kit: kit, language: language)
    }

    /// A finished download of `model` in `base`: Argmax folders are named like
    /// openai_whisper-large-v3-v20240930_626MB, and "large-v3-v20240930_626MB" names it too.
    static func localModel(_ model: String, in base: URL) -> URL? {
        let root = base.appendingPathComponent("models/\(repo)", isDirectory: true)
        guard let names = try? FileManager.default.contentsOfDirectory(atPath: root.path) else { return nil }
        let candidates = names.filter { $0 == model || $0.hasSuffix("_" + model) || $0.hasSuffix("-" + model) }
        return candidates.sorted().lazy
            .map { root.appendingPathComponent($0, isDirectory: true) }
            .first { FileManager.default.fileExists(atPath: $0.appendingPathComponent(completeMarker).path) }
    }

    static func download(_ model: String, to base: URL, sink: EventSink?) async throws -> URL {
        let reporter = ProgressReporter(sink: sink)
        reporter.report(0)
        let folder = try await WhisperKit.download(variant: model, downloadBase: base, from: repo) { progress in
            reporter.report(progress.fractionCompleted)
        }
        reporter.report(1)
        try Data().write(to: folder.appendingPathComponent(completeMarker))
        return folder
    }
}

/// Sends `model` download events at most every 1% or half second.
final class ProgressReporter: @unchecked Sendable {
    private let sink: EventSink?
    private let lock = NSLock()
    private var last = -1.0
    private var lastAt = Date.distantPast

    init(sink: EventSink?) { self.sink = sink }

    func report(_ fraction: Double) {
        let value = min(max(fraction, 0), 1)
        lock.lock()
        let due = value >= 1 ? value > last : value - last >= 0.01 || Date().timeIntervalSince(lastAt) >= 0.5 && value > last
        if due {
            last = value
            lastAt = Date()
        }
        lock.unlock()
        if due { sink?.emit(.model(progress: value, stage: "download")) }
    }
}

public final class WhisperKitTranscriber: Transcriber, @unchecked Sendable {
    let kit: WhisperKit
    let options: DecodingOptions

    init(kit: WhisperKit, language: String?) {
        self.kit = kit
        options = DecodingOptions(
            verbose: false,
            task: .transcribe,
            language: language,
            temperatureFallbackCount: 3,
            usePrefillPrompt: true,
            detectLanguage: language == nil,
            skipSpecialTokens: true,
            withoutTimestamps: true,
            suppressBlank: true
        )
    }

    public func transcribe(_ samples: [Float]) async throws -> String {
        let started = Date()
        let results = try await kit.transcribe(audioArray: samples, decodeOptions: options)
        let text = results.map(\.text).joined(separator: " ").trimmingCharacters(in: .whitespacesAndNewlines)
        let audio = Double(samples.count) / 16000
        log(String(format: "transcribed %.1f s of audio in %.2f s", audio, Date().timeIntervalSince(started)))
        return text
    }
}
