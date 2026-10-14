import XCTest
@testable import BBStudio

/// The Bot chat (and every thread) draws its cached rows at once, merges the
/// server's by id, and shows a sent message before the server does.
final class TimelineCacheTests: XCTestCase {
    private let server = URL(string: "https://timeline-cache.invalid")!

    private func message(_ id: String, _ role: String = "assistant", _ text: String? = nil, initiator: String? = nil) -> TimelineRow {
        var row = TimelineRow(id: id, kind: "conversation", role: role, text: text ?? "Text of \(id)")
        row.initiator = initiator
        return row
    }

    private func work(_ id: String, output: String? = nil) -> TimelineRow {
        TimelineRow(id: id, kind: "work", status: "completed", output: output)
    }

    private func pageJSON(_ rows: [TimelineRow], hasOlder: Bool = false, cursor: (Int, String)? = nil, maxSeq: Int = 1) -> Data {
        let rowsJSON = String(data: try! JSONEncoder().encode(rows), encoding: .utf8)!
        let older = cursor.map { #","olderCursor":{"anchorSeq":\#($0.0),"anchorId":"\#($0.1)"}"# } ?? ""
        return Data(#"{"rows":\#(rowsJSON),"maxSeq":\#(maxSeq),"timelinePage":{"hasOlderRows":\#(hasOlder)\#(older)}}"#.utf8)
    }

    private let threadJSON = Data(#"{"id":"thr_c","projectId":"p","status":"idle","createdAt":1,"updatedAt":2}"#.utf8)

    // MARK: The cache

    func testTrimKeepsTheLastMessagesAndTheWorkBetweenThem() {
        var rows: [TimelineRow] = []
        for index in 0..<80 {
            rows.append(message("m\(index)", index.isMultiple(of: 2) ? "user" : "assistant"))
            rows.append(work("w\(index)"))
        }
        let trimmed = TimelineCache.trim(rows, messages: 50)
        XCTAssertEqual(trimmed.filter(\.isConversation).count, 50)
        XCTAssertEqual(trimmed.first?.id, "m30")
        XCTAssertEqual(trimmed.last?.id, "w79")
        XCTAssertEqual(TimelineCache.trim(Array(rows.prefix(6)), messages: 50).map(\.id), rows.prefix(6).map(\.id))
    }

    func testTrimCutsLongToolOutput() {
        let rows = [work("w", output: String(repeating: "x", count: 10_000)), message("m")]
        XCTAssertEqual(TimelineCache.trim(rows).first?.output?.count, TimelineCache.outputLimit)
    }

    func testWritesAndReadsBackCappedAtFiftyMessages() {
        let rows = (0..<120).map { message("m\($0)") }
        TimelineCache.save("thr_rw", thread: nil, rows: rows, serverURL: server)
        TimelineCache.flush()
        let snapshot = TimelineCache.load("thr_rw", serverURL: server)
        XCTAssertEqual(snapshot?.rows.count, 50)
        XCTAssertEqual(snapshot?.rows.first?.id, "m70")
        XCTAssertEqual(snapshot?.rows.last?.id, "m119")
        XCTAssertNil(TimelineCache.load("thr_rw", serverURL: URL(string: "https://other.invalid")!))
    }

    func testACorruptFileIsIgnored() throws {
        let url = DiskCache.fileURL(TimelineCache.key("thr_bad"), serverURL: server)
        try FileManager.default.createDirectory(at: url.deletingLastPathComponent(), withIntermediateDirectories: true)
        try Data("{\"rows\":[{\"id\":".utf8).write(to: url)
        XCTAssertNil(TimelineCache.load("thr_bad", serverURL: server))
        try Data(#"{"something":"else"}"#.utf8).write(to: url)
        XCTAssertNil(TimelineCache.load("thr_bad", serverURL: server))
    }

    // MARK: Merging by id

    func testAPageThatJoinsUpKeepsTheRowsAboveIt() {
        let cached = ["a", "b", "c", "d"].map { message($0) }
        let page = [message("c"), message("d", "assistant", "edited"), message("e")]
        let (rows, contiguous) = TimelineMerge.merge(cached, page: page)
        XCTAssertTrue(contiguous)
        XCTAssertEqual(rows.map(\.id), ["a", "b", "c", "d", "e"])
        XCTAssertEqual(rows[3].text, "edited")
    }

    func testAnUnchangedPageLeavesTheRowsEqual() {
        let cached = ["a", "b", "c"].map { message($0) }
        let (rows, contiguous) = TimelineMerge.merge(cached, page: Array(cached.suffix(2)))
        XCTAssertTrue(contiguous)
        XCTAssertEqual(rows, cached)
    }

    func testAPageWithAGapReplacesTheRows() {
        let (rows, contiguous) = TimelineMerge.merge(["a", "b"].map { message($0) }, page: ["x", "y"].map { message($0) })
        XCTAssertFalse(contiguous)
        XCTAssertEqual(rows.map(\.id), ["x", "y"])
        XCTAssertTrue(TimelineMerge.merge([], page: [message("x")]).contiguous)
    }

    func testEachNewUserMessageConfirmsTheOldestPendingOnce() {
        let before = [message("u1", "user"), message("a1")]
        let first = PendingSend(text: "One", rows: before)
        let second = PendingSend(text: "Two", rows: before)
        var claimed = Set<String>()
        // BB's own message about a child thread isn't the user's.
        var rows = before + [message("s1", "user", initiator: "system"), message("u2", "user", "One, as BB wrote it")]
        var left = TimelineMerge.unconfirmed([first, second], in: rows, claimed: &claimed)
        XCTAssertEqual(left.map(\.row.text), ["Two"])
        // Asked again with the same rows, u2 doesn't count twice.
        left = TimelineMerge.unconfirmed(left, in: rows, claimed: &claimed)
        XCTAssertEqual(left.map(\.row.text), ["Two"])
        rows.append(message("u3", "user", "Two"))
        XCTAssertTrue(TimelineMerge.unconfirmed(left, in: rows, claimed: &claimed).isEmpty)
    }

    // MARK: The model

    @MainActor
    func testCachedRowsShowAtOnceAndTheServerPageMergesInPlace() async {
        let original = BBClient.storedServerURL
        defer { BBClient.storedServerURL = original }
        BBClient.storedServerURL = server
        let cached = (0..<10).map { message("m\($0)") }
        TimelineCache.save("thr_c", thread: nil, rows: cached, serverURL: server)
        TimelineCache.flush()

        let client = BBClient(baseURL: server)
        let page = Array(cached.suffix(4)) + [message("m10")]
        client.transport = { [threadJSON] method, path, _ in
            if path == "/api/v1/threads/thr_c" { return (200, threadJSON) }
            if path.hasPrefix("/api/v1/threads/thr_c/timeline") { return (200, self.pageJSON(page, hasOlder: true, cursor: (6, "m6"))) }
            return (404, Data(#"{"error":{"message":"no"}}"#.utf8))
        }
        let model = ThreadModel(threadId: "thr_c", client: client)
        // Before any request: the cached rows.
        XCTAssertTrue(model.loaded)
        XCTAssertTrue(model.showsCache)
        XCTAssertEqual(model.rows.map(\.id), cached.map(\.id))

        await model.load()
        XCTAssertFalse(model.showsCache)
        XCTAssertEqual(model.rows.map(\.id), (0...10).map { "m\($0)" })
        // It joined up, so the timeline isn't rebuilt.
        XCTAssertEqual(model.replacedCache, 0)
    }

    @MainActor
    func testOlderPagesSkipRowsAlreadyKeptFromTheCache() async {
        let original = BBClient.storedServerURL
        defer { BBClient.storedServerURL = original }
        BBClient.storedServerURL = server
        let all = (0..<12).map { message("o\($0)") }
        TimelineCache.save("thr_o", thread: nil, rows: Array(all[4...]), serverURL: server)
        TimelineCache.flush()
        let client = BBClient(baseURL: server)
        client.transport = { method, path, _ in
            if path == "/api/v1/threads/thr_o" { return (200, Data(#"{"id":"thr_o","projectId":"p","status":"idle","createdAt":1,"updatedAt":2}"#.utf8)) }
            guard path.hasPrefix("/api/v1/threads/thr_o/timeline") else { return (404, Data(#"{"error":{"message":"no"}}"#.utf8)) }
            let before = URLComponents(string: path)?.queryItems?.first { $0.name == "beforeAnchorSeq" }?.value.flatMap(Int.init) ?? 12
            let start = max(0, before - 3)
            return (200, self.pageJSON(Array(all[start..<before]), hasOlder: start > 0, cursor: start > 0 ? (start, "o\(start)") : nil))
        }
        let model = ThreadModel(threadId: "thr_o", client: client)
        await model.load()
        XCTAssertEqual(model.rows.first?.id, "o4")
        // The first page up (o6–o8) is all cached; it goes on to o3–o5.
        let result = await model.loadOlder()
        XCTAssertEqual(result, .added)
        XCTAssertEqual(model.rows.map(\.id), (3..<12).map { "o\($0)" })
    }

    /// Sending keeps every row on screen, shows the message at once, and the
    /// server's row replaces it.
    @MainActor
    func testSendKeepsTheRowsAndShowsTheMessageUntilTheServersRowReplacesIt() async {
        let original = BBClient.storedServerURL
        defer { BBClient.storedServerURL = original }
        BBClient.storedServerURL = server
        let history = [message("h1", "user", "Hi"), message("h2", "assistant", "Hello")]
        let sent = LockedFlag()
        let client = BBClient(baseURL: server)
        client.transport = { method, path, _ in
            if path == "/api/v1/threads/thr_s" {
                return (200, Data(#"{"id":"thr_s","projectId":"p","status":"\#(sent.value ? "active" : "idle")","createdAt":1,"updatedAt":2}"#.utf8))
            }
            if path.hasPrefix("/api/v1/threads/thr_s/timeline") {
                let rows = sent.value ? history + [self.message("srv1", "user", "Ship it")] : history
                return (200, self.pageJSON(rows, maxSeq: rows.count))
            }
            if method == "POST", path == "/api/v1/threads/thr_s/send" {
                try await Task.sleep(for: .milliseconds(300))
                sent.value = true
                return (200, Data(#"{"ok":true,"delivery":"sent"}"#.utf8))
            }
            return (404, Data(#"{"error":{"message":"no"}}"#.utf8))
        }
        let model = ThreadModel(threadId: "thr_s", client: client)
        await model.load()
        XCTAssertEqual(model.chainRows.map(\.id), ["h1", "h2"])

        async let done = model.send("Ship it")
        try? await Task.sleep(for: .milliseconds(100))
        // In flight: the history stays, and the message shows after it.
        XCTAssertEqual(model.rows.map(\.id), ["h1", "h2"])
        XCTAssertEqual(model.chainRows.count, 3)
        XCTAssertEqual(model.chainRows.last?.text, "Ship it")
        XCTAssertTrue(model.chainRows.last?.id.hasPrefix("pending:") == true)
        XCTAssertEqual(model.shownRows.last?.text, "Ship it")

        let ok = await done
        XCTAssertTrue(ok)
        XCTAssertTrue(model.pendingSends.isEmpty)
        XCTAssertEqual(model.chainRows.map(\.id), ["h1", "h2", "srv1"])
    }

    @MainActor
    func testAFailedSendTakesTheMessageBackOut() async {
        let client = BBClient(baseURL: server)
        client.transport = { _, _, _ in (500, Data(#"{"error":{"message":"down"}}"#.utf8)) }
        let model = ThreadModel(threadId: "thr_f", client: client)
        let ok = await model.send("Lost")
        XCTAssertFalse(ok)
        XCTAssertTrue(model.pendingSends.isEmpty)
        XCTAssertTrue(model.chainRows.isEmpty)
    }
}
