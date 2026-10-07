import XCTest
@testable import BBStudio

final class StudioOverviewDecodingTests: XCTestCase {
    func testMalformedEntriesAreSkippedAndCosmeticFieldsDefault() async throws {
        let client = BBClient(baseURL: URL(string: "https://overview.invalid")!)
        client.transport = { _, _, _ in
            (200, Data(#"""
            {"ok":true,"result":{
              "items":[
                {"pluginId":"artifacts","id":"a1","kind":"artifact","title":"Chart"},
                {"pluginId":"studio-tables","id":"t1","title":"No kind"},
                {"pluginId":"design","id":"d1","kind":"design","title":"Onboarding"}
              ],
              "providers":[
                {"pluginId":"artifacts","kinds":[
                  {"id":"artifact","actions":[{"id":"copy","label":"Copy {count}"},{"label":"no id"}]},
                  {"label":"No id"}
                ]},
                {"kinds":"broken"}
              ],
              "tags":[{"id":"t","name":"Work"},{"name":"no id"}],
              "spaces":{"not":"a list"}
            }}
            """#.utf8))
        }
        let overview = try await client.studioOverview()
        XCTAssertEqual(overview.items.map(\.itemId), ["a1", "d1"])
        XCTAssertEqual(overview.kinds.map(\.id), ["artifact"])
        XCTAssertEqual(overview.kinds.first?.label, "Artifact")
        XCTAssertEqual(overview.kinds.first?.plural, "Artifacts")
        XCTAssertEqual(overview.kinds.first?.actions.map(\.id), ["copy"])
        XCTAssertEqual(overview.kinds.first?.actions.first?.result, "toast")
        XCTAssertEqual(overview.tags?.map(\.id), ["t"])
        XCTAssertEqual(overview.tags?.first?.color, "#64748b")
        XCTAssertNil(overview.spaces)
    }
}
