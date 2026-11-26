import XCTest
@testable import BBStudio

final class BotPagesTests: XCTestCase {
    private func makeClient(_ answer: @escaping (String, [String: Any]) -> Any) -> (BBClient, () -> [(String, [String: Any])]) {
        let client = BBClient(baseURL: URL(string: "https://pages-\(UUID().uuidString.lowercased()).invalid")!)
        let lock = NSLock()
        nonisolated(unsafe) var calls: [(String, [String: Any])] = []
        client.transport = { _, path, body in
            let method = String(path.split(separator: "/").last ?? "")
            let input = body.flatMap { try? JSONSerialization.jsonObject(with: $0) as? [String: Any] } ?? [:]
            lock.withLock { calls.append((method, input)) }
            return (200, try JSONSerialization.data(withJSONObject: ["ok": true, "result": answer(method, input)]))
        }
        return (client, { lock.withLock { calls } })
    }

    // MARK: Library

    private func item(_ id: String, _ title: String, kind: BotLibraryItem.Kind = .artifact, plugin: String = "artifacts", at: Double) -> BotLibraryItem {
        BotLibraryItem(pluginId: plugin, itemId: id, title: title, kind: kind, updatedAt: at)
    }

    func testLibraryFiltersByKindSearchesTitlesAndSectionsByDate() {
        let now = Date()
        let ms = now.timeIntervalSince1970 * 1000
        let day = 86_400_000.0
        let items = [
            item("p1", "Round notes", kind: .page, plugin: "pages", at: ms - 60_000),
            item("d1", "Phone design", kind: .design, plugin: "design", at: ms - 120_000),
            item("r1", "Morning walk", kind: .recording, plugin: "talk", at: ms - 3 * day),
            item("w1", "Garden bed layout", kind: .whiteboard, plugin: "excalidraw", at: ms - 4 * day),
            item("a1", "Habit tracker", kind: .app, plugin: "minis", at: ms - 40 * day),
            item("a2", "Still 1.png", kind: .artifact, at: ms - 41 * day),
        ]
        let all = LibraryPage.sections(items, query: "", filter: .all, now: now)
        XCTAssertEqual(all.map(\.title), ["Today", "This week", "Older"])
        XCTAssertEqual(all[0].items.map(\.itemId), ["p1", "d1"], "newest first")
        XCTAssertEqual(LibraryPage.sections(items, query: "", filter: .apps, now: now).flatMap(\.items).map(\.itemId), ["a1", "a2"], "apps and artifacts together")
        XCTAssertEqual(LibraryPage.sections(items, query: "", filter: .drawings, now: now).flatMap(\.items).map(\.itemId), ["w1"])
        XCTAssertEqual(LibraryPage.sections(items, query: "", filter: .recordings, now: now).flatMap(\.items).map(\.itemId), ["r1"])
        XCTAssertEqual(LibraryPage.sections(items, query: "garden BED", filter: .all, now: now).flatMap(\.items).map(\.itemId), ["w1"], "every word, any case")
        XCTAssertTrue(LibraryPage.sections(items, query: "garden", filter: .pages, now: now).isEmpty)
        XCTAssertEqual(LibraryPage.Filter.allCases.map(\.title), ["All", "Pages", "Designs", "Recordings", "Drawings", "Apps"])
        XCTAssertTrue(LibraryPage.meta(items[0], now: now).hasPrefix("Page · "))
        XCTAssertEqual(LibraryPage.meta(items[4], now: now), "App · " + MemoryFormat.shortDate(ms - 40 * day, now: now))
        XCTAssertEqual(LibraryPage.label(.whiteboard), "Drawing")
        XCTAssertEqual(LibraryPage.dateGroup(ms - day + 1, now: Calendar.current.startOfDay(for: now).addingTimeInterval(3600)).title, "Yesterday")
    }

    func testLibraryItemsOpenInTheirViewers() async throws {
        let (client, _) = makeClient { _, _ in
            ["botId": "bot_a", "items": [
                ["pluginId": "design", "id": "dsn_1", "title": "  ", "kind": "design", "type": "design", "href": "/plugins/studio/studio/pages/dsn_1", "updatedAt": 5, "createdAt": 1, "madeIn": NSNull()],
                ["pluginId": "dashboards", "id": "dsh_1", "title": "Week", "kind": "app", "type": "dashboard", "href": "/plugins/studio/studio/apps/dsh_1", "updatedAt": 4, "createdAt": 1,
                 "madeIn": ["threadId": "thr_w", "title": "Lead", "kind": "worker", "conversationId": NSNull(), "conversationTitle": NSNull()]],
            ]]
        }
        let items = try await client.botLibrary(botId: "bot_a")
        XCTAssertEqual(items.first?.title, "Untitled")
        XCTAssertEqual(items.first?.route, .design(id: "dsn_1"))
        XCTAssertEqual(items.map(\.itemId), ["dsn_1"], "dashboards stay on the desktop")
        XCTAssertNil(RelatedSection.route("dashboards", "dsh_1"), "a related dashboard isn't a design")
        XCTAssertNil(RelatedSection.route("unknown", "x_1"))
        XCTAssertEqual(RelatedSection.route("design", "dsn_1"), .design(id: "dsn_1"))
        XCTAssertEqual(RelatedSection.route("minis", "mini_1"), .mini(id: "mini_1"))
        let studio = [StudioItem(pluginId: "dashboards", itemId: "dsh_1", kind: "dashboard", title: "W", createdAt: 0, updatedAt: 0), StudioItem(pluginId: "pages", itemId: "pg_1", kind: "page", title: "P", createdAt: 0, updatedAt: 0)]
        XCTAssertEqual(StudioStore.shown(studio).map(\.itemId), ["pg_1"], "Studio leaves dashboards out, starred and cached too")
        XCTAssertEqual(BotLibraryItem(pluginId: "talk", itemId: "rec_1", title: "R", kind: .other, updatedAt: 0).route, .recording(id: "rec_1"))
        XCTAssertEqual(BotLibraryItem(pluginId: "excalidraw", itemId: "drw_1", title: "W", kind: .whiteboard, updatedAt: 0).studioKind, "drawing")
    }

    // MARK: Archive

    func testArchiveMergesFinishedFiltersAndReopens() async throws {
        let now = Date().timeIntervalSince1970 * 1000
        let (client, calls) = makeClient { method, input in
            switch method {
            case "bot_threads_older":
                return ["botId": "bot_a",
                        "conversations": [["threadId": "thr_o", "title": "Old", "isMain": false, "forkedFrom": NSNull(), "projectId": "p", "updatedAt": now - 5_000,
                                           "latest": "", "running": false, "needsYou": NSNull(), "mirrored": false]],
                        "workers": [["threadId": "thr_f", "title": "Fix", "status": "failed", "ownerConversationId": "thr_m", "ownerTitle": "Main", "projectId": "p",
                                     "updatedAt": now - 8 * 86_400_000, "tag": NSNull(), "branch": NSNull(), "mirrored": false, "sameTitle": 1],
                                    ["threadId": "thr_d", "title": "Done", "status": "done", "ownerConversationId": NSNull(), "ownerTitle": NSNull(), "projectId": "p",
                                     "updatedAt": now, "tag": "v1", "branch": NSNull(), "mirrored": false, "sameTitle": 1]],
                        "finished": [["threadId": "thr_x", "title": "Launch", "finishedAt": now - 1_000, "summary": "Shipped"]]]
            case "bot_finished":
                return ["finished": input["threadId"] as? String == "thr_x"
                    ? ["threadId": "thr_x", "botId": "bot_a", "title": "Launch", "summary": "Shipped", "startedAt": 1, "finishedAt": 2, "records": 3, "memoryHref": NSNull(), "archived": true] as Any
                    : NSNull()]
            default:
                return ["ok": true]
            }
        }
        let data = try await client.botArchive(botId: "bot_a")
        XCTAssertEqual(data.conversations.map(\.threadId), ["thr_x", "thr_o"], "finished and older, newest first")
        XCTAssertTrue(data.conversations[0].finished)
        XCTAssertEqual(ArchivePage.shown(data, query: "", filter: .failed).workers.map(\.threadId), ["thr_f"])
        XCTAssertTrue(ArchivePage.shown(data, query: "", filter: .failed).conversations.isEmpty)
        XCTAssertTrue(ArchivePage.shown(data, query: "", filter: .conversations).workers.isEmpty)
        XCTAssertEqual(ArchivePage.shown(data, query: "v1", filter: .all).workers.map(\.threadId), ["thr_d"], "search covers the tag")
        XCTAssertEqual(ArchivePage.count(data, .failed), 1)
        XCTAssertNil(ArchivePage.count(data, .all))
        XCTAssertTrue(ArchivePage.staleFailure(data.workers[0]), "a failure over 7 days old is history")
        XCTAssertEqual(ArchivePage.statusLabel(data.workers[0]), "Failed")
        XCTAssertEqual(ArchivePage.emptyText(query: "", filter: .all), "Nothing archived")
        XCTAssertEqual(ArchivePage.emptyText(query: "x", filter: .all), "Nothing matches")

        let finished = try await client.botFinished(threadId: "thr_x")
        XCTAssertEqual(finished?.summary, "Shipped")
        let notFinished = try await client.botFinished(threadId: "thr_o")
        XCTAssertNil(notFinished)
        try await client.botReopen(threadId: "thr_x")
        XCTAssertEqual(calls().last?.0, "bot_reopen")
        XCTAssertEqual(calls().last?.1["threadId"] as? String, "thr_x")
    }

    func testReopenRefusedThrows() async {
        let (client, _) = makeClient { _, _ in ["ok": false] }
        do {
            try await client.botReopen(threadId: "thr_x")
            XCTFail("a refused reopen throws")
        } catch {}
    }

    // MARK: Demo

    func testDemoMemoryWritesAreCompareAndSwap() async throws {
        let client = BBClient(baseURL: URL(string: "https://pages-demo.invalid")!)
        client.transport = { method, path, body in
            BotSpacesDemo.State.shared.respond(method, path, body) ?? (404, Data())
        }
        let core = try await client.memoryCore(botId: "bot_juniper")
        let skill = try XCTUnwrap(core.coreSkill)
        XCTAssertEqual(skill.name, "core-profile")
        XCTAssertEqual(core.cap, 2000)
        do {
            try await client.memoryWriteSkill(botId: "bot_juniper", name: skill.name, description: skill.description, body: "x", ifBody: .string("stale"))
            XCTFail("a write over text that changed is refused")
        } catch {}
        let after = try await client.memoryCore(botId: "bot_juniper")
        XCTAssertEqual(after.coreSkill?.body, skill.body, "nothing was written")
        let summaries = try await client.memorySummaries(botId: "bot_juniper")
        XCTAssertEqual(summaries.map(\.threadId), ["thr_demo_lisbon"])
    }
}
