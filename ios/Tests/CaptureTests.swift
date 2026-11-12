import XCTest
@testable import BBStudio

final class CaptureTests: XCTestCase {
    func testNoteTitleUsesFirstLine() {
        XCTAssertEqual(CaptureNote.title(from: "  Buy milk  \nBefore Friday"), "Buy milk")
        XCTAssertEqual(CaptureNote.title(from: "\nMore text"), "Untitled")
    }

    func testLastUsedOptionMovesFirstWithoutChangingTheRest() {
        XCTAssertEqual(CaptureOption.ordered(last: .file), [.file, .voice, .dictate, .note, .thread])
        XCTAssertEqual(CaptureOption.ordered(last: nil), CaptureOption.allCases)
    }
}
