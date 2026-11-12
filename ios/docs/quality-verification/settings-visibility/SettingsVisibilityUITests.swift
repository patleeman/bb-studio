import XCTest
final class SettingsVisibilityUITests: XCTestCase {
    let fixture = "http://127.0.0.1:49486"
    override func setUpWithError() throws {
        continueAfterFailure = false
        guard ProcessInfo.processInfo.environment["BB_QA_SERVER_URL"] == fixture else { throw XCTSkip("Explicit staged origin required") }
    }
    func testDefaultPortrait() throws { try verify(large: false, landscape: false) }
    func testXXXLPortrait() throws { try verify(large: true, landscape: false) }
    func testDefaultLandscape() throws { try verify(large: false, landscape: true) }
    func testXXXLLandscape() throws { try verify(large: true, landscape: true) }
    func retain(_ app: XCUIApplication, _ row: XCUIElement, _ name: String, _ bottom: CGFloat, _ top: CGFloat, _ scroll: Int) {
        let screenshot = XCTAttachment(screenshot: XCUIScreen.main.screenshot()); screenshot.name=name; screenshot.lifetime = .keepAlways; add(screenshot)
        let tree = XCTAttachment(string: app.debugDescription); tree.name=name+"-tree"; tree.lifetime = .keepAlways; add(tree)
        let json: [String:Any] = ["label":row.label,"hittable":row.isHittable,"row":[row.frame.minX,row.frame.minY,row.frame.width,row.frame.height],"window":[app.windows.firstMatch.frame.width,app.windows.firstMatch.frame.height],"tabBar":app.tabBars.firstMatch.exists ? [app.tabBars.firstMatch.frame.minY,app.tabBars.firstMatch.frame.maxY] : [],"visibleTop":top,"visibleBottom":bottom,"ordinaryScrolls":scroll]
        let bounds = XCTAttachment(data:try! JSONSerialization.data(withJSONObject:json,options:[.prettyPrinted,.sortedKeys]),uniformTypeIdentifier:"public.json"); bounds.name=name+"-bounds"; bounds.lifetime = .keepAlways; add(bounds)
        print("VISIBILITY "+name+" "+String(data:try! JSONSerialization.data(withJSONObject:json,options:[.sortedKeys]),encoding:.utf8)!)
    }
    func verify(large: Bool, landscape: Bool) throws {
        XCUIDevice.shared.orientation = landscape ? .landscapeLeft : .portrait
        let app = XCUIApplication()
        app.launchArguments=["-serverURL",fixture,"-skipPushPrompt","YES"]
        if large { app.launchArguments += ["-UIPreferredContentSizeCategoryName","UICTContentSizeCategoryAccessibilityXXXL"] }
        app.launch()
        defer { app.terminate(); XCUIDevice.shared.orientation = .portrait }
        // iPad exposes the adaptive Settings tab as a Cell rather than TabBar Button.
        let settings = app.descendants(matching:.any).matching(NSPredicate(format:"label == %@", "Settings")).firstMatch
        XCTAssertTrue(settings.waitForExistence(timeout:20)); XCTAssertTrue(settings.isHittable)
        settings.tap()
        let server=app.descendants(matching:.any)["settingsServerURL"]
        XCTAssertTrue(server.waitForExistence(timeout:10)); XCTAssertEqual(server.value as? String,fixture)
        let window=app.windows.firstMatch.frame
        if landscape && window.width < window.height { throw XCTSkip("iPhone Info.plist supports portrait only; rotation request confirmed portrait") }
        let name="settings-"+(large ? "xxxl" : "default")+"-"+(landscape ? "landscape" : "portrait")
        let row=app.staticTexts.matching(NSPredicate(format:"label == %@","Configured limit, Automatic")).firstMatch
        let nav=app.navigationBars["Settings"]
        let tab=app.tabBars.firstMatch.exists ? app.tabBars.firstMatch.frame : .zero
        let top=max(nav.frame.maxY,tab.minY < window.height/2 ? tab.maxY : 0)+8
        let bottom=(tab.minY > window.height/2 ? tab.minY : window.maxY-34)-8
        var count=0
        for _ in 0..<12 {
            if row.exists && row.isHittable { break }
            app.coordinate(withNormalizedOffset:CGVector(dx:0.5,dy:0.72)).press(forDuration:0.05,thenDragTo:app.coordinate(withNormalizedOffset:CGVector(dx:0.5,dy:0.56)))
            count += 1
        }
        XCTAssertTrue(row.exists); XCTAssertTrue(row.isHittable)
        retain(app,row,name+"-first-reachable",bottom,top,count)
        for _ in 0..<8 {
            if row.frame.minY >= top && row.frame.maxY <= bottom { break }
            let dy:CGFloat=row.frame.maxY > bottom ? -0.12 : 0.12
            app.coordinate(withNormalizedOffset:CGVector(dx:0.5,dy:0.62)).press(forDuration:0.05,thenDragTo:app.coordinate(withNormalizedOffset:CGVector(dx:0.5,dy:0.62+dy)))
            count += 1
        }
        retain(app,row,name+"-fully-visible",bottom,top,count)
        XCTAssertEqual(row.label,"Configured limit, Automatic")
        XCTAssertTrue(row.isHittable)
        XCTAssertGreaterThan(row.frame.height,0)
        XCTAssertGreaterThanOrEqual(row.frame.minY,top)
        XCTAssertLessThanOrEqual(row.frame.maxY,bottom)
        XCTAssertGreaterThanOrEqual(row.frame.minX,window.minX)
        XCTAssertLessThanOrEqual(row.frame.maxX,window.maxX)
        // Visibility/bounds are the proof; do not substitute an audit result.
    }
}
