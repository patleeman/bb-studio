import XCTest
@testable import TalkTapCore

final class SegmenterTests: XCTestCase {
    /// Feeds audio in 100 ms chunks, the way inputs deliver it.
    func run(_ audio: [Float], config: SegmenterConfig = SegmenterConfig(), flush: Bool = true) -> [ClosedSegment] {
        let segmenter = Segmenter(config: config)
        var out: [ClosedSegment] = []
        var i = 0
        while i < audio.count {
            out += segmenter.append(Array(audio[i..<min(i + 1600, audio.count)]))
            i += 1600
        }
        if flush, let last = segmenter.flush() { out.append(last) }
        return out
    }

    func testSilenceMakesNoSegments() {
        XCTAssertTrue(run(TestSignals.silence(ms: 30000)).isEmpty)
        XCTAssertTrue(run(TestSignals.noise(ms: 30000)).isEmpty)
    }

    func testShortUtteranceClosesAtFlushWithPreRoll() throws {
        let audio = TestSignals.talk(utterances: [2000], pauseMs: 500, leadMs: 5000)
        let segments = run(audio)
        XCTAssertEqual(segments.count, 1)
        let segment = try XCTUnwrap(segments.first)
        // Leading silence is dropped except about 300 ms of pre-roll.
        XCTAssertEqual(segment.startMs, 4700, accuracy: 40)
        XCTAssertGreaterThan(segment.speechMs, 1500)
    }

    func testCutsAtPausesAfterTarget() {
        // Utterances of 3 s with 600 ms pauses: the first pause after 8 s closes each segment.
        let audio = TestSignals.talk(utterances: Array(repeating: 3000, count: 10), pauseMs: 600)
        let segments = run(audio)
        XCTAssertGreaterThanOrEqual(segments.count, 3)
        for segment in segments.dropLast() {
            let length = segment.endMs - segment.startMs
            // At least the target, less the half pause kept by the next segment.
            XCTAssertGreaterThanOrEqual(length, 8000 - 300)
            XCTAssertLessThanOrEqual(length, 15000)
            // The cut is inside a pause: the segment ends in silence.
            XCTAssertLessThan(rms(segment.samples.suffix(160)), 0.001)
        }
        // Only silence is left out between segments.
        for (a, b) in zip(segments, segments.dropFirst()) {
            XCTAssertGreaterThanOrEqual(b.startMs, a.endMs)
            XCTAssertLessThanOrEqual(b.startMs - a.endMs, 600)
        }
    }

    func testContinuousSpeechCutsAtMax() {
        let audio = TestSignals.utterance(ms: 40000)
        let segments = run(audio, flush: false)
        XCTAssertEqual(segments.count, 2)
        for segment in segments {
            let length = segment.endMs - segment.startMs
            XCTAssertLessThanOrEqual(length, 15000)
            XCTAssertGreaterThanOrEqual(length, 12000)
        }
    }

    func testCustomTargetAndMax() {
        var config = SegmenterConfig(targetMs: 2000, maxMs: 4000)
        config.pauseMs = 200
        let segments = run(TestSignals.talk(utterances: Array(repeating: 1500, count: 8), pauseMs: 400), config: config)
        XCTAssertGreaterThanOrEqual(segments.count, 4)
        for segment in segments.dropLast() {
            XCTAssertGreaterThanOrEqual(segment.endMs - segment.startMs, 2000 - 200)
            XCTAssertLessThanOrEqual(segment.endMs - segment.startMs, 4000)
        }
    }

    func testLongPauseClosesEarly() {
        // A 1.5 s reply, then 5 s of silence: closed after the pause, not at the next turn.
        let segmenter = Segmenter()
        var closed: [ClosedSegment] = []
        let audio = TestSignals.talk(utterances: [1500], pauseMs: 5000, leadMs: 1000)
        var fedMs = 0
        var closedAtMs: Int?
        for start in stride(from: 0, to: audio.count, by: 1600) {
            closed += segmenter.append(Array(audio[start..<min(start + 1600, audio.count)]))
            fedMs += 100
            if closedAtMs == nil, !closed.isEmpty { closedAtMs = fedMs }
        }
        XCTAssertEqual(closed.count, 1)
        // Speech ends at 2.5 s; a 1.5 s pause closes it by about 4 s.
        XCTAssertEqual(closedAtMs ?? 0, 4000, accuracy: 200)
        XCTAssertEqual(closed.first?.endMs ?? 0, 2500 + 750, accuracy: 100)
        XCTAssertNil(segmenter.flush())
    }

    func testClickIsDropped() {
        var audio = TestSignals.silence(ms: 3000)
        audio += TestSignals.syllable(ms: 60, amplitude: 0.5)
        audio += TestSignals.silence(ms: 9000)
        XCTAssertTrue(run(audio).isEmpty)
    }

    func testAdaptsToSteadyNoise() {
        // Speech over steady noise well above the fixed threshold still finds the pauses.
        let noise = TestSignals.noise(ms: 30000, level: 0.03)
        let speech = TestSignals.talk(utterances: Array(repeating: 3000, count: 8), pauseMs: 700, leadMs: 2000)
        let mixed = zip(noise, speech + TestSignals.silence(ms: 30000)).map { $0 + $1 * 2 }
        let segments = run(mixed, flush: false)
        XCTAssertGreaterThanOrEqual(segments.count, 2)
        for segment in segments { XCTAssertLessThan(segment.endMs - segment.startMs, 15000) }
    }

    func testLevelMeter() {
        var meter = LevelMeter()
        let levels = meter.append([Float](repeating: 0.5, count: 4000))
        XCTAssertEqual(levels.count, 2) // 100 ms windows; 800 samples wait for the next chunk
        XCTAssertEqual(levels[0], 0.5, accuracy: 1e-6)
        XCTAssertEqual(meter.append([Float](repeating: 0, count: 800)).count, 1)
    }

    private func rms<C: Collection>(_ samples: C) -> Float where C.Element == Float {
        (samples.reduce(0) { $0 + $1 * $1 } / Float(max(samples.count, 1))).squareRoot()
    }
}
