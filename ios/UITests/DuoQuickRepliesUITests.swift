import XCTest

/// The Duo's inner screen offline: the composer hides what the offline
/// fixture can't do. (The classic Bot chat's quick-reply row it also
/// measured is gone; replies are the transcript's What next? card.)
@MainActor
final class DuoQuickRepliesUITests: ServerIsolatedUITestCase {
    func testOfflineFixtureHidesUnavailableComposerCapabilities() {
        let app = XCUIApplication()
        app.launchArguments = ["-skipPushPrompt", "YES",
            "-qaBotDemo", "duo", "-qaDuoPhone", "-qaDuoColdWide", "-qaDark", "-openURL", "bbstudio://bot"]
        app.launchOffline()
        XCTAssertTrue(app.otherElements["threadComposer"].firstMatch.waitForExistence(timeout: 30))
        XCTAssertFalse(app.buttons["composerExpandToPage"].exists)
        XCTAssertFalse(app.buttons["Voice mode"].exists)
    }
}
