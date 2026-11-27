import XCTest

final class MicPermissionUITests: ServerIsolatedUITestCase {
    private let app = XCUIApplication()

    private func answerTheMicPrompt(_ button: String) {
        let springboard = XCUIApplication(bundleIdentifier: "com.apple.springboard")
        let choice = springboard.alerts.firstMatch.buttons[button]
        if choice.waitForExistence(timeout: 10) { choice.tap() }
    }

    func testTheFirstMicrophonePromptNeverCrashesAndADenialSaysWhatToDo() throws {
        guard let answer = ProcessInfo.processInfo.environment["MIC_ANSWER"] else { throw XCTSkip("run on a fresh simulator with the microphone reset") }
        app.launchArguments += ["-skipPushPrompt", "YES", "-qaBotDemo", "chat", "-qaSpacesDemo", "list"]
        app.launchOffline()
        XCTAssertTrue(app.waitForRoom(timeout: 60), "Main opens from Home")
        let mic = app.buttons["composerMic"]
        XCTAssertTrue(mic.waitForExistence(timeout: 60))
        mic.tap()
        answerTheMicPrompt(answer)
        if answer == "Don’t Allow" {
            let message = app.staticTexts.matching(NSPredicate(format: "label CONTAINS 'Microphone access is off'")).firstMatch
            XCTAssertTrue(message.waitForExistence(timeout: 8), "the denial says what to do")
            try? XCUIScreen.main.screenshot().pngRepresentation.write(to: URL(fileURLWithPath: "/tmp/mic-denied-message.png"))
        }
        sleep(3)
        XCTAssertEqual(app.state, .runningForeground, "the app is still running")
        // Still listening: the same button stops it.
        if mic.exists, mic.label != "Dictate" { mic.tap() }
        sleep(2)
        XCTAssertEqual(app.state, .runningForeground)
        XCTAssertTrue(mic.waitForExistence(timeout: 10), "back in the conversation")
        try? XCUIScreen.main.screenshot().pngRepresentation.write(to: URL(fileURLWithPath: "/tmp/mic-\(answer.hasPrefix("Don") ? "denied" : "allowed").png"))
    }
}
