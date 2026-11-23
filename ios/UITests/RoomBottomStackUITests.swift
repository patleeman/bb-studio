import XCTest

final class RoomBottomStackUITests: ServerIsolatedUITestCase {
    private let app = XCUIApplication()
    private var duo: Bool { ProcessInfo.processInfo.environment["ROOM_DUO"] != nil }
    private var theme: String { ProcessInfo.processInfo.environment["ROOM_THEME"] ?? "forest" }
    private var device: String { duo ? "duo" : "iphone" }

    private func launch() {
        app.launchArguments += ["-skipPushPrompt", "YES", "-qaBotDemo", "chat", "-qaSpacesDemo", "list", "-qaStrandsDemo", "-qaRoomTheme", theme]
        app.launchOffline()
        if !app.waitForRoom(timeout: 30) {
            app.terminate()
            app.launchOffline()
        }
        XCTAssertTrue(app.waitForRoom(timeout: 60), "the app opens on the room")
    }

    private func command(_ path: String, wait: TimeInterval = 2) {
        XCUIDevice.shared.system.open(URL(string: "bbstudio://qa-duo/" + path)!)
        Thread.sleep(forTimeInterval: wait)
    }

    private func shot(_ name: String) {
        guard let folder = ProcessInfo.processInfo.environment["ROOM_OUT"] else { return }
        let url = URL(fileURLWithPath: folder)
        try? FileManager.default.createDirectory(at: url, withIntermediateDirectories: true)
        try? XCUIScreen.main.screenshot().pngRepresentation.write(to: url.appendingPathComponent("\(device)-\(theme)-\(name).png"))
    }

    private func capture(_ name: String) {
        guard ProcessInfo.processInfo.environment["ROOM_OUT"] != nil else { return }
        command("capture?\(device)-\(theme)-\(name)", wait: 3)
    }

    private var keyboard: XCUIElement { app.keyboards.firstMatch }
    private var field: XCUIElement { app.textViews["composerField"] }
    private func any(_ id: String) -> XCUIElement { app.descendants(matching: .any)[id].firstMatch }

    private func geometry() throws -> [String: Any] {
        command("layout", wait: 0.5)
        let value = try XCTUnwrap(app.windows.firstMatch.value as? String)
        return try XCTUnwrap(JSONSerialization.jsonObject(with: Data(value.utf8)) as? [String: Any])
    }

    private func rect(_ value: Any?) -> CGRect? {
        guard let box = value as? [String: Any], let x = box["x"] as? Double, let y = box["y"] as? Double,
              let width = box["width"] as? Double, let height = box["height"] as? Double else { return nil }
        return CGRect(x: x, y: y, width: width, height: height)
    }

    private func transcript(_ when: String, file: StaticString = #filePath, line: UInt = #line) throws -> (layout: [String: Any], transcript: [String: Any]) {
        let layout = try geometry()
        let transcripts = try XCTUnwrap(layout["transcripts"] as? [[String: Any]], file: file, line: line)
        let transcript = try XCTUnwrap(transcripts.first { rect($0["stack"]).map { $0.width > 0 } ?? false }, "a transcript \(when)", file: file, line: line)
        return (layout, transcript)
    }

    private func jumpFrame(_ transcript: [String: Any]) -> CGRect? {
        if let pill = rect(transcript["pill"]) { return pill }
        let button = app.buttons["jumpToLatest"]
        return button.exists ? button.frame : nil
    }

    private func stackParts() -> [(String, CGRect)] {
        [("the strands box", any("strands-box")), ("the worker pill", any("conversationWorkers")), ("the composer", any("threadComposer"))]
            .filter { $0.1.exists }.map { ($0.0, $0.1.frame) }
    }

    private func assertTheJumpSitsAboveTheStack(_ when: String, file: StaticString = #filePath, line: UInt = #line) throws {
        Thread.sleep(forTimeInterval: 1.5)
        let (_, transcript) = try transcript(when, file: file, line: line)
        let stack = try XCTUnwrap(rect(transcript["stack"]), file: file, line: line)
        let jump = try XCTUnwrap(jumpFrame(transcript), "the ↓ shows while reading up \(when)", file: file, line: line)
        if transcript["jumpInline"] as? Bool == true {
            XCTAssertGreaterThanOrEqual(jump.minY, stack.minY - 0.5, "the ↓ (\(jump)) is in the stack (from \(stack.minY)), over no row \(when)", file: file, line: line)
            for (name, frame) in stackParts() {
                XCTAssertLessThanOrEqual(frame.intersection(jump).height, 0.5, "the ↓ (\(jump)) leaves \(name) (\(frame)) clear \(when)", file: file, line: line)
            }
        } else {
            XCTAssertLessThanOrEqual(jump.maxY, stack.minY + 0.5, "the ↓ (\(jump.minY)–\(jump.maxY)) sits above the stack (from \(stack.minY)) \(when)", file: file, line: line)
        }
    }

    private func assertClearOfTheStack(_ when: String, keyboardUp: Bool, file: StaticString = #filePath, line: UInt = #line) throws {
        Thread.sleep(forTimeInterval: 1.5)
        let (layout, transcript) = try transcript(when, file: file, line: line)
        let stack = try XCTUnwrap(rect(transcript["stack"]), file: file, line: line)
        let last = try XCTUnwrap(rect(transcript["lastRow"]), "the last row's frame \(when)", file: file, line: line)
        XCTAssertEqual(transcript["atEnd"] as? Bool, true, "the transcript is at its end \(when)", file: file, line: line)
        XCTAssertLessThanOrEqual(last.maxY, stack.minY + 0.5,
                                 "the last row (\(last.minY)–\(last.maxY)) ends above the bottom stack (from \(stack.minY)) \(when)", file: file, line: line)
        XCTAssertGreaterThanOrEqual((transcript["insetBottom"] as? Double) ?? 0, Double(stack.height) - 0.5,
                                    "the transcript's bottom inset holds the whole stack (\(stack.height)) \(when)", file: file, line: line)
        if let pill = rect(transcript["pill"]) {
            XCTAssertLessThanOrEqual(pill.maxY, stack.minY + 0.5, "the ↓ sits above the stack \(when)", file: file, line: line)
        }
        if keyboardUp {
            let top = try XCTUnwrap(layout["keyboardTop"] as? Double, file: file, line: line)
            XCTAssertLessThan(top, (layout["height"] as? Double) ?? 0, "the app saw the keyboard \(when)", file: file, line: line)
            XCTAssertLessThanOrEqual(Double(stack.maxY), top + 0.5, "the stack ends above the keyboard \(when)", file: file, line: line)
        }
    }

    private func expandStrands() {
        let toggle = app.buttons["strands-toggle"]
        XCTAssertTrue(toggle.waitForExistence(timeout: 20), "the strands box sits above the composer")
        if toggle.value as? String == "Collapsed", !keyboard.exists { toggle.tap() }
    }

    func testTheLastMessageStaysAboveTheStrandsBoxAndTheComposer() throws {
        launch()
        Thread.sleep(forTimeInterval: 8)
        shot("presence")
        if duo {
            command("landscape", wait: 10)
            capture("unfolded-presence")
            command("outer", wait: 4)
        }
        app.textViews["Message"].tap()
        XCTAssertTrue(field.waitForExistence(timeout: 10), "the chat stands up")
        XCTAssertTrue(keyboard.waitForExistence(timeout: 10), "the keyboard is up")
        let tip = app.buttons["Continue"]
        if tip.waitForExistence(timeout: 2) { tip.tap() }
        command("dismiss")
        expandStrands()
        command("bottom")
        try assertClearOfTheStack("with the keyboard down", keyboardUp: false)
        shot("chat-keyboard-down")
        command("mid", wait: 3)
        shot("chat-reading")
        command("bottom")

        field.tap()
        XCTAssertTrue(keyboard.waitForExistence(timeout: 10), "the keyboard is up again")
        try assertClearOfTheStack("with the keyboard up", keyboardUp: true)
        shot("chat-keyboard-up-empty")
        field.typeText("Looks good")
        try assertClearOfTheStack("with text in the composer", keyboardUp: true)
        shot("chat-keyboard-up-text")

        command("mid")
        field.tap()
        XCTAssertTrue(keyboard.waitForExistence(timeout: 10), "the keyboard is up while reading up")
        // The folded Duo's ↓ is on its side column, which hides it while you type: no ↓ to tap here.
        if !(duo || app.isFoldedDuo) {
            try assertTheJumpSitsAboveTheStack("with the keyboard up")
            shot("chat-keyboard-up-reading")
            app.buttons["jumpToLatest"].firstMatch.tap()
            try assertClearOfTheStack("after the ↓, with the keyboard up", keyboardUp: true)
        }

        guard duo else { return }
        command("landscape", wait: 4)
        command("activate?composerField")
        if !keyboard.waitForExistence(timeout: 5) { command("activate?composerField") }
        XCTAssertTrue(keyboard.waitForExistence(timeout: 10), "the keyboard on the unfolded Duo")
        try assertClearOfTheStack("unfolded, with the keyboard up", keyboardUp: true)
        capture("unfolded-keyboard-up")
        command("split-right", wait: 3)
        shot("unfolded-right-keyboard-up")
        command("dismiss", wait: 2)
        command("landscape", wait: 3)
        try assertClearOfTheStack("unfolded, with the keyboard down", keyboardUp: false)
        capture("unfolded-keyboard-down")
        command("mid", wait: 3)
        capture("unfolded-reading")
        command("split-right", wait: 3)
        shot("unfolded-right-keyboard-down")
        command("outer", wait: 3)
    }

    private func assertOneOpaqueStack(_ when: String, reading: Bool, file: StaticString = #filePath, line: UInt = #line) throws {
        Thread.sleep(forTimeInterval: 1.5)
        let (_, transcript) = try transcript(when, file: file, line: line)
        let stack = try XCTUnwrap(rect(transcript["stack"]), file: file, line: line)
        let band = try XCTUnwrap(rect(transcript["band"]), "a band behind the bottom stack \(when)", file: file, line: line)
        XCTAssertEqual(transcript["bandOpaque"] as? Bool, true, "the band is opaque, so no row shows between the stack's parts \(when)", file: file, line: line)
        XCTAssertLessThanOrEqual(band.minY, stack.minY + 0.5, "the band starts at the stack's top \(when)", file: file, line: line)
        XCTAssertGreaterThanOrEqual(band.maxY, stack.maxY - 0.5, "and runs under all of it \(when)", file: file, line: line)
        let workers = any("conversationWorkers")
        if workers.exists {
            XCTAssertGreaterThanOrEqual(workers.frame.minY, band.minY - 0.5, "the worker pill (\(workers.frame)) is in the stack, not over the chat \(when)", file: file, line: line)
        }
        if reading {
            let jump = try XCTUnwrap(jumpFrame(transcript), "the ↓ shows while reading up \(when)", file: file, line: line)
            // The folded Duo's ↓ is on its side column, not the band.
            if !app.isFoldedDuo {
                XCTAssertGreaterThanOrEqual(jump.minY, band.minY - 0.5, "the ↓ (\(jump)) is on the band (from \(band.minY)), over no row \(when)", file: file, line: line)
            }
            for (name, frame) in stackParts() {
                XCTAssertLessThanOrEqual(frame.intersection(jump).height, 0.5, "the ↓ (\(jump)) leaves \(name) (\(frame)) clear \(when)", file: file, line: line)
            }
        } else {
            let last = try XCTUnwrap(rect(transcript["lastRow"]), "the last row \(when)", file: file, line: line)
            XCTAssertEqual(transcript["atEnd"] as? Bool, true, "at the end \(when)", file: file, line: line)
            XCTAssertLessThanOrEqual(last.maxY, band.minY + 0.5, "the last row (to \(last.maxY)) ends above the stack (from \(band.minY)) \(when)", file: file, line: line)
            XCTAssertNil(transcript["pill"], "no ↓ at the end \(when)", file: file, line: line)
        }
    }

    private func setStrands(collapsed: Bool) {
        let toggle = app.buttons["strands-toggle"]
        XCTAssertTrue(toggle.waitForExistence(timeout: 20), "the strands box")
        if (toggle.value as? String == "Collapsed") != collapsed { toggle.tap() }
        Thread.sleep(forTimeInterval: 1)
    }

    private func readUp() {
        let window = app.windows.firstMatch.frame
        let start = app.coordinate(withNormalizedOffset: .zero).withOffset(CGVector(dx: window.width / 2, dy: window.height * 0.2))
        for _ in 0..<3 {
            start.press(forDuration: 0.05, thenDragTo: start.withOffset(CGVector(dx: 0, dy: window.height * 0.25)), withVelocity: .slow, thenHoldForDuration: 0.2)
        }
        Thread.sleep(forTimeInterval: 1)
    }

    func testTheBottomStackIsOneOpaqueBandWithTheJumpInItsOwnLane() throws {
        launch()
        app.textViews["Message"].tap()
        XCTAssertTrue(field.waitForExistence(timeout: 10), "the chat stands up")
        let tip = app.buttons["Continue"]
        if tip.waitForExistence(timeout: 2) { tip.tap() }
        command("dismiss")
        for collapsed in [false, true] {
            let state = collapsed ? "collapsed" : "expanded"
            setStrands(collapsed: collapsed)
            command("bottom", wait: 2)
            try assertOneOpaqueStack("strands \(state), keyboard down, at the end", reading: false)
            shot("stack-inflight-\(state)-end")
            readUp()
            try assertOneOpaqueStack("strands \(state), keyboard down, reading up", reading: true)
            shot("stack-inflight-\(state)-reading")
            command("bottom", wait: 2)
            field.tap()
            XCTAssertTrue(keyboard.waitForExistence(timeout: 10), "the keyboard is up")
            try assertOneOpaqueStack("strands \(state), keyboard up, at the end", reading: false)
            shot("stack-inflight-\(state)-keyboard")
            readUp()
            // Not on the folded Duo, whose ↓ hides while you type.
            if keyboard.exists, !duo, !app.isFoldedDuo {
                try assertOneOpaqueStack("strands \(state), keyboard up, reading up", reading: true)
            }
            command("dismiss")
        }
    }

    func testAConversationWithoutWorkersHasTheSameStack() throws {
        app.launchArguments += ["-skipPushPrompt", "YES", "-qaBotDemo", "chat", "-qaSpacesDemo", "list", "-qaStrandsDemo", "-qaRoomTheme", theme,
                                "-qaRoomConversation", "thr_demo_interview", "-qaRoomMode", "read"]
        app.launchOffline()
        if !field.waitForExistence(timeout: 30) {
            app.terminate()
            app.launchOffline()
        }
        XCTAssertTrue(field.waitForExistence(timeout: 60), "Launch prep stands up")
        XCTAssertFalse(any("conversationWorkers").exists, "no worker pill here")
        command("bottom", wait: 2)
        try assertOneOpaqueStack("no pill, no strands, at the end", reading: false)
        shot("stack-plain-end")
    }
}
