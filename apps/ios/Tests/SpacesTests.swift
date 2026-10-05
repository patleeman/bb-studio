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
        XCTAssertEqual(space.label, "🚀 Launch")
        XCTAssertNil(space.defaultProjectId)
        XCTAssertFalse(space.isDefault)

        let item = try JSONDecoder().decode(
            StudioItem.self, from: Data(#"{"pluginId":"pages","id":"pg_2","kind":"page","spaces":["sp_1"]}"#.utf8))
        XCTAssertEqual(item.spaces, ["sp_1"])
    }

    private func space(_ id: String, projects: [String] = [], isDefault: Bool = false) throws -> StudioSpace {
        let json: [String: Any] = [
            "id": id, "isDefault": isDefault, "name": id, "color": "#000000", "description": "", "projectIds": projects, "threadIds": [],
        ]
        return try JSONDecoder().decode(StudioSpace.self, from: JSONSerialization.data(withJSONObject: json))
    }

    private func thread(_ id: String, project: String = "p", parent: String? = nil) throws -> ThreadEntry {
        let parentJSON = parent.map { #""\#($0)""# } ?? "null"
        let json = #"{"id":"\#(id)","projectId":"\#(project)","status":"idle","parentThreadId":\#(parentJSON),"createdAt":1,"updatedAt":1}"#
        return try JSONDecoder().decode(ThreadEntry.self, from: Data(json.utf8))
    }

    /// One Space per thread, decided as the web sidebar's By space does.
    func testThreadsFollowStudioThenTheirProjectThenTheDefaultSpace() throws {
        let personal = try space("personal", isDefault: true)
        let launch = try space("launch", projects: ["p_launch"])
        let assignment = SpaceAssignment(spaces: [personal, launch], spaceOf: ["listed": "launch", "gone": "deleted_space"])

        XCTAssertEqual(assignment.defaultSpaceId, "personal")
        XCTAssertEqual(assignment.spaceId(of: try thread("listed"), among: [:]), "launch")
        // Studio hasn't listed a new thread yet: its project's Space has it.
        XCTAssertEqual(assignment.spaceId(of: try thread("new", project: "p_launch"), among: [:]), "launch")
        // A Space that no longer exists counts as none.
        XCTAssertEqual(assignment.spaceId(of: try thread("gone"), among: [:]), "personal")
        XCTAssertEqual(assignment.spaceId(of: try thread("loose"), among: [:]), "personal")

        // A child stays with its root's Space.
        let root = try thread("listed")
        let child = try thread("child", parent: "listed")
        XCTAssertEqual(assignment.spaceId(of: child, among: ["listed": root, "child": child]), "launch")
    }

    func testDefaultSpaceFallsBackToTheFirst() throws {
        let assignment = SpaceAssignment(spaces: [try space("a"), try space("b")], spaceOf: [:])
        XCTAssertEqual(assignment.defaultSpaceId, "a")
        XCTAssertNil(SpaceAssignment(spaces: [], spaceOf: [:]).defaultSpaceId)
    }

    func testRowAgesMatchTheWebSidebar() {
        let now = Date(timeIntervalSince1970: 10_000_000)
        XCTAssertEqual(SpaceThreadRow.age(now, now: now), "now")
        XCTAssertEqual(SpaceThreadRow.age(now - 5 * 60, now: now), "5m")
        XCTAssertEqual(SpaceThreadRow.age(now - 3 * 3600, now: now), "3h")
        XCTAssertEqual(SpaceThreadRow.age(now - 2 * 86400, now: now), "2d")
        XCTAssertEqual(SpaceThreadRow.age(now - 21 * 86400, now: now), "3w")
        XCTAssertEqual(SpaceThreadRow.age(now - 120 * 86400, now: now), "4mo")
    }

    func testHeartbeatLabels() {
        XCTAssertEqual(SpaceLead.cadenceLabel("every15minutes"), "every 15 min")
        XCTAssertEqual(SpaceLead.cadenceLabel("daily"), "daily")
        XCTAssertEqual(SpaceLead.cadenceLabel("weekdays"), "weekdays")
    }

    func testSidebarPreferencesDecodeStudioSidebarFields() throws {
        let json = #"{"organizationMode":"space","currentSpace":"all","hiddenThreads":["t1"],"sectionOrder":[]}"#
        let prefs = try JSONDecoder().decode(SidebarPreferences.self, from: Data(json.utf8))
        XCTAssertEqual(prefs.organizationMode, "space")
        XCTAssertEqual(prefs.currentSpace, "all")
        XCTAssertEqual(prefs.hiddenThreads, ["t1"])
        // BB's own Thread List has neither.
        let plain = try JSONDecoder().decode(SidebarPreferences.self, from: Data(#"{"organizationMode":"project"}"#.utf8))
        XCTAssertNil(plain.hiddenThreads)
    }
}
