import XCTest
@testable import BBStudio

/// The posture from the window, the screen and the hinge; Home beside or
/// over the conversation; and the Router's tabs (round 8).
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
        XCTAssertEqual(ShellPosture.allCases.filter(\.splitsWorkbench), [.book, .flat])
        XCTAssertEqual(ShellPosture.allCases.filter(\.largeType), [.vertical])
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

    /// Round 8: Memory and Library are tabs; a push goes on the shown tab's
    /// stack (one Memory stack, folded or not), never twice in a row.
    @MainActor func testPlacesAreTabsAndPushesGoOnTheShownTab() {
        let router = Router()
        router.open(item: .page(.memory))
        XCTAssertEqual(router.tab, .memory)
        XCTAssertEqual(router.path, [], "not pushed over Home")
        router.push(.memorySkill(botId: "b", name: "s"))
        XCTAssertEqual(router.memoryPath, [.memorySkill(botId: "b", name: "s")])
        router.push(.memorySkill(botId: "b", name: "s"))
        XCTAssertEqual(router.memoryPath.count, 1, "a double tap pushes once")
        router.push(.memoryNewSkill(botId: "b"))
        XCTAssertEqual(router.memoryPath, [.memorySkill(botId: "b", name: "s"), .memoryNewSkill(botId: "b")])
        router.open(item: .page(.archive))
        XCTAssertEqual(router.tab, .home)
        XCTAssertEqual(router.path, [.place(.archive)], "Archive opens on Home")
        router.tab = .library
        router.openConversation("thr_c")
        XCTAssertEqual(router.tab, .home, "a conversation opens on Home's tab")
        XCTAssertEqual(router.path, [.conversation(id: "thr_c")])
    }

    func testHomeBesideOrOverTheConversation() {
        var pane = ShellHomePane()
        XCTAssertTrue(pane.shown(fits: true), "Home shows where it fits")
        XCTAssertFalse(pane.shown(fits: false), "and waits for its button where it doesn't")
        pane.toggle(fits: false)
        XCTAssertTrue(pane.shown(fits: false), "the bar's Home brings it over the conversation")
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
