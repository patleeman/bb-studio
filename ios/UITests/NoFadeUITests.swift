import XCTest

/// No fade over the transcript above the bottom stack (the composer's opaque
/// band) and the jump button (docs/ios/no-fade): up in the history, rows
/// stay at full brightness right up to the controls. Dark mode, so a
/// fade to the page's black dims the white text.
///
/// `TEST_RUNNER_NOFADE_LAYOUT`: `phone` (default, an iPhone) or `split` (the
/// iPhone Duo inner screen's right page). `TEST_RUNNER_NOFADE_SHOTS=<dir>`
/// saves the screen up in the history.
@MainActor
final class NoFadeUITests: ServerIsolatedUITestCase {
    private let app = XCUIApplication()
    private let layout = ProcessInfo.processInfo.environment["NOFADE_LAYOUT"] ?? "phone"
    private var composer: XCUIElement { app.otherElements["threadComposer"].firstMatch }
    private var jump: XCUIElement {
        app.buttons.matching(NSPredicate(format: "identifier == 'jumpToLatest' OR label BEGINSWITH 'Jump to latest'")).firstMatch
    }

    func testTranscript() throws {
        let name = layout
        app.launchArguments = ["-skipPushPrompt", "YES", "-qaBotDemo", layout == "split" ? "duo" : "chat",
            "-qaDark", "-openURL", "bbstudio://bot"]
            + (layout == "split" ? ["-qaDuoPhone", "-qaDuoColdWide", "-qaDuoWideTitles"] : [])
        app.launchOffline()
        XCTAssertTrue(composer.waitForExistence(timeout: 30), "\(name): composer")
        if layout == "split" {
            command("split-right")
            let until = Date().addingTimeInterval(15)
            while !(0..<200).contains(composer.frame.minX), Date() < until { Thread.sleep(forTimeInterval: 0.25) }
        }
        // A draft left by an earlier test (a photo, text) makes the composer taller.
        command("draft?0")
        for _ in 0..<3 where app.buttons["Remove attachment"].firstMatch.exists { app.buttons["Remove attachment"].firstMatch.tap() }
        Thread.sleep(forTimeInterval: 1)
        command("mid")
        _ = jump.waitForExistence(timeout: 5)
        // The phone's demo chat is short: "mid" can stop near the end.
        for _ in 0..<4 where !jump.exists {
            let start = app.coordinate(withNormalizedOffset: .zero)
                .withOffset(CGVector(dx: composer.frame.midX, dy: composer.frame.minY - 300))
            start.press(forDuration: 0.1, thenDragTo: start.withOffset(CGVector(dx: 0, dy: 200)),
                        withVelocity: .slow, thenHoldForDuration: 0.3)
            _ = jump.waitForExistence(timeout: 3)
        }
        guard jump.exists else { return XCTFail("\(name): jump button shows up in the history") }
        Thread.sleep(forTimeInterval: 1)
        command("capture?no-fade-\(name)")
        shot(name)

        // Bright text in the strip from 16 points above the jump button down
        // to the composer, beside the button: there unless a fade dims it.
        // A gap between rows can fall there, so look at a few scroll offsets.
        var brightest = 0
        for step in 0..<6 {
            let count = brightPixels()
            print("NO FADE \(name) step=\(step) bright=\(count) jump=\(jump.frame) composer=\(composer.frame) stackTop=\(stackTop().map { "\($0)" } ?? "none")")
            brightest = max(brightest, count)
            if count >= 20 || !jump.exists { break }
            // From plain text well above the controls (a card there can keep the drag).
            let start = app.coordinate(withNormalizedOffset: .zero)
                .withOffset(CGVector(dx: composer.frame.midX, dy: max(160, composer.frame.minY - 420)))
            start.press(forDuration: 0.1, thenDragTo: start.withOffset(CGVector(dx: 0, dy: 29)),
                        withVelocity: .slow, thenHoldForDuration: 0.3)
            Thread.sleep(forTimeInterval: 0.6)
        }
        XCTAssertGreaterThanOrEqual(brightest, 20, "\(name): text fades out above the composer and jump button")
    }

    /// Pixels near white in the strip above the controls, outside the jump
    /// button and the scroll indicator.
    private func brightPixels() -> Int {
        let screenshot = XCUIScreen.main.screenshot()
        guard let image = screenshot.image.cgImage else { return 0 }
        let scale = CGFloat(image.width) / screenshot.image.size.width
        let button = jump.frame.insetBy(dx: -6, dy: -6)
        // The room's bottom stack is one opaque band (RoomBottomStackUITests):
        // the strip is above it, where a fade would dim the rows.
        let bottom = stackTop() ?? composer.frame.minY
        let top = (layout == "split" ? jump.frame.minY : bottom) - 16
        let strip = CGRect(x: 0, y: top, width: screenshot.image.size.width - 10, height: bottom - top)
        guard strip.height > 0,
              let data = image.dataProvider?.data, let bytes = CFDataGetBytePtr(data) else { return 0 }
        let row = image.bytesPerRow, step = image.bitsPerPixel / 8
        var count = 0
        for y in Int(strip.minY * scale)..<Int(strip.maxY * scale) where y >= 0 && y < image.height {
            for x in stride(from: 0, to: Int(strip.maxX * scale), by: 1) {
                if button.contains(CGPoint(x: CGFloat(x) / scale, y: CGFloat(y) / scale)) { continue }
                let p = bytes + y * row + x * step
                if Int(p[0]) >= 220 && Int(p[1]) >= 220 && Int(p[2]) >= 220 { count += 1 }
            }
        }
        return count
    }

    /// The top of the opaque band under the transcript (`qa-duo/layout`'s transcript stack).
    private func stackTop() -> CGFloat? {
        command("layout")
        guard let value = app.windows.firstMatch.value as? String,
              let layout = try? JSONSerialization.jsonObject(with: Data(value.utf8)) as? [String: Any],
              let transcripts = layout["transcripts"] as? [[String: Any]] else { return nil }
        let tops = transcripts.compactMap { ($0["stack"] as? [String: Any]).flatMap { box -> CGFloat? in
            guard let y = box["y"] as? Double, let width = box["width"] as? Double, width > 0 else { return nil }
            return CGFloat(y)
        } }
        return tops.first
    }

    private func shot(_ name: String) {
        guard let dir = ProcessInfo.processInfo.environment["NOFADE_SHOTS"] else { return }
        try? XCUIScreen.main.screenshot().pngRepresentation
            .write(to: URL(fileURLWithPath: dir).appending(path: "screen-\(name).png"))
    }

    private func command(_ path: String) {
        XCUIDevice.shared.system.open(URL(string: "bbstudio://qa-duo/" + path)!)
        // A fresh simulator asks once before opening the app's links.
        let open = XCUIApplication(bundleIdentifier: "com.apple.springboard").buttons["Open"]
        if open.waitForExistence(timeout: 1.5) { open.tap() }
    }
}
