import XCTest

/// Two watchdog kills (0x8BADF00D, 10 s of main-thread CPU) on the Duo:
/// answering a Bot question with a long chat behind it, the thread view's
/// body ran without end, each pass rebuilding the whole chat; and a
/// safe-area recompute that never settled while folding or backgrounding.
/// Each step here counts the transcript's redraws and geometry writes
/// (`qa-duo/counts`) and fails if they don't settle once the step is over,
/// or if they grow with the chat's length.
@MainActor
final class TranscriptHangUITests: ServerIsolatedUITestCase {
    private let app = XCUIApplication()
    private var lines: [String] = []

    /// A question card over a 1,000-message chat: pick an option, type an
    /// answer with the keyboard up, put it away, type in the composer.
    func testAnsweringAQuestionInALongChatSettles() {
        open(messages: Self.messages ?? 1000)
        let option = app.buttons.matching(NSPredicate(format: "label CONTAINS 'Tivoli'")).firstMatch
        XCTAssertTrue(option.waitForExistence(timeout: 10), "The question card is up")
        settle("open")

        step("pick an option") { option.tap() }
        let answer = app.textViews["Or type an answer"].exists ? app.textViews["Or type an answer"] : app.textFields["Or type an answer"]
        XCTAssertTrue(answer.waitForExistence(timeout: 5), "The card takes a typed answer")
        step("answer field, keyboard up") { answer.tap() }
        step("type an answer") { answer.typeText("Tivoli, if the room fits twelve") }
        step("idle with the keyboard up") {}
        step("keyboard away") { command("dismiss") }
        let composer = app.textViews.matching(NSPredicate(format: "label BEGINSWITH 'Message'")).firstMatch
        step("composer, keyboard up") { composer.tap() }
        step("type in the composer") { composer.typeText("And book lunch") }
        step("keyboard away again") { command("dismiss") }
        finish()
    }

    /// The Duo's window changing with the keyboard up and a question waiting:
    /// fold and unfold, the split, the list's width, and back from the
    /// background. Every change must settle within a few frames.
    func testDuoWindowChangesWithTheKeyboardUpSettle() {
        open(messages: Self.messages ?? 600, duo: true)
        let composer = app.textViews.matching(NSPredicate(format: "label BEGINSWITH 'Message'")).firstMatch
        step("keyboard up") { composer.tap() }
        for cycle in 0..<2 {
            step("c\(cycle) unfold") { command("landscape") }
            step("c\(cycle) narrow list") { command("pane?narrow") }
            step("c\(cycle) even list") { command("pane?even") }
            step("c\(cycle) split") { command("split-right") }
            step("c\(cycle) portrait") { command("portrait") }
            step("c\(cycle) fold") { command("outer") }
            step("c\(cycle) keyboard up") { composer.tap() }
        }
        step("background and back") {
            XCUIDevice.shared.press(.home)
            Thread.sleep(forTimeInterval: 1.5)
            app.activate()
        }
        finish()
    }

    // MARK: -

    /// `TEST_RUNNER_HANG_MESSAGES`: a longer (or shorter) chat.
    private static let messages = ProcessInfo.processInfo.environment["HANG_MESSAGES"].flatMap(Int.init)

    private func open(messages: Int, duo: Bool = false) {
        app.launchArguments = ["-skipPushPrompt", "YES", "-qaBotDemo", duo ? "duo" : "chat", "-qaDemoQuestion",
            "-qaDemoMessages", "\(messages)", "-qaDark", "-openURL", "bbstudio://bot"]
        if duo { app.launchArguments += ["-qaDuoPhone"] }
        app.launchOffline()
        let composer = app.textViews.matching(NSPredicate(format: "label BEGINSWITH 'Message'")).firstMatch
        XCTAssertTrue(composer.waitForExistence(timeout: 30))
        if duo { command("outer") }
    }

    /// Lets what's running finish, so the next step counts only itself.
    private func settle(_ name: String) {
        Thread.sleep(forTimeInterval: 1.5)
        _ = counts(reset: true)
        lines.append("\(name): settled")
    }

    /// Runs `action`, then counts what it set off: during it and the 4 s
    /// after (`during`: a width change restores the reading position for
    /// about 2.6 s), and in the 2 s after that (`after`), when nothing should
    /// be moving. A loop keeps `after` climbing.
    private func step(_ name: String, _ action: () -> Void) {
        _ = counts(reset: true)
        action()
        Thread.sleep(forTimeInterval: 4)
        let during = counts(reset: true)
        Thread.sleep(forTimeInterval: 2)
        let after = counts(reset: true)
        let line = "\(name): during=\(describe(during)) after=\(describe(after))"
        lines.append(line)
        print("HANG-STEP " + line)
        // At rest the transcript doesn't redraw or write geometry. A few
        // from the end of a keyboard or window animation are fine.
        for (key, bound) in Self.restBounds where (after[key] ?? 0) > bound {
            XCTFail("\(name): \(key) ran \(after[key] ?? 0) times in 2 s at rest (bound \(bound))")
        }
        for (key, bound) in Self.stepBounds where (during[key] ?? 0) > bound {
            XCTFail("\(name): \(key) ran \(during[key] ?? 0) times in the step (bound \(bound))")
        }
    }

    /// What may still run once a step has settled: a stray frame or two.
    private static let restBounds = ["thread.body": 2, "botTimeline.body": 2, "root.body": 2, "botTab.body": 2,
                                     "write.window": 2, "geometry.end": 4, "keepAtEnd.scroll": 2, "scrollToBottom": 2,
                                     "scrollPosition.body": 2, "scrollPosition.writeBack": 2, "write.atBottom": 2]
    /// What a step itself may set off. The restore after a width change asks
    /// for the end 24 times; each of those used to redraw the whole thread.
    private static let stepBounds = ["thread.body": 30, "botTimeline.body": 30, "root.body": 6, "write.window": 6]

    private func finish() {
        print("HANG-SUMMARY\n" + lines.joined(separator: "\n"))
    }

    private func describe(_ counts: [String: Int]) -> String {
        counts.isEmpty ? "{}" : "{" + counts.sorted { $0.key < $1.key }.map { "\($0.key)=\($0.value)" }.joined(separator: " ") + "}"
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
