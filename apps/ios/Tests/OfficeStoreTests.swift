import XCTest
@testable import BBStudio

final class OfficeStoreTests: XCTestCase {
    private struct Fixture: Decodable {
        var id: String
        var method: String
        var input: JSONValue
        var output: JSONValue
    }
    private func fixture(_ method: String) throws -> Fixture {
        let url = try XCTUnwrap(Bundle(for: Self.self).url(forResource: "native-payloads", withExtension: "json"))
        return try XCTUnwrap(JSONDecoder().decode([Fixture].self, from: Data(contentsOf: url)).first { $0.id == "office-" + method })
    }
    private func client(_ method: String) throws -> BBClient {
        let fixture = try fixture(method)
        let client = BBClient(baseURL: URL(string: "https://office.invalid")!)
        client.transport = { method, path, body in
            XCTAssertEqual(method, "POST")
            XCTAssertEqual(path, "/api/v1/plugins/studio/rpc/\(fixture.method)")
            XCTAssertEqual(try JSONDecoder().decode(JSONValue.self, from: XCTUnwrap(body)), fixture.input)
            return (200, try JSONEncoder().encode(JSONValue.object(["ok": true, "result": fixture.output])))
        }
        return client
    }

    func testAllSpaceAndFolderPayloads() async throws {
        let spaces = try await client("spaces_list").officeSpaces()
        XCTAssertEqual(spaces.first?.id, "sp_office")
        let created = try await client("space_create").officeCreateSpace(name: "Personal")
        XCTAssertTrue(created.isDefault)
        let updated = try await client("space_update").officeUpdateSpace("sp_office", name: "Personal", icon: nil, description: "")
        XCTAssertNil(updated.icon)
        try await client("space_delete").officeDeleteSpace("sp_office")
        let moved = try await client("space_move_project").officeMoveProject("proj_personal", to: "sp_office")
        XCTAssertEqual(moved.projectIds, ["proj_personal"])
        let settings = try await client("space_settings_get").officeSpaceSettings("sp_office")
        XCTAssertEqual(settings.defaultTrust, .ask)
        let saved = try await client("space_settings_set").officeSetSpaceSettings("sp_office", settings: settings)
        XCTAssertNil(saved.defaultBotModel)
        let folder = try await client("folder_create").officeCreateFolder(spaceId: "sp_office", name: "Notes")
        XCTAssertEqual(folder.id, "proj_personal")
        XCTAssertNil(folder.threads)
        try await client("folder_archive").officeArchiveFolder("proj_personal")
        let tree = try await client("space_tree").officeSpaceTree("sp_office")
        XCTAssertEqual(tree.folders.first?.items?.first?.id, "pages:pg_office")
        XCTAssertEqual(tree.folders.first?.items?.first?.authorBotId, "bot_office")
        let generated = try JSONDecoder().decode(Studio.SpaceTree2Output.self, from: JSONEncoder().encode(fixture("space_tree").output))
        XCTAssertEqual(generated.space?.id, tree.space.id)
    }

    @MainActor func testSpaceSelectionPersistsAndMissingSelectionFallsBack() async throws {
        let suite = "OfficeStoreTests.\(UUID().uuidString)"
        let defaults = try XCTUnwrap(UserDefaults(suiteName: suite))
        defer { defaults.removePersistentDomain(forName: suite) }
        let first = try await client("spaces_list").officeSpaces()[0]
        var second = first
        second.id = "sp_second"
        second.isDefault = false
        var values = [first, second]
        let store = SpacesStore(defaults: defaults, fetch: { values })
        await store.load()
        XCTAssertEqual(store.currentSpaceId, first.id)
        store.select(second.id)
        XCTAssertEqual(defaults.string(forKey: "office.currentSpaceId"), second.id)
        store.select("missing")
        XCTAssertEqual(store.currentSpaceId, second.id)
        values = [first]
        await store.refresh()
        XCTAssertEqual(store.currentSpaceId, first.id)
        XCTAssertFalse(store.isLoading)
        XCTAssertNil(store.error)
    }

    @MainActor func testSpaceRefreshFailurePreservesLastGoodState() async throws {
        let suite = "OfficeStoreTests.\(UUID().uuidString)"
        let defaults = try XCTUnwrap(UserDefaults(suiteName: suite))
        defer { defaults.removePersistentDomain(forName: suite) }
        let values = try await client("spaces_list").officeSpaces()
        var fail = false
        let store = SpacesStore(defaults: defaults, fetch: {
            if fail { throw BBError(status: 500, message: "Test failure") }
            return values
        })
        await store.load()
        fail = true
        await store.refresh()
        XCTAssertEqual(store.spaces, values)
        XCTAssertEqual(store.error, "Test failure")
        XCTAssertFalse(store.isLoading)
    }

    @MainActor func testHomeAndTeamKeepLastGoodValuesOnFailure() async throws {
        let tree = try await client("space_tree").officeSpaceTree("sp_office")
        let home = OfficeHome(needsYou: [], working: [], reports: [], recent: tree.folders[0].items ?? [])
        let bot = OfficeTeamBot(id: "bot_office", name: "Editor", avatar: nil, role: "Editing", state: .needsYou, activeTaskCount: 1)
        var fail = false
        let homeStore = HomeStore(spaceId: "sp_office", fetch: {
            if fail { throw BBError(status: 503, message: "Unavailable") }
            return home
        })
        let teamStore = TeamStore(spaceId: "sp_office", fetch: {
            if fail { throw BBError(status: 503, message: "Unavailable") }
            return ([bot], [])
        })
        await homeStore.load()
        await teamStore.load()
        fail = true
        await homeStore.refresh()
        await teamStore.refresh()
        XCTAssertEqual(homeStore.recent.first?.id, "pages:pg_office")
        XCTAssertEqual(teamStore.bots.first?.state, .needsYou)
        XCTAssertEqual(homeStore.error, "Unavailable")
        XCTAssertEqual(teamStore.error, "Unavailable")
        XCTAssertFalse(homeStore.isLoading)
        XCTAssertFalse(teamStore.isLoading)
    }

    @MainActor func testWorkOverlaysOnlyNewerKnownThreads() async throws {
        let tree = try await client("space_tree").officeSpaceTree("sp_office")
        let store = WorkStore(spaceId: "sp_office", fetch: { tree })
        await store.load()
        store.mergeLiveThreads([
            OfficeThread(id: "thr_office", title: "Running draft", state: "active", updatedAt: 3, authorBotId: nil),
            OfficeThread(id: "thr_bot", title: "Private bot work", state: "active", updatedAt: 3, authorBotId: "bot_office"),
        ])
        XCTAssertEqual(store.folders.first?.threads?.map(\.id), ["thr_office"])
        XCTAssertEqual(store.folders.first?.threads?.first?.state, "active")
        store.mergeLiveThreads([OfficeThread(id: "thr_office", title: "Stale", state: "error", updatedAt: 1, authorBotId: nil)])
        XCTAssertEqual(store.folders.first?.threads?.first?.title, "Draft")
    }
}
