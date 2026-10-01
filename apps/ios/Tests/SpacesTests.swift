import XCTest
@testable import BBStudio

final class SpacesTests: XCTestCase {
    func testSpaceWidgetTargetReadsTheSection() {
        XCTAssertEqual(SpaceWidgetTarget("sp_1/threads")?.spaceId, "sp_1")
        XCTAssertEqual(SpaceWidgetTarget("sp_1/threads")?.section, .threads)
        XCTAssertEqual(SpaceWidgetTarget("sp_1")?.section, .recent)
        XCTAssertEqual(SpaceWidgetTarget("sp_1/nonsense")?.section, .recent)
        XCTAssertNil(SpaceWidgetTarget(""))
        XCTAssertNil(SpaceWidgetTarget("/actions"))
    }

    func testSpacePathsOpenTheSpace() {
        XCTAssertEqual(Route(href: "/plugins/studio/studio/space/sp_1"), .space(id: "sp_1"))
        XCTAssertEqual(Route(href: "/plugins/pages/pages/pg_1"), .page(id: "pg_1"))
        XCTAssertNil(Route(href: "/plugins/studio/studio/space/sp_1/items"))
    }

    func testOverviewSpacesAndItemSpacesDecode() throws {
        let json = """
            {"id":"sp_1","name":"Launch","color":"#22c55e","icon":"🚀","description":"","defaultProjectId":null,
             "projectIds":["p1"],"threadIds":["t1"],"itemKeys":["pages:pg_2"],"pageId":"pg_1"}
            """
        let space = try JSONDecoder().decode(StudioSpace.self, from: Data(json.utf8))
        XCTAssertEqual(space.emoji, "🚀")
        XCTAssertNil(space.defaultProjectId)
        XCTAssertEqual(space.itemKeys, ["pages:pg_2"])

        let item = try JSONDecoder().decode(
            StudioItem.self, from: Data(#"{"pluginId":"pages","id":"pg_2","kind":"page","spaces":["sp_1"]}"#.utf8))
        XCTAssertEqual(item.spaces, ["sp_1"])
    }
}
