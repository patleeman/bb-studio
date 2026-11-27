import XCTest

/// The room's scene fills the screen behind a conversation, on the iPhone and
/// the folded Duo (one page: the frost over the scene covers it all), offline
/// (`-qaRoomTheme forest`), in a short conversation (Launch prep: two messages,
/// then empty room). A band from the middle of the screen to just above the
/// composer must be the frosted scene, not the black window behind it: the
/// frost is as tall as the conversation's own frame, and the backdrop under it
/// fills the rest.
/// `TEST_RUNNER_BACKDROP_OUT` keeps the screenshots.
final class RoomBackdropUITests: ServerIsolatedUITestCase {
    private let app = XCUIApplication()

    /// The share of sampled pixels in `rect` (screen points) that are black: the
    /// window behind the room, not a dark scene or its fallback colour.
    private func blackShare(_ image: UIImage, in rect: CGRect) -> Double {
        guard let cg = image.cgImage, let data = cg.dataProvider?.data, let bytes = CFDataGetBytePtr(data) else { return 1 }
        let scale = image.scale, row = cg.bytesPerRow, step = cg.bitsPerPixel / 8
        var black = 0, sampled = 0
        for y in stride(from: Int(rect.minY * scale), to: min(cg.height, Int(rect.maxY * scale)), by: 6) {
            for x in stride(from: Int(rect.minX * scale), to: min(cg.width, Int(rect.maxX * scale)), by: 6) {
                let at = y * row + x * step
                sampled += 1
                if Int(bytes[at]) + Int(bytes[at + 1]) + Int(bytes[at + 2]) <= 6 { black += 1 }
            }
        }
        return sampled > 0 ? Double(black) / Double(sampled) : 1
    }

    func testTheSceneFillsTheRoomBehindTheConversation() throws {
        app.launchArguments = ["-skipPushPrompt", "YES", "-qaBotDemo", "chat", "-qaSpacesDemo", "list", "-qaConversationHome",
                               "-qaRoomConversation", "thr_demo_interview", "-qaRoomTheme", "forest"]
        app.launchOffline()
        let composer = app.textViews["Message"]
        XCTAssertTrue(composer.waitForExistence(timeout: 40), "the conversation")
        if UIDevice.current.name.lowercased().contains("duo") {
            // Unfold and fold again (the app's own window resize): the frost's
            // still was made for the other screen, and the room must still be filled.
            for size in ["landscape", "outer"] {
                XCUIDevice.shared.system.open(URL(string: "bbstudio://qa-duo/" + size)!)
                sleep(4)
            }
            XCTAssertTrue(composer.waitForExistence(timeout: 20), "the conversation, folded again")
        }
        // Type, then put the keyboard away: the room laid out above the keyboard
        // for a moment, and must fill to the bottom again after.
        composer.tap()
        XCTAssertTrue(app.keyboards.firstMatch.waitForExistence(timeout: 10), "the keyboard")
        sleep(3)
        // A tap on the transcript puts it away.
        app.coordinate(withNormalizedOffset: CGVector(dx: 0.3, dy: 0.3)).tap()
        let gone = XCTNSPredicateExpectation(predicate: NSPredicate(format: "exists == false"), object: app.keyboards.firstMatch)
        _ = XCTWaiter.wait(for: [gone], timeout: 10)
        sleep(3)
        let window = app.windows.firstMatch.frame
        // From the middle down to just above the composer, left of the folded Duo's rail.
        let band = CGRect(x: window.minX + 8, y: window.height * 0.5,
                          width: window.width * 0.7, height: max(0, composer.frame.minY - 12 - window.height * 0.5))
        // The scene's still renders a moment after launch: look again until it shows, or give up.
        var shot = XCUIScreen.main.screenshot()
        var share = blackShare(shot.image, in: band)
        let until = Date().addingTimeInterval(30)
        while share >= 0.2, Date() < until {
            sleep(2)
            shot = XCUIScreen.main.screenshot()
            share = blackShare(shot.image, in: band)
        }
        if let folder = ProcessInfo.processInfo.environment["BACKDROP_OUT"] {
            try? FileManager.default.createDirectory(atPath: folder, withIntermediateDirectories: true)
            try? shot.pngRepresentation.write(to: URL(fileURLWithPath: folder).appendingPathComponent("room.png"))
        }
        XCTAssertLessThan(share, 0.2, "the scene fills the room down to the composer: \(Int(share * 100))% of the band is black")
    }
}
