import XCTest

/// Visual Chat against a staged BB (`TEST_RUNNER_BBGO_QA_SERVER`) with the
/// studio-visual-chat plugin and a signed-in staged agent: the chat list, a
/// real board, the page while the agent writes it, and an older version.
/// Real turns, so it takes minutes. With `TEST_RUNNER_VC_OUT` naming a folder
/// it writes `<tag>-list.png`, `<tag>-streaming.png`, `<tag>-board.png` and
/// `<tag>-versions.png` there (`TEST_RUNNER_VC_TAG`, default "run");
/// `TEST_RUNNER_VC_DARK=1` runs in dark mode. The first run makes a chat with
/// `TEST_RUNNER_VC_FIRST`; every run then asks `TEST_RUNNER_VC_NEXT` in the
/// newest chat, so each has a page being written to catch.
@MainActor
final class VisualChatStillsUITests: StagedServerUITestCase {
    private let app = XCUIApplication()
    private var env: [String: String] { ProcessInfo.processInfo.environment }
    private func setting(_ name: String) -> String? { env["TEST_RUNNER_\(name)"] ?? env[name] }
    private var tag: String { setting("VC_TAG") ?? "run" }

    func testChatListBoardStreamingAndVersions() throws {
        app.launchArguments += ["-skipPushPrompt", "YES", "-openURL", "bbstudio://studio"]
        if setting("VC_DARK") == "1" { app.launchArguments += ["-qaDark"] }
        app.launchStaged(server: qaServer)

        let card = app.buttons["studioVisualChat"]
        XCTAssertTrue(card.waitForExistence(timeout: 60), "the Studio tab has Visual Chat")
        card.tap()
        let newChat = app.buttons["visualChatNew"]
        XCTAssertTrue(newChat.waitForExistence(timeout: 20))
        let row = app.buttons["visualChatRow"].firstMatch
        _ = row.waitForExistence(timeout: 5)
        save("list")

        let state = app.staticTexts["visualChatBoardState"]
        if row.exists {
            row.tap()
            XCTAssertTrue(waitFor(state, timeout: 60) { $0.hasPrefix("page rev") }, "the chat's board shows")
        } else {
            newChat.tap()
            ask(setting("VC_FIRST") ?? "Compare the Game Boy Color and the Game Boy Advance for a collector on a budget.")
            XCTAssertTrue(waitFor(state, timeout: 120) { $0.hasPrefix("streaming") }, "the first page streams")
            XCTAssertTrue(waitForIdle(timeout: 300), "the first turn ends")
        }

        // A follow-up, caught while the agent writes it.
        // A new topic, so the agent writes a whole new page (a follow-up about the same things may only patch parts).
        ask(setting("VC_NEXT") ?? "Now show me the five Game Boy Advance games to start a collection with, as a wall of pictures.")
        XCTAssertTrue(waitFor(state, timeout: 180) { Self.step($0) >= 4 }, "the page streams")
        save("streaming")
        XCTAssertTrue(waitForIdle(timeout: 300), "the turn ends")
        sleep(3)
        save("board")
        // The window's real safe area on this device (the folded Duo's side column, if it is one), for the report.
        note("geometry", (state.value as? String) ?? "")

        let back = app.buttons["visualChatBack"]
        XCTAssertTrue(back.waitForExistence(timeout: 20), "there are versions to step through")
        back.tap()
        let version = app.staticTexts["visualChatVersion"]
        XCTAssertTrue(waitFor(version, timeout: 10) { !$0.hasPrefix(Self.last($0)) }, "an older version shows")
        sleep(3)
        save("versions")
    }

    private func ask(_ text: String) {
        let field = app.textFields["visualChatField"].exists ? app.textFields["visualChatField"] : app.textViews["visualChatField"]
        XCTAssertTrue(field.waitForExistence(timeout: 20))
        field.tap()
        field.typeText(text)
        app.buttons["visualChatSend"].tap()
    }

    /// The streaming step in "streaming rev 3 step 41".
    private static func step(_ label: String) -> Int {
        guard label.hasPrefix("streaming"), let last = label.split(separator: " ").last else { return 0 }
        return Int(last) ?? 0
    }

    /// "3" in "2 of 3".
    private static func last(_ label: String) -> String { String(label.split(separator: " ").last ?? "") }

    private func waitForIdle(timeout: TimeInterval) -> Bool {
        let send = app.buttons["visualChatSend"]
        let state = app.staticTexts["visualChatBoardState"]
        return waitFor(state, timeout: timeout) { label in
            label.hasPrefix("page rev") && !self.app.activityIndicators.firstMatch.exists && send.exists
        }
    }

    private func waitFor(_ element: XCUIElement, timeout: TimeInterval, _ test: (String) -> Bool) -> Bool {
        let end = Date().addingTimeInterval(timeout)
        while Date() < end {
            if element.exists, test(element.label) { return true }
            usleep(250_000)
        }
        return false
    }

    private func note(_ name: String, _ text: String) {
        let attachment = XCTAttachment(string: text)
        attachment.name = "\(tag)-\(name)"
        attachment.lifetime = .keepAlways
        add(attachment)
        guard let folder = setting("VC_OUT") else { return }
        try? Data(text.utf8).write(to: URL(fileURLWithPath: folder).appending(path: "\(tag)-\(name).txt"))
    }

    private func save(_ name: String) {
        let shot = XCUIScreen.main.screenshot()
        let attachment = XCTAttachment(screenshot: shot)
        attachment.name = "\(tag)-\(name)"
        attachment.lifetime = .keepAlways
        add(attachment)
        guard let folder = setting("VC_OUT") else { return }
        try? FileManager.default.createDirectory(atPath: folder, withIntermediateDirectories: true)
        try? shot.pngRepresentation.write(to: URL(fileURLWithPath: folder).appending(path: "\(tag)-\(name).png"))
    }
}
