import XCTest
@testable import BBStudio

/// A new Codex fork (a Bot's side thread) opens with Codex's deprecation
/// notice about how BB forks. The transcript leaves it out, so the thread
/// doesn't open on it; errors and other warnings still show.
final class DeprecationNoticeTests: XCTestCase {
    func testDeprecationNoticeIsLeftOutAndErrorsStay() throws {
        let json = """
        [
          {"id":"dep","kind":"system","systemKind":"operation","operationKind":"deprecation","title":"Deprecation notice","detail":"Full-history hydration is deprecated for paginated threads","status":"completed","createdAt":1},
          {"id":"warn","kind":"system","systemKind":"operation","operationKind":"warning","title":"Configuration warning","status":"completed","createdAt":2},
          {"id":"u1","kind":"conversation","role":"user","text":"Which is riskier?","createdAt":3},
          {"id":"err","kind":"system","systemKind":"error","title":"Turn failed","status":"error","createdAt":4},
          {"id":"a1","kind":"conversation","role":"assistant","text":"The checklist.","createdAt":5}
        ]
        """
        let rows = try JSONDecoder().decode([TimelineRow].self, from: Data(json.utf8))
        XCTAssertTrue(rows[0].isDeprecationNotice)
        XCTAssertFalse(rows[1].isDeprecationNotice)
        XCTAssertFalse(rows[3].isDeprecationNotice)
        let items = TimelineItem.group(rows)
        XCTAssertEqual(items.map(\.id), ["activity:warn", "u1", "activity:err", "a1"])
        XCTAssertFalse(items.flatMap(\.rows).contains { $0.id == "dep" })
    }
}
