import XCTest

final class RoomStackLineUITests: ServerIsolatedUITestCase {
    private let app = XCUIApplication()
    private var duo: Bool { ProcessInfo.processInfo.environment["ROOM_DUO"] != nil }
    private var failures: [String] = []
    private var steps: [String] = []
    private static let step = "Find AI-native engineering companies"

    private func launch() {
        app.launchArguments += ["-skipPushPrompt", "YES", "-qaBotDemo", "chat", "-qaSpacesDemo", "list", "-qaLoopsDemo", "-qaRoomTheme", "forest", "-qaDemoLatency", "50"]
        app.launchOffline()
        if !app.buttons["roomMic"].waitForExistence(timeout: 30) {
            app.terminate()
            app.launchOffline()
        }
        XCTAssertTrue(app.buttons["roomMic"].waitForExistence(timeout: 60), "the app opens on the room")
    }

    private func command(_ path: String, wait: TimeInterval = 2) {
        XCUIDevice.shared.system.open(URL(string: "bbstudio://qa-duo/" + path)!)
        Thread.sleep(forTimeInterval: wait)
    }

    private var device: String {
        if duo { return "duo" }
        return app.windows.firstMatch.frame.height < 700 ? "short" : "iphone"
    }

    private func shot(_ name: String) {
        guard let folder = ProcessInfo.processInfo.environment["ROOM_OUT"] else { return }
        let url = URL(fileURLWithPath: folder)
        try? FileManager.default.createDirectory(at: url, withIntermediateDirectories: true)
        try? XCUIScreen.main.screenshot().pngRepresentation.write(to: url.appendingPathComponent("\(device)-line-\(name).png"))
    }

    private func capture(_ name: String) {
        guard ProcessInfo.processInfo.environment["ROOM_OUT"] != nil else { return }
        command("capture?\(device)-line-\(name)", wait: 3)
    }

    private var keyboard: XCUIElement { app.keyboards.firstMatch }
    private var field: XCUIElement { app.textViews["composerField"] }
    private func any(_ id: String) -> XCUIElement { app.descendants(matching: .any)[id].firstMatch }

    private func rect(_ value: Any?) -> CGRect? {
        guard let box = value as? [String: Any], let x = box["x"] as? Double, let y = box["y"] as? Double,
              let width = box["width"] as? Double, let height = box["height"] as? Double else { return nil }
        return CGRect(x: x, y: y, width: width, height: height)
    }

    private func geometry() -> [String: Any]? {
        command("layout", wait: 0.5)
        guard let value = app.windows.firstMatch.value as? String else { return nil }
        return try? JSONSerialization.jsonObject(with: Data(value.utf8)) as? [String: Any]
    }

    private func keyboardTop() -> CGFloat? {
        guard let layout = geometry(), let top = layout["keyboardTop"] as? Double, let height = layout["height"] as? Double,
              top < height - 1 else { return nil }
        return CGFloat(top)
    }

    private func transcript() -> [String: Any]? {
        guard let layout = geometry() else { return nil }
        return (layout["transcripts"] as? [[String: Any]])?.filter { rect($0["stack"]).map { $0.width > 0 } ?? false }
            .max { (rect($0["stack"])?.minX ?? 0) < (rect($1["stack"])?.minX ?? 0) }
    }

    private func readUp() {
        let composer = any("threadComposer")
        if duo, app.windows.firstMatch.frame.width > 700 {
            command("mid", wait: 2)
            return
        }
        let top = composer.exists ? composer.frame.minY : app.windows.firstMatch.frame.height * 0.5
        let x = composer.exists ? composer.frame.midX : app.windows.firstMatch.frame.width / 2
        let start = app.coordinate(withNormalizedOffset: .zero).withOffset(CGVector(dx: x, dy: max(130, top * 0.35)))
        for _ in 0..<4 {
            start.press(forDuration: 0.05, thenDragTo: start.withOffset(CGVector(dx: 0, dy: max(60, top * 0.4))), withVelocity: .slow, thenHoldForDuration: 0.2)
        }
        Thread.sleep(forTimeInterval: 1)
    }

    private func rows(_ when: String) -> Int {
        guard let transcript = transcript(), let stack = rect(transcript["stack"]) else {
            failures.append("\(when): no layout")
            return 0
        }
        let bandTop = min(rect(transcript["band"])?.minY ?? stack.minY, stack.minY)
        let composer = any("threadComposer").frame
        var frames: [CGRect] = []
        for id in ["in-flight", "conversationWorkers"] where any(id).exists { frames.append(any(id).frame) }
        let live = app.staticTexts.matching(NSPredicate(format: "label == %@", Self.step))
        for index in 0..<live.count {
            let frame = live.element(boundBy: index).frame
            if frame.minY >= bandTop - 1, frame.maxY <= composer.minY + 1 { frames.append(frame) }
        }
        if let lane = rect(transcript["pill"]) { frames.append(lane) }
        let jump = app.buttons["jumpToLatest"]
        if jump.exists, jump.frame.maxY <= composer.minY - 4 { frames.append(jump.frame) }
        let above = frames.filter { $0.maxY <= composer.minY + 1 && $0.height > 1 }.sorted { $0.minY < $1.minY }
        var bands: [ClosedRange<CGFloat>] = []
        for frame in above {
            if let last = bands.last, frame.minY < last.upperBound - 2 {
                bands[bands.count - 1] = last.lowerBound...max(last.upperBound, frame.maxY)
            } else {
                bands.append(frame.minY...frame.maxY)
            }
        }
        steps.append("\(when): \(bands.count) rows above the composer \(bands.map { "\(Int($0.lowerBound))–\(Int($0.upperBound))" })")
        return bands.count
    }

    private func checkMenu(_ when: String) {
        let menu = app.buttons["roomMenuButton"]
        guard menu.exists else { return steps.append("\(when): no ≡ on screen") }
        steps.append("\(when): ≡ at \(menu.frame)")
        for id in ["in-flight-toggle", "in-flight-clear", "jumpToLatest", "composerMic", "threadComposer"] {
            let control = any(id)
            guard control.exists else { continue }
            if control.frame.intersection(menu.frame).width > 0.5 && control.frame.intersection(menu.frame).height > 0.5 {
                failures.append("\(when): ≡ (\(menu.frame)) covers \(id) (\(control.frame))")
            }
        }
    }

    private func checkTyping(_ when: String, reading: Bool) {
        Thread.sleep(forTimeInterval: 1.5)
        guard let top = keyboardTop() else { return failures.append("\(when): the keyboard isn't up") }
        let composer = any("threadComposer").frame
        if composer.maxY > top + 1 { failures.append("\(when): the composer (\(composer)) is under the keyboard (top \(top))") }
        steps.append("\(when): keyboard top \(Int(top)), composer \(Int(composer.minY))–\(Int(composer.maxY))")
        let count = rows(when)
        if count > 1 { failures.append("\(when): \(count) rows above the composer with the keyboard up") }
        let jump = app.buttons["jumpToLatest"]
        if reading, !jump.exists { failures.append("\(when): no ↓ while reading up") }
        if jump.exists, jump.frame.maxY <= any("threadComposer").frame.minY - 4 {
            failures.append("\(when): the ↓ (\(jump.frame)) sits in a row of its own above the composer")
        }
        let line = app.buttons["in-flight-toggle"]
        if !line.exists {
            failures.append("\(when): no In flight line")
        } else if !line.label.contains(Self.step) || !line.label.contains("In flight") {
            failures.append("\(when): the line says '\(line.label)', not the count and the latest step")
        }
        checkMenu(when)
    }

    private func checkCalm(_ when: String) {
        Thread.sleep(forTimeInterval: 1.5)
        _ = rows(when)
        if any("in-flight").exists, any("conversationWorkers").exists {
            failures.append("\(when): the worker chip repeats what In flight shows")
        }
        let inFlight = any("in-flight").frame
        let live = app.staticTexts.matching(NSPredicate(format: "label == %@", Self.step))
        let composer = any("threadComposer").frame
        for index in 0..<live.count {
            let frame = live.element(boundBy: index).frame
            if frame.maxY <= composer.minY + 1, frame.minY >= inFlight.minY - 400, !inFlight.contains(CGPoint(x: frame.midX, y: frame.midY)),
               frame.minY > inFlight.maxY - 1 {
                failures.append("\(when): the live step has its own row (\(frame)) beside In flight")
            }
        }
        checkMenu(when)
    }

    private func standWithKeyboard() {
        for attempt in 0..<4 where keyboardTop() == nil {
            if attempt % 2 == 0, field.exists, field.isHittable, field.frame.maxX <= app.frame.maxX { field.tap() } else { command("activate?composerField") }
            _ = keyboard.waitForExistence(timeout: 5)
        }
    }

    private func pass(_ layout: String, capturing: Bool) {
        standWithKeyboard()
        XCTAssertNotNil(keyboardTop(), "\(layout): the keyboard is up")
        command("busy?120", wait: 4)
        command("bottom", wait: 1.5)
        standWithKeyboard()
        checkTyping("\(layout), keyboard up, at the end", reading: false)
        if capturing { capture("\(layout)-keyboard-end") } else { shot("\(layout)-keyboard-end") }
        readUp()
        standWithKeyboard()
        checkTyping("\(layout), keyboard up, reading up", reading: true)
        if capturing { capture("\(layout)-keyboard-reading") } else { shot("\(layout)-keyboard-reading") }
        command("dismiss", wait: 1.5)
        if capturing { command("landscape", wait: 2) }
        command("bottom", wait: 1.5)
        checkCalm("\(layout), keyboard down, at the end")
        if capturing { capture("\(layout)-calm-end") } else { shot("\(layout)-calm-end") }
        readUp()
        checkCalm("\(layout), keyboard down, reading up")
        if capturing, !app.buttons["jumpToLatest"].exists { failures.append("\(layout), keyboard down, reading up: no ↓") }
        if capturing { capture("\(layout)-calm-reading") } else { shot("\(layout)-calm-reading") }
    }

    private func checkExpand(_ when: String) {
        standWithKeyboard()
        let line = app.buttons["in-flight-toggle"]
        guard line.waitForExistence(timeout: 5), line.frame.midX > 0, line.frame.midX < 466 || !duo else {
            return failures.append("\(when): the In flight line can't be tapped")
        }
        line.coordinate(withNormalizedOffset: CGVector(dx: 0.5, dy: 0.5)).tap()
        Thread.sleep(forTimeInterval: 1.5)
        if keyboardTop() != nil { failures.append("\(when): tapping the line keeps the keyboard up") }
        if app.buttons["in-flight-toggle"].value as? String != "Expanded" { failures.append("\(when): tapping the line doesn't open In flight") }
        shot("\(when)-expanded")
    }

    func testOneLineAboveTheComposerWithTheKeyboardUp() {
        launch()
        app.buttons["roomInput"].tap()
        XCTAssertTrue(field.waitForExistence(timeout: 10), "the chat stands up")
        let tip = app.buttons["Continue"]
        if tip.waitForExistence(timeout: 2) { tip.tap() }
        XCTAssertTrue(any("in-flight").waitForExistence(timeout: 20), "In flight is in the stack")
        pass(duo ? "folded" : device, capturing: false)
        checkExpand(duo ? "folded" : device)
        if duo {
            command("landscape", wait: 5)
            pass("unfolded", capturing: true)
            command("busy?60", wait: 3)
            command("split-right", wait: 3)
            standWithKeyboard()
            checkTyping("unfolded, right page, keyboard up", reading: false)
            shot("unfolded-right-keyboard")
            checkExpand("unfolded-right")
            command("outer", wait: 4)
        }
        print("LINE-SUMMARY\n" + steps.joined(separator: "\n"))
        XCTAssertEqual(failures, [], steps.joined(separator: "\n"))
    }
}
