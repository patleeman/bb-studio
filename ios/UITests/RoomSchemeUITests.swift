import XCTest

/// The room is dark under its frost, whatever variant the scene's driver chose
/// for the hour: the composer's band, the strands pill and the composer are dark
/// like the transcript above them, never a light canvas under a dark transcript.
/// Offline, a two-mode scene theme (`kyoto-garden`) in its light variant (as
/// its driver picks by day; `-qaSceneMode light`), on the iPhone and the folded Duo.
/// `SCHEME_OUT` keeps the screenshot.
final class RoomSchemeUITests: ServerIsolatedUITestCase {
    private let app = XCUIApplication()

    /// The mean luminance (0 black, 1 white) of `rect` (screen points), sampled.
    private func luminance(_ image: UIImage, in rect: CGRect) -> Double {
        guard let cg = image.cgImage, let data = cg.dataProvider?.data, let bytes = CFDataGetBytePtr(data) else { return 1 }
        let scale = image.scale, row = cg.bytesPerRow, step = cg.bitsPerPixel / 8
        var total = 0.0, sampled = 0
        for y in stride(from: Int(rect.minY * scale), to: min(cg.height, Int(rect.maxY * scale)), by: 4) {
            for x in stride(from: Int(rect.minX * scale), to: min(cg.width, Int(rect.maxX * scale)), by: 4) {
                let at = y * row + x * step
                total += (0.2126 * Double(bytes[at + 2]) + 0.7152 * Double(bytes[at + 1]) + 0.0722 * Double(bytes[at])) / 255
                sampled += 1
            }
        }
        return sampled > 0 ? total / Double(sampled) : 1
    }

    func testTheComposerBandAndStrandsPillAreDarkLikeTheTranscript() throws {
        app.launchArguments = ["-skipPushPrompt", "YES", "-qaBotDemo", "chat", "-qaSpacesDemo", "list", "-qaConversationHome",
                               "-qaStrandsDemo", "-qaReplyAskDemo", "-qaRoomConversation", "thr_botdemo01", "-qaRoomTheme", "kyoto-garden",
                               // Its light variant, as by day, at any hour.
                               "-qaSceneMode", "light"]
        app.launchOffline()
        let composer = app.textViews["Message"]
        XCTAssertTrue(composer.waitForExistence(timeout: 40), "the conversation")
        let pill = app.buttons["strands-toggle"]
        XCTAssertTrue(pill.waitForExistence(timeout: 15), "the strands pill")
        // The scene's still and its mode settle a moment after launch.
        sleep(6)
        let window = app.windows.firstMatch.frame
        let field = composer.frame.insetBy(dx: 12, dy: 6)
        let strands = pill.frame.insetBy(dx: 16, dy: 6)
        // The band between the pill and the composer, at the leading margin.
        let band = CGRect(x: window.minX + 2, y: strands.maxY + 8, width: 10, height: max(1, field.minY - strands.maxY - 16))
        let transcript = CGRect(x: window.minX + 8, y: window.height * 0.3, width: window.width * 0.6, height: min(window.height * 0.25, strands.minY - window.height * 0.3 - 8))
        let shot = XCUIScreen.main.screenshot()
        if let folder = ProcessInfo.processInfo.environment["SCHEME_OUT"] {
            try? FileManager.default.createDirectory(atPath: folder, withIntermediateDirectories: true)
            try? shot.pngRepresentation.write(to: URL(fileURLWithPath: folder).appendingPathComponent("room-scheme.png"))
        }
        let image = shot.image
        let rows = luminance(image, in: transcript)
        XCTAssertLessThan(rows, 0.4, "the transcript is dark (luminance \(rows))")
        for (name, rect) in [("the composer", field), ("the strands pill", strands), ("the band between them", band)] {
            let value = luminance(image, in: rect)
            XCTAssertLessThan(value, 0.4, "\(name) is dark like the transcript (luminance \(String(format: "%.2f", value)) at \(rect))")
        }
    }
}
