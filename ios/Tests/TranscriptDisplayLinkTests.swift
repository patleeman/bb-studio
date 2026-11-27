import QuartzCore
import XCTest
@testable import BBStudio

/// The transcript's scroll runs on a display link. Its owner gone (a
/// conversation closed mid-scroll), the link stops itself: one left ticking
/// kept the phone awake and the app from ever going idle.
@MainActor
final class TranscriptDisplayLinkTests: XCTestCase {
    func testALinkWhoseOwnerIsGoneStopsItself() {
        let before = TranscriptDisplayLinkTarget.live
        var ticks = 0
        autoreleasepool {
            let link = CADisplayLink(target: TranscriptDisplayLinkTarget { ticks += 1; return false },
                                     selector: #selector(TranscriptDisplayLinkTarget.tick(_:)))
            link.add(to: .main, forMode: .common)
        }
        XCTAssertEqual(TranscriptDisplayLinkTarget.live, before + 1, "running")
        let end = Date().addingTimeInterval(1)
        while Date() < end, TranscriptDisplayLinkTarget.live > before { RunLoop.main.run(until: Date().addingTimeInterval(0.05)) }
        XCTAssertEqual(TranscriptDisplayLinkTarget.live, before, "the link invalidated itself and let go of its target")
        XCTAssertEqual(ticks, 1, "after one frame")
    }

    func testALinkWhoseOwnerIsThereKeepsTicking() {
        var ticks = 0
        let link = CADisplayLink(target: TranscriptDisplayLinkTarget { ticks += 1; return true },
                                 selector: #selector(TranscriptDisplayLinkTarget.tick(_:)))
        link.add(to: .main, forMode: .common)
        RunLoop.main.run(until: Date().addingTimeInterval(0.3))
        link.invalidate()
        XCTAssertGreaterThan(ticks, 3)
    }
}
