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
        // Review S4: turned sideways, still the folded Duo (not an iPhone).
        let sideways = CGSize(width: outer.height, height: outer.width)
        XCTAssertEqual(ShellPosture.resolve(window: sideways, screen: sideways, phone: true, hinge: nil), .folded)
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
                       [.tabs, .home(lit: false), .new, .more], "9d: book and flat share one rule")
        XCTAssertEqual(RailLayout.slots(.flat, screen: .conversation(workbench: true), tabs: 3, homeShown: true),
                       [.tabs, .home(lit: true), .new, .more], "9e")
        XCTAssertEqual(RailLayout.slots(.phone, screen: .home, tabs: 0, homeShown: false), [], "no rail on the iPhone")
    }

    /// Review B1: anything pushed (not only a conversation) closes Home over
    /// the conversation, through `Router.path`.
    @MainActor func testEveryPushClosesHomeOverTheConversation() {
        for route: Route in [.place(.memory), .thread(id: "thr_w"), .settings, .studio, .conversation(id: "thr_c")] {
            let router = Router()
            router.homePane.toggle(fits: false)
            XCTAssertTrue(router.homePane.shown(fits: false))
            router.path = [route]
            XCTAssertFalse(router.homePane.shown(fits: false), "\(route) closes Home over the conversation")
        }
        let router = Router()
        router.path = [.conversation(id: "thr_c")]
        router.homePane.toggle(fits: false)
        router.openConversation("thr_c")
        XCTAssertFalse(router.homePane.shown(fits: false), "the same conversation picked again")
        router.homePane.toggle(fits: false)
        router.path = []
        XCTAssertTrue(router.homePane.shown(fits: false), "back to Home keeps Home")
    }

    func testHomeBesideOrOverTheConversation() {
        var pane = ShellHomePane()
        XCTAssertTrue(pane.shown(fits: true), "Home shows where it fits")
        XCTAssertFalse(pane.shown(fits: false), "and waits for the rail where it doesn't")
        pane.toggle(fits: false)
        XCTAssertTrue(pane.shown(fits: false), "the rail's Home brings it over the conversation")
        pane.pushed()
        XCTAssertFalse(pane.shown(fits: false), "a pick closes it")
        pane.toggle(fits: true)
        XCTAssertFalse(pane.shown(fits: true), "hidden by hand where it fits")
        pane.layoutChanged()
        XCTAssertFalse(pane.shown(fits: true), "a Home you hid yourself stays hidden")
        pane.toggle(fits: false)
        pane.layoutChanged()
        XCTAssertFalse(pane.shown(fits: false), "Home over the conversation ends with the layout")
    }

    func testTheComposersStatusLine() {
        let now = Date(timeIntervalSince1970: 1_000)
        XCTAssertEqual(ComposerStatus.working(since: 1_000_000 - 40_000, now: now), "Working · 40s")
        XCTAssertEqual(ComposerStatus.working(since: 1_000_000 - 72_000, now: now), "Working · 1m 12s")
        XCTAssertEqual(ComposerStatus.working(since: nil, now: now), "Working")
        XCTAssertFalse(ComposerStatus(running: false, since: nil, queued: 0).shown)
        XCTAssertTrue(ComposerStatus(running: false, since: nil, queued: 2).shown, "the queue alone shows the line")
    }

    /// Review B2: a share action in the rail is the share sheet, not a dead button.
    func testTheRailSharesAShareAction() {
        let url = URL(string: "https://example.com/transcript.txt")!
        XCTAssertEqual(RailControl(ScreenAction(id: "share", title: "Share", systemImage: "square.and.arrow.up", share: url)), .share(url))
        XCTAssertEqual(RailControl(ScreenAction(id: "edit", title: "Edit", systemImage: "pencil")), .button)
        XCTAssertEqual(RailControl(ScreenAction(id: "more", title: "More", systemImage: "ellipsis",
                                                children: [ScreenAction(id: "a", title: "A", systemImage: "a.circle")])), .menu)
    }

    /// The inner screen comes from the screen, not the window: beside another
    /// app in iOS's split our window is a page wide.
    func testTheInnerScreen() {
        for (screen, phone, inner) in [
            (CGSize(width: 951, height: 669), true, true),     // Duo inner screen
            (CGSize(width: 669, height: 951), true, false),    // inner screen, portrait
            (CGSize(width: 466, height: 678), true, false),    // Duo outer screen
            (CGSize(width: 402, height: 874), true, false),    // iPhone 18 Pro
            (CGSize(width: 956, height: 440), true, false),    // iPhone Pro Max, landscape
            (CGSize(width: 1366, height: 1024), false, false), // iPad, landscape
        ] {
            XCTAssertEqual(ShellGeometry.isInnerScreen(screen, phone: phone), inner, "\(screen) phone \(phone)")
        }
    }
}
