import XCTest

/// The composer in a long thread served by `-qaBurstDemo` (local fixture, no server).
@MainActor
final class TypingBurstUITests: ServerIsolatedUITestCase {
    private var app = XCUIApplication()

    private func launch(_ arguments: [String]) {
        app = XCUIApplication()
        app.launchArguments += ["-skipPushPrompt", "YES", "-qaBurstDemo", "-openURL", "bbstudio://thread/thr_burstdemo1"] + arguments
        app.launchOffline()
    }

    private var composer: XCUIElement { app.textViews["Message"] }

    private func focusComposer() {
        XCTAssertTrue(app.navigationBars["Busy thread"].waitForExistence(timeout: 30), "the thread opens")
        command("focus?thr_burstdemo1")
        XCTAssertTrue(composer.waitForExistence(timeout: 10), "the composer takes the keyboard")
    }

    func testTypingDoesNotRedrawTheThread() {
        launch(["-qaBurstQuiet", "-qaBurstClearDraft"])
        focusComposer()
        Thread.sleep(forTimeInterval: 2)
        _ = counts(reset: true)
        composer.typeText("Typing in a long thread with large tables")
        Thread.sleep(forTimeInterval: 1)
        let typed = counts(reset: true)
        print("TYPING-COUNTS \(typed.sorted { $0.key < $1.key })")
        XCTAssertLessThanOrEqual(typed["thread.body"] ?? 0, 6, "41 keys redraw the composer, not the thread")
    }

    func testTypingDuringABurst() {
        launch([])
        XCTAssertTrue(app.navigationBars["Busy thread"].waitForExistence(timeout: 30), "the thread opens")
        Thread.sleep(forTimeInterval: 40)
        var result = counts(reset: false)
        let deadline = Date().addingTimeInterval(80)
        while result["burst.done"] == nil, Date() < deadline {
            Thread.sleep(forTimeInterval: 5)
            result = counts(reset: false)
        }
        XCTAssertEqual(result["burst.done"], 1, "the harness finished")
        let burst = result.filter { $0.key.hasPrefix("burst.") }.sorted { $0.key < $1.key }
        print("BURST-RESULT " + burst.map { "\($0.key)=\($0.value)" }.joined(separator: " "))
        XCTAssertLessThanOrEqual(result["burst.idle.threadBodies"] ?? .max, 6, "quiet typing doesn't redraw the thread")
    }

    func testTypingAndDraftSurvivesRelaunch() {
        launch(["-qaBurstQuiet", "-qaBurstClearDraft"])
        focusComposer()
        composer.typeText("Draft\nkept\nacross\na\nrelaunch")
        XCTAssertEqual(composer.value as? String, "Draft\nkept\nacross\na\nrelaunch")
        XCTAssertTrue(app.buttons["Expand"].waitForExistence(timeout: 5), "A five-line draft offers the full-screen composer")
        Thread.sleep(forTimeInterval: 2)
        app.terminate()

        launch(["-qaBurstQuiet"])
        focusComposer()
        XCTAssertEqual(composer.value as? String, "Draft\nkept\nacross\na\nrelaunch")
        composer.typeText("!")
        XCTAssertTrue((composer.value as? String)?.contains("!") == true, "Typing goes on in the restored draft")
    }

    private func counts(reset: Bool) -> [String: Int] {
        command("counts")
        let value = app.windows.firstMatch.value as? String ?? ""
        let counts = (try? JSONDecoder().decode([String: Int].self, from: Data(value.utf8))) ?? [:]
        if reset { command("counts?reset") }
        return counts
    }

    private func command(_ path: String) { XCUIDevice.shared.system.open(URL(string: "bbstudio://qa-duo/" + path)!) }
}
