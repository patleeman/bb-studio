import XCTest

/// The composer's one status line in every state, offline (round 8 fix:
/// "this background pill takes up a ton of space and tells me nothing"):
/// background work is a part of the line ("1 in background"), never a row
/// of its own; while working it goes where the line has no room; idle it is
/// the line, and the line never leaves the composer's width, at the default
/// and an accessibility text size, on the iPhone and the Duo.
final class ComposerStatusUITests: ServerIsolatedUITestCase {
    private let app = XCUIApplication()

    private func any(_ id: String) -> XCUIElement { app.descendants(matching: .any)[id].firstMatch }

    /// `served`: the demo Bot behind a fake server, whose `busy` runs a turn with a background task.
    private func launch(_ extra: [String], size: String, served: Bool = false) {
        app.launchArguments = ["-skipPushPrompt", "YES", "-qaBotDemo", "chat", "-UIPreferredContentSizeCategoryName", size]
            + (served ? ["-qaDemoLatency", "50", "-openURL", "bbstudio://bot"] : ["-qaSpacesDemo", "list", "-qaConversation", "thr_botdemo01"])
            + extra
        app.launchOffline()
        XCTAssertTrue(app.textViews["Message"].waitForExistence(timeout: 30), "the conversation")
    }

    /// The line inside the composer, and nothing of it past the window.
    private func assertInside(_ state: String, file: StaticString = #filePath, line: UInt = #line) {
        let status = any("composerStatus")
        XCTAssertTrue(status.waitForExistence(timeout: 10), "\(state): the status line", file: file, line: line)
        let window = app.windows.firstMatch.frame
        for id in ["composerStatus", "composerWorking", "composerBackground", "composerQueued"] where any(id).exists {
            XCTAssertLessThanOrEqual(any(id).frame.maxX, window.maxX + 1, "\(state): \(id) inside the window", file: file, line: line)
        }
        XCTAssertFalse(any("chip-background").exists, "\(state): no background pill", file: file, line: line)
    }

    func testIdleWithBackgroundWorkAndAQueue() {
        for size in ["UICTContentSizeCategoryL", "UICTContentSizeCategoryAccessibilityXL"] {
            launch(["-qaShelfDemo", "-qaQueuedDemo"], size: size)
            assertInside("idle, \(size)")
            XCTAssertTrue(any("composerBackground").exists, "idle: the background part is the line, never dropped (\(size))")
            XCTAssertTrue(any("composerQueued").exists, "the queue (\(size))")
            XCTAssertFalse(any("composerWorking").exists)
            app.terminate()
        }
    }

    func testWorkingWithBackgroundWork() {
        for size in ["UICTContentSizeCategoryL", "UICTContentSizeCategoryAccessibilityXL"] {
            launch([], size: size, served: true)
            sleep(2)
            XCUIDevice.shared.system.open(URL(string: "bbstudio://qa-duo/busy?12")!)
            XCTAssertTrue(any("composerWorking").waitForExistence(timeout: 10), "working (\(size))")
            // The demo's task runs from its first second.
            sleep(3)
            assertInside("working, \(size)")
            if size == "UICTContentSizeCategoryL" {
                XCTAssertTrue(any("composerBackground").exists, "working: \"· 1 in background\" where it fits")
            }
            app.terminate()
        }
    }
}
