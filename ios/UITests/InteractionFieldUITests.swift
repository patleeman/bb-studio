import XCTest

/// Patrick, Nov 1: he couldn't type into a secret request's field in the Bot
/// chat. A tap on a field in a pending interaction (a secret request, a
/// question's typed answer, the ask-user-question plugin's form) takes the
/// keyboard and keeps it, and what's typed stays. A tap on the transcript's
/// empty space still puts the keyboard away.
///
/// In the Bot chat the card rides over the composer; in a thread without a
/// Bot (`-qaBotDemo duo` alone) it's a row in the transcript. The new
/// transcript by default; `TEST_RUNNER_TRANSCRIPT_V2=0` the old one.
/// Fake values only.
@MainActor
final class InteractionFieldUITests: ServerIsolatedUITestCase {
    private let app = XCUIApplication()

    func testSecretFieldTakesTypingInTheBotChat() { secret(bot: true) }
    func testSecretFieldTakesTypingInATranscriptRow() { secret(bot: false) }
    func testQuestionAnswerTakesTypingInTheBotChat() { answer(kind: "question", bot: true, placeholder: "Or type an answer", send: "Send answer", texts: ["Which venue should I book for the Lisbon offsite?", "Decide later"]) }
    func testQuestionAnswerTakesTypingInATranscriptRow() { answer(kind: "question", bot: false, placeholder: "Or type an answer", send: "Send answer", texts: ["Which venue should I book for the Lisbon offsite?", "Decide later"]) }
    func testPluginQuestionTakesTypingInTheBotChat() { answer(kind: "plugin", bot: true, placeholder: "Your answer", send: "Send answer", texts: ["What should the offsite be called?"]) }
    func testPluginQuestionTakesTypingInATranscriptRow() { answer(kind: "plugin", bot: false, placeholder: "Your answer", send: "Send answer", texts: ["What should the offsite be called?"]) }

    // MARK: -

    private func secret(bot: Bool) {
        open("secret", bot: bot)
        let field = app.secureTextFields["Value"].firstMatch
        XCTAssertTrue(field.waitForExistence(timeout: 15), "The secret request's field is on screen")
        let save = app.buttons["Save"].firstMatch
        type("sk-test", into: field)
        // Masked: one dot a character.
        XCTAssertEqual((field.value as? String)?.count, 7, "The field holds what was typed (\(field.value ?? "nil"))")
        app.buttons["Show value"].firstMatch.tap()
        let shown = app.textFields["Value"].firstMatch
        XCTAssertTrue(shown.waitForExistence(timeout: 5))
        XCTAssertEqual(shown.value as? String, "sk-test", "Revealed, the value is what was typed")
        XCTAssertTrue(save.isEnabled, "Save is enabled once the field is filled")
        // Still holds after the chat's refreshes.
        Thread.sleep(forTimeInterval: 4)
        XCTAssertEqual(shown.value as? String, "sk-test", "The value survives the chat refreshing")
        // Revealing swaps the field; back in it, the keyboard stays.
        type("", into: shown)
        dismissOnEmptySpace(bot: bot, texts: ["The demo needs an API key.", "DEMO_API_KEY", "A fake key for the demo"])
    }

    private func answer(kind: String, bot: Bool, placeholder: String, send: String, texts: [String]) {
        open(kind, bot: bot)
        // A one-to-four-line field: a text view or a text field, by OS. Its
        // placeholder goes once something is typed.
        let target = app.descendants(matching: .any).matching(NSPredicate(format: "(elementType == %d OR elementType == %d) AND (placeholderValue == %@ OR label == %@ OR value == 'Lisbon')",
            XCUIElement.ElementType.textField.rawValue, XCUIElement.ElementType.textView.rawValue, placeholder, placeholder)).firstMatch
        XCTAssertTrue(target.waitForExistence(timeout: 15), "The answer field is on screen")
        let button = app.buttons[send].firstMatch
        type("Lisbon", into: target)
        XCTAssertEqual(target.value as? String, "Lisbon", "The field holds what was typed")
        XCTAssertTrue(button.isEnabled, "\(send) is enabled once answered")
        Thread.sleep(forTimeInterval: 4)
        XCTAssertEqual(target.value as? String, "Lisbon", "The answer survives the chat refreshing")
        dismissOnEmptySpace(bot: bot, texts: texts)
    }

    /// Taps the field, checks it kept the keyboard, and types.
    private func type(_ text: String, into field: XCUIElement) {
        // As Patrick had it: the composer has the keyboard, then the field is tapped.
        let composer = app.textViews.matching(NSPredicate(format: "label BEGINSWITH 'Message'")).firstMatch
        if !app.keyboards.firstMatch.exists {
            composer.tap()
            XCTAssertTrue(app.keyboards.firstMatch.waitForExistence(timeout: 5), "The composer took the keyboard")
        }
        field.tap()
        let keyboard = app.keyboards.firstMatch
        XCTAssertTrue(keyboard.waitForExistence(timeout: 5), "The keyboard came up")
        // The tap's dismissal, if any, runs a beat later.
        Thread.sleep(forTimeInterval: 1.5)
        XCTAssertTrue(keyboard.exists, "The field kept the keyboard")
        if !text.isEmpty { field.typeText(text) }
    }

    /// A tap on the transcript, away from any row's text field, still closes
    /// it. In a row, a tap on the card's own text counts: the first of
    /// `texts` that's clear of the header (a tall card reaches under it on a
    /// short screen). In the Bot chat the card rides over the composer; with
    /// the keyboard up on a phone it can reach under the header too, which
    /// leaves no transcript to tap.
    private func dismissOnEmptySpace(bot: Bool, texts: [String]) {
        XCTAssertTrue(app.keyboards.firstMatch.exists, "The keyboard is still up before the transcript tap")
        let label = app.staticTexts.matching(NSPredicate(format: "label CONTAINS %@ OR label CONTAINS %@", "An agent needs credentials", "BB has a question")).firstMatch
        let title = app.staticTexts["Juniper"].firstMatch
        let headerBottom = title.exists ? title.frame.maxY + 24 : 120
        if bot {
            guard label.frame.minY - headerBottom > 40 else {
                print("INTERACTION-FIELD no transcript above the card (\(label.frame.minY) under \(headerBottom)); tap skipped")
                return
            }
            app.coordinate(withNormalizedOffset: .zero).withOffset(CGVector(dx: app.frame.width - 12, dy: (headerBottom + label.frame.minY) / 2)).tap()
        } else {
            let text = texts.map { app.staticTexts[$0].firstMatch }.first { $0.exists && $0.frame.minY > headerBottom }
            XCTAssertNotNil(text, "Some of the card's text is clear of the header")
            text?.tap()
        }
        let gone = NSPredicate { _, _ in !self.app.keyboards.firstMatch.exists }
        expectation(for: gone, evaluatedWith: nil)
        waitForExpectations(timeout: 5) { _ in }
        XCTAssertFalse(app.keyboards.firstMatch.exists, "A tap on the transcript closed the keyboard")
    }

    private func open(_ kind: String, bot: Bool) {
        let duo = ProcessInfo.processInfo.environment["INTERACTION_LAYOUT"] == "outer"
        app.launchArguments = ["-skipPushPrompt", "YES", "-qaBotDemo", bot && !duo ? "chat" : "duo",
            "-qaDemoQuestion", kind, "-qaDark", "-openURL", bot ? "bbstudio://bot" : "bbstudio://thread/thr_botdemo01"]
        if bot && duo { app.launchArguments += ["-qaDuoPhone"] }
        app.launchOffline()
        let composer = app.textViews.matching(NSPredicate(format: "label BEGINSWITH 'Message'")).firstMatch
        XCTAssertTrue(composer.waitForExistence(timeout: 30))
        if duo { command("outer") }
    }

    private func command(_ path: String) { XCUIDevice.shared.system.open(URL(string: "bbstudio://qa-duo/" + path)!) }
}
