import XCTest

/// The Attention Router, offline: `-qaLoopsDemo` answers `loops.*` from a
/// local store with the mockups' loops, in the `-qaBotDemo` chat. Cards and
/// their actions, Loops in the Bot's ⋯ menu and the Loops screen, the setting
/// turned off, Places, and the Duo's folded and unfolded layouts. Set
/// `TEST_RUNNER_BBGO_STATES_OUT` to a folder to keep a PNG of each state.
@MainActor
final class LoopsUITests: ServerIsolatedUITestCase {
    private let app = XCUIApplication()

    override func setUpWithError() throws {
        try super.setUpWithError()
        continueAfterFailure = false
    }

    // MARK: iPhone

    func testCardActionsPhone() throws {
        try launchPhone()
        let sam = card("loop_sam")
        scrollTo(sam)
        shot("iphone-cards")
        sam.buttons["Done"].tap()
        XCTAssertTrue(card("loop_sam").staticTexts.matching(NSPredicate(format: "label CONTAINS %@", "Done")).firstMatch.waitForExistence(timeout: 10)
            || text(containing: "Done · Reply to Sam").waitForExistence(timeout: 5), "Done collapses the card to one line")
        let undo = card("loop_sam").buttons["Undo"]
        XCTAssertTrue(undo.waitForExistence(timeout: 5))
        undo.tap()
        XCTAssertTrue(card("loop_sam").buttons["Done"].waitForExistence(timeout: 10), "Undo reopens it")

        // A decision with two options chooses inline.
        let deck = card("loop_deck")
        scrollTo(deck)
        deck.buttons["Choose Hudson Carpentry · $3,650 · starts Dec 1"].tap()
        XCTAssertTrue(text(containing: "Hudson Carpentry · Choose the deck contractor").waitForExistence(timeout: 10))

        // More than three options open Choose….
        let venue = card("loop_options")
        scrollTo(venue)
        venue.buttons["Choose…"].tap()
        XCTAssertTrue(app.buttons.matching(NSPredicate(format: "label CONTAINS %@", "Porto")).firstMatch.waitForExistence(timeout: 5))
        shot("iphone-choose")
        app.buttons.matching(NSPredicate(format: "label CONTAINS %@", "Porto")).firstMatch.tap()
        XCTAssertTrue(text(containing: "Porto · Pick the offsite venue").waitForExistence(timeout: 10))

        // Read: Got it.
        let read = card("loop_vendor")
        scrollTo(read)
        read.buttons["Got it"].tap()
        XCTAssertTrue(text(containing: "Got it · Vendor demo").waitForExistence(timeout: 10))
    }

    func testSnoozeHandOffAndNudgePhone() throws {
        try launchPhone()
        let sam = card("loop_sam")
        scrollTo(sam)
        sam.buttons["Snooze"].tap()
        XCTAssertTrue(app.buttons.matching(NSPredicate(format: "label CONTAINS %@", "When I'm home")).firstMatch.waitForExistence(timeout: 5))
        XCTAssertTrue(app.buttons.matching(NSPredicate(format: "label CONTAINS %@", "Tomorrow")).firstMatch.exists)
        XCTAssertFalse(text(containing: "at my Mac").exists, "When I'm at my Mac is phase 2")
        shot("iphone-snooze")
        app.buttons.matching(NSPredicate(format: "label CONTAINS %@", "Tonight")).firstMatch.tap()
        XCTAssertTrue(card("loop_sam").staticTexts.matching(NSPredicate(format: "label BEGINSWITH %@", "Snoozed · ")).firstMatch.waitForExistence(timeout: 10))

        // Hand off sits behind ⋯ on the phone.
        let deck = card("loop_deck")
        scrollTo(deck)
        XCTAssertFalse(deck.buttons["Hand off"].exists)
        let handOff = app.buttons.matching(NSPredicate(format: "label == %@", "Hand off…")).firstMatch
        for _ in 0..<3 where !handOff.exists {
            sleep(1)
            deck.buttons["More actions"].tap()
            _ = handOff.waitForExistence(timeout: 3)
        }
        XCTAssertTrue(app.buttons.matching(NSPredicate(format: "label == %@", "Drop")).firstMatch.exists, "Drop is behind ⋯ too")
        handOff.tap()
        let lead = app.buttons.matching(NSPredicate(format: "label == %@", "Larkspur lead")).firstMatch
        XCTAssertTrue(lead.waitForExistence(timeout: 5))
        lead.tap()
        XCTAssertTrue(text(containing: "Larkspur lead is on it").waitForExistence(timeout: 10))
        XCTAssertTrue(app.buttons["Take back"].firstMatch.exists)
        shot("iphone-progress")

        // Nudge drafts; it never sends.
        let lease = card("loop_lease")
        scrollTo(lease)
        lease.buttons["Nudge them"].tap()
        let composer = app.textViews.matching(NSPredicate(format: "label BEGINSWITH 'Message'")).firstMatch
        XCTAssertTrue(composer.waitForExistence(timeout: 5))
        XCTAssertTrue((composer.value as? String ?? "").contains("Draft a nudge about “Signed lease addendum”"))
        // Leave no draft behind for the next launch's renders.
        composer.tap()
        composer.typeText(String(repeating: XCUIKeyboardKey.delete.rawValue, count: (composer.value as? String ?? "").count + 2))
    }

    func testDiscussPhone() throws {
        try launchPhone()
        openLoopsFromMenu()
        XCTAssertTrue(header("Needs you now").waitForExistence(timeout: 10))
        loopsScreen.staticTexts["Reply to Sam about the Q3 planning doc"].firstMatch.tap()
        XCTAssertTrue(app.buttons["Hand off"].waitForExistence(timeout: 5))
        app.buttons["More actions"].firstMatch.tap()
        let discuss = app.buttons["Discuss"]
        XCTAssertTrue(discuss.waitForExistence(timeout: 5), "Discuss is in the row's ⋯ menu")
        shot("iphone-row-discuss")
        // It switches to the chat and drafts the loop's line and title; it never sends.
        discuss.tap()
        let composer = app.textViews.matching(NSPredicate(format: "label BEGINSWITH 'Message'")).firstMatch
        XCTAssertTrue(composer.waitForExistence(timeout: 5))
        let draft = { composer.value as? String ?? "" }
        XCTAssertTrue(draft().contains("::loop{id=\"loop_sam\"}\nAbout: Reply to Sam about the Q3 planning doc"), draft())
        shot("iphone-discuss-draft")
        // Leave no draft behind for the next launch's renders.
        composer.typeText(String(repeating: XCUIKeyboardKey.delete.rawValue, count: draft().count + 2))
    }

    func testMorningCardPhone() throws {
        try launchPhone()
        let morning = app.descendants(matching: .any)["morning-card"]
        scrollTo(app.staticTexts["Monday, Nov 2"])
        XCTAssertTrue(morning.staticTexts["Monday, Nov 2"].exists)
        XCTAssertTrue(morning.staticTexts["ON TODAY'S LIST"].exists)
        XCTAssertTrue(morning.staticTexts["Pay the property tax installment"].waitForExistence(timeout: 10))
        shot("iphone-morning")
        scrollTo(app.buttons["morning-more"])
        app.buttons["morning-more"].tap()
        XCTAssertTrue(app.descendants(matching: .any)["loops-screen"].waitForExistence(timeout: 10), "+N more opens Loops")
    }

    func testLoopsScreenPhone() throws {
        try launchPhone(extra: ["-qaPlacesDemo"])
        // The ⋯ carries the Needs you now count, and so does its Loops item.
        let menu = app.buttons["bot-menu"].firstMatch
        XCTAssertTrue(menu.waitForExistence(timeout: 20))
        XCTAssertTrue(menu.label.contains("6 todos need you"), "Needs you now count: \(menu.label)")
        XCTAssertFalse(app.descendants(matching: .any)["bot-switch-loops"].exists, "No Chat | Loops bar")
        menu.tap()
        let item = app.buttons.matching(NSPredicate(format: "label BEGINSWITH %@", "Todos")).firstMatch
        XCTAssertTrue(item.waitForExistence(timeout: 5))
        XCTAssertTrue(item.label.contains("6"), "Loops item count: \(item.label)")
        item.tap()
        XCTAssertTrue(header("Needs you now").waitForExistence(timeout: 10))
        shot("iphone-loops")
        let plumber = app.staticTexts["Call the plumber about the slow drain"]
        scrollTo(plumber, older: false)
        XCTAssertTrue(app.staticTexts["When you get home"].exists)
        scrollTo(app.textFields["loops-add"])
        // Area filter.
        app.buttons["Larkspur"].tap()
        XCTAssertFalse(app.staticTexts["Call the plumber about the slow drain"].waitForExistence(timeout: 2))
        app.buttons["All"].tap()
        // A row's buttons, then Change trigger.
        loopsScreen.staticTexts["Reply to Sam about the Q3 planning doc"].firstMatch.tap()
        XCTAssertTrue(app.buttons["Hand off"].waitForExistence(timeout: 5))
        app.buttons["More actions"].firstMatch.tap()
        XCTAssertTrue(app.buttons["Surface now"].waitForExistence(timeout: 5))
        shot("iphone-row")
        app.buttons["Change trigger"].tap()
        XCTAssertTrue(app.buttons["Place"].waitForExistence(timeout: 5))
        app.buttons["Place"].tap()
        app.buttons.matching(NSPredicate(format: "label CONTAINS %@", "Home")).firstMatch.tap()
        let push = app.switches["Send to iPhone"]
        XCTAssertTrue(push.exists)
        if (push.value as? String) == "0" { push.switches.firstMatch.tap() }
        shot("iphone-trigger")
        app.buttons["Save"].tap()
        // It waits for home now, under Coming up.
        let moved = app.staticTexts["Reply to Sam about the Q3 planning doc"]
        scrollTo(moved, older: false)
        XCTAssertTrue(app.staticTexts.matching(NSPredicate(format: "label == %@", "When you get home")).count >= 2)
        scrollTo(app.textFields["loops-add"])
        // Add a loop goes to the Chief of Staff.
        let add = app.textFields["loops-add"]
        add.tap()
        add.typeText("call the dentist next week\n")
        let added = app.staticTexts["call the dentist next week"]
        scrollTo(added, older: false)
        XCTAssertTrue(added.exists, "A new loop goes to the Chief of Staff, under Agents on it")
        scrollTo(app.textFields["loops-add"])
        // Back goes to the chat.
        app.buttons["loops-back"].tap()
        XCTAssertFalse(app.descendants(matching: .any)["loops-screen"].waitForExistence(timeout: 2))
        scrollTo(card("loop_larkspur"))
    }

    func testEmptyLoopsPhone() throws {
        try launchPhone(extra: ["-qaLoopsEmpty"])
        openLoopsFromMenu()
        XCTAssertTrue(app.staticTexts["No open todos"].waitForExistence(timeout: 10))
        shot("iphone-loops-empty")
    }

    func testAttentionRouterOffPhone() throws {
        try launchPhone(mode: "off")
        XCTAssertTrue(app.descendants(matching: .any)["loop-card-off"].firstMatch.waitForExistence(timeout: 20))
        let menu = app.buttons["bot-menu"].firstMatch
        XCTAssertTrue(menu.exists)
        XCTAssertFalse(menu.label.contains("need you"), "No badge while it's off: \(menu.label)")
        menu.tap()
        XCTAssertTrue(app.buttons["Edit profile"].waitForExistence(timeout: 5))
        XCTAssertFalse(app.buttons.matching(NSPredicate(format: "label BEGINSWITH %@", "Todos")).firstMatch.exists, "No Loops in the menu while it's off")
        app.windows.firstMatch.coordinate(withNormalizedOffset: CGVector(dx: 0.3, dy: 0.6)).tap()
        XCTAssertFalse(app.buttons["Done"].exists)
        shot("iphone-off")
    }

    func testPlacesPhone() throws {
        guard UIDevice.current.userInterfaceIdiom == .phone else { throw XCTSkip("Phone only") }
        app.launchArguments = ["-skipPushPrompt", "YES", "-qaBotDemo", "chat", "-qaLoopsDemo", "-qaPlacesDemo", "-qaPlacesAccess", "whileUsing",
                               "-qaReduceMotion", "-openURL", "bbstudio://settings"]
        app.launchOffline()
        XCTAssertTrue(app.windows.firstMatch.waitForExistence(timeout: 20))
        if abs(app.windows.firstMatch.frame.width - 466) < 2 { throw XCTSkip("The Duo has its own tests") }
        let places = app.buttons["settingsPlaces"]
        XCTAssertTrue(places.waitForExistence(timeout: 20))
        shot("iphone-settings")
        places.tap()
        XCTAssertTrue(app.buttons["place-Home"].waitForExistence(timeout: 10))
        XCTAssertTrue(app.buttons["place-Mom's"].exists)
        XCTAssertTrue(text(containing: "4 of 20 places").exists)
        shot("iphone-places")
        // The explanation comes before any system prompt; Not now asks nothing.
        app.buttons["places-access"].tap()
        XCTAssertTrue(app.descendants(matching: .any)["location-explainer"].waitForExistence(timeout: 5))
        XCTAssertTrue(text(containing: "Change to Always Allow").exists)
        shot("iphone-permission")
        app.buttons["Not now"].tap()
        XCTAssertTrue(app.buttons["place-Home"].waitForExistence(timeout: 5))
        // Add a place: a pin on the map, a name and a radius.
        app.buttons["places-add"].tap()
        XCTAssertTrue(app.textFields["place-name"].waitForExistence(timeout: 5))
        XCTAssertTrue(app.buttons["Use current location"].exists)
        shot("iphone-place-editor")
    }

    // MARK: Duo

    func testDuoFolded() throws {
        try launchDuo()
        let deck = card("loop_deck")
        scrollTo(deck)
        duoShot("duo-folded-cards")
        openLoopsFromMenu()
        XCTAssertTrue(header("Needs you now").waitForExistence(timeout: 10))
        duoShot("duo-folded-loops")
        loopsScreen.staticTexts["Reply to Sam about the Q3 planning doc"].firstMatch.tap()
        XCTAssertTrue(app.buttons["Hand off"].waitForExistence(timeout: 5))
        duoShot("duo-folded-row")
        app.buttons["loops-back"].tap()
        let sam = card("loop_sam")
        scrollTo(sam)
        sam.buttons["Done"].tap()
        XCTAssertTrue(text(containing: "Done · Reply to Sam").waitForExistence(timeout: 10))
        scrollTo(app.staticTexts["Monday, Nov 2"])
        duoShot("duo-folded-morning")
    }

    func testDuoUnfolded() throws {
        try launchDuo()
        command("landscape")
        let window = app.windows.firstMatch
        expectation(for: NSPredicate { _, _ in abs(window.frame.width - 951) < 1 }, evaluatedWith: nil)
        waitForExpectations(timeout: 10)
        let allLoops = app.buttons["bot-all-loops"]
        XCTAssertTrue(allLoops.waitForExistence(timeout: 20))
        duoShot("duo-unfolded-cards")
        allLoops.tap()
        let needs = header("Needs you now")
        XCTAssertTrue(needs.waitForExistence(timeout: 10))
        XCTAssertLessThan(needs.frame.minX, 951 / 2, "Loops opens in the left pane")
        let larkspur = card("loop_larkspur")
        XCTAssertTrue(larkspur.waitForExistence(timeout: 10))
        XCTAssertGreaterThan(larkspur.frame.minX, 951 / 2, "The chat stays on the right")
        duoShot("duo-unfolded-loops")
        loopsScreen.staticTexts["Reply to Sam about the Q3 planning doc"].firstMatch.tap()
        XCTAssertTrue(app.buttons["Surface now"].firstMatch.waitForExistence(timeout: 5) || app.buttons["More actions"].firstMatch.exists)
        duoShot("duo-unfolded-row")
        app.buttons["loops-back"].tap()
        XCTAssertTrue(allLoops.waitForExistence(timeout: 10))
    }

    // MARK: Helpers

    private func launchPhone(mode: String? = nil, extra: [String] = []) throws {
        guard UIDevice.current.userInterfaceIdiom == .phone else { throw XCTSkip("Phone only") }
        app.launchArguments = ["-skipPushPrompt", "YES", "-qaBotDemo", "chat", "-qaLoopsDemo"] + (mode.map { [$0] } ?? []) + extra + ["-qaReduceMotion"]
        app.launchOffline()
        XCTAssertTrue(app.textViews.matching(NSPredicate(format: "label BEGINSWITH 'Message'")).firstMatch.waitForExistence(timeout: 25))
        if abs(app.windows.firstMatch.frame.width - 466) < 2 { throw XCTSkip("The Duo has its own tests") }
    }

    private func launchDuo() throws {
        app.launchArguments = ["-skipPushPrompt", "YES", "-qaBotDemo", "duo", "-qaDuoPhone", "-qaLoopsDemo", "-qaReduceMotion", "-openURL", "bbstudio://bot"]
        app.launchOffline()
        XCTAssertTrue(app.windows.firstMatch.waitForExistence(timeout: 20))
        guard abs(app.windows.firstMatch.frame.width - 466) < 2 else { throw XCTSkip("Duo only (466 × 678 outer screen)") }
        XCTAssertTrue(app.textViews.matching(NSPredicate(format: "label BEGINSWITH 'Message'")).firstMatch.waitForExistence(timeout: 25))
    }

    /// Loops from the Bot's ⋯ menu.
    private func openLoopsFromMenu() {
        let menu = app.buttons["bot-menu"].firstMatch
        XCTAssertTrue(menu.waitForExistence(timeout: 20))
        menu.tap()
        let item = app.buttons.matching(NSPredicate(format: "label BEGINSWITH %@", "Todos")).firstMatch
        XCTAssertTrue(item.waitForExistence(timeout: 5), "Loops is in the ⋯ menu")
        item.tap()
    }

    private func card(_ id: String) -> XCUIElement {
        app.descendants(matching: .any)["loop-\(id)"].firstMatch
    }

    private var loopsScreen: XCUIElement { app.descendants(matching: .any)["loops-screen"].firstMatch }

    private func header(_ title: String) -> XCUIElement {
        app.staticTexts.matching(NSPredicate(format: "label ==[c] %@", title)).firstMatch
    }

    private func text(containing value: String) -> XCUIElement {
        app.descendants(matching: .any).matching(NSPredicate(format: "label CONTAINS %@", value)).firstMatch
    }

    /// Scrolls the chat until the element is fully on screen.
    /// A chat opens at its newest message, so a missing element is looked for
    /// above (`older`); a list opens at its top, so below.
    private func scrollTo(_ element: XCUIElement, older: Bool = true) {
        let window = app.windows.firstMatch
        let height = window.frame.height
        let bottom = height * 0.3
        func drag(_ from: Double, _ to: Double) {
            window.coordinate(withNormalizedOffset: CGVector(dx: 0.45, dy: from))
                .press(forDuration: 0.05, thenDragTo: window.coordinate(withNormalizedOffset: CGVector(dx: 0.45, dy: to)), withVelocity: .slow, thenHoldForDuration: 0.3)
        }
        // Look the way it should be first, then the other way.
        for attempt in 0..<24 {
            // Clear of the header above, and the composer and tab bar below.
            if element.exists, element.frame.minY > 150, element.frame.maxY < height - bottom {
                // Let the scroll come to rest: a tap while it glides only stops it.
                usleep(800_000)
                return
            }
            // Clipped at the bottom: bring it up; at the top: bring it down.
            let towardOlder = element.exists ? element.frame.maxY <= height - bottom : (attempt < 10) == older
            if towardOlder { drag(0.3, 0.7) } else { drag(0.7, 0.35) }
        }
        XCTAssertTrue(element.waitForExistence(timeout: 5), "Scrolled to \(element)")
    }

    private func command(_ path: String) {
        XCUIDevice.shared.system.open(URL(string: "bbstudio://qa-duo/" + path)!)
    }

    /// The whole Duo window through UIKit (XCTest's capture clips to the outer display).
    private func duoShot(_ name: String) {
        guard ProcessInfo.processInfo.environment["BBGO_STATES_OUT"] != nil else { return }
        sleep(1)
        command("capture?loops-" + name)
        sleep(2)
    }

    private func shot(_ name: String) {
        guard let out = ProcessInfo.processInfo.environment["BBGO_STATES_OUT"] else { return }
        sleep(1)
        let folder = URL(fileURLWithPath: out)
        try? FileManager.default.createDirectory(at: folder, withIntermediateDirectories: true)
        try? XCUIScreen.main.screenshot().pngRepresentation.write(to: folder.appendingPathComponent(name + ".png"))
    }
}
