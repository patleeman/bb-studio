import XCTest
@testable import BBStudio

/// Round 5, change 4: Home groups its one list into Needs you, Running, Earlier.
final class HomeGroupsTests: XCTestCase {
    private func line(_ id: String, _ tone: BotConversationLine.Tone) -> BotConversationLine {
        BotConversationLine(threadId: id, title: id, forkedFrom: nil, depth: 0, updatedAt: 0, tone: tone, text: "")
    }

    func testNeedsYouThenRunningThenEarlier() {
        let groups = HomeGroups.make([line("a", .quiet), line("b", .running), line("c", .needsYou), line("d", .quiet)])
        XCTAssertEqual(groups.map(\.kind), [.needsYou, .running, .earlier])
        XCTAssertEqual(groups.map { $0.lines.map(\.threadId) }, [["c"], ["b"], ["a", "d"]], "order within a group stays")
    }

    func testEmptyGroupsAreLeftOut() {
        XCTAssertEqual(HomeGroups.make([line("a", .quiet)]).map(\.kind), [.earlier])
        XCTAssertTrue(HomeGroups.make([]).isEmpty)
    }
}
