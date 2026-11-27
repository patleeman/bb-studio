import XCTest
@testable import BBStudio

@MainActor
final class ShellEmptyBotStateTests: XCTestCase {
    private func decodeSpaces(_ json: String) throws -> BotSpaces {
        BotSpaces(try JSONDecoder().decode(Studio.BotSpacesOutput.self, from: Data(json.utf8)))
    }

    func testResolveDistinguishesLoadingFailedEmptyAndReady() throws {
        XCTAssertEqual(ShellBotState.resolve(spaces: nil, bot: nil, error: nil), .loading)
        XCTAssertEqual(ShellBotState.resolve(spaces: nil, bot: nil, error: "timed out"), .failed("timed out"))

        let emptySpaces = try decodeSpaces(#"{"bots":[],"currentBotId":null}"#)
        XCTAssertEqual(ShellBotState.resolve(spaces: emptySpaces, bot: nil, error: nil), .empty)

        let withBot = try decodeSpaces(
            #"{"bots":[{"id":"bot_1","name":"Dot","avatar":"🤖","primary":true,"mainThreadId":null,"needsYou":false}],"currentBotId":"bot_1"}"#
        )
        let bot = try XCTUnwrap(withBot.bots.first)
        XCTAssertEqual(ShellBotState.resolve(spaces: withBot, bot: bot, error: nil), .ready(bot))
    }

    func testRouterFollowsDeepLinksWhenServerHasZeroBots() {
        let store = BotSpacesStore(serverURL: URL(string: "https://unit-tests.invalid")!)
        let router = Router.shared
        router.reset()

        router.follow(.studio(kind: "mini", .mini(id: "mini_123")), store: store)
        XCTAssertEqual(router.path, [.studio, .mini(id: "mini_123")])

        router.follow(.route(.automations), store: store)
        XCTAssertEqual(router.path.last, .automations)

        router.follow(.settings, store: store)
        XCTAssertEqual(router.path, [.settings])

        router.reset()
    }
}
