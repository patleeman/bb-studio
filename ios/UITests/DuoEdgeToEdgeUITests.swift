import XCTest

/// The unfolded Duo (951×669, emulated on an iPhone): the room's two pages
/// reach the screen's edges while their controls keep clear of the status
/// column and the bottom edge. The left page is the conversation's context,
/// the right one the conversation (or a worker).
@MainActor
final class DuoEdgeToEdgeUITests: ServerIsolatedUITestCase {
    private let app = XCUIApplication()
    /// The status column right of the right page (`FoldedChrome.column`).
    private let column: CGFloat = 84

    func testTheRoomReachesTheEdgesWhileControlsStaySafe() throws {
        let env = ProcessInfo.processInfo.environment
        let device = env["BBGO_QA_DEVICE"] ?? "duo"
        // BBGO_QA_LIGHT reviews the same surfaces in light mode; the
        // documented renders are dark, as Patrick uses the app.
        let light = env["BBGO_QA_LIGHT"] != nil
        let prefix = light ? "qa-v8-light-" : "v8-"
        app.launchArguments = ["-skipPushPrompt", "YES",
            "-qaBotDemo", "duo", "-qaDuoPhone", "-qaDuoColdWide", "-qaDuoLong",
            "-qaNotesDemo", "draft", "-openURL", "bbstudio://bot"] + (light ? [] : ["-qaDark"])
        app.launchOffline()
        XCTAssertTrue(app.otherElements["threadComposer"].firstMatch.waitForExistence(timeout: 30))
        try assertEdges(composer: "threadComposer")
        XCTAssertTrue(app.staticTexts.matching(NSPredicate(format: "label CONTAINS %@", "History turn 299.")).firstMatch.waitForExistence(timeout: 30))
        Thread.sleep(forTimeInterval: 3)
        // The scroll request can land before the lazy transcript settles; ask again.
        let jump = app.buttons["Jump to latest"]
        for _ in 0..<3 where !jump.exists {
            command("mid")
            _ = jump.waitForExistence(timeout: 10)
        }
        XCTAssertTrue(jump.exists)
        // Beside the composer, on the right page and clear of the bottom edge.
        let page = try transcript(try layout())
        let composer = app.otherElements["threadComposer"].firstMatch.frame
        XCTAssertGreaterThanOrEqual(jump.frame.minX, composer.maxX - 1, "Jump to latest sits right of the composer")
        XCTAssertLessThanOrEqual(jump.frame.maxX, page.maxX - 12 + 1)
        XCTAssertEqual(jump.frame.maxY, composer.maxY, accuracy: 6, "on the composer's bottom line")
        command("bottom")
        XCTAssertTrue(app.staticTexts.matching(NSPredicate(format: "label CONTAINS %@", "History turn 299.")).firstMatch.waitForExistence(timeout: 15))
        command("capture?" + prefix + "room-" + device)

        // A worker from the left page: the same edges, its ask field where the composer was.
        let worker = app.buttons["contextWorker-thr_demo_w2"]
        XCTAssertTrue(worker.waitForExistence(timeout: 15))
        worker.tap()
        XCTAssertTrue(app.otherElements["workerAsk"].waitForExistence(timeout: 15))
        try assertEdges(composer: "workerAsk")
        command("capture?" + prefix + "worker-" + device)
    }

    private func assertEdges(composer id: String) throws {
        let layout = try layout()
        print("EDGE LAYOUT width=\(layout.width) height=\(layout.height) scrolls=\(layout.scrolls)")
        // The messages run under the header and down to the bottom edge, and
        // stop at the status column.
        let page = try transcript(layout)
        XCTAssertEqual(page.y, 0, accuracy: 1, "The messages run under the header")
        XCTAssertEqual(page.maxY, layout.height, accuracy: 1, "The messages run to the bottom edge")
        XCTAssertEqual(page.x, layout.width / 2 + 16, accuracy: 1, "The right page starts past the crease")
        // At the status column: on a phone the room pads for it; on a Duo the
        // device's safe area holds it, and the page runs to the edge under it.
        XCTAssertTrue(abs(page.maxX - (layout.width - column)) <= 1 || abs(page.maxX - layout.width) <= 1,
                      "The right page stops at the status column or the edge: \(page.maxX)")
        // The left page's list too, from the screen's left edge.
        // Within the left half (the scene behind both pages has a full-window scroll view too).
        let context = try XCTUnwrap(layout.scrolls.first { $0.x >= -1 && $0.maxX <= layout.width / 2 && $0.height >= layout.height - 1 }, "the left page's list")
        XCTAssertEqual(context.x, 0, accuracy: 1)
        XCTAssertEqual(context.maxY, layout.height, accuracy: 1, "The left page runs to the bottom edge")
        XCTAssertLessThanOrEqual(context.maxX, layout.width / 2 - 16 + 1, "The left page stops before the crease")

        // The composer keeps the transcript's margins, 8 points from the
        // inner screen's bottom edge (which draws no home indicator).
        let box = app.otherElements[id].firstMatch
        XCTAssertTrue(box.waitForExistence(timeout: 10))
        XCTAssertGreaterThanOrEqual(box.frame.minX, page.x + 12 - 1)
        XCTAssertLessThanOrEqual(box.frame.maxX, page.maxX - 12 + 1)
        XCTAssertEqual(layout.height - box.frame.maxY, 8, accuracy: 1)
        // The header's buttons stay on the right page, clear of the column.
        let actions = app.buttons.allElementsBoundByIndex.filter {
            $0.frame.minX > layout.width / 2 && $0.frame.minY >= 0 && $0.frame.minY < 120 && $0.frame.height > 0
        }
        XCTAssertFalse(actions.isEmpty, "the header has its actions")
        for action in actions {
            XCTAssertLessThanOrEqual(action.frame.maxX, page.maxX + 1, action.label)
        }
    }

    private func layout() throws -> Geometry {
        command("layout")
        return try JSONDecoder().decode(Geometry.self, from: Data(try XCTUnwrap(app.windows.firstMatch.value as? String).utf8))
    }

    /// The right page's message list: the tall scroll view past the crease.
    private func transcript(_ layout: Geometry) throws -> Scroll {
        try XCTUnwrap(layout.scrolls.first { $0.x > layout.width / 2 && $0.height >= layout.height - 1 && $0.maxY <= layout.height + 1 }, "the right page's messages")
    }

    private func command(_ path: String) { XCUIDevice.shared.system.open(URL(string: "bbstudio://qa-duo/" + path)!) }

    private struct Geometry: Decodable {
        let width: CGFloat
        let height: CGFloat
        let scrolls: [Scroll]
    }
    private struct Scroll: Decodable, CustomStringConvertible {
        let x: CGFloat
        let y: CGFloat
        let width: CGFloat
        let height: CGFloat
        var maxX: CGFloat { x + width }
        var maxY: CGFloat { y + height }
        var description: String { "(\(x), \(y), \(width), \(height))" }
    }
}
