import XCTest
@testable import BBStudio

final class SpacesTests: XCTestCase {
    func testItemPathsOpenTheItem() {
        XCTAssertEqual(Route(href: "/plugins/pages/pages/pg_1"), .page(id: "pg_1"))
        XCTAssertNil(Route(href: "/plugins/studio/spaces/sp_1"))
    }

    func testOverviewSpacesAndItemSpacesDecode() throws {
        let json = """
            {"id":"sp_1","name":"Launch","color":"#22c55e","icon":"🚀","description":"","defaultProjectId":null,
             "projectIds":["p1"],"threadIds":["t1"],"itemKeys":["pages:pg_2"],"pageId":"pg_1"}
            """
        let space = try JSONDecoder().decode(StudioSpace.self, from: Data(json.utf8))
        XCTAssertEqual(space.emoji, "🚀")
        XCTAssertNil(space.defaultProjectId)

        let item = try JSONDecoder().decode(
            StudioItem.self, from: Data(#"{"pluginId":"pages","id":"pg_2","kind":"page","spaces":["sp_1"]}"#.utf8))
        XCTAssertEqual(item.spaces, ["sp_1"])
    }
}
