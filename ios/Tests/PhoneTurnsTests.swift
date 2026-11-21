import UserNotifications
import XCTest
@testable import BBStudio

/// Less lock-screen noise: the turns the phone started (the Bot Live Activity
/// follows only those), the Bot widget skipping `[PASS]`, and plain replies
/// staying out of the way while the app is open.
final class PhoneTurnsTests: XCTestCase {
    private let server = URL(string: "https://phone-turns.invalid")!
    private let other = URL(string: "https://phone-turns-other.invalid")!
    private var defaults: UserDefaults!
    private let suite = "PhoneTurnsTests"

    override func setUp() {
        super.setUp()
        defaults = UserDefaults(suiteName: suite)
        defaults.removePersistentDomain(forName: suite)
    }

    override func tearDown() {
        defaults.removePersistentDomain(forName: suite)
        super.tearDown()
    }

    // MARK: PhoneTurns

    func testRecordsAThreadPerServer() {
        let now = Date(timeIntervalSince1970: 1_800_000_000)
        PhoneTurns.record("thr_main", serverURL: server, at: now, defaults: defaults)
        XCTAssertEqual(PhoneTurns.active(serverURL: server, now: now + 5, defaults: defaults), ["thr_main": now])
        XCTAssertEqual(PhoneTurns.active(serverURL: other, now: now + 5, defaults: defaults), [:])
    }

    func testEntriesExpireAfterTheWindow() {
        let now = Date(timeIntervalSince1970: 1_800_000_000)
        PhoneTurns.record("thr_old", serverURL: server, at: now, defaults: defaults)
        PhoneTurns.record("thr_new", serverURL: server, at: now + 20 * 60, defaults: defaults)
        let later = now + PhoneTurns.window + 1
        XCTAssertEqual(Array(PhoneTurns.active(serverURL: server, now: later, defaults: defaults).keys), ["thr_new"])
    }

    func testClearForgetsFinishedTurns() {
        let now = Date.now
        PhoneTurns.record("thr_a", serverURL: server, at: now, defaults: defaults)
        PhoneTurns.record("thr_b", serverURL: server, at: now, defaults: defaults)
        PhoneTurns.clear(["thr_a"], serverURL: server, defaults: defaults)
        XCTAssertEqual(Array(PhoneTurns.active(serverURL: server, defaults: defaults).keys), ["thr_b"])
        PhoneTurns.clear(["thr_b"], serverURL: server, defaults: defaults)
        XCTAssertNil(defaults.object(forKey: PhoneTurns.key(server)))
    }

    func testSendingFromThePhoneRecordsTheTurn() async throws {
        let client = BBClient(baseURL: server)
        client.transport = { _, _, _ in (200, Data(#"{"ok":true,"delivery":"started"}"#.utf8)) }
        PhoneTurns.clear(["thr_sent"], serverURL: server)
        defer { PhoneTurns.clear(["thr_sent"], serverURL: server) }
        _ = try await client.send("thr_sent", text: "Hi")
        XCTAssertNotNil(PhoneTurns.active(serverURL: server)["thr_sent"])
    }

    func testAScheduledSendIsNotATurn() async throws {
        let client = BBClient(baseURL: server)
        client.transport = { _, _, _ in (200, Data(#"{"ok":true,"delivery":"scheduled"}"#.utf8)) }
        PhoneTurns.clear(["thr_later"], serverURL: server)
        _ = try await client.send("thr_later", text: "Later", at: .now + 3600)
        XCTAssertNil(PhoneTurns.active(serverURL: server)["thr_later"])
    }

    // MARK: Bot widget

    private func rows(_ json: String) throws -> [TimelineRow] {
        try JSONDecoder().decode([TimelineRow].self, from: Data(json.utf8))
    }

    func testBotWidgetSkipsAPassForTheLastRealReply() throws {
        let rows = try rows("""
        [{"id":"a1","kind":"conversation","role":"assistant","text":"The **deploy** is done.","createdAt":1000},
         {"id":"u1","kind":"conversation","role":"user","text":"Check in","createdAt":2000},
         {"id":"a2","kind":"conversation","role":"assistant","text":"[PASS]","createdAt":3000}]
        """)
        let reply = try XCTUnwrap(BotProvider.latestReply(rows))
        XCTAssertEqual(reply.id, "a1")
        XCTAssertEqual(BotProvider.history(rows, before: reply.id).map(\.id), [])
    }

    func testBotWidgetFallbackNeverShowsAPass() {
        XCTAssertNil(BotProvider.fallbackMessage("[PASS]"))
        XCTAssertNil(BotProvider.fallbackMessage(" `[pass]` "))
        XCTAssertNil(BotProvider.fallbackMessage(nil))
        XCTAssertEqual(BotProvider.fallbackMessage("All **set**"), "All set")
    }

    // MARK: Foreground notifications

    func testPlainRepliesGoToTheListWhileTheAppIsOpen() {
        XCTAssertEqual(NotificationActions.foregroundOptions(["kind": "turn-finished"], category: "BB_REPLY"), [.list])
        XCTAssertEqual(NotificationActions.foregroundOptions(["kind": "turn-finished"], category: ""), [.list])
    }

    func testNeedsYouBannersWhileTheAppIsOpen() {
        XCTAssertEqual(NotificationActions.foregroundOptions(["kind": "needs-you"], category: ""), [.banner, .sound])
        XCTAssertEqual(NotificationActions.foregroundOptions(["kind": "needs-you", "aps": ["category": ""]], category: nil), [.banner, .sound])
    }

    func testAsksErrorsAndTheRestStillBanner() {
        let loud: UNNotificationPresentationOptions = [.banner, .sound]
        XCTAssertEqual(NotificationActions.foregroundOptions(["kind": "pending-interaction"], category: "BB_APPROVAL"), loud)
        XCTAssertEqual(NotificationActions.foregroundOptions(["kind": "thread-error"], category: ""), loud)
        XCTAssertEqual(NotificationActions.foregroundOptions([:], category: ""), loud)
        // A needs-you that is really an ask.
        XCTAssertEqual(NotificationActions.foregroundOptions(["kind": "needs-you"], category: "BB_QUESTION"), loud)
        XCTAssertEqual(NotificationActions.foregroundOptions(["kind": "needs-you"], category: "BB_CHOICE.3"), loud)
        XCTAssertEqual(NotificationActions.foregroundOptions(["kind": "turn-finished", "aps": ["category": "BB_PLAN"]], category: ""), loud)
        XCTAssertEqual(NotificationActions.foregroundOptions(["kind": "needs-you", "category": "BB_LOOP"], category: ""), loud)
    }
}
