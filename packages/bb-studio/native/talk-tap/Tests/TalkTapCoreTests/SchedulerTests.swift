import XCTest
@testable import TalkTapCore

/// Records calls; each call waits `delayMs`.
final class SlowTranscriber: Transcriber, @unchecked Sendable {
    let delayMs: UInt64
    private let lock = NSLock()
    private var seen: [Int] = []
    init(delayMs: UInt64) { self.delayMs = delayMs }
    var calls: [Int] { lock.lock(); defer { lock.unlock() }; return seen }
    func transcribe(_ samples: [Float]) async throws -> String {
        lock.withLock { seen.append(samples.count) }
        try await Task.sleep(nanoseconds: delayMs * 1_000_000)
        return "n=\(samples.count)"
    }
}

final class SchedulerTests: XCTestCase {
    func job(_ source: Source, _ index: Int, count: Int = 16000, final: Bool = true) -> TranscriptionJob {
        TranscriptionJob(source: source, index: index, samples: [Float](repeating: 0, count: count), startMs: index * 1000, endMs: index * 1000 + 1000, isFinal: final)
    }

    func testFinalsInOrderAndDrainWaits() async {
        let sink = MemorySink()
        let scheduler = TranscriptionScheduler(sink: sink)
        scheduler.setTranscriber(SlowTranscriber(delayMs: 20))
        scheduler.enqueueFinal(job(.them, 0, count: 100))
        scheduler.enqueueFinal(job(.me, 0, count: 200))
        scheduler.enqueueFinal(job(.them, 1, count: 300))
        await scheduler.drain()
        XCTAssertEqual(sink.events, [
            .final(source: .them, index: 0, text: "n=100", startMs: 0, endMs: 1000),
            .final(source: .me, index: 0, text: "n=200", startMs: 0, endMs: 1000),
            .final(source: .them, index: 1, text: "n=300", startMs: 1000, endMs: 2000),
        ])
    }

    func testFinalsWaitForTheModel() async throws {
        let sink = MemorySink()
        let scheduler = TranscriptionScheduler(sink: sink)
        scheduler.enqueueFinal(job(.them, 0, count: 100))
        scheduler.offerPartial(job(.them, 1, count: 5, final: false)) // ignored: no model yet
        try await Task.sleep(nanoseconds: 50_000_000)
        XCTAssertTrue(sink.events.isEmpty)
        scheduler.setTranscriber(SlowTranscriber(delayMs: 1))
        await scheduler.drain()
        XCTAssertEqual(sink.events, [.final(source: .them, index: 0, text: "n=100", startMs: 0, endMs: 1000)])
    }

    func testPartialReplacedByNewerAndDroppedAfterFinal() async throws {
        let sink = MemorySink()
        let scheduler = TranscriptionScheduler(sink: sink)
        let transcriber = SlowTranscriber(delayMs: 50)
        scheduler.setTranscriber(transcriber)
        scheduler.enqueueFinal(job(.them, 0, count: 10)) // keeps the worker busy
        scheduler.offerPartial(job(.them, 1, count: 11, final: false))
        scheduler.offerPartial(job(.them, 1, count: 12, final: false)) // replaces the one above
        scheduler.offerPartial(job(.me, 0, count: 13, final: false))
        scheduler.enqueueFinal(job(.me, 0, count: 14)) // supersedes me's partial
        XCTAssertFalse(scheduler.wantsPartial(for: .them))
        await scheduler.drain()
        try await Task.sleep(nanoseconds: 200_000_000)
        XCTAssertFalse(transcriber.calls.contains(11))
        XCTAssertFalse(transcriber.calls.contains(13))
        XCTAssertFalse(sink.events.contains(.partial(source: .me, index: 0, text: "n=13")))
        XCTAssertEqual(Array(sink.events.prefix(2)), [
            .final(source: .them, index: 0, text: "n=10", startMs: 0, endMs: 1000),
            .final(source: .me, index: 0, text: "n=14", startMs: 0, endMs: 1000),
        ])
    }

    func testPartialFinishingAfterItsFinalIsDropped() async throws {
        let sink = MemorySink()
        let scheduler = TranscriptionScheduler(sink: sink)
        scheduler.setTranscriber(SlowTranscriber(delayMs: 30))
        scheduler.offerPartial(job(.them, 0, count: 7, final: false))
        try await Task.sleep(nanoseconds: 5_000_000)
        scheduler.enqueueFinal(job(.them, 0, count: 8)) // arrives while the partial runs
        await scheduler.drain()
        // The partial finished after its segment closed, so only the final is reported.
        XCTAssertEqual(sink.events, [.final(source: .them, index: 0, text: "n=8", startMs: 0, endMs: 1000)])
        scheduler.offerPartial(job(.them, 1, count: 9, final: false))
        try await Task.sleep(nanoseconds: 100_000_000)
        XCTAssertEqual(sink.events.last, .partial(source: .them, index: 1, text: "n=9"))
    }

    func testDrainWaitsForALoadingModelButNotADownload() async throws {
        let sink = MemorySink()
        let scheduler = TranscriptionScheduler(sink: sink)
        scheduler.enqueueFinal(job(.them, 0, count: 100))
        await scheduler.drain() // still downloading: returns at once, nothing transcribed
        XCTAssertTrue(sink.events.isEmpty)

        scheduler.markLoading()
        let drained = Task { await scheduler.drain() }
        try await Task.sleep(nanoseconds: 50_000_000)
        scheduler.setTranscriber(SlowTranscriber(delayMs: 1))
        await drained.value
        XCTAssertEqual(sink.events, [.final(source: .them, index: 0, text: "n=100", startMs: 0, endMs: 1000)])

        // Loading with nothing queued: drain returns once the model is ready.
        let idle = TranscriptionScheduler(sink: sink)
        idle.markLoading()
        let waiting = Task { await idle.drain() }
        idle.setTranscriber(SlowTranscriber(delayMs: 1))
        await waiting.value
    }

    func testUnavailableDropsWorkAndDrainReturns() async {
        let sink = MemorySink()
        let scheduler = TranscriptionScheduler(sink: sink)
        scheduler.enqueueFinal(job(.them, 0))
        scheduler.markUnavailable()
        scheduler.enqueueFinal(job(.them, 1))
        await scheduler.drain()
        XCTAssertTrue(sink.events.isEmpty)
    }
}
