import XCTest

final class DuoAuditUITests: ServerIsolatedUITestCase {
    private let app = XCUIApplication()
    private var environment: [String: String] { ProcessInfo.processInfo.environment }

    override func setUpWithError() throws {
        try super.setUpWithError()
        guard environment["DUO_AUDIT_DIR"] != nil else { throw XCTSkip("set TEST_RUNNER_DUO_AUDIT_DIR on an iPhone Duo simulator") }
    }

    private func launch(_ extra: [String] = []) {
        app.launchArguments += ["-skipPushPrompt", "YES", "-qaBotDemo", "chat", "-qaSpacesDemo", "list", "-qaLoopsDemo",
                                "-qaRoomTheme", environment["ROOM_THEME"] ?? "forest"] + extra
        app.launchOffline()
        if !app.buttons["roomMic"].waitForExistence(timeout: 30) && !app.buttons["roomLayDown"].exists {
            app.terminate()
            app.launchOffline()
        }
        _ = app.buttons["roomMic"].waitForExistence(timeout: 30)
        sleep(2)
    }

    private func command(_ path: String, wait: UInt32 = 3) {
        XCUIDevice.shared.system.open(URL(string: "bbstudio://qa-duo/" + path)!)
        sleep(wait)
    }

    private func shot(_ name: String) {
        guard let folder = environment["DUO_AUDIT_DIR"] else { return }
        let base = URL(fileURLWithPath: folder)
        let request = base.appendingPathComponent("req/\(name)")
        let done = base.appendingPathComponent("done/\(name)")
        try? FileManager.default.removeItem(at: done)
        try? Data().write(to: request)
        let deadline = Date().addingTimeInterval(20)
        while !FileManager.default.fileExists(atPath: done.path) && Date() < deadline { usleep(200_000) }
        if !FileManager.default.fileExists(atPath: done.path) {
            try? XCUIScreen.main.screenshot().pngRepresentation.write(to: base.appendingPathComponent("xcui-\(name).png"))
        }
    }

    private func postures(_ name: String, unfoldedOnly: Bool = false) {
        if !unfoldedOnly { shot("\(name)-1-folded") }
        command("landscape")
        shot("\(name)-2-landscape")
        command("split-right")
        shot("\(name)-3-landscape-right")
        command("portrait")
        shot("\(name)-4-portrait")
        command("shift-portrait?0,476")
        shot("\(name)-5-portrait-bottom")
        command("outer")
        shot("\(name)-6-folded-again")
    }

    private func any(_ id: String) -> XCUIElement { app.descendants(matching: .any)[id].firstMatch }

    func testRest() { launch(); postures("room-rest") }
    func testMenu() { launch(["-qaRoomMode", "menu"]); postures("room-menu") }
    func testTalk() {
        launch()
        app.buttons["roomInput"].tap()
        _ = app.keyboards.firstMatch.waitForExistence(timeout: 10)
        sleep(1)
        postures("room-talk")
    }
    func testRead() { launch(["-qaRoomMode", "read"]); postures("room-read") }
    func testRecord() { launch(["-qaRoomMode", "recordLocked"]); postures("room-record") }

    func testPlaces() {
        let places = environment["DUO_AUDIT_PLACES"].map { $0.split(separator: ",").map(String.init) }
            ?? ["tasks", "conversations", "memory", "library", "schedules", "theme", "archive"]
        for place in places {
            app.terminate()
            app.launchArguments = []
            launch(["-qaRoomMode", place])
            sleep(2)
            postures("place-\(place)")
        }
    }

    func testSettings() {
        launch(["-qaRoomMode", "menu"])
        any("roomSettings").tap()
        sleep(3)
        postures("settings")
    }

    private func openConversation() {
        app.openRoomPlace("conversations")
        let row = app.buttons["roomConversation-thr_demo_interview"]
        if row.waitForExistence(timeout: 10) { row.tap() }
        sleep(3)
    }

    func testThread() {
        launch()
        openConversation()
        postures("thread")
    }

    func testThreadMenu() {
        launch()
        openConversation()
        let more = app.buttons["More"].firstMatch
        if more.waitForExistence(timeout: 5) { more.tap() }
        sleep(1)
        shot("thread-menu-1-folded")
        app.tap()
        command("landscape")
        let wide = app.buttons["More"].firstMatch
        if wide.waitForExistence(timeout: 5) { wide.tap() }
        sleep(1)
        shot("thread-menu-2-landscape")
        command("split-right")
        shot("thread-menu-3-landscape-right")
        command("outer")
        shot("thread-menu-6-folded-again")
    }

    func testThreadSheets() {
        launch()
        openConversation()
        let field = app.textViews["composerField"]
        if field.waitForExistence(timeout: 5) { field.tap() }
        sleep(2)
        shot("composer-1-folded")
        command("landscape")
        shot("composer-2-landscape")
        command("split-right")
        shot("composer-3-landscape-right")
        command("outer")
        shot("composer-6-folded-again")
        command("dismiss")
        let more = app.buttons["More"].firstMatch
        if more.waitForExistence(timeout: 5) { more.tap() }
        let model = app.buttons["menuModel"]
        if model.waitForExistence(timeout: 3) { model.tap() }
        sleep(2)
        postures("model-sheet")
    }

    func testModelSheet() {
        launch()
        openConversation()
        let more = app.buttons["More"].firstMatch
        if more.waitForExistence(timeout: 5) { more.tap() }
        let model = app.buttons["menuModel"]
        if model.waitForExistence(timeout: 3) { model.tap() }
        sleep(2)
        postures("model-picker")
    }

    func testAttach() {
        launch()
        openConversation()
        let field = app.textViews["composerField"]
        if field.waitForExistence(timeout: 5) { field.tap() }
        sleep(1)
        let plus = app.buttons.matching(NSPredicate(format: "identifier == 'composerAttach' OR label == 'Attach'")).firstMatch
        if plus.waitForExistence(timeout: 3) { plus.tap() }
        sleep(2)
        postures("attach")
    }

    func testWorker() {
        launch(["-qaRoomMode", "menu"])
        let worker = app.buttons["roomWorkingNow"]
        if worker.waitForExistence(timeout: 10) { worker.tap() }
        sleep(3)
        postures("worker")
    }

    func testLibraryItem() {
        launch(["-qaRoomMode", "library"])
        let tile = app.buttons.matching(NSPredicate(format: "identifier BEGINSWITH 'library-row-'")).firstMatch
        if tile.waitForExistence(timeout: 10) { tile.tap() }
        sleep(4)
        postures("library-item")
    }

    func testConversationActions() {
        launch()
        app.openRoomPlace("conversations")
        let row = app.buttons["roomConversation-thr_demo_interview"]
        if row.waitForExistence(timeout: 10) { row.swipeLeft() }
        sleep(1)
        shot("remove-swipe-1-folded")
        app.buttons["roomConversationDelete-thr_demo_interview"].firstMatch.tap()
        sleep(1)
        shot("remove-confirm-1-folded")
        command("landscape")
        shot("remove-confirm-2-landscape")
        command("split-right")
        shot("remove-confirm-3-landscape-right")
        command("outer")
        shot("remove-confirm-6-folded-again")
    }

    func testThreadMenuArchive() {
        launch()
        openConversation()
        let more = app.buttons["More"].firstMatch
        if more.waitForExistence(timeout: 5) { more.tap() }
        sleep(1)
        shot("thread-archive-1-folded")
        let context = app.buttons["Context"].firstMatch
        if context.waitForExistence(timeout: 3) { context.tap() }
        sleep(1)
        shot("thread-archive-1b-folded-context")
        app.coordinate(withNormalizedOffset: CGVector(dx: 0.1, dy: 0.1)).tap()
        sleep(1)
        if more.waitForExistence(timeout: 5) { more.tap() }
        if app.buttons["menuDelete"].waitForExistence(timeout: 3) { app.buttons["menuDelete"].tap() }
        sleep(1)
        shot("thread-delete-1-folded")
    }

    func testFoldKeepsTheRoom() {
        launch()
        app.buttons["roomMenuButton"].tap()
        sleep(2)
        shot("fold-menu-1-folded")
        command("landscape")
        shot("fold-menu-2-landscape")
        command("outer")
        shot("fold-menu-6-folded-again")
        NSLog("AUDIT menu after fold: close=\(app.buttons["roomMenuClose"].exists) button=\(app.buttons["roomMenuButton"].exists)")
        if app.buttons["roomMenuClose"].exists { app.buttons["roomMenuClose"].tap() }
        app.buttons["roomInput"].tap()
        sleep(2)
        command("landscape")
        shot("fold-talk-2-landscape")
        command("outer")
        shot("fold-talk-6-folded-again")
        NSLog("AUDIT talk after fold: layDown=\(app.buttons["roomLayDown"].exists) mic=\(app.buttons["roomMic"].exists)")
        command("landscape")
        command("outer")
        NSLog("AUDIT talk after second fold: layDown=\(app.buttons["roomLayDown"].exists) mic=\(app.buttons["roomMic"].exists)")
    }
}
