import XCTest
@testable import BBStudio

final class FeedContractTests: XCTestCase {
    func testFeedRequestUsesGeneratedMethodAndKeepsPagingInput() async throws {
        let client = BBClient(baseURL: URL(string: "https://contracts.invalid")!)
        client.transport = { method, path, body in
            XCTAssertEqual(method, "POST")
            XCTAssertEqual(path, "/api/v1/plugins/feed/rpc/\(Feed.Method.list)")
            let input = try JSONDecoder().decode(Feed.ListInput.self, from: XCTUnwrap(body))
            XCTAssertEqual(input.cursor, "older")
            XCTAssertEqual(input.topic, "Review")
            XCTAssertEqual(input.query, "recovery")
            XCTAssertEqual(input.limit, 40)
            return (200, Data(#"{"ok":true,"result":{"posts":[],"nextCursor":"next","lastSeenAt":0}}"#.utf8))
        }
        let page = try await client.feed(cursor: "older", topic: "Review", query: "recovery")
        XCTAssertEqual(page.nextCursor, "next")
        XCTAssertTrue(page.posts.isEmpty)
    }

    func testGeneratedAndNativeFeedModelsKeepLegacyReadAndFuturePriority() throws {
        let source = #"{"posts":[{"id":"post_contract","title":"Contract","body":"Report","preview":"Report","domains":[],"storyPosts":1,"priority":"future","author":"QA","createdAt":0,"updatedAt":0}],"nextCursor":null}"#
        let data = Data(source.utf8)
        let native = try JSONDecoder().decode(FeedPage.self, from: data)
        let generated = try JSONDecoder().decode(Feed.ListOutput.self, from: data)
        XCTAssertEqual(native.posts.first?.id, generated.posts?.first?.id)
        XCTAssertEqual(native.posts.first?.read, true)
        XCTAssertEqual(native.posts.first?.priority, "future")
        XCTAssertEqual(generated.posts?.first?.priority, .unknown("future"))
    }

    func testStudioChatUsesHomeContractAndHandlesUnlinkedItem() async throws {
        let client = BBClient(baseURL: URL(string: "https://contracts.invalid")!)
        client.transport = { _, path, body in
            XCTAssertEqual(path, "/api/v1/plugins/studio-chat/rpc/\(Chat.Method.home)")
            let input = try JSONDecoder().decode(Chat.HomeInput.self, from: XCTUnwrap(body))
            XCTAssertEqual(input.pluginId, "pages")
            XCTAssertEqual(input.id, "pg_contract")
            return (200, Data(#"{"ok":true,"result":{"thread":{"threadId":"thr_home","title":"Home","origin":"chosen"}}}"#.utf8))
        }
        let thread = try await client.lastStudioChat(pluginId: "pages", itemId: "pg_contract")
        XCTAssertEqual(thread, "thr_home")
        client.transport = { _, _, _ in (200, Data(#"{"ok":true,"result":{"thread":null}}"#.utf8)) }
        let unlinked = try await client.lastStudioChat(pluginId: "pages", itemId: "pg_contract")
        XCTAssertNil(unlinked)
    }
}
