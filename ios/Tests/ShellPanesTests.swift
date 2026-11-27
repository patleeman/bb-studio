import SwiftUI
import XCTest
@testable import BBStudio

/// The open Duo's panes by width and text size (round 7 fix: "the layout is
/// super cramped"). The Duo's inner screen is 951 pt wide; the rail keeps 84.
final class ShellPanesTests: XCTestCase {
    private let duo: CGFloat = 951 - ShellPosture.railWidth
    /// The Duo open upright: one screen's width.
    private let upright: CGFloat = 669 - ShellPosture.railWidth
    private let large: CGFloat = 17
    private let xxxLarge: CGFloat = 23
    private let accessibility: CGFloat = 33

    func testTheMinimumsScaleWithTheText() {
        XCTAssertEqual(ShellPanes.conversationMinimum(body: large), 481, "about 60 characters at 17 pt")
        XCTAssertGreaterThan(ShellPanes.conversationMinimum(body: xxxLarge), ShellPanes.conversationMinimum(body: large))
        XCTAssertGreaterThan(ShellPanes.homeMinimum(body: xxxLarge), ShellPanes.homeMinimum(body: large))
        XCTAssertGreaterThan(ShellPanes.sideMinimum(body: xxxLarge), ShellPanes.sideMinimum(body: large))
        XCTAssertEqual(ShellPanes.body(.large), 17)
        XCTAssertEqual(ShellPanes.body(.xxxLarge), 23)
    }

    func testTheDuoSplitsAtTheDefaultSizeAndNotAtLargeText() {
        XCTAssertTrue(ShellPanes.splits(width: duo, body: large))
        XCTAssertFalse(ShellPanes.splits(width: duo, body: xxxLarge), "60 characters and a readable Workbench don't both fit")
        XCTAssertFalse(ShellPanes.splits(width: duo, body: accessibility))
        XCTAssertEqual(ShellPosture.flat.laidOut(width: duo, body: large), .flat)
        XCTAssertEqual(ShellPosture.book.laidOut(width: duo, body: large), .book)
        XCTAssertEqual(ShellPosture.flat.laidOut(width: duo, body: xxxLarge), .vertical, "one big column")
        XCTAssertEqual(ShellPosture.book.laidOut(width: duo, body: xxxLarge), .vertical)
        XCTAssertEqual(ShellPosture.vertical.laidOut(width: upright, body: large), .vertical)
        XCTAssertFalse(ShellPanes.splits(width: upright, body: 14), "upright, even small text gets one column")
        XCTAssertEqual(ShellPosture.folded.laidOut(width: duo, body: large), .folded)
        XCTAssertEqual(ShellPosture.phone.laidOut(width: duo, body: large), .phone)
    }

    func testAWorkbenchTabGivesTheConversationTheLargerShare() {
        let panes = ShellPanes.make(width: duo, body: large, side: true, home: true)
        XCTAssertEqual(panes.home, 0, "Home doesn't fit beside both: the rail brings it")
        XCTAssertFalse(panes.homeFits)
        XCTAssertEqual(panes.conversation + panes.side, duo)
        XCTAssertEqual(panes.conversation / duo, 0.58, accuracy: 0.01)
        XCTAssertGreaterThanOrEqual(panes.conversation, ShellPanes.conversationMinimum(body: large))
        XCTAssertGreaterThanOrEqual(panes.side, ShellPanes.sideMinimum(body: large))
    }

    func testNoTabThePhoneCanShowClaimsNoPane() {
        let panes = ShellPanes.make(width: duo, body: large, side: false, home: true)
        XCTAssertEqual(panes.side, 0)
        XCTAssertTrue(panes.homeFits)
        XCTAssertGreaterThanOrEqual(panes.home, ShellPanes.homeMinimum(body: large))
        XCTAssertGreaterThanOrEqual(panes.conversation, ShellPanes.conversationMinimum(body: large))
        XCTAssertEqual(panes.home + panes.conversation, duo)
        let hidden = ShellPanes.make(width: duo, body: large, side: false, home: false)
        XCTAssertEqual(hidden.conversation, duo, "Home hidden by hand: the conversation takes it all")
        XCTAssertTrue(hidden.homeFits)
    }

    func testThreePanesOnlyWhenAllMeetTheirMinimums() {
        let iPad: CGFloat = 1366 - ShellPosture.railWidth
        let panes = ShellPanes.make(width: iPad, body: large, side: true, home: true)
        XCTAssertGreaterThan(panes.home, 0)
        XCTAssertGreaterThan(panes.side, 0)
        XCTAssertEqual(panes.home + panes.conversation + panes.side, iPad)
        XCTAssertGreaterThanOrEqual(panes.conversation, ShellPanes.conversationMinimum(body: large))
        XCTAssertGreaterThan(panes.conversation, panes.side)
        let crowded = ShellPanes.make(width: iPad, body: accessibility, side: true, home: true)
        XCTAssertEqual(crowded.home, 0, "large text: Home gives way first")
    }

    func testEveryWidthAndSizeKeepsTheMinimumsOrDropsAPane() {
        for size in DynamicTypeSize.allCases {
            let body = ShellPanes.body(size)
            for width in stride(from: CGFloat(700), through: 1400, by: 50) where ShellPanes.splits(width: width, body: body) {
                for side in [false, true] {
                    let panes = ShellPanes.make(width: width, body: body, side: side, home: true)
                    XCTAssertEqual(panes.home + panes.conversation + panes.side, width, accuracy: 0.5)
                    XCTAssertGreaterThanOrEqual(panes.conversation, ShellPanes.conversationMinimum(body: body))
                    if panes.home > 0 { XCTAssertGreaterThanOrEqual(panes.home, ShellPanes.homeMinimum(body: body)) }
                    if side { XCTAssertGreaterThanOrEqual(panes.side, ShellPanes.sideMinimum(body: body), "\(size) at \(width)") }
                }
            }
        }
    }

    func testHomeOverTheConversationIsNeverTheWholeWidth() {
        XCTAssertEqual(ShellPanes.overlayWidth(width: duo, body: large), (duo * 0.4).rounded())
        XCTAssertGreaterThanOrEqual(ShellPanes.overlayWidth(width: duo, body: large), ShellPanes.homeMinimum(body: large))
    }
}
