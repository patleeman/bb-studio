import XCTest

@MainActor
final class DuoEdgeToEdgeUITests: XCTestCase {
    private let app = XCUIApplication()

    func testSurfacesReachEdgesWhileControlsStaySafe() throws {
        let env = ProcessInfo.processInfo.environment
        let device = env["BBGO_QA_DEVICE"] ?? "duo"
        app.launchArguments = ["-skipPushPrompt", "YES", "-serverURL", try XCTUnwrap(env["BBGO_QA_SERVER"]),
            "-qaBotDemo", "duo", "-qaDuoPhone", "-qaDuoColdWide", "-qaDuoLong", "-qaDark",
            "-qaNotesDemo", "draft", "-qaVoice", "idle", "-openURL", "bbstudio://bot"]
        app.launch()
        XCTAssertTrue(app.otherElements["threadComposer"].firstMatch.waitForExistence(timeout: 30))
        try assertEdges(composer: true)
        XCTAssertTrue(app.staticTexts.matching(NSPredicate(format: "label CONTAINS %@", "History turn 299.")).firstMatch.waitForExistence(timeout: 30))
        Thread.sleep(forTimeInterval: 3)
        command("mid")
        let jump = app.buttons["Jump to latest"]
        XCTAssertTrue(jump.waitForExistence(timeout: 15))
        command("layout")
        let metrics = try JSONDecoder().decode(Geometry.self, from: Data(try XCTUnwrap(app.windows.firstMatch.value as? String).utf8))
        XCTAssertLessThanOrEqual(jump.frame.maxX, metrics.width - metrics.safeRight + 1)
        command("bottom")
        XCTAssertTrue(app.staticTexts.matching(NSPredicate(format: "label CONTAINS %@", "History turn 299.")).firstMatch.waitForExistence(timeout: 15))
        try capture("v7-bot-" + device)
        command("tab?threads")
        let thread = app.buttons["inbox-thread-thr_botdemo01"]
        XCTAssertTrue(thread.waitForExistence(timeout: 20))
        thread.tap()
        XCTAssertTrue(app.staticTexts["duoThreadTitle"].waitForExistence(timeout: 15))
        try assertEdges(composer: true)
        try capture("v7-threads-" + device)
        command("tab?studio")
        let page = app.buttons.matching(identifier: "studioItem")
            .matching(NSPredicate(format: "label CONTAINS %@", "Review checklist")).firstMatch
        XCTAssertTrue(page.waitForExistence(timeout: 20))
        page.tap()
        XCTAssertTrue(app.staticTexts.matching(NSPredicate(format: "label BEGINSWITH %@", "Search and list cards share")).firstMatch.waitForExistence(timeout: 15))
        try assertEdges(composer: false)
        try capture("v7-studio-" + device)
    }

    func testNativeIPadSurfacesAndSafeControls() throws {
        let env = ProcessInfo.processInfo.environment
        guard env["BBGO_QA_DEVICE"] == "ipad" else { throw XCTSkip("Native iPad window") }
        XCUIDevice.shared.orientation = .landscapeLeft
        defer { XCUIDevice.shared.orientation = .portrait }
        app.launchArguments = ["-skipPushPrompt", "YES", "-serverURL", try XCTUnwrap(env["BBGO_QA_SERVER"]),
            "-qaBotDemo", "duo", "-qaDuoPhone", "-qaDuoLong", "-qaDark", "-qaNotesDemo", "draft",
            "-qaVoice", "idle", "-openURL", "bbstudio://bot"]
        app.launch()
        XCTAssertTrue(app.otherElements["threadComposer"].firstMatch.waitForExistence(timeout: 30))
        try assertEdges(composer: true)
        try capture("qa-v7-native-ipad")
    }

    private func assertEdges(composer: Bool) throws {
        command("layout")
        let data = Data(try XCTUnwrap(app.windows.firstMatch.value as? String).utf8)
        let layout = try JSONDecoder().decode(Geometry.self, from: data)
        print("EDGE LAYOUT \(String(decoding: data, as: UTF8.self))")
        let rail = try XCTUnwrap(layout.surfaces.first { $0.key.hasPrefix("rail-") }?.value)
        let detail = try XCTUnwrap(layout.surfaces.first { $0.key.hasPrefix("detail-") && abs($0.value.x - (layout.width / 2 + 16)) < 1 }?.value)
        let header = try XCTUnwrap(layout.surfaces.first { $0.key.hasPrefix("header-") && abs($0.value.x - (layout.width / 2 + 16)) < 1 }?.value)
        XCTAssertEqual(rail.maxY, layout.height, accuracy: 1)
        XCTAssertEqual(detail.maxY, layout.height, accuracy: 1)
        XCTAssertEqual(detail.maxX, layout.width, accuracy: 1)
        XCTAssertEqual(header.maxX, layout.width, accuracy: 1)
        let scroll = try XCTUnwrap(layout.scrolls.first { $0.x > layout.width / 2 && $0.height >= layout.height - 1 })
        XCTAssertEqual(scroll.maxX, layout.width, accuracy: 1)
        XCTAssertEqual(scroll.maxY, layout.height, accuracy: 1)
        XCTAssertEqual(scroll.contentWidth, scroll.width, accuracy: 1,
            "Scrolling content uses the status-column width, without reserving an empty band")
        XCTAssertGreaterThanOrEqual(scroll.adjustedBottom, layout.safeBottom)
        let sidebar = try XCTUnwrap(layout.scrolls.first { $0.x < layout.width / 2 && $0.height >= layout.height - 1 })
        XCTAssertEqual(sidebar.maxY, layout.height, accuracy: 1)
        XCTAssertGreaterThanOrEqual(sidebar.adjustedBottom, layout.safeBottom)
        let actions = app.buttons.allElementsBoundByIndex.filter {
            $0.frame.minX > layout.width / 2 && $0.frame.minY >= 0 && $0.frame.minY < 100 && $0.frame.height > 0
        }
        XCTAssertFalse(actions.isEmpty)
        for action in actions {
            XCTAssertLessThanOrEqual(action.frame.maxX, layout.width - layout.safeRight + 1, action.label)
        }
        XCTAssertLessThanOrEqual(app.buttons["Settings"].frame.maxY, layout.height - layout.safeBottom + 1)
        if composer {
            let box = app.otherElements["threadComposer"].firstMatch
            XCTAssertTrue(box.exists)
            XCTAssertLessThanOrEqual(box.frame.maxX, layout.width - layout.safeRight + 1)
            XCTAssertEqual(layout.height - layout.safeBottom - box.frame.maxY, 8, accuracy: 1)
        }
    }

    private func command(_ path: String) { XCUIDevice.shared.system.open(URL(string: "bbstudio://qa-duo/" + path)!) }
    private func capture(_ name: String) throws {
        command("capture?" + name)
        let data = Data(try XCTUnwrap(app.windows.firstMatch.value as? String).utf8)
        let pixels = try JSONDecoder().decode(RailPixels.self, from: data)
        XCTAssertEqual(pixels.railCenter.count, 3)
        XCTAssertEqual(pixels.railBottom.count, 3)
        for (center, bottom) in zip(pixels.railCenter, pixels.railBottom) {
            XCTAssertEqual(Double(center), Double(bottom), accuracy: 2,
                "The bottom rail must be painted like its center, without a separate safe-area band")
        }
    }
    private struct RailPixels: Decodable {
        let railCenter: [UInt8]
        let railBottom: [UInt8]
    }
    private struct Geometry: Decodable {
        let width: CGFloat
        let height: CGFloat
        let safeRight: CGFloat
        let safeBottom: CGFloat
        let surfaces: [String: Rect]
        let scrolls: [Scroll]
    }
    private struct Rect: Decodable {
        let x: CGFloat
        let y: CGFloat
        let width: CGFloat
        let height: CGFloat
        var maxX: CGFloat { x + width }
        var maxY: CGFloat { y + height }
    }
    private struct Scroll: Decodable {
        let x: CGFloat
        let y: CGFloat
        let width: CGFloat
        let height: CGFloat
        let contentWidth: CGFloat
        let adjustedBottom: CGFloat
        var maxX: CGFloat { x + width }
        var maxY: CGFloat { y + height }
    }
}
