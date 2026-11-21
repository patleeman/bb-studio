import XCTest
@testable import BBStudio

/// The one list's Projects: BB's threads that belong to no Bot, by project.
final class ProjectThreadsTests: XCTestCase {
    private func thread(_ id: String, _ title: String, project: String, updated: Double, parent: String? = nil, owner: String? = nil,
                        archived: Bool = false) -> ThreadEntry {
        let json: [String: Any] = ["id": id, "projectId": project, "title": title, "status": "idle", "createdAt": 0, "updatedAt": updated,
                                   "parentThreadId": parent ?? NSNull(), "lifecycleOwnerThreadId": owner ?? NSNull(),
                                   "archivedAt": archived ? 1 : NSNull()]
        return try! JSONDecoder().decode(ThreadEntry.self, from: JSONSerialization.data(withJSONObject: json))
    }

    private var sidebar: SidebarBootstrap {
        SidebarBootstrap(
            sections: [],
            projects: [
                .init(id: "proj_site", name: "Website", threads: [
                    thread("form", "Fix the contact form", project: "proj_site", updated: 50),
                    thread("mobile", "Check the form on mobile", project: "proj_site", updated: 60, parent: "form"),
                    thread("old", "An archived one", project: "proj_site", updated: 99, archived: true),
                ]),
                .init(id: "proj_studio", name: "BB Studio", threads: [
                    thread("icons", "Redraw the app icons", project: "proj_studio", updated: 10),
                    thread("lead", "BB Studio", project: "proj_studio", updated: 90),
                    thread("build", "Build: strands", project: "proj_studio", updated: 80, parent: "lead"),
                    thread("review", "Review the build", project: "proj_studio", updated: 85, owner: "build"),
                ]),
            ],
            personalProject: .init(id: "proj_personal", name: "Personal", threads: [
                thread("main", "Main", project: "proj_personal", updated: 100),
                thread("receipts", "Sort the tax receipts", project: "proj_personal", updated: 5),
            ]))
    }

    func testLeavesOutEveryBotThreadAndWhatItStarted() {
        let groups = ProjectThreads.groups(sidebar, botThreads: ["main", "lead"])
        let ids = groups.flatMap(\.lines).map(\.id)
        XCTAssertFalse(ids.contains("main"), "a Bot's Main")
        XCTAssertFalse(ids.contains("lead"), "a Bot's conversation in a project")
        XCTAssertFalse(ids.contains("build"), "a worker it started")
        XCTAssertFalse(ids.contains("review"), "and what that worker started")
        XCTAssertFalse(ids.contains("old"), "nor an archived thread")
        XCTAssertEqual(Set(ids), ["form", "mobile", "icons", "receipts"])
    }

    func testGroupsByProjectNewestFirstWithChildrenNested() {
        let groups = ProjectThreads.groups(sidebar, botThreads: ["main", "lead"])
        XCTAssertEqual(groups.map(\.name), ["Website", "BB Studio", "No project"], "most recently active first; the personal project is No project")
        let site = groups[0]
        XCTAssertEqual(site.lines.map(\.id), ["form", "mobile"])
        XCTAssertEqual(site.lines.map(\.depth), [0, 1], "a thread it started nests under it")
        XCTAssertEqual(site.count, 2)
    }

    func testSearchFindsThreadsFlat() {
        let groups = ProjectThreads.groups(sidebar, botThreads: ["main", "lead"], query: "form")
        XCTAssertEqual(groups.flatMap(\.lines).map(\.id), ["mobile", "form"])
        XCTAssertEqual(groups.flatMap(\.lines).map(\.depth), [0, 0])
        XCTAssertTrue(ProjectThreads.groups(sidebar, botThreads: [], query: "nothing like this").isEmpty)
    }
}
