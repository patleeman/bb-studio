// Runs speech to text on closed segments (finals) and on the open segment (partials).
//
// One transcription runs at a time across both sources. Finals always go first,
// in the order the segments closed. A partial is only the latest offer per source,
// and is dropped once that segment's final is queued, so a slow Mac skips
// partials instead of falling behind.
import Foundation

public protocol Transcriber: Sendable {
    /// Text of 16 kHz mono samples (empty when nothing was said).
    func transcribe(_ samples: [Float]) async throws -> String
}

public struct TranscriptionJob: Sendable {
    public var source: Source
    public var index: Int
    public var samples: [Float]
    public var startMs: Int
    public var endMs: Int
    public var isFinal: Bool
}

public final class TranscriptionScheduler: @unchecked Sendable {
    private let sink: EventSink
    private let lock = NSLock()
    private var transcriber: Transcriber?
    /// Set when the transcriber can't load; queued and later finals are dropped.
    private var unavailable = false
    private var finals: [TranscriptionJob] = []
    private var partials: [Source: TranscriptionJob] = [:]
    private var finalIndex: [Source: Int] = [:]
    private var running = false
    /// The model is on disk and loading: stop waits for it rather than dropping finals.
    private var loading = false
    private var idleWaiters: [CheckedContinuation<Void, Never>] = []

    public init(sink: EventSink) {
        self.sink = sink
    }

    private func locked<T>(_ body: () -> T) -> T {
        lock.lock()
        defer { lock.unlock() }
        return body()
    }

    public var isReady: Bool { locked { transcriber != nil } }

    public func setTranscriber(_ transcriber: Transcriber) {
        locked {
            self.transcriber = transcriber
            loading = false
        }
        kick()
        resumeIfIdle()
    }

    /// The model is downloaded and loading (seconds, or a minute or more on its first compile).
    public func markLoading() {
        locked { loading = true }
    }

    public func markUnavailable() {
        let waiters: [CheckedContinuation<Void, Never>] = locked {
            unavailable = true
            loading = false
            finals.removeAll()
            partials.removeAll()
            return running ? [] : takeWaiters()
        }
        waiters.forEach { $0.resume() }
    }

    public func enqueueFinal(_ job: TranscriptionJob) {
        locked {
            guard !unavailable else { return }
            finals.append(job)
            finalIndex[job.source] = max(finalIndex[job.source] ?? -1, job.index)
            if let partial = partials[job.source], partial.index <= job.index { partials[job.source] = nil }
        }
        kick()
    }

    /// Partials are only taken once the model is ready, and only the latest per source is kept.
    public func offerPartial(_ job: TranscriptionJob) {
        locked {
            guard !unavailable, transcriber != nil, job.index > (finalIndex[job.source] ?? -1) else { return }
            partials[job.source] = job
        }
        kick()
    }

    /// Whether a partial for this source would be picked up soon (callers skip copying audio otherwise).
    public func wantsPartial(for source: Source) -> Bool {
        locked { transcriber != nil && !unavailable && finals.isEmpty && partials[source] == nil }
    }

    /// Waits until every queued final has been transcribed. Partials are discarded.
    /// Returns at once while the model is still downloading (that can take minutes).
    public func drain() async {
        await withCheckedContinuation { (continuation: CheckedContinuation<Void, Never>) in
            let done: Bool = locked {
                partials.removeAll()
                if unavailable || (transcriber == nil && !loading) || (finals.isEmpty && !running) { return true }
                idleWaiters.append(continuation)
                return false
            }
            if done { continuation.resume() }
        }
    }

    private func resumeIfIdle() {
        let waiters: [CheckedContinuation<Void, Never>] = locked {
            guard finals.isEmpty, !running else { return [] }
            return takeWaiters()
        }
        waiters.forEach { $0.resume() }
    }

    private func kick() {
        let start: Bool = locked {
            guard !running, transcriber != nil, !finals.isEmpty || !partials.isEmpty else { return false }
            running = true
            return true
        }
        if start { Task.detached { await self.loop() } }
    }

    /// Must hold the lock.
    private func next() -> TranscriptionJob? {
        if !finals.isEmpty { return finals.removeFirst() }
        // The partial that has waited longest (lowest start) goes first.
        guard let source = partials.values.min(by: { $0.startMs < $1.startMs })?.source else { return nil }
        return partials.removeValue(forKey: source)
    }

    /// Must hold the lock.
    private func takeWaiters() -> [CheckedContinuation<Void, Never>] {
        let waiters = idleWaiters
        idleWaiters.removeAll()
        return waiters
    }

    private func loop() async {
        while true {
            let picked: (TranscriptionJob, Transcriber)? = locked {
                while let job = next() {
                    if job.isFinal || job.index > (finalIndex[job.source] ?? -1) { return (job, transcriber!) }
                }
                return nil
            }
            guard let (job, transcriber) = picked else { break }
            do {
                let text = try await transcriber.transcribe(job.samples)
                if job.isFinal {
                    sink.emit(.final(source: job.source, index: job.index, text: text, startMs: job.startMs, endMs: job.endMs))
                } else if !text.isEmpty, locked({ job.index > (finalIndex[job.source] ?? -1) }) {
                    sink.emit(.partial(source: job.source, index: job.index, text: text))
                }
            } catch {
                if job.isFinal {
                    sink.emit(.error(code: .model, message: "transcribing \(job.source.rawValue) segment \(job.index) failed: \(error)"))
                }
            }
        }
        let waiters: [CheckedContinuation<Void, Never>] = locked {
            running = false
            return takeWaiters()
        }
        waiters.forEach { $0.resume() }
        // Work may have arrived between the last pick and clearing `running`.
        kick()
    }
}

/// Test-only transcriber: describes the audio instead of recognising it.
public struct DescribingTranscriber: Transcriber {
    public init() {}
    public func transcribe(_ samples: [Float]) async throws -> String {
        "\(samples.count * 1000 / 16000) ms of audio"
    }
}
