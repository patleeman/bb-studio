// Cuts one source's 16 kHz mono stream into segments at pauses.
//
// - Silence before speech isn't kept: while the open segment has no speech,
//   only a short pre-roll is held, so silent stretches make no segments.
// - Once a segment reaches the target length, it closes at the next pause
//   (the middle of it, so both sides keep a little silence).
// - A long pause closes a segment early, so a short reply followed by
//   silence is transcribed now rather than when the next turn ends.
// - At the maximum length it closes at the quietest frame of the last few seconds.
// - A segment with almost no speech in it (a click, a cough) is dropped.
import Foundation

public struct SegmenterConfig: Equatable, Sendable {
    public var sampleRate = 16000
    public var targetMs = 8000
    public var maxMs = 15000
    public var frameMs = 20
    /// A pause this long closes a segment that has reached targetMs.
    public var pauseMs = 300
    /// A pause this long closes a segment whatever its length.
    public var longPauseMs = 1500
    /// Frames quieter than this (RMS) are never speech, however quiet the room.
    public var minThreshold: Float = 0.006
    /// Speech must be this many times louder than the tracked noise floor.
    public var noiseFactor: Float = 3
    /// Silence kept before the first speech in a segment.
    public var preRollMs = 300
    /// Segments with less speech than this are dropped.
    public var minSpeechMs = 160
    /// At the maximum length, look this far back for the quietest place to cut.
    public var maxCutWindowMs = 3000

    public init(targetMs: Int = 8000, maxMs: Int = 15000) {
        self.targetMs = targetMs
        self.maxMs = maxMs
    }

    var frameSamples: Int { sampleRate * frameMs / 1000 }
    func frames(ms: Int) -> Int { max(1, ms / frameMs) }
}

public struct ClosedSegment: Equatable, Sendable {
    /// Position of the first sample in the source stream.
    public var startSample: Int
    public var samples: [Float]
    public var speechMs: Int
    public let sampleRate: Int

    public var startMs: Int { startSample * 1000 / sampleRate }
    public var endMs: Int { (startSample + samples.count) * 1000 / sampleRate }
}

public final class Segmenter {
    public let config: SegmenterConfig
    private var buffer: [Float] = []
    /// Stream position of buffer[0].
    private var bufferStart = 0
    /// One entry per complete frame in `buffer`.
    private var frameRMS: [Float] = []
    private var frameVoiced: [Bool] = []
    private var noiseFloor: Float = 0.002

    public init(config: SegmenterConfig = SegmenterConfig()) {
        self.config = config
    }

    /// Samples of the open segment (for partial transcripts).
    public var openSamples: ArraySlice<Float> { buffer[...] }
    public var openStartSample: Int { bufferStart }
    public var openSpeechMs: Int { frameVoiced.lazy.filter { $0 }.count * config.frameMs }

    public func append(_ samples: [Float]) -> [ClosedSegment] {
        var closed: [ClosedSegment] = []
        buffer.append(contentsOf: samples)
        let n = config.frameSamples
        while (frameRMS.count + 1) * n <= buffer.count {
            let start = frameRMS.count * n
            var sum: Float = 0
            for i in start..<start + n { sum += buffer[i] * buffer[i] }
            let rms = (sum / Float(n)).squareRoot()
            let voiced = rms > max(config.minThreshold, noiseFloor * config.noiseFactor)
            // The floor follows quiet frames quickly and rises slowly, so speech doesn't lift it much.
            noiseFloor = rms < noiseFloor ? noiseFloor * 0.9 + rms * 0.1 : min(noiseFloor * 1.002, max(rms, noiseFloor))
            noiseFloor = max(noiseFloor, 0.0005)
            frameRMS.append(rms)
            frameVoiced.append(voiced)
            if let segment = decide() { closed.append(segment) }
        }
        return closed
    }

    /// Closes whatever is open (at stop).
    public func flush() -> ClosedSegment? {
        // A trailing partial frame is kept as audio but not judged.
        defer {
            buffer.removeAll()
            frameRMS.removeAll()
            frameVoiced.removeAll()
        }
        return makeSegment(frames: frameRMS.count, includeTail: true)
    }

    private func decide() -> ClosedSegment? {
        let frames = frameRMS.count
        let speech = frameVoiced.contains(true)
        if !speech {
            // Keep only the pre-roll while nothing has been said.
            let keep = config.frames(ms: config.preRollMs)
            if frames > keep { drop(frames: frames - keep) }
            return nil
        }
        let lengthMs = frames * config.frameMs
        let trailingQuiet = frameVoiced.reversed().prefix { !$0 }.count
        if trailingQuiet >= config.frames(ms: config.longPauseMs)
            || (lengthMs >= config.targetMs && trailingQuiet >= config.frames(ms: config.pauseMs)) {
            return cut(atFrame: frames - trailingQuiet / 2)
        }
        if lengthMs >= config.maxMs {
            let window = config.frames(ms: config.maxCutWindowMs)
            let from = max(1, frames - window)
            var best = frames - 1
            // The latest of equally quiet frames, so segments stay close to the maximum.
            for i in (from..<frames).reversed() where frameRMS[i] < frameRMS[best] { best = i }
            return cut(atFrame: best + 1)
        }
        return nil
    }

    private func cut(atFrame frame: Int) -> ClosedSegment? {
        let segment = makeSegment(frames: frame, includeTail: false)
        drop(frames: frame)
        return segment
    }

    private func makeSegment(frames: Int, includeTail: Bool) -> ClosedSegment? {
        let speechMs = frameVoiced.prefix(frames).filter { $0 }.count * config.frameMs
        guard speechMs >= config.minSpeechMs else { return nil }
        let count = includeTail ? buffer.count : frames * config.frameSamples
        return ClosedSegment(startSample: bufferStart, samples: Array(buffer.prefix(count)), speechMs: speechMs, sampleRate: config.sampleRate)
    }

    private func drop(frames: Int) {
        let samples = frames * config.frameSamples
        buffer.removeFirst(samples)
        frameRMS.removeFirst(frames)
        frameVoiced.removeFirst(frames)
        bufferStart += samples
    }
}

/// RMS over fixed windows (100 ms by default), for the level meter.
public struct LevelMeter {
    public let windowSamples: Int
    private var sum: Float = 0
    private var count = 0

    public init(sampleRate: Int = 16000, windowMs: Int = 100) {
        windowSamples = sampleRate * windowMs / 1000
    }

    public mutating func append(_ samples: [Float]) -> [Double] {
        var levels: [Double] = []
        for sample in samples {
            sum += sample * sample
            count += 1
            if count == windowSamples {
                levels.append(Double((sum / Float(count)).squareRoot()))
                sum = 0
                count = 0
            }
        }
        return levels
    }
}
