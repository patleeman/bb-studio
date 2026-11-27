import XCTest

/// Round 5, change 2, offline: a Bot conversation's header is Home and the
/// title; while a reply streams, Stop sits beside Send in the composer and
/// the title's second line says "Writing"; hands-free is first in "+".
/// `TEST_RUNNER_HEADER_OUT` keeps PNGs.
final class HeaderTwoControlsUITests: ServerIsolatedUITestCase {
    private let app = XCUIApplication()

    func testStopBesideSendWhileStreamingAndHandsFreeInPlus() throws {
        app.launchArguments = ["-skipPushPrompt", "YES", "-qaBotDemo", "chat", "-qaSpacesDemo", "list",
                               "-qaRoomConversation", "thr_botdemo01", "-qaDemoLatency", "400", "-qaDemoStream"]
        app.launchOffline()
        XCTAssertTrue(app.textViews["Message"].waitForExistence(timeout: 30))
        try XCTSkipIf(app.isFoldedDuo, "the folded Duo keeps its rail")
        XCTAssertTrue(app.buttons["roomList"].exists, "Home")
        XCTAssertTrue(app.buttons["conversationMore"].exists, "the title")
        XCTAssertFalse(app.buttons["composerStop"].exists, "no Stop while idle")

        XCUIDevice.shared.system.open(URL(string: "bbstudio://qa-duo/stream?Hello")!)
        let stop = app.buttons["composerStop"]
        XCTAssertTrue(stop.waitForExistence(timeout: 10), "Stop beside Send while a reply runs")
        let title = app.buttons["conversationMore"]
        XCTAssertTrue(title.label.contains("Writing"), title.label)
        XCTAssertFalse(app.navigationBars.buttons["Stop"].exists, "no Stop in the header")
        shot("1-streaming")
        stop.tap()
        XCTAssertTrue(stop.waitForNonExistence(timeout: 15), "Stop leaves when the turn ends")

        app.buttons["Attach"].firstMatch.tap()
        XCTAssertTrue(app.buttons["Talk hands-free"].waitForExistence(timeout: 5), "hands-free first in +")
        shot("2-plus")
    }

    private func shot(_ name: String) {
        guard let folder = ProcessInfo.processInfo.environment["HEADER_OUT"] else { return }
        sleep(1)
        let url = URL(fileURLWithPath: folder)
        try? FileManager.default.createDirectory(at: url, withIntermediateDirectories: true)
        try? XCUIScreen.main.screenshot().pngRepresentation.write(to: url.appendingPathComponent("\(name).png"))
    }
}
