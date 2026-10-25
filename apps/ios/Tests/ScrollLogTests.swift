import XCTest
@testable import BBStudio

final class ScrollLogTests: XCTestCase {
    private var file: URL!

    override func setUp() {
        file = FileManager.default.temporaryDirectory.appending(path: "scroll-log-\(UUID().uuidString).txt")
    }
    override func tearDown() { try? FileManager.default.removeItem(at: file) }

    func testTheFileStaysUnderItsCapAndKeepsTheNewestWholeLines() throws {
        let cap = 2_000
        for index in 0..<500 {
            ScrollLog.append(String(format: "%.3f req keepAtEnd following=true from %d to %d\n", Double(index), index, index + 1), to: file, cap: cap)
            let size = try XCTUnwrap(FileManager.default.attributesOfItem(atPath: file.path)[.size] as? Int)
            XCTAssertLessThanOrEqual(size, cap)
        }
        let lines = try String(contentsOf: file, encoding: .utf8).split(separator: "\n")
        XCTAssertEqual(lines.last, "499.000 req keepAtEnd following=true from 499 to 500")
        XCTAssertGreaterThan(lines.count, 10, "Trimming keeps most of the cap, not a line or two")
        for line in lines { XCTAssertTrue(line.contains(" req keepAtEnd following=true from "), "A line cut in half: \(line)") }
        // Consecutive: nothing in the middle went missing.
        let numbers = lines.compactMap { Double($0.split(separator: " ")[0]) }
        XCTAssertEqual(numbers, (0..<numbers.count).map { Double(500 - numbers.count + $0) })
    }

    func testOneLineLongerThanTheCapIsCutToIt() throws {
        ScrollLog.append(String(repeating: "x", count: 50) + "\n", to: file, cap: 20)
        XCTAssertLessThanOrEqual(try Data(contentsOf: file).count, 20)
    }

    func testRowIdsPassButMessageTextDoesNot() {
        for id in ["a149", "timeline-bottom", "child:started:thr_research1", "reply3", "burst2-17", "019a.b_c"] {
            XCTAssertEqual(ScrollLog.id(id), id)
        }
        for text in ["Meet Dana at 5 about the merger", "Lisbon", "passport?", "héllo", "", String(repeating: "a", count: 65)] {
            let logged = ScrollLog.id(text)
            XCTAssertTrue(logged.hasPrefix("?"), "\(text) was logged as \(logged)")
            XCTAssertEqual(logged, "?\(text.count)")
        }
    }

    func testARestoreAnchorLogsItsRowIdOnly() {
        XCTAssertEqual(ScrollLog.describe(.bottom), "bottom")
        XCTAssertEqual(ScrollLog.describe(.message("a149", offset: 82)), "message a149 offset=82.0")
        XCTAssertEqual(ScrollLog.describe(.message("Call me tonight", offset: 0)), "message ?15 offset=0.0")
    }

    func testAGeometryLineHoldsNumbersAndIdsOnly() {
        let secret = "Wire the deposit to account 4471 before Friday"
        let line = ScrollLog.geometryLine(offset: 2353, content: 2997, container: 378, insetTop: 82, insetBottom: 218,
                                          past: -184, visible: ["a149", secret, "timeline-bottom"])
        XCTAssertEqual(line, "offset=2353.0 content=2997.0 container=378.0 insetTop=82.0 insetBottom=218.0 past=-184.0 rows=3 visible=a149,?\(secret.count),timeline-bottom")
        XCTAssertFalse(line.contains("deposit"))
        let many = ScrollLog.geometryLine(offset: 0, content: 0, container: 0, insetTop: 0, insetBottom: 0, past: 0,
                                          visible: [secret, "a1", "a2", "a3", secret])
        XCTAssertFalse(many.contains("Wire"))
        XCTAssertTrue(many.hasSuffix("rows=5 visible=?\(secret.count),…,?\(secret.count)"))
    }
}
