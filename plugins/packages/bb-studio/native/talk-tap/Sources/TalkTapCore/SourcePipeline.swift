// One source ("them" or "me"): levels, segments on disk, and speech-to-text jobs.
import Foundation

public final class SourcePipeline: @unchecked Sendable {
    public let source: Source
    private let segmentDir: String
    private let sink: EventSink
    private let scheduler: TranscriptionScheduler?
    private let segmenter: Segmenter
    private var meter = LevelMeter()
    private var nextIndex = 0
    /// Every source counts time from the moment capture started.
    private var offsetSamples = 0
    private var started = false
    private var finished = false
    private var lastPartialSamples = 0
    /// All work for this source runs here, in order, off the audio thread.
    private let queue: DispatchQueue

    /// A partial is offered once the open segment has this much new audio.
    public var partialEveryMs = 1500

    public init(source: Source, segmentDir: String, config: SegmenterConfig, sink: EventSink, scheduler: TranscriptionScheduler?) {
        self.source = source
        self.segmentDir = segmentDir
        self.sink = sink
        self.scheduler = scheduler
        segmenter = Segmenter(config: config)
        queue = DispatchQueue(label: "bb-talk-tap.\(source.rawValue)")
    }

    /// Feed 16 kHz mono audio. `atMs` (first chunk only) is when it starts, relative to capture start.
    public func feed(_ samples: [Float], atMs: Int? = nil) {
        queue.async { self.process(samples, atMs: atMs) }
    }

    /// Holds queued audio until `resume()` (so `started` goes out before any level or segment).
    public func hold() { queue.suspend() }
    public func resume() { queue.resume() }

    /// Closes the open segment and waits for the queue to empty.
    public func finish() {
        queue.sync {
            guard !finished else { return }
            finished = true
            if let segment = segmenter.flush() { close(segment) }
        }
    }

    public func path(for index: Int) -> String {
        (segmentDir as NSString).appendingPathComponent(String(format: "%@-%05d.wav", source.rawValue, index))
    }

    private func process(_ samples: [Float], atMs: Int?) {
        // Audio that arrives after stop belongs to no segment.
        guard !finished else { return }
        if !started {
            started = true
            offsetSamples = (atMs ?? 0) * 16
        }
        for rms in meter.append(samples) { sink.emit(.level(source: source, rms: rms)) }
        for segment in segmenter.append(samples) { close(segment) }
        offerPartialIfDue()
    }

    private func close(_ segment: ClosedSegment) {
        let index = nextIndex
        nextIndex += 1
        lastPartialSamples = 0
        let path = path(for: index)
        let startMs = (offsetSamples + segment.startSample) / 16
        let endMs = (offsetSamples + segment.startSample + segment.samples.count) / 16
        do {
            try WAV.write(segment.samples, to: path)
        } catch {
            sink.emit(.error(code: .internal, message: "writing \(path) failed: \(error)"))
            return
        }
        sink.emit(.segment(source: source, index: index, path: path, startMs: startMs, endMs: endMs))
        guard let scheduler else { return }
        let job = TranscriptionJob(source: source, index: index, samples: segment.samples, startMs: startMs, endMs: endMs, isFinal: true)
        scheduler.enqueueFinal(job)
    }

    private func offerPartialIfDue() {
        guard let scheduler, segmenter.openSpeechMs >= 500 else { return }
        let open = segmenter.openSamples
        guard open.count - lastPartialSamples >= partialEveryMs * 16, scheduler.wantsPartial(for: source) else { return }
        lastPartialSamples = open.count
        let startMs = (offsetSamples + segmenter.openStartSample) / 16
        scheduler.offerPartial(TranscriptionJob(source: source, index: nextIndex, samples: Array(open), startMs: startMs, endMs: startMs + open.count / 16, isFinal: false))
    }
}
