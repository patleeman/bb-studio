import XCTest

final class ComposerKeyboardUITests: ServerIsolatedUITestCase {
    private let app = XCUIApplication()
    private var duo: Bool { ProcessInfo.processInfo.environment["ROOM_DUO"] != nil }

    private var variant = ""

    private func launch(room: Bool) {
        variant = room ? "room" : "chat"
        app.launchArguments += ["-skipPushPrompt", "YES", "-qaBotDemo", "chat"]
            + (room ? ["-qaSpacesDemo", "list", "-qaLoopsDemo", "-qaRoomTheme", ProcessInfo.processInfo.environment["ROOM_THEME"] ?? "forest"] : [])
        let ready = room ? app.buttons["roomMic"] : field
        app.launchOffline()
        if !ready.waitForExistence(timeout: 30) {
            app.terminate()
            app.launchOffline()
        }
        XCTAssertTrue(ready.waitForExistence(timeout: 60), room ? "the app opens on the room" : "the app opens on the Bot chat")
    }

    private func shot(_ name: String) {
        guard let folder = ProcessInfo.processInfo.environment["ROOM_OUT"] else { return }
        let url = URL(fileURLWithPath: folder)
        try? FileManager.default.createDirectory(at: url, withIntermediateDirectories: true)
        try? XCUIScreen.main.screenshot().pngRepresentation.write(to: url.appendingPathComponent("keyboard-\(variant)-\(duo ? "duo" : "iphone")-\(name).png"))
    }

    private func command(_ path: String) {
        XCUIDevice.shared.system.open(URL(string: "bbstudio://qa-duo/" + path)!)
    }

    private var keyboard: XCUIElement { app.keyboards.firstMatch }
    private var field: XCUIElement { app.textViews["composerField"] }

    private func geometry() throws -> Geometry {
        command("layout")
        Thread.sleep(forTimeInterval: 0.5)
        let value = try XCTUnwrap(app.windows.firstMatch.value as? String)
        return try JSONDecoder().decode(Geometry.self, from: Data(value.utf8))
    }

    private func assertAboveTheKeyboard(_ when: String, onScreen: Bool = true, file: StaticString = #filePath, line: UInt = #line) throws {
        Thread.sleep(forTimeInterval: 1)
        XCTAssertTrue(keyboard.exists, "the keyboard is up \(when)", file: file, line: line)
        let layout = try geometry()
        let composer = try XCTUnwrap(layout.composers.first, "the composer's geometry \(when)", file: file, line: line)
        XCTAssertLessThan(layout.keyboardTop, layout.height, "the app saw the keyboard \(when)", file: file, line: line)
        XCTAssertLessThanOrEqual(composer.host.maxY, layout.keyboardTop + 0.5,
                                 "the composer (\(composer.host)) ends above the keyboard (top \(layout.keyboardTop)) \(when)", file: file, line: line)
        XCTAssertGreaterThanOrEqual(composer.field.y, composer.host.y - 0.5,
                                    "the field (\(composer.field)) starts inside the composer (\(composer.host)) \(when)", file: file, line: line)
        XCTAssertLessThanOrEqual(composer.field.maxY, composer.host.maxY - 4,
                                 "the field and its button row (\(composer.field)) end inside the composer (\(composer.host)) \(when)", file: file, line: line)
        XCTAssertLessThanOrEqual(composer.field.maxY, layout.keyboardTop - 4,
                                 "the field and its button row (\(composer.field)) end above the keyboard (top \(layout.keyboardTop)) \(when)", file: file, line: line)
        if onScreen {
            let send = app.buttons["Send"].firstMatch
            let hittable = expectation(for: NSPredicate(format: "isHittable == true"), evaluatedWith: send)
            XCTAssertEqual(XCTWaiter().wait(for: [hittable], timeout: 5), .completed, "Send can be tapped \(when)", file: file, line: line)
        }
    }

    private func key(_ labels: [String]) -> XCUIElement {
        for label in labels {
            let match = app.descendants(matching: .any).matching(NSPredicate(format: "label == %@ OR identifier == %@", label, label)).firstMatch
            if match.exists { return match }
        }
        return app.buttons[labels[0]]
    }

    private func focusOffScreen() {
        if keyboard.exists { return }
        command("activate?composerField")
        if !keyboard.waitForExistence(timeout: 5) { command("activate?composerField") }
    }

    private func standUpAgain() {
        if keyboard.exists { return }
        let input = app.buttons["roomInput"]
        if input.exists, input.isHittable { input.tap() } else { field.tap() }
    }

    private func clear() {
        for _ in 0..<4 {
            let left = (field.value as? String)?.count ?? 0
            guard left > 0 else { return }
            field.coordinate(withNormalizedOffset: CGVector(dx: 0.98, dy: 0.9)).tap()
            type(String(repeating: XCUIKeyboardKey.delete.rawValue, count: left + 2))
        }
    }

    private func type(_ text: String) {
        field.typeText(text)
    }

    func testTheRoomsChatKeepsSixLinesAboveTheKeyboard() throws {
        launch(room: true)
        app.buttons["roomInput"].tap()
        XCTAssertTrue(field.waitForExistence(timeout: 10), "the chat stands up")
        try typeSixLines()
    }

    func testTheBotChatKeepsSixLinesAboveTheKeyboard() throws {
        launch(room: false)
        field.tap()
        try typeSixLines()
    }

    private func typeSixLines() throws {
        addTeardownBlock { [self] in
            if field.exists, keyboard.exists { clear() }
        }
        XCTAssertTrue(keyboard.waitForExistence(timeout: 10), "the keyboard is up")
        let tip = app.buttons["Continue"]
        if tip.waitForExistence(timeout: 2) { tip.tap() }
        clear()
        XCTAssertEqual((field.value as? String)?.count ?? 0, 0, "an empty composer to start")
        Thread.sleep(forTimeInterval: 1)
        shot("empty")
        type("one")
        try assertAboveTheKeyboard("with one line")
        let oneLine = try XCTUnwrap(geometry().composers.first).field.height

        for (index, word) in ["two", "three", "four", "five", "six"].enumerated() {
            type("\n" + word)
            try assertAboveTheKeyboard("with \(index + 2) lines")
        }
        XCTAssertGreaterThan(try XCTUnwrap(geometry().composers.first).field.height, oneLine * 3, "the field grew")
        shot("six-lines")
        type("\nseven\neight")
        try assertAboveTheKeyboard("past the field's six-line limit")

        type(String(repeating: XCUIKeyboardKey.delete.rawValue, count: 12))
        try assertAboveTheKeyboard("after deleting back to six lines")

        if duo {
            command("landscape")
            Thread.sleep(forTimeInterval: 3)
            focusOffScreen()
            XCTAssertTrue(keyboard.waitForExistence(timeout: 10), "the keyboard on the unfolded Duo")
            try assertAboveTheKeyboard("unfolded, on the right page", onScreen: false)
            type("\nnine")
            try assertAboveTheKeyboard("typing on the right page", onScreen: false)
            command("split-right")
            Thread.sleep(forTimeInterval: 2)
            shot("unfolded-right-page")
            clear()
            Thread.sleep(forTimeInterval: 1)
            shot("unfolded-right-page-empty")
            type("one")
            Thread.sleep(forTimeInterval: 2)
            command("outer")
            Thread.sleep(forTimeInterval: 3)
            standUpAgain()
            XCTAssertTrue(keyboard.waitForExistence(timeout: 10), "the keyboard on the folded Duo again")
            try assertAboveTheKeyboard("folded again")
        }
        let emoji = key(["Emoji", "Next keyboard"])
        XCTAssertTrue(emoji.exists, "the emoji keyboard's key")
        emoji.tap()
        try assertAboveTheKeyboard("on the emoji keyboard")
        shot("emoji")
        let letters = key(["ABC", "letters", "Next keyboard"])
        XCTAssertTrue(letters.exists, "the letters' key")
        letters.tap()
        XCTAssertTrue(keyboard.keys.matching(NSPredicate(format: "label ==[c] 'q'")).firstMatch.waitForExistence(timeout: 5), "back on the letters")
        try assertAboveTheKeyboard("back on the letters", onScreen: false)

        type("\nseven")
        try assertAboveTheKeyboard("typing on the letters again", onScreen: false)
        clear()
    }

    private struct Geometry: Decodable {
        let height: CGFloat
        let keyboardTop: CGFloat
        let composers: [Composer]
    }
    private struct Composer: Decodable {
        let field: Rect
        let host: Rect
    }
    private struct Rect: Decodable, CustomStringConvertible {
        let x: CGFloat
        let y: CGFloat
        let width: CGFloat
        let height: CGFloat
        var maxY: CGFloat { y + height }
        var description: String { "y \(y)–\(maxY)" }
    }
}
