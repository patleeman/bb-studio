import XCTest

/// The vertical room in the Bot chat and a thread view, keyboard down and up,
/// on the folded Duo (an iPhone Duo simulator, whose screen is the 466 × 678
/// outer one) or an iPhone. Local demo data only (`-qaBotDemo chat
/// -qaDuoSpace`: a photo you sent with a long message, the Bot's two steps
/// and its reply); the server is a closed local port.
///
/// Checks that the composer rests on the home indicator's inset (not 8
/// points above it), one row until it's focused; that no row draws over
/// your message; and, on the folded Duo, that the header is one line with
/// its buttons in the right column, where back works from a thread the Bot
/// tab opened. With
/// `TEST_RUNNER_DUO_SPACE_OUT` naming a folder, it also writes PNGs and a
/// JSON of measured frames as `<TAG>-<device>-<surface>-kb<down|up>`:
/// `TEST_RUNNER_DUO_SPACE_TAG` names the build (before, fix, proposal),
/// `TEST_RUNNER_DUO_SPACE_ARGS` adds launch arguments (space separated), and `TEST_RUNNER_DUO_SPACE_IMAGE` serves the photo
/// (a local fixture server; without it the photo can't load).
@MainActor
final class DuoSpaceCaptureUITests: ServerIsolatedUITestCase {
    private let app = XCUIApplication()
    private var out: URL?
    private var tag = "run"
    private var device = "iphone"
    private var env: [String: String] { ProcessInfo.processInfo.environment }

    override func setUpWithError() throws {
        try super.setUpWithError()
        if let folder = env["DUO_SPACE_OUT"] {
            out = URL(fileURLWithPath: folder)
            try FileManager.default.createDirectory(at: out!, withIntermediateDirectories: true)
        }
        tag = env["DUO_SPACE_TAG"] ?? "run"
        let size = XCUIScreen.main.screenshot().image.size
        device = abs(size.width - 466) < 1 && abs(size.height - 678) < 1 ? "duo" : "iphone"
        continueAfterFailure = true
    }

    func testBotChat() throws {
        try run(surface: "bot", url: "bbstudio://bot")
    }

    func testThreadView() throws {
        try run(surface: "thread", url: "bbstudio://thread/thr_botdemo01")
    }

    /// The photo comes in on a message already on screen (the same row id,
    /// reconfigured in place) while nothing scrolls. The Worked row after it
    /// must move down with it rather than draw over it.
    func testPhotoArrivesOnShownMessage() throws {
        launch(["-qaDemoLatency", "50", "-qaDemoMessages", "20", "-qaDuoSpaceLate"], url: "bbstudio://bot")
        XCTAssertTrue(app.textViews["composerField"].firstMatch.waitForExistence(timeout: 30))
        let bubble = yourMessage
        XCTAssertTrue(bubble.waitForExistence(timeout: 20))
        sleep(2)
        XCUIDevice.shared.system.open(URL(string: "bbstudio://qa-duo/space-photo")!)
        XCTAssertTrue(app.descendants(matching: .any)["Attached image"].firstMatch.waitForExistence(timeout: 10))
        sleep(2)
        write(XCUIScreen.main.screenshot(), "late-photo")
        assertNothingOver(bubble)
    }

    /// The photo's row starts above the view, unmeasured. Scrolling up to it
    /// never draws the Worked row over it.
    func testScrollUpToPhoto() throws {
        launch(["-qaDuoSpaceTail"], url: "bbstudio://bot")
        XCTAssertTrue(app.textViews["composerField"].firstMatch.waitForExistence(timeout: 30))
        sleep(2)
        let bubble = yourMessage
        let window = app.windows.firstMatch
        var seen = false
        for _ in 0..<14 {
            window.coordinate(withNormalizedOffset: CGVector(dx: 0.4, dy: 0.35))
                .press(forDuration: 0.05, thenDragTo: window.coordinate(withNormalizedOffset: CGVector(dx: 0.4, dy: 0.6)))
            usleep(400_000)
            if bubble.exists, bubble.frame.maxY > 0, bubble.frame.minY < window.frame.maxY {
                seen = true
                assertNothingOver(bubble)
            }
        }
        XCTAssertTrue(seen, "Scrolled up to your message")
    }

    /// The folded Duo: a thread the Bot started opens inside the Bot tab,
    /// and the column's back returns to the chat.
    func testFoldedBackFromThreadInBotTab() throws {
        guard device == "duo" else { throw XCTSkip("Folded Duo only (466 × 678)") }
        app.launchArguments = ["-skipPushPrompt", "YES", "-qaBotDemo", "chat", "-qaDark", "-qaReduceMotion", "-openURL", "bbstudio://bot"]
        app.launchOffline()
        let title = app.staticTexts["foldedChatTitle"]
        XCTAssertTrue(title.waitForExistence(timeout: 30))
        XCTAssertTrue(title.label.hasPrefix("Juniper"))
        let started = app.buttons.matching(NSPredicate(format: "label CONTAINS %@", "Lisbon offsite options")).firstMatch
        XCTAssertTrue(started.waitForExistence(timeout: 10))
        started.tap()
        let back = app.buttons["folded-back"]
        XCTAssertTrue(back.waitForExistence(timeout: 10), "The thread has back in the column")
        XCTAssertFalse(app.buttons["Hands-free"].exists, "The Bot's buttons go with its chat")
        back.tap()
        expectation(for: NSPredicate(format: "exists == true AND label BEGINSWITH 'Juniper'"), evaluatedWith: app.staticTexts["foldedChatTitle"])
        waitForExpectations(timeout: 10)
        XCTAssertTrue(app.buttons["Hands-free"].waitForExistence(timeout: 5), "Back in the Bot's chat")
    }

    // MARK: -

    private var yourMessage: XCUIElement {
        app.descendants(matching: .any).matching(NSPredicate(format: "label BEGINSWITH 'You: Mobile app'")).firstMatch
    }

    private func launch(_ extra: [String], url: String) {
        var arguments = ["-skipPushPrompt", "YES", "-qaBotDemo", "chat", "-qaDuoSpace", "-qaBotAttention", "-qaDark",
                         "-qaReduceMotion", "-openURL", url] + extra
        if let image = env["DUO_SPACE_IMAGE"] { arguments += ["-qaDuoSpaceImage", image] }
        arguments += (env["DUO_SPACE_ARGS"] ?? "").split(separator: " ").map(String.init)
        app.launchArguments = arguments
        app.launchOffline()
    }

    private func assertNothingOver(_ bubble: XCUIElement, file: StaticString = #filePath, line: UInt = #line) {
        let worked = app.buttons.matching(NSPredicate(format: "label BEGINSWITH 'Worked'")).allElementsBoundByIndex
        for row in worked where row.exists && row.frame.minY > bubble.frame.minY {
            XCTAssertGreaterThanOrEqual(row.frame.minY, bubble.frame.maxY - 1,
                                        "The Worked row (\(row.frame)) draws over your message (\(bubble.frame))", file: file, line: line)
        }
    }

    private func run(surface: String, url: String) throws {
        launch([], url: url)
        let composer = app.textViews["composerField"].firstMatch
        XCTAssertTrue(composer.waitForExistence(timeout: 30))
        let reply = app.staticTexts.matching(NSPredicate(format: "label CONTAINS %@", "chat fills the screen")).firstMatch
        XCTAssertTrue(reply.waitForExistence(timeout: 20), "The fixture's last reply is in")
        sleep(3)
        let card = app.otherElements["threadComposer"].firstMatch
        let window = app.windows.firstMatch
        let safeBottom = layoutValue("safeBottom") ?? 0
        let tabBar = app.tabBars.firstMatch
        if card.exists, safeBottom > 0 {
            if tabBar.exists, tabBar.frame.height > 0, tabBar.frame.minY < window.frame.maxY {
                // A phone's Bot tab: the composer stands on its tab bar.
                XCTAssertLessThan(card.frame.maxY, tabBar.frame.minY, "The composer clears the tab bar")
            } else {
                // Over a home indicator alone: the card rests on its inset.
                XCTAssertEqual(window.frame.maxY - card.frame.maxY, safeBottom, accuracy: 1.5,
                               "The composer rests on the home indicator's \(safeBottom)-point inset, no higher")
            }
        }
        if yourMessage.exists { assertNothingOver(yourMessage) }
        // One row until it's focused: no model chip yet.
        XCTAssertFalse(app.buttons["Model & permissions"].exists, "The composer is one row while it's not focused")
        if card.exists { XCTAssertLessThan(card.frame.height, 60, "One row: + field mic send") }
        if device == "duo" {
            XCTAssertTrue(app.staticTexts["foldedChatTitle"].exists, "One line for the name and status")
            XCTAssertEqual(app.navigationBars.count, 0, "No navigation bar on the folded Duo")
            XCTAssertTrue(app.buttons["Hands-free"].exists && app.buttons["bot-menu"].exists || surface == "thread",
                          "The Bot's buttons are in the column")
        }
        record(surface: surface, keyboard: "down")
        composer.tap()
        XCTAssertTrue(app.keyboards.firstMatch.waitForExistence(timeout: 10))
        sleep(2)
        XCTAssertTrue(app.buttons["Model & permissions"].exists, "The model chip shows with the keyboard")
        record(surface: surface, keyboard: "up")
    }

    /// A number from the window's geometry (`bbstudio://qa-duo/layout`).
    private func layoutValue(_ key: String) -> Double? {
        XCUIDevice.shared.system.open(URL(string: "bbstudio://qa-duo/layout")!)
        let window = app.windows.firstMatch
        for _ in 0..<20 {
            if let value = window.value as? String, let data = value.data(using: .utf8),
               let json = try? JSONSerialization.jsonObject(with: data) as? [String: Any], let number = json[key] as? Double {
                return number
            }
            usleep(200_000)
        }
        return nil
    }

    private func write(_ shot: XCUIScreenshot, _ suffix: String) {
        let attachment = XCTAttachment(screenshot: shot)
        attachment.name = "\(tag)-\(device)-\(suffix)"
        attachment.lifetime = .keepAlways
        add(attachment)
        guard let out else { return }
        try? shot.pngRepresentation.write(to: out.appending(path: "\(tag)-\(device)-\(suffix).png"))
    }

    private func record(surface: String, keyboard: String) {
        let name = "\(surface)-kb\(keyboard)"
        write(XCUIScreen.main.screenshot(), name)
        guard let out else { return }
        func rect(_ element: XCUIElement) -> [String: Double]? {
            guard element.exists else { return nil }
            let f = element.frame
            return ["x": f.minX, "y": f.minY, "w": f.width, "h": f.height]
        }
        var frames: [String: Any] = [:]
        frames["window"] = rect(app.windows.firstMatch)
        frames["composer"] = rect(app.otherElements["threadComposer"].firstMatch)
        frames["composerField"] = rect(app.textViews["composerField"].firstMatch)
        frames["send"] = rect(app.buttons["Send"].firstMatch)
        frames["keyboard"] = rect(app.keyboards.firstMatch)
        frames["navBar"] = rect(app.navigationBars.firstMatch)
        frames["tabBar"] = rect(app.tabBars.firstMatch)
        frames["worked"] = rect(app.buttons.matching(NSPredicate(format: "label BEGINSWITH 'Worked'")).firstMatch)
        frames["userBubble"] = rect(yourMessage)
        frames["photo"] = rect(app.descendants(matching: .any).matching(NSPredicate(format: "label == 'Attached image'")).firstMatch)
        frames["safeBottom"] = layoutValue("safeBottom")
        frames["buttons"] = app.buttons.allElementsBoundByIndex.prefix(60).compactMap { button -> [String: Any]? in
            guard button.exists, button.frame.width > 0 else { return nil }
            var r: [String: Any] = rect(button) ?? [:]
            r["label"] = button.label
            r["id"] = button.identifier
            return r
        }
        frames["texts"] = app.staticTexts.allElementsBoundByIndex.prefix(80).compactMap { text -> [String: Any]? in
            guard text.exists, text.frame.width > 0, text.frame.maxY > 0 else { return nil }
            var r: [String: Any] = rect(text) ?? [:]
            r["label"] = String(text.label.prefix(60))
            return r
        }
        let base = "\(tag)-\(device)-\(name)"
        if let data = try? JSONSerialization.data(withJSONObject: frames, options: [.sortedKeys, .prettyPrinted]) {
            try? data.write(to: out.appending(path: base + ".json"))
        }
        try? app.debugDescription.write(to: out.appending(path: base + ".tree.txt"), atomically: true, encoding: .utf8)
    }
}
