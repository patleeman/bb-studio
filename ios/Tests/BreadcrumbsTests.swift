import XCTest
@testable import BBStudio

@MainActor
final class BreadcrumbsTests: XCTestCase {
    private var directory: URL!

    override func setUp() async throws {
        directory = FileManager.default.temporaryDirectory.appending(path: "breadcrumbs-\(UUID().uuidString)")
    }

    override func tearDown() async throws {
        try? FileManager.default.removeItem(at: directory)
    }

    func testKeepsOnlyTheNewestLines() {
        let crumbs = Breadcrumbs(directory: directory)
        for index in 0..<(Breadcrumbs.cap + 50) { crumbs.record("window \(index)x1") }
        XCTAssertEqual(crumbs.lines.count, Breadcrumbs.cap)
        XCTAssertTrue(crumbs.lines.first?.hasSuffix("window 50x1") == true, "The oldest go first")
        XCTAssertTrue(crumbs.lines.last?.hasSuffix("window \(Breadcrumbs.cap + 49)x1") == true)
        crumbs.flush()
        let written = (try? String(contentsOf: crumbs.file, encoding: .utf8)) ?? ""
        XCTAssertEqual(written.split(separator: "\n").count, Breadcrumbs.cap, "The file holds the same lines")
    }

    /// Focus changes name the field by id; a message's words never get in.
    func testFocusNeverRecordsText() {
        let crumbs = Breadcrumbs(directory: directory)
        crumbs.focus("composer-field", "began")
        crumbs.focus("Meet me at the Lisbon office at 3", "began")
        XCTAssertTrue(crumbs.lines[0].hasSuffix("focus composer-field began"), crumbs.lines[0])
        XCTAssertFalse(crumbs.lines.joined().contains("Lisbon"))
        XCTAssertTrue(crumbs.lines[1].hasSuffix("focus ?33 began"), crumbs.lines[1])
    }

    /// A session still marked active at the next launch crashed (or was
    /// killed in front): its file is kept. One that went to the background
    /// ended cleanly, as far as we can tell, and its file is not.
    func testKeepsTheFileOnlyAfterAnUncleanExit() {
        let first = Breadcrumbs(directory: directory)
        XCTAssertFalse(first.launch(), "Nothing to keep on a first launch")
        first.record("kbd willShow end=0,400,466x278")
        first.flush()

        let afterCrash = Breadcrumbs(directory: directory)
        XCTAssertTrue(afterCrash.launch(), "Still active: an unclean exit")
        let kept = (try? String(contentsOf: afterCrash.lastCrash, encoding: .utf8)) ?? ""
        XCTAssertTrue(kept.contains("kbd willShow end=0,400,466x278"), kept)
        XCTAssertTrue(afterCrash.hasLastCrash)

        afterCrash.scene("background")
        let afterBackground = Breadcrumbs(directory: directory)
        XCTAssertFalse(afterBackground.launch(), "Left in the background: clean")
        XCTAssertTrue(afterBackground.hasLastCrash, "The earlier crash's file stays until cleared")
        afterBackground.clearLastCrash()
        XCTAssertFalse(afterBackground.hasLastCrash)
    }
}

@MainActor
final class ResizeSettlingTests: XCTestCase {
    /// Work waits until the window has kept its size for `quiet`, and a
    /// change in the meantime pushes it back again.
    func testWorkWaitsForTheWindowToSettle() {
        let settling = ResizeSettling()
        var clock = Date(timeIntervalSince1970: 1_000)
        var pending: [(TimeInterval, @MainActor () -> Void)] = []
        settling.now = { clock }
        settling.schedule = { delay, work in pending.append((delay, work)) }
        var ran = 0

        settling.afterSettling { ran += 1 }
        XCTAssertEqual(pending.first?.0, 0, "Settled: on the next pass, as before")
        pending.removeFirst().1()
        XCTAssertEqual(ran, 1)

        settling.changed()
        settling.afterSettling { ran += 1 }
        XCTAssertEqual(pending.first?.0 ?? 0, 0.4, accuracy: 0.001)
        clock += 0.3
        settling.changed()
        clock += 0.1
        pending.removeFirst().1()
        XCTAssertEqual(ran, 1, "Changed again in the meantime: still waiting")
        XCTAssertEqual(pending.first?.0 ?? 0, 0.3, accuracy: 0.001)
        clock += 0.3
        pending.removeFirst().1()
        XCTAssertEqual(ran, 2)
        XCTAssertTrue(pending.isEmpty)
    }
}
