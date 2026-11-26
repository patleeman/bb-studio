import XCTest
@testable import BBStudio

/// Round 7: the posture from the window, the screen and the hinge, and the
/// rail's buttons in each posture, lowest first.
final class ShellPostureTests: XCTestCase {
    private let iPhone = CGSize(width: 402, height: 874)
    private let outer = ShellPosture.foldedScreen
    private let inner = CGSize(width: 951, height: 669)
    private let upright = CGSize(width: 669, height: 951)

    func testPostureFromTheWindowScreenAndHinge() {
        XCTAssertEqual(ShellPosture.resolve(window: iPhone, screen: iPhone, phone: true, hinge: nil), .phone)
        XCTAssertEqual(ShellPosture.resolve(window: outer, screen: outer, phone: true, hinge: .closed), .folded)
        XCTAssertEqual(ShellPosture.resolve(window: inner, screen: inner, phone: true, hinge: .partiallyOpen), .book)
        XCTAssertEqual(ShellPosture.resolve(window: inner, screen: inner, phone: true, hinge: .fullyOpen), .flat)
        XCTAssertEqual(ShellPosture.resolve(window: inner, screen: inner, phone: true, hinge: nil), .book,
                       "no hinge to read: the half-open book, the Duo's resting posture")
        XCTAssertEqual(ShellPosture.resolve(window: upright, screen: upright, phone: true, hinge: .fullyOpen), .vertical)
        XCTAssertEqual(ShellPosture.resolve(window: CGSize(width: 468, height: 669), screen: inner, phone: true, hinge: .fullyOpen), .phone,
                       "beside another app in iOS's split: one column")
        XCTAssertEqual(ShellPosture.resolve(window: CGSize(width: 1180, height: 820), screen: .zero, phone: false, hinge: nil), .flat,
                       "a wide iPad")
        XCTAssertEqual(ShellPosture.resolve(window: inner, screen: inner, phone: true, hinge: nil, forced: .flat), .flat, "-qaPosture")
    }

    func testWhatEachPostureLaysOut() {
        XCTAssertFalse(ShellPosture.phone.usesRail, "the iPhone keeps its one bar")
        XCTAssertTrue([ShellPosture.folded, .book, .flat, .vertical].allSatisfy(\.usesRail))
        XCTAssertEqual(ShellPosture.allCases.filter(\.splitsWorkbench), [.book, .flat])
        XCTAssertTrue(ShellPosture.vertical.largeType)
        XCTAssertEqual(ShellPosture.folded.titleLine, 40)
        XCTAssertEqual(ShellPosture.vertical.titleLine, 44)
    }

    func testTheRailLowestFirst() {
        XCTAssertEqual(RailLayout.slots(.folded, screen: .conversation(workbench: false), tabs: 3, homeShown: false),
                       [.workbench(tabs: 3), .home(lit: false), .more], "9c, Chat")
        XCTAssertEqual(RailLayout.slots(.folded, screen: .conversation(workbench: true), tabs: 3, homeShown: false),
                       [.chat, .home(lit: false), .tabs, .more], "9c, Workbench")
        // Pushed over another conversation (a reply thread, a worker): Back lowest.
        XCTAssertEqual(RailLayout.slots(.folded, screen: .conversation(workbench: false, over: true), tabs: 3, homeShown: false),
                       [.back, .workbench(tabs: 3), .home(lit: false), .more])
        XCTAssertEqual(RailLayout.slots(.vertical, screen: .home, tabs: 0, homeShown: false), [.new, .search], "9f, Home")
        XCTAssertEqual(RailLayout.slots(.book, screen: .conversation(workbench: true), tabs: 3, homeShown: false),
                       [.tabs, .home(lit: false), .more], "9d")
        XCTAssertEqual(RailLayout.slots(.book, screen: .conversation(workbench: true), tabs: 3, homeShown: true),
                       [.tabs, .home(lit: true), .new], "9d, Home shown: More becomes New")
        XCTAssertEqual(RailLayout.slots(.flat, screen: .conversation(workbench: true), tabs: 3, homeShown: true),
                       [.tabs, .home(lit: true), .new, .more], "9e")
        XCTAssertEqual(RailLayout.slots(.phone, screen: .home, tabs: 0, homeShown: false), [], "no rail on the iPhone")
    }

    func testHomeBesideTheConversation() {
        var pane = ShellHomePane()
        XCTAssertTrue(pane.shown(.flat), "flat shows Home")
        XCTAssertFalse(pane.shown(.book), "book hides it")
        pane.toggle(.book)
        XCTAssertTrue(pane.shown(.book), "Home in the rail brings it back")
        pane.pickedConversation()
        XCTAssertFalse(pane.shown(.book), "a picked conversation takes the page back")
        pane.toggle(.flat)
        XCTAssertFalse(pane.shown(.flat), "hidden by hand in flat")
        pane.postureChanged(from: .flat, to: .book)
        pane.postureChanged(from: .book, to: .flat)
        XCTAssertFalse(pane.shown(.flat), "a Home you hid yourself stays hidden")
        pane.toggle(.book)
        pane.postureChanged(from: .book, to: .flat)
        pane.postureChanged(from: .flat, to: .book)
        XCTAssertFalse(pane.shown(.book), "a book's request ends with the posture")
    }

    func testTheComposersStatusLine() {
        let now = Date(timeIntervalSince1970: 1_000)
        XCTAssertEqual(ComposerStatus.working(since: 1_000_000 - 40_000, now: now), "Working · 40s")
        XCTAssertEqual(ComposerStatus.working(since: 1_000_000 - 72_000, now: now), "Working · 1m 12s")
        XCTAssertEqual(ComposerStatus.working(since: nil, now: now), "Working")
        XCTAssertFalse(ComposerStatus(running: false, since: nil, queued: 0).shown)
        XCTAssertTrue(ComposerStatus(running: false, since: nil, queued: 2).shown, "the queue alone shows the line")
    }
}
