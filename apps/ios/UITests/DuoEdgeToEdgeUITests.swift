import XCTest

@MainActor
final class DuoEdgeToEdgeUITests: ServerIsolatedUITestCase {
    private let app = XCUIApplication()

    func testSurfacesReachEdgesWhileControlsStaySafe() throws {
        let env = ProcessInfo.processInfo.environment
        let device = env["BBGO_QA_DEVICE"] ?? "duo"
        // BBGO_QA_LIGHT reviews the same surfaces in light mode; the
        // documented renders are dark, as Patrick uses the app.
        let light = env["BBGO_QA_LIGHT"] != nil
        let prefix = light ? "qa-v8-light-" : "v8-"
        app.launchArguments = ["-skipPushPrompt", "YES",
            "-qaBotDemo", "duo", "-qaDuoPhone", "-qaDuoColdWide", "-qaDuoLong",
            "-qaNotesDemo", "draft", "-qaVoice", "idle", "-openURL", "bbstudio://bot"] + (light ? [] : ["-qaDark"])
        app.launchOffline()
        XCTAssertTrue(app.otherElements["threadComposer"].firstMatch.waitForExistence(timeout: 30))
        try assertEdges(composer: true)
        XCTAssertTrue(app.staticTexts.matching(NSPredicate(format: "label CONTAINS %@", "History turn 299.")).firstMatch.waitForExistence(timeout: 30))
        Thread.sleep(forTimeInterval: 3)
        // The scroll request can land before the lazy transcript settles; ask again.
        let jump = app.buttons["Jump to latest"]
        for _ in 0..<3 where !jump.exists {
            command("mid")
            _ = jump.waitForExistence(timeout: 10)
        }
        XCTAssertTrue(jump.exists)
        command("layout")
        let metrics = try JSONDecoder().decode(Geometry.self, from: Data(try XCTUnwrap(app.windows.firstMatch.value as? String).utf8))
        // Centred on the page, in its own band above the composer.
        XCTAssertEqual(jump.frame.midX, (metrics.width / 2 + 16 + metrics.width) / 2, accuracy: 2)
        command("bottom")
        XCTAssertTrue(app.staticTexts.matching(NSPredicate(format: "label CONTAINS %@", "History turn 299.")).firstMatch.waitForExistence(timeout: 15))
        try capture(prefix + "bot-" + device, cardRows: true)
        command("tab?threads")
        let thread = app.buttons["inbox-thread-thr_botdemo01"]
        XCTAssertTrue(thread.waitForExistence(timeout: 20))
        thread.tap()
        XCTAssertTrue(app.staticTexts["duoThreadTitle"].waitForExistence(timeout: 15))
        try assertEdges(composer: true)
        try capture(prefix + "threads-" + device)
        command("tab?studio")
        let page = app.buttons.matching(identifier: "studioItem")
            .matching(NSPredicate(format: "label CONTAINS %@", "Review checklist")).firstMatch
        XCTAssertTrue(page.waitForExistence(timeout: 20))
        page.tap()
        XCTAssertTrue(app.staticTexts.matching(NSPredicate(format: "label BEGINSWITH %@", "Search and list cards share")).firstMatch.waitForExistence(timeout: 15))
        try assertEdges(composer: false)
        XCTAssertTrue(app.buttons["studio-kind-all"].exists)
        XCTAssertTrue(app.staticTexts["Folders"].exists)
        let allItems = app.buttons["studio-folder-all"]
        XCTAssertTrue(allItems.exists)
        XCTAssertTrue(allItems.isSelected, "All items is the active folder and is highlighted as such")
        // Row content keeps the same 20-point inset from the card on both sides.
        command("layout")
        let studio = try JSONDecoder().decode(Geometry.self, from: Data(try XCTUnwrap(app.windows.firstMatch.value as? String).utf8))
        let cardMaxX = studio.width / 2 - DuoGeometry.gutter / 2 - DuoGeometry.sidebarMargin
        let stamp = try XCTUnwrap(app.staticTexts.matching(NSPredicate(format: "label CONTAINS %@", " ago"))
            .allElementsBoundByIndex.first { $0.frame.maxX < studio.width / 2 && $0.frame.width > 0 })
        print("ROW INSET stamp=\(stamp.frame) cardMaxX=\(cardMaxX) title=\(allItems.frame)")
        XCTAssertEqual(cardMaxX - stamp.frame.maxX, 20, accuracy: 2, "Trailing row inset matches the leading one")
        try capture(prefix + "studio-" + device)
        command("tab?settings")
        XCTAssertTrue(app.buttons["Server"].waitForExistence(timeout: 10))
        XCTAssertTrue(app.textFields["settingsServerURL"].waitForExistence(timeout: 10))
        try assertEdges(composer: false, headerActions: false)
        // Form cards keep a margin inside the status column, like the header.
        command("layout")
        let settings = try JSONDecoder().decode(Geometry.self, from: Data(try XCTUnwrap(app.windows.firstMatch.value as? String).utf8))
        let toggle = app.switches.firstMatch
        XCTAssertTrue(toggle.exists)
        XCTAssertLessThanOrEqual(toggle.frame.maxX, settings.width - settings.safeRight + 1)
        XCTAssertLessThanOrEqual(app.textFields["settingsServerURL"].frame.maxX, settings.width - settings.safeRight + 1)
        XCTAssertLessThanOrEqual(toggle.frame.maxX, settings.width - settings.safeRight - 20 + 1, "Cards keep their margin inside the safe edge")
        try capture(prefix + "settings-" + device)
    }

    func testNativeIPadSurfacesAndSafeControls() throws {
        let env = ProcessInfo.processInfo.environment
        guard env["BBGO_QA_DEVICE"] == "ipad" else { throw XCTSkip("Native iPad window") }
        XCUIDevice.shared.orientation = .landscapeLeft
        defer { XCUIDevice.shared.orientation = .portrait }
        app.launchArguments = ["-skipPushPrompt", "YES",
            "-qaBotDemo", "duo", "-qaDuoPhone", "-qaDuoLong", "-qaDark", "-qaNotesDemo", "draft",
            "-qaVoice", "idle", "-openURL", "bbstudio://bot"]
        app.launchOffline()
        XCTAssertTrue(app.otherElements["threadComposer"].firstMatch.waitForExistence(timeout: 30))
        try assertEdges(composer: true)
        try capture("qa-v7-native-ipad")
    }

    private func assertEdges(composer: Bool, headerActions: Bool = true) throws {
        command("layout")
        let data = Data(try XCTUnwrap(app.windows.firstMatch.value as? String).utf8)
        let layout = try JSONDecoder().decode(Geometry.self, from: data)
        print("EDGE LAYOUT \(String(decoding: data, as: UTF8.self))")
        let rail = try XCTUnwrap(layout.surfaces.first { $0.key.hasPrefix("rail-") }?.value)
        let detail = try XCTUnwrap(layout.surfaces.first { $0.key.hasPrefix("detail-") && abs($0.value.x - (layout.width / 2 + 16)) < 1 }?.value)
        let header = try XCTUnwrap(layout.surfaces.first { $0.key.hasPrefix("header-") && abs($0.value.x - (layout.width / 2 + 16)) < 1 }?.value)
        XCTAssertEqual(rail.maxY, layout.height, accuracy: 1)
        XCTAssertEqual(rail.y, 0, accuracy: 1, "The rail fills the status bar on iPad")
        XCTAssertEqual(header.y, 0, accuracy: 1, "The detail header fills the status bar on iPad")
        let sidebarHeader = try XCTUnwrap(layout.surfaces.first { $0.key.hasPrefix("sidebarHeader-") && abs($0.value.x - 64) < 1 }?.value)
        XCTAssertEqual(sidebarHeader.y, 0, accuracy: 1)
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
        // The scroll view's frame reaching the edge is not enough: its
        // clipping container must too, or rows stop at the home indicator.
        // Probes keep earlier tabs' frames too; take the one at the crease.
        let creases = layout.surfaces.filter { $0.key.hasPrefix("creaseLine-") && abs($0.value.midX - layout.width / 2) < 1 }
        XCTAssertFalse(creases.isEmpty)
        for crease in creases.values {
            XCTAssertEqual(crease.maxY, layout.height, accuracy: 1, "The crease line runs the full height")
        }
        let actions = app.buttons.allElementsBoundByIndex.filter {
            $0.frame.minX > layout.width / 2 && $0.frame.minY >= 0 && $0.frame.minY < 100 && $0.frame.height > 0
        }
        XCTAssertEqual(actions.isEmpty, !headerActions)
        for action in actions {
            XCTAssertLessThanOrEqual(action.frame.maxX, layout.width - layout.safeRight + 1, action.label)
        }
        XCTAssertLessThanOrEqual(app.buttons["Settings"].frame.maxY, layout.height - layout.safeBottom + 1)
        if composer {
            let box = app.otherElements["threadComposer"].firstMatch
            XCTAssertTrue(box.exists)
            // The composer has the transcript's margins, under the status column too.
            XCTAssertLessThanOrEqual(box.frame.maxX, layout.width - 12 + 1)
            XCTAssertGreaterThanOrEqual(box.frame.maxX, layout.width - layout.safeRight - 17, "The composer reaches past the safe edge when there is a status column")
            XCTAssertEqual(layout.height - layout.safeBottom - box.frame.maxY, 8, accuracy: 1)
        }
    }

    private enum DuoGeometry {
        static let gutter: CGFloat = 32
        static let sidebarMargin: CGFloat = 16
    }

    private func command(_ path: String) { XCUIDevice.shared.system.open(URL(string: "bbstudio://qa-duo/" + path)!) }
    /// `cardRows`: the sidebar's rows sit on cards (Bot), so a card, not the
    /// bare sidebar, shows at the bottom edge whenever the list overflows.
    private func capture(_ name: String, cardRows: Bool = false) throws {
        command("capture?" + name)
        let data = Data(try XCTUnwrap(app.windows.firstMatch.value as? String).utf8)
        let pixels = try JSONDecoder().decode(RailPixels.self, from: data)
        XCTAssertEqual(pixels.railCenter.count, 3)
        XCTAssertEqual(pixels.railBottom.count, 3)
        for (center, bottom) in zip(pixels.railCenter, pixels.railBottom) {
            XCTAssertEqual(Double(center), Double(bottom), accuracy: 2,
                "The bottom rail must be painted like its center, without a separate safe-area band")
        }
        let geometry = try JSONDecoder().decode(Geometry.self, from: data)
        let sidebarList = geometry.scrolls.first { $0.x < geometry.width / 2 && $0.height >= geometry.height - 1 }
        if cardRows, let sidebarList, sidebarList.contentHeight - sidebarList.contentOffsetY > sidebarList.height {
            // A card row, not the bare sidebar, is under the home indicator.
            XCTAssertNotEqual(pixels.sidebarRowBottom, pixels.sidebarBody,
                "Sidebar rows draw to the window's bottom edge rather than stopping above the home indicator")
        }
        XCTAssertEqual(pixels.sidebarHeader.count, 3)
        for (header, body) in zip(pixels.sidebarHeader, pixels.sidebarBody) {
            XCTAssertEqual(Double(header), Double(body), accuracy: 2,
                "The sidebar header shares the sidebar surface, without a separate bar band")
        }
    }
    private struct RailPixels: Decodable {
        let railCenter: [UInt8]
        let railBottom: [UInt8]
        let sidebarHeader: [UInt8]
        let sidebarBody: [UInt8]
        let sidebarRowBottom: [UInt8]
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
        var midX: CGFloat { x + width / 2 }
    }
    private struct Scroll: Decodable {
        let x: CGFloat
        let y: CGFloat
        let width: CGFloat
        let height: CGFloat
        let contentWidth: CGFloat
        let contentHeight: CGFloat
        let contentOffsetY: CGFloat
        let adjustedBottom: CGFloat
        var maxX: CGFloat { x + width }
        var maxY: CGFloat { y + height }
    }
}
