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

    private static func record(_ id: String, topic: String = "Work", text: String = "A fact", source: [String: Any] = ["kind": "manual", "id": NSNull(), "title": "Added by you", "section": NSNull()],
                               state: Any = NSNull(), replacedBy: Any = NSNull(), replaces: Any = NSNull(), archived: Bool = false) -> [String: Any] {
        ["id": id, "botId": "bot_a", "topic": topic, "text": text, "createdAt": 1_762_000_000_000.0, "updatedAt": 1_762_000_000_000.0, "source": source,
         "sourceState": state, "replacesId": NSNull(), "replaces": replaces, "replacedById": replacedBy, "replacedAt": NSNull(), "archived": archived]
    }

    // MARK: Memory

    func testMemoryOverviewAndListDecodeAndSplitReplaced() async throws {
        let (client, calls) = makeClient { method, _ in
            switch method {
            case "memory.overview":
                return ["bot": ["id": "bot_a", "name": "Juniper"], "profile": ["pageId": "pg_p", "title": "Profile", "updatedAt": 1, "chars": 2600, "cap": 2500, "over": true],
                        "split": ["state": "none", "legacyPageId": NSNull(), "legacyTitle": NSNull(), "splitAt": NSNull()],
                        "counts": ["current": 2, "replaced": 1, "archived": 0], "topics": [["topic": "Work", "count": 2]]]
            default:
                return ["records": [Self.record("r1"), Self.record("r0", replacedBy: "r1"), Self.record("r2", topic: "Home")], "total": 3]
            }
        }
        let overview = try await client.memoryOverview(botId: "bot_a")
        XCTAssertEqual(overview.botName, "Juniper")
        XCTAssertEqual(overview.profile.map(MemoryPage.profileCount), "2,600 of 2,500 characters")
        XCTAssertEqual(overview.profile?.over, true)
        XCTAssertEqual(overview.topics.map(\.topic), ["Work"])

        let result = try await client.memoryRecords(botId: "bot_a", query: "  ", topic: "Work", sort: .oldest)
        let split = MemoryPage.split(result.records)
        XCTAssertEqual(split.current.map(\.id), ["r1", "r2"])
        XCTAssertEqual(split.replaced.map(\.id), ["r0"])
        let input = calls().last!.1
        XCTAssertEqual(input["botId"] as? String, "bot_a")
        XCTAssertEqual(input["topic"] as? String, "Work")
        XCTAssertEqual(input["sort"] as? String, "oldest")
        XCTAssertNil(input["query"], "an empty search sends no query, not null")
    }

    func testMemoryWritesSendTheirInputs() async throws {
        let (client, calls) = makeClient { method, input in
            if method == "memory.update" { return ["record": Self.record("r9", text: input["text"] as? String ?? ""), "replaced": Self.record("r1", replacedBy: "r9")] }
            return ["record": Self.record(input["id"] as? String ?? "r8", archived: input["archived"] as? Bool ?? false)]
        }
        let added = try await client.memoryAdd(botId: "bot_a", topic: "Food", text: "No cilantro.")
        XCTAssertEqual(added?.id, "r8")
        let updated = try await client.memoryUpdate(botId: "bot_a", id: "r1", text: "New text", topic: nil)
        XCTAssertEqual(updated?.text, "New text")
        let archived = try await client.memoryArchive(botId: "bot_a", id: "r1", archived: true)
        XCTAssertEqual(archived?.archived, true)
        let sent = calls()
        XCTAssertEqual(sent.map(\.0), ["memory.add", "memory.update", "memory.archive"])
        XCTAssertEqual(sent[0].1["topic"] as? String, "Food")
        XCTAssertNil(sent[1].1["topic"], "an unchanged topic stays out")
        XCTAssertEqual(sent[2].1["archived"] as? Bool, true)
    }

    func testSourceLabelsAndTargetsMatchDesktop() throws {
        func record(_ source: [String: Any], state: Any = NSNull()) throws -> MemoryRecord {
            let data = try JSONSerialization.data(withJSONObject: Self.record("r", source: source, state: state))
            return try XCTUnwrap(MemoryRecord(try JSONDecoder().decode(Studio.MemoryListOutputRecordsItem.self, from: data)))
        }
        let main = try record(["kind": "conversation", "id": "thr_m", "title": "Main", "section": NSNull()])
        XCTAssertEqual(MemoryPage.sourceLabel(main), "from Main")
        XCTAssertEqual(MemoryPage.sourceTarget(main), .thread("thr_m"))
        let finished = try record(["kind": "conversation", "id": "thr_l", "title": "Launch prep", "section": NSNull()], state: "finished")
        XCTAssertEqual(MemoryPage.sourceLabel(finished), "from “Launch prep” (finished)")
        let worker = try record(["kind": "worker", "id": "thr_w", "title": "Runner: staff sweep", "section": NSNull()])
        XCTAssertEqual(MemoryPage.sourceLabel(worker), "from Runner: staff sweep")
        let page = try record(["kind": "page", "id": "pg_1", "title": "Chief of Staff's Memory", "section": "Systems"])
        XCTAssertEqual(MemoryPage.sourceLabel(page), "from “Chief of Staff's Memory” › Systems")
        XCTAssertEqual(MemoryPage.sourceTarget(page), .page("pg_1"))
        let gone = try record(["kind": "thread", "id": "thr_x", "title": "Old", "section": NSNull()], state: "missing")
        XCTAssertEqual(MemoryPage.sourceLabel(gone), "from “Old” (removed)")
        XCTAssertNil(MemoryPage.sourceTarget(gone))
        let manual = try record(["kind": "manual", "id": NSNull(), "title": "Added by you", "section": NSNull()])
        XCTAssertEqual(MemoryPage.sourceLabel(manual), "added by you")
        XCTAssertNil(MemoryPage.sourceTarget(manual))
    }

    func testReplacesTopicsPromptAndSave() {
        let now = Date()
        var record = MemoryRecord(id: "r", botId: "b", topic: "Work", text: "x", createdAt: 0, source: .init(kind: .manual, title: "Added by you"))
        XCTAssertNil(MemoryPage.replacesLabel(record))
        record.replaces = (String(repeating: "word ", count: 20), now.timeIntervalSince1970 * 1000)
        let label = MemoryPage.replacesLabel(record, now: now) ?? ""
        XCTAssertTrue(label.hasPrefix("replaces “word word"), label)
        XCTAssertTrue(label.contains("…”"), "a long text is cut")
        XCTAssertEqual(MemoryPage.topicPills([("Work", 3), ("Home", 1)], picked: "Food"), ["Work", "Home", "Food"])
        XCTAssertEqual(MemoryPage.topicPills([("Work", 3)], picked: "work"), ["Work"])
        XCTAssertEqual(MemoryPage.searchPrompt(1), "Search 1 record")
        XCTAssertEqual(MemoryPage.searchPrompt(1214), "Search 1,214 records")
        XCTAssertFalse(MemoryPage.canSave(topic: "Work", text: "x", initial: ("Work", "x")), "nothing changed")
        XCTAssertFalse(MemoryPage.canSave(topic: " ", text: "x", initial: ("", "")))
        XCTAssertTrue(MemoryPage.canSave(topic: "Work", text: "y", initial: ("Work", "x")))
        XCTAssertFalse(MemoryPage.canSave(topic: String(repeating: "t", count: 61), text: "y", initial: ("", "")))
    }

    // MARK: Library

    private func item(_ id: String, _ title: String, kind: BotLibraryItem.Kind = .artifact, plugin: String = "artifacts", at: Double,
                      madeIn: BotLibraryItem.MadeIn? = nil) -> BotLibraryItem {
        BotLibraryItem(pluginId: plugin, itemId: id, title: title, kind: kind, updatedAt: at, madeIn: madeIn)
    }

    func testLibraryGroupsByConversationFoldsLookalikesAndFilters() {
        let main = BotLibraryItem.MadeIn(threadId: "thr_m", title: "Main", worker: false, conversationId: "thr_m", conversationTitle: "Main")
        let worker = BotLibraryItem.MadeIn(threadId: "thr_w", title: "Fable lead", worker: true, conversationId: "thr_m", conversationTitle: "Main")
        let items = [
            item("a1", "Real explorer in BB colours: shot-1.png", at: 10, madeIn: worker),
            item("a2", "Real explorer in BB colours: shot-2.png", at: 9, madeIn: worker),
            item("p1", "Plan", kind: .page, plugin: "pages", at: 8, madeIn: main),
            item("m1", "Mine", kind: .app, plugin: "minis", at: 20),
        ]
        let groups = LibraryPage.groups(items, query: "", kind: nil, groupBy: .conversation)
        XCTAssertEqual(groups.map(\.title), ["Made by you", "Main"], "groups by their newest file")
        XCTAssertEqual(groups[1].threadId, "thr_m")
        XCTAssertEqual(groups[1].count, 3)
        XCTAssertEqual(groups[1].rows.map(\.count), [2, 1], "lookalikes from one source fold")
        XCTAssertEqual(LibraryPage.meta(items[0], groupBy: .conversation, now: Date(timeIntervalSince1970: 0)).hasPrefix("App · by Fable lead"), true)
        XCTAssertEqual(LibraryPage.meta(items[2], groupBy: .conversation, now: Date(timeIntervalSince1970: 0)).hasPrefix("Page · "), true, "no 'made in' under its own group")
        XCTAssertEqual(LibraryPage.provenance(items[3]), "made by you")
        XCTAssertEqual(LibraryPage.groups(items, query: "", kind: .page, groupBy: .conversation).flatMap(\.rows).map(\.item.itemId), ["p1"])
        XCTAssertEqual(LibraryPage.groups(items, query: "fable", kind: nil, groupBy: .conversation).flatMap(\.rows).map(\.item.itemId), ["a1"])
        XCTAssertEqual(LibraryPage.filters.map(LibraryPage.chip), ["Page", "Whiteboard", "Design", "Apps"], "one chip for apps and artifacts")
        XCTAssertEqual(Set(LibraryPage.groups(items, query: "", kind: .app, groupBy: .date).flatMap(\.rows).map(\.item.kind)), [.app, .artifact])
        XCTAssertEqual(LibraryPage.groups(items, query: "", kind: nil, groupBy: .kind).map(\.title), ["Pages", "Apps"])
        XCTAssertEqual([BotLibraryItem.Kind.artifact, .app].map(LibraryPage.label), ["App", "App"], "every app says App")
    }

    func testLibraryFoldsLongGroupsAndGroupsByDate() {
        let rows = (0..<11).map { BotLibraryRow(id: "\($0)", item: item("\($0)", "x\($0)", at: 0), count: 1) }
        let folded = LibraryPage.folded(rows, open: false)
        XCTAssertEqual(folded.shown.count, 8)
        XCTAssertEqual(folded.more, 3)
        XCTAssertEqual(LibraryPage.folded(rows, open: true).more, 0)
        let now = Date()
        let ms = now.timeIntervalSince1970 * 1000
        XCTAssertEqual(LibraryPage.dateGroup(ms, now: now).title, "Today")
        XCTAssertEqual(LibraryPage.dateGroup(ms - 3 * 86_400_000, now: now).title, "This week")
        XCTAssertEqual(LibraryPage.dateGroup(ms - 90 * 86_400_000, now: now).title, "Older")
        XCTAssertEqual(LibraryPage.titleStem("Real explorer in BB colours: a.png"), "real explorer in bb colours")
        XCTAssertEqual(LibraryPage.titleStem("Still 12.png"), "still #")
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
        XCTAssertEqual(items.last?.route, .dashboard(id: "dsh_1"), "apps open by plugin, not by the /apps family address")
        XCTAssertEqual(items.last?.madeIn?.worker, true)
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
        XCTAssertEqual(finished?.recordsLabel, "3 memory records")
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

    func testDemoFiltersMemoryByTopic() async throws {
        let client = BBClient(baseURL: URL(string: "https://pages-demo.invalid")!)
        client.transport = { method, path, body in
            BotSpacesDemo.State.shared.respond(method, path, body) ?? (404, Data())
        }
        let home = try await client.memoryRecords(botId: "bot_juniper", query: "", topic: "Home", sort: .newest)
        XCTAssertEqual(home.records.map(\.topic), ["Home"])
    }
}
