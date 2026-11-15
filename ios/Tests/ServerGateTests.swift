import XCTest
@testable import BBStudio

@MainActor
final class ServerGateTests: XCTestCase {
    func testSignInKeepsToOnePageOfTheUnfoldedDuo() throws {
        try XCTSkipUnless(UIDevice.current.userInterfaceIdiom == .phone)
        XCTAssertEqual(ServerGate.page(CGSize(width: 951, height: 669)), CGSize(width: 459.5, height: 669), "the left page")
        XCTAssertEqual(ServerGate.page(CGSize(width: 669, height: 951)), CGSize(width: 669, height: 459.5), "the top page")
        XCTAssertNil(ServerGate.page(CGSize(width: 466, height: 678)), "the folded Duo is one screen")
        XCTAssertNil(ServerGate.page(CGSize(width: 932, height: 430)), "a phone in landscape is one screen")
    }
}
