import XCTest
@testable import TalkTapCore

/// The live inputs are never started in tests (that would prompt for permission on this Mac).
/// These check what can be checked without touching audio hardware.
final class LiveInputTests: XCTestCase {
    func testMakesATapAndAMic() throws {
        let sink = MemorySink()
        let both = try LiveInputs.make(CaptureArgs(target: .bundleIds(["us.zoom.xos"]), mic: true, segmentDir: "/tmp/x"), sink: sink)
        XCTAssertEqual(both.map(\.source), [.them, .me])
        XCTAssertTrue(both[0] is ProcessTapInput)
        XCTAssertTrue(both[1] is MicInput)
        let tapOnly = try LiveInputs.make(CaptureArgs(target: .all, mic: false, segmentDir: "/tmp/x"), sink: sink)
        XCTAssertEqual(tapOnly.map(\.source), [.them])
        XCTAssertEqual((tapOnly[0] as? ProcessTapInput)?.target, .all)
        // Stopping inputs that never started is harmless and creates nothing.
        both.forEach { $0.stop() }
        XCTAssertTrue(sink.events.isEmpty)
    }

    func testHostClock() {
        CaptureClock.reset()
        Thread.sleep(forTimeInterval: 0.05)
        let now = mach_absolute_time()
        XCTAssertEqual(Double(HostClock.msSinceStart(hostTime: now)), 50, accuracy: 30)
        XCTAssertEqual(Double(CaptureClock.elapsedMs), 50, accuracy: 30)
        // A host time from before capture started clamps to zero.
        XCTAssertEqual(HostClock.msSinceStart(hostTime: 1), 0)
    }
}
