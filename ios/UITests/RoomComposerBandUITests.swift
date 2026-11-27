import XCTest

final class RoomComposerBandUITests: ServerIsolatedUITestCase {
    private let app = XCUIApplication()
    /// The folded Duo: `TEST_RUNNER_ROOM_DUO`, or seen on screen (its title and side column).
    private var duo: Bool { ProcessInfo.processInfo.environment["ROOM_DUO"] != nil || app.isFoldedDuo }
    private var device: String { duo ? "duo" : "iphone" }
    private var failures: [String] = []
    private var steps: [String] = []

    static let bandBudget: CGFloat = 132
    static let lineAllowance: CGFloat = 22

    private func launch() {
        app.launchArguments += ["-skipPushPrompt", "YES", "-qaBotDemo", "chat", "-qaSpacesDemo", "list", "-qaStrandsDemo", "-qaRoomTheme", "forest"]
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
        try? XCUIScreen.main.screenshot().pngRepresentation.write(to: url.appendingPathComponent("\(device)-band-\(name).png"))
    }

    private var keyboard: XCUIElement { app.keyboards.firstMatch }
    private var field: XCUIElement { app.textViews["composerField"] }
    private func any(_ id: String) -> XCUIElement { app.descendants(matching: .any)[id].firstMatch }

    private func geometry() -> [String: Any]? {
        command("layout", wait: 0.5)
        guard let value = app.windows.firstMatch.value as? String else { return nil }
        return try? JSONSerialization.jsonObject(with: Data(value.utf8)) as? [String: Any]
    }

    private func rect(_ value: Any?) -> CGRect? {
        guard let box = value as? [String: Any], let x = box["x"] as? Double, let y = box["y"] as? Double,
              let width = box["width"] as? Double, let height = box["height"] as? Double else { return nil }
        return CGRect(x: x, y: y, width: width, height: height)
    }

    private func readUp() {
        let window = app.windows.firstMatch.frame
        let start = app.coordinate(withNormalizedOffset: .zero).withOffset(CGVector(dx: window.width / 2, dy: window.height * 0.17))
        for _ in 0..<4 {
            start.press(forDuration: 0.05, thenDragTo: start.withOffset(CGVector(dx: 0, dy: window.height * 0.14)), withVelocity: .slow, thenHoldForDuration: 0.2)
        }
        Thread.sleep(forTimeInterval: 1)
    }

    private func check(_ when: String, lines: Int, jump: Bool) {
        Thread.sleep(forTimeInterval: 1.2)
        guard let layout = geometry(),
              let transcript = (layout["transcripts"] as? [[String: Any]])?.first(where: { rect($0["stack"]).map { $0.width > 0 } ?? false }),
              let stack = rect(transcript["stack"]) else { return failures.append("\(when): no layout") }
        let band = rect(transcript["band"]) ?? stack
        let keyboardTop = (layout["keyboardTop"] as? Double).map { CGFloat($0) } ?? band.maxY
        let height = min(band.maxY, keyboardTop) - band.minY
        let card = any("threadComposer").frame
        let text = field.frame
        let parts = [("the strands box", any("strands-box")), ("the worker pill", any("conversationWorkers")), ("the composer", any("threadComposer"))]
            .filter { $0.1.exists }.map { ($0.0, $0.1.frame) }
        steps.append(String(format: "%@: band %.0f–%.0f (%.0f pt), stack from %.0f, field %.0f–%.0f, card %.0f–%.0f, jump %@",
                            when, band.minY, band.maxY, height, stack.minY, text.minY, text.maxY, card.minY, card.maxY,
                            rect(transcript["pill"]).map { String(format: "%.0f–%.0f", $0.minY, $0.maxY) } ?? "none"))
        if text.minY < card.minY - 0.5 || text.maxY > card.maxY + 0.5 {
            failures.append(String(format: "%@: the text (%.0f–%.0f) leaves the composer (%.0f–%.0f)", when, text.minY, text.maxY, card.minY, card.maxY))
        }
        for (index, first) in parts.enumerated() {
            for second in parts.dropFirst(index + 1) where first.1.intersection(second.1).height > 0.5 {
                failures.append("\(when): \(first.0) (\(first.1)) overlaps \(second.0) (\(second.1))")
            }
        }
        let shown = max(1, min(6, Int(((text.height - 16) / 20.3).rounded())))
        steps.append("\(when): \(shown) lines shown")
        let budget = Self.bandBudget + CGFloat(shown - 1) * Self.lineAllowance
        if height > budget { failures.append(String(format: "%@: the band is %.0f pt, over the %.0f pt budget", when, height, budget)) }
        // The folded Duo's ↓ is on its rail (NewConversationUITests), which has no room for it under ⋯ with the keyboard up:
        // it hides while you type, and never sits beside the composer.
        if jump && duo {
            if app.buttons["jumpToLatest"].exists { failures.append("\(when): the ↓ shows beside the composer with the keyboard up") }
        } else if jump {
            let button = app.buttons["jumpToLatest"]
            guard let pill = rect(transcript["pill"]) ?? (button.exists ? button.frame : nil) else { return failures.append("\(when): the ↓ didn't show") }
            if pill.maxY < stack.minY - 0.5 && band.minY < stack.minY - 0.5 {
                failures.append(String(format: "%@: the ↓ (%.0f–%.0f) adds a lane above the stack (from %.0f)", when, pill.minY, pill.maxY, stack.minY))
            }
            for (name, frame) in parts where frame.intersection(pill).height > 0.5 {
                failures.append("\(when): the ↓ (\(pill)) covers \(name)")
            }
        }
    }

    private static let words = "There has got to be a monetization angle to this too like a small price for ten packs or a season pass with a few extra cards every month and a trade window"

    private func type(lines: Int) {
        let text: String
        switch lines {
        case 1: text = "Like ten packs"
        case 3: text = "There has got to be a monetization angle to this too, like ten packs"
        default: text = Array(repeating: Self.words, count: 3).joined(separator: " ")
        }
        field.typeText(text)
    }

    private func clear() {
        for _ in 0..<3 {
            let left = (field.value as? String)?.count ?? 0
            guard left > 0 else { return }
            field.coordinate(withNormalizedOffset: CGVector(dx: 0.98, dy: 0.9)).tap()
            field.typeText(String(repeating: XCUIKeyboardKey.delete.rawValue, count: left + 2))
        }
    }

    func testTheComposerGrowsWithItsTextAndTheBandStaysCompact() {
        launch()
        app.textViews["Message"].tap()
        XCTAssertTrue(field.waitForExistence(timeout: 10), "the chat stands up")
        XCTAssertTrue(keyboard.waitForExistence(timeout: 10), "the keyboard is up")
        let tip = app.buttons["Continue"]
        if tip.waitForExistence(timeout: 2) { tip.tap() }
        XCTAssertTrue(any("strands-box").waitForExistence(timeout: 20), "the strands box is in the stack")
        for lines in [1, 3, 8] {
            clear()
            type(lines: lines)
            check("\(lines) lines, at the end", lines: lines, jump: false)
            shot("\(lines)-lines")
            readUp()
            if keyboard.exists {
                check("\(lines) lines, reading up", lines: lines, jump: true)
                shot("\(lines)-lines-reading")
            }
            command("bottom", wait: 1.5)
            if !keyboard.exists { field.tap() }
        }
        clear()
        print("BAND-SUMMARY\n" + steps.joined(separator: "\n"))
        XCTAssertEqual(failures, [], steps.joined(separator: "\n"))
    }
}
