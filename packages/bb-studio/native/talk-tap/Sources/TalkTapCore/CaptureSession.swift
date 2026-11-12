// A capture: inputs -> pipelines -> segment files and events, until stop.
import Foundation

public final class CaptureSession: @unchecked Sendable {
    public let args: CaptureArgs
    private let sink: EventSink
    private let inputs: [AudioInput]
    private let pipelines: [Source: SourcePipeline]
    private let scheduler: TranscriptionScheduler?
    private let modelLoader: (@Sendable (TranscriptionScheduler, EventSink) async -> Void)?
    private let lock = NSLock()
    private var stopping = false
    private var endedInputs = 0
    private let onStopped: @Sendable () -> Void
    /// How long stop waits for outstanding final transcripts.
    public var drainTimeout: TimeInterval = 120

    /// - Parameters:
    ///   - inputs: one per source; the session owns them.
    ///   - modelLoader: loads the transcriber into the scheduler (nil when stt is none).
    ///   - stopWhenInputsEnd: stop by itself once every input has ended (fake mode at end of file).
    public init(
        args: CaptureArgs,
        sink: EventSink,
        inputs: [AudioInput],
        transcribes: Bool,
        modelLoader: (@Sendable (TranscriptionScheduler, EventSink) async -> Void)?,
        onStopped: @escaping @Sendable () -> Void
    ) {
        self.args = args
        self.sink = sink
        self.inputs = inputs
        self.modelLoader = modelLoader
        self.onStopped = onStopped
        let scheduler = transcribes ? TranscriptionScheduler(sink: sink) : nil
        self.scheduler = scheduler
        let config = SegmenterConfig(targetMs: args.segmentTargetMs, maxMs: args.segmentMaxMs)
        var pipelines: [Source: SourcePipeline] = [:]
        for input in inputs {
            pipelines[input.source] = SourcePipeline(source: input.source, segmentDir: args.segmentDir, config: config, sink: sink, scheduler: scheduler)
        }
        self.pipelines = pipelines
    }

    public var stopWhenInputsEnd = false

    public func start() throws {
        CaptureClock.reset()
        try FileManager.default.createDirectory(atPath: args.segmentDir, withIntermediateDirectories: true)
        if let scheduler, let modelLoader {
            let sink = self.sink
            Task.detached { await modelLoader(scheduler, sink) }
        }
        var started: [Source] = []
        pipelines.values.forEach { $0.hold() }
        defer { pipelines.values.forEach { $0.resume() } }
        for input in inputs {
            let pipeline = pipelines[input.source]!
            do {
                try input.start(
                    deliver: { samples, atMs in pipeline.feed(samples, atMs: atMs) },
                    ended: { [weak self] in self?.inputEnded() }
                )
                started.append(input.source)
            } catch let error as CaptureError {
                sink.emit(.error(code: error.code, message: error.message))
                // Without the call audio there is nothing to capture; without the mic, carry on.
                if input.source == .them { throw error }
            }
        }
        sink.emit(.started(sources: started))
    }

    private func inputEnded() {
        lock.lock()
        endedInputs += 1
        let all = endedInputs >= inputs.count
        lock.unlock()
        if all && stopWhenInputsEnd { stop() }
    }

    /// Stops the inputs, closes open segments, waits for final transcripts, then emits `stopped`.
    public func stop() {
        lock.lock()
        if stopping { lock.unlock(); return }
        stopping = true
        lock.unlock()
        Thread.detachNewThread { [self] in
            inputs.forEach { $0.stop() }
            for source in Source.allCases { pipelines[source]?.finish() }
            let finished = DispatchSemaphore(value: 0)
            Task.detached { [scheduler] in
                await scheduler?.drain()
                finished.signal()
            }
            if finished.wait(timeout: .now() + drainTimeout) == .timedOut {
                sink.emit(.error(code: .model, message: "stopped before every final transcript was ready"))
            }
            sink.emit(.stopped)
            onStopped()
        }
    }
}

public struct CaptureError: Error, CustomStringConvertible {
    public let code: ErrorCode
    public let message: String
    public init(_ code: ErrorCode, _ message: String) {
        self.code = code
        self.message = message
    }
    public var description: String { "\(code.rawValue): \(message)" }
}
