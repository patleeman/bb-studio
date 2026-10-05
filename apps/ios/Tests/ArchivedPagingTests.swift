import XCTest
@testable import BBStudio

/// A Space's archived threads are filtered on the phone, so loading more keeps going past pages with none of them.
final class ArchivedPagingTests: XCTestCase {
    private func thread(_ id: String, project: String) throws -> ThreadEntry {
        let json = #"{"id":"\#(id)","projectId":"\#(project)","status":"idle","parentThreadId":null,"createdAt":1,"updatedAt":1}"#
        return try JSONDecoder().decode(ThreadEntry.self, from: Data(json.utf8))
    }

    /// Pages of two; only the last thread is in the Space.
    private func archive() throws -> [ThreadEntry] {
        try [thread("a", project: "other"), thread("b", project: "other"), thread("c", project: "other"),
             thread("d", project: "other"), thread("e", project: "mine")]
    }

    func testKeepsLoadingUntilAPageAddsAMatch() async throws {
        let all = try archive()
        let mine = { (list: [ThreadEntry]) in list.filter { $0.projectId == "mine" }.count }
        var offsets: [Int] = []
        let result = try await ArchivedView.fetch(after: [], offset: 0, pageSize: 2, shown: mine) { offset in
            offsets.append(offset)
            return Array(all.dropFirst(offset).prefix(2))
        }
        XCTAssertEqual(offsets, [0, 2, 4])
        XCTAssertEqual(result.threads.map(\.id), ["a", "b", "c", "d", "e"])
        XCTAssertEqual(result.offset, 5)
        XCTAssertFalse(result.more)
    }

    func testStopsWhenThereAreNoMorePages() async throws {
        let all = Array(try archive().prefix(4))
        let mine = { (list: [ThreadEntry]) in list.filter { $0.projectId == "mine" }.count }
        let result = try await ArchivedView.fetch(after: [], offset: 0, pageSize: 2, shown: mine) { offset in
            Array(all.dropFirst(offset).prefix(2))
        }
        XCTAssertEqual(result.threads.count, 4)
        XCTAssertEqual(result.offset, 4)
        // The last page was full, so BB is asked once more and answers empty.
        XCTAssertFalse(result.more)
    }

    func testUnfilteredLoadsOnePage() async throws {
        let all = try archive()
        var calls = 0
        let result = try await ArchivedView.fetch(after: [], offset: 0, pageSize: 2, shown: \.count) { offset in
            calls += 1
            return Array(all.dropFirst(offset).prefix(2))
        }
        XCTAssertEqual(calls, 1)
        XCTAssertTrue(result.more)
        XCTAssertEqual(result.offset, 2)
    }
}
