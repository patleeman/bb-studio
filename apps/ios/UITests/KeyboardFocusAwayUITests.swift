import XCTest

/// Patrick, Oct 26, the Duo's inner screen split with Safari: "the input
/// keeps hovering". The composer floated 500 points up with no keyboard on
/// screen: a keyboard's inset kept after the keyboard had gone. Focus the
/// composer, take the focus away (another app, the background, a window
/// resize), come back, and the composer must sit where it does with no
/// keyboard, or right on top of the keyboard if it came back.
///
/// Runs on a phone. With `TEST_RUNNER_TAP_LAYOUT=outer` or `split` (the
/// inner screen's two pages, shifted so the right page with the chat is on
/// the simulator's screen), on an iPhone Duo simulator.
/// `TEST_RUNNER_TAP_SHOTS=<dir>` saves screenshots.
@MainActor
final class KeyboardFocusAwayUITests: ServerIsolatedUITestCase {
    private let app = XCUIApplication()
    private let layout = ProcessInfo.processInfo.environment["TAP_LAYOUT"] ?? "phone"
    private var steps: [String] = []
    private var failures: [String] = []
    /// From the composer's bottom to the window's, with no keyboard.
    private var restingGap: CGFloat = 0
    /// From the composer's bottom to the keyboard's top, as first focused.
    private var focusedGap: CGFloat?

    private var composerField: XCUIElement {
        app.textViews.matching(NSPredicate(format: "label BEGINSWITH 'Message'")).firstMatch
    }
    private var composer: XCUIElement { app.otherElements["threadComposer"].firstMatch }

    func testTheComposerComesBackDownWhenFocusLeaves() {
        open()

        // The app goes to the background and comes back.
        focus("home")
        XCUIDevice.shared.press(.home)
        Thread.sleep(forTimeInterval: 1.5)
        app.activate()
        expectComposerPlaced("home and back")

        // Another app takes the keyboard, then this one is back in front.
        focus("other app")
        let safari = XCUIApplication(bundleIdentifier: "com.apple.mobilesafari")
        safari.activate()
        _ = safari.wait(for: .runningForeground, timeout: 15)
        let address = safari.textFields.firstMatch
        if address.waitForExistence(timeout: 5) { address.tap() }
        Thread.sleep(forTimeInterval: 1.5)
        app.activate()
        expectComposerPlaced("other app took the keyboard")
        command("dismiss")
        expectComposerPlaced("other app, keyboard closed here")

        // The window changes size under the keyboard, then it closes.
        if layout != "phone" {
            focus("resize")
            command(layout == "split" ? "outer" : "landscape")
            Thread.sleep(forTimeInterval: 1.5)
            command(layout == "split" ? "split-right" : layout)
            expectComposerPlaced("resized with the keyboard up")
            command("dismiss")
            expectComposerPlaced("resized, keyboard closed")
        }
        finish()
    }

    private func open() {
        app.launchArguments = ["-skipPushPrompt", "YES", "-qaScrollLog",
            "-qaBotDemo", layout == "phone" ? "chat" : "duo", "-qaDemoLatency", "300", "-qaDark", "-openURL", "bbstudio://bot"]
        if layout != "phone" { app.launchArguments.append("-qaDuoPhone") }
        if layout == "split" { app.launchArguments.append("-qaDuoColdWide") }
        app.launchOffline()
        XCTAssertTrue(composerField.waitForExistence(timeout: 30))
        if layout == "outer" { command("outer") }
        if layout == "split" { command("split-right") }
        Thread.sleep(forTimeInterval: 2)
        restingGap = windowHeight() - composer.frame.maxY
        steps.append(String(format: "resting gap %.1f (window %.0f)", restingGap, windowHeight()))
        shot("0-resting")
    }

    private func focus(_ step: String) {
        composerField.tap()
        let keyboard = app.keyboards.firstMatch
        if !keyboard.waitForExistence(timeout: 5) { failures.append("\(step): no keyboard") }
        Thread.sleep(forTimeInterval: 1)
        if focusedGap == nil, keyboard.exists {
            focusedGap = keyboard.frame.minY - composer.frame.maxY
            steps.append(String(format: "focused: composer %.1f above the keyboard", focusedGap ?? 0))
        }
    }

    /// With no keyboard, the composer sits where it rests; with one, right on
    /// top of it.
    private func expectComposerPlaced(_ step: String) {
        XCTAssertTrue(composer.waitForExistence(timeout: 10))
        Thread.sleep(forTimeInterval: 2)
        let keyboard = app.keyboards.firstMatch
        let gap = windowHeight() - composer.frame.maxY
        let line: String
        if keyboard.exists {
            let above = keyboard.frame.minY - composer.frame.maxY
            line = String(format: "%@: keyboard up, composer %.1f above it (focused %.1f)", step, above, focusedGap ?? .nan)
            if abs(above - (focusedGap ?? above)) > 2 { failures.append(line) }
        } else {
            line = String(format: "%@: no keyboard, composer gap %.1f (resting %.1f)", step, gap, restingGap)
            if abs(gap - restingGap) > 2 { failures.append(line) }
        }
        steps.append(line)
        print("FOCUS-STEP " + line)
        shot(step.replacingOccurrences(of: " ", with: "-").replacingOccurrences(of: ",", with: ""))
    }

    private func finish() {
        print("FOCUS-SUMMARY \(layout)\n" + steps.joined(separator: "\n"))
        XCTAssertEqual(failures, [], "\(layout):\n" + steps.joined(separator: "\n"))
    }

    private func windowHeight() -> CGFloat {
        command("layout")
        guard let value = app.windows.firstMatch.value as? String,
              let data = value.data(using: .utf8),
              let geometry = try? JSONSerialization.jsonObject(with: data) as? [String: Any],
              let height = geometry["height"] as? Double else { return app.windows.firstMatch.frame.height }
        return height
    }

    private func shot(_ name: String) {
        guard let dir = ProcessInfo.processInfo.environment["TAP_SHOTS"] else { return }
        try? XCUIScreen.main.screenshot().pngRepresentation
            .write(to: URL(fileURLWithPath: dir).appending(path: "focus-\(layout)-\(name).png"))
    }

    private func command(_ path: String) { XCUIDevice.shared.system.open(URL(string: "bbstudio://qa-duo/" + path)!) }
}
