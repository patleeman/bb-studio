import XCTest
@testable import BBStudio

/// Reloads that are superseded or overtaken must not undo newer state.
final class RefreshRaceTests: XCTestCase {
    private let server = URL(string: "https://refresh-race.invalid")!

    @MainActor
    func testCancelledStudioReloadKeepsTagsAndSpacesInsteadOfFallingBack() async {
        let original = BBClient.storedServerURL
        defer { BBClient.storedServerURL = original }
        BBClient.storedServerURL = server
        let store = StudioStore()
        let client = BBClient(baseURL: server)
        let cancelOverview = LockedFlag()
        client.transport = { _, path, _ in
            if path == "/api/v1/plugins" {
                return (200, Data(#"{"plugins":[{"id":"studio","status":"running"},{"id":"pages","status":"running"}]}"#.utf8))
            }
            if path.hasSuffix("/studio/rpc/overview") {
                if cancelOverview.value { throw URLError(.cancelled) }
                return (200, Data(#"""
                    {"ok":true,"result":{"items":[{"pluginId":"pages","id":"p1","kind":"page","title":"Plan","createdAt":1,"updatedAt":2}],
                    "tags":[{"id":"t1","name":"Work","color":"#ff0000"}]}}
                    """#.utf8))
            }
            // The fallback would list pages directly; it must not be reached.
            if path.contains("/plugins/pages/") { XCTFail("Fell back to the add-ons after a cancelled reload: \(path)") }
            return (404, Data())
        }
        await store.load(client)
        XCTAssertEqual(store.tags.map(\.id), ["t1"])
        XCTAssertTrue(store.viaStudio)

        cancelOverview.value = true
        await store.load(client)
        XCTAssertEqual(store.tags.map(\.id), ["t1"])
        XCTAssertTrue(store.supportsTags)
        XCTAssertTrue(store.viaStudio)
        XCTAssertEqual(store.items.map(\.itemId), ["p1"])
    }

    @MainActor
    func testSlowerOlderStudioLoadCannotReplaceANewerList() async {
        let original = BBClient.storedServerURL
        defer { BBClient.storedServerURL = original }
        BBClient.storedServerURL = server
        let store = StudioStore()
        let client = BBClient(baseURL: server)
        let calls = LockedCounter()
        client.transport = { _, path, _ in
            if path == "/api/v1/plugins" { return (200, Data(#"{"plugins":[{"id":"studio","status":"running"}]}"#.utf8)) }
            if path.hasSuffix("/studio/rpc/overview") {
                if calls.next() == 1 {
                    try await Task.sleep(for: .milliseconds(400))
                    return (200, Data(#"{"ok":true,"result":{"items":[{"pluginId":"pages","id":"old","kind":"page","title":"Old"}]}}"#.utf8))
                }
                return (200, Data(#"{"ok":true,"result":{"items":[{"pluginId":"pages","id":"new","kind":"page","title":"New"}]}}"#.utf8))
            }
            return (404, Data())
        }
        async let first: Void = store.load(client)
        try? await Task.sleep(for: .milliseconds(100))
        await store.load(client)
        await first
        XCTAssertEqual(store.items.map(\.itemId), ["new"])
        XCTAssertEqual(DiskCache.load(StudioSnapshot.self, key: StudioSnapshot.cacheKey, serverURL: server)?.items.map(\.itemId), ["new"])
    }

    @MainActor
    func testLeavingAThreadStopsAPendingRefreshFromMarkingItRead() async {
        let client = BBClient(baseURL: server)
        let reads = LockedCounter()
        client.transport = { method, path, _ in
            if path.hasPrefix("/api/v1/threads/thr_leave/timeline") {
                try await Task.sleep(for: .milliseconds(100))
                return (200, Data(#"{"rows":[{"id":"r1","kind":"conversation","role":"assistant","text":"new"}],"maxSeq":1}"#.utf8))
            }
            if method == "POST", path == "/api/v1/threads/thr_leave/read" { _ = reads.next() }
            return (404, Data(#"{"error":{"message":"not here"}}"#.utf8))
        }
        let model = ThreadModel(threadId: "thr_leave", client: client)
        model.scheduleRefresh(["events-appended"])
        try? await Task.sleep(for: .milliseconds(200))
        model.detach()
        try? await Task.sleep(for: .milliseconds(300))
        XCTAssertEqual(reads.next(), 1, "A refresh after leaving marked the thread read")
    }

    @MainActor
    func testSlowFirstLoadCannotOverwriteANewerRefresh() async {
        let client = BBClient(baseURL: server)
        let calls = LockedCounter()
        client.transport = { method, path, _ in
            if path.hasPrefix("/api/v1/threads/thr_race/timeline") {
                if calls.next() == 1 {
                    // The first page is slow and older.
                    try await Task.sleep(for: .milliseconds(400))
                    return (200, Data(#"{"rows":[{"id":"r1","kind":"conversation","role":"user","text":"hi"}],"maxSeq":1}"#.utf8))
                }
                return (200, Data(#"{"rows":[{"id":"r1","kind":"conversation","role":"user","text":"hi"},{"id":"r2","kind":"conversation","role":"assistant","text":"hello"}],"maxSeq":2}"#.utf8))
            }
            if method == "GET", path == "/api/v1/threads/thr_race" {
                return (200, Data(#"{"id":"thr_race","projectId":"p","status":"idle","createdAt":1,"updatedAt":1}"#.utf8))
            }
            return (404, Data(#"{"error":{"message":"not here"}}"#.utf8))
        }
        let model = ThreadModel(threadId: "thr_race", client: client)
        async let first: Void = model.load()
        try? await Task.sleep(for: .milliseconds(50))
        await model.refreshLatest()
        await first
        XCTAssertEqual(model.rows.map(\.id), ["r1", "r2"])
    }
}

final class LockedCounter: @unchecked Sendable {
    private let lock = NSLock()
    private var count = 0
    func next() -> Int { lock.lock(); defer { lock.unlock() }; count += 1; return count }
}

final class LockedFlag: @unchecked Sendable {
    private let lock = NSLock()
    private var stored = false
    var value: Bool {
        get { lock.lock(); defer { lock.unlock() }; return stored }
        set { lock.lock(); stored = newValue; lock.unlock() }
    }
}

final class RecordingPlayerRefreshTests: XCTestCase {
    private func segment(_ id: String, offset: Double) -> Segment {
        Segment(id: id, sessionId: "s", status: "done", text: nil, offsetMs: offset, durationMs: 1000, mimeType: "audio/mp4", error: nil)
    }

    @MainActor
    func testAudioRemovedWhileLoadingStopsInsteadOfIndexingTheOldList() async {
        let client = BBClient(baseURL: URL(string: "https://player.invalid")!)
        client.transport = { _, _, _ in
            try await Task.sleep(for: .milliseconds(200))
            return (500, Data())
        }
        let player = RecordingPlayer()
        player.configure(client: client, recordingId: "rec", title: "Talk", segments: [segment("a", offset: 0), segment("b", offset: 1000)])
        player.play(from: 1500)
        XCTAssertTrue(player.loading)
        // A refresh finds the audio expired.
        player.configure(client: client, recordingId: "rec", title: "Talk", segments: [])
        XCTAssertFalse(player.loading)
        try? await Task.sleep(for: .milliseconds(400))
        XCTAssertFalse(player.loading)
        XCTAssertNil(player.error)
        player.stop()
    }

    @MainActor
    func testAppendedSegmentKeepsLoading() {
        let player = RecordingPlayer()
        let client = BBClient(baseURL: URL(string: "https://player.invalid")!)
        client.transport = { _, _, _ in try await Task.sleep(for: .seconds(5)); return (500, Data()) }
        player.configure(client: client, recordingId: "rec", title: "Talk", segments: [segment("a", offset: 0)])
        player.play(from: 0)
        player.configure(client: client, recordingId: "rec", title: "Talk", segments: [segment("a", offset: 0), segment("b", offset: 1000)])
        XCTAssertTrue(player.loading)
        player.stop()
    }
}
