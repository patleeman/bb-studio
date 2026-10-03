import XCTest
@testable import BBStudio

@MainActor
final class PageDraftTests: XCTestCase {
    private let a = URL(string: "https://a.invalid")!
    private let b = URL(string: "https://b.invalid")!
    private func storage() -> PageDraftStore {
        let directory = FileManager.default.temporaryDirectory.appending(path: UUID().uuidString)
        addTeardownBlock { try? FileManager.default.removeItem(at: directory) }
        return PageDraftStore(directory: directory)
    }

    func testRestartRestoresOfflineDraftAndClonedIDsStayIsolated() async throws {
        let store = storage()
        let model = PageEditorModel(pageId: "same", client: BBClient(baseURL: a), store: store, read: { "base" })
        await model.load()
        model.updateText("my offline work")
        let recovered = PageEditorModel(pageId: "same", client: BBClient(baseURL: a), store: store,
                                        read: { throw URLError(.notConnectedToInternet) })
        await recovered.load()
        XCTAssertEqual(recovered.text, "my offline work")
        XCTAssertEqual(recovered.expected, "base")
        XCTAssertTrue(recovered.canClose)
        XCTAssertNil(try store.load(server: b, page: "same"))
        XCTAssertEqual(store.pages(server: a), ["same"])
        XCTAssertTrue(store.pages(server: b).isEmpty)
    }

    func testNewerServerNeverRebasesDraftOrWritesOnRetry() async throws {
        let store = storage()
        try store.save(.init(serverURL: a, pageId: "p", kind: "edit", text: "mine", expected: "old"))
        var writes = 0
        let model = PageEditorModel(pageId: "p", client: BBClient(baseURL: a), store: store,
                                   read: { "new from another editor" }, edit: { _, _ in writes += 1; return "bad" })
        await model.retry()
        XCTAssertTrue(model.conflict)
        XCTAssertEqual(model.expected, "old")
        XCTAssertEqual(model.text, "mine")
        XCTAssertEqual(writes, 0)
        XCTAssertEqual(try store.load(server: a, page: "p")?.expected, "old")
        await model.discardAndReload()
        XCTAssertEqual(model.text, "new from another editor")
        XCTAssertFalse(model.conflict)
        XCTAssertNil(try store.load(server: a, page: "p"))
    }

    func testDelayedAcknowledgementCannotRemoveNewTyping() async throws {
        let store = storage()
        let gate = PageSaveGate()
        let entered = expectation(description: "Save entered")
        let model = PageEditorModel(pageId: "p", client: BBClient(baseURL: a), store: store, read: { "base" }, edit: { base, text in
            XCTAssertEqual(base, "base")
            entered.fulfill()
            await gate.wait()
            return text
        })
        await model.load()
        model.updateText("first")
        let saving = Task { await model.save() }
        await fulfillment(of: [entered], timeout: 2)
        model.updateText("first plus next")
        let interrupted = try XCTUnwrap(store.load(server: a, page: "p"))
        XCTAssertEqual(interrupted.submitted, "first")
        XCTAssertEqual(interrupted.text, "first plus next")
        await gate.release()
        await saving.value
        let durable = try XCTUnwrap(store.load(server: a, page: "p"))
        XCTAssertEqual(durable.text, "first plus next")
        XCTAssertEqual(durable.expected, "first")
        XCTAssertNil(durable.submitted)
    }

    func testRestartAfterLostAcknowledgementRetainsSubsequentTyping() async throws {
        let store = storage()
        try store.save(.init(serverURL: a, pageId: "p", kind: "edit", text: "next", expected: "base", submitted: "sent"))
        var bases: [String] = []
        let model = PageEditorModel(pageId: "p", client: BBClient(baseURL: a), store: store,
                                   read: { "<!-- ^id -->\nsent" }, edit: { base, text in bases.append(base); return text })
        await model.load()
        XCTAssertEqual(model.text, "next")
        XCTAssertFalse(model.conflict)
        await model.save()
        XCTAssertEqual(bases, ["<!-- ^id -->\nsent"])
        XCTAssertNil(try store.load(server: a, page: "p"))
    }

    func testAtomicWriteFailureKeepsOldFileAndBlocksServerSaveAndClose() async throws {
        var store = storage()
        try store.save(.init(serverURL: a, pageId: "p", kind: "edit", text: "durable", expected: "base"))
        store.write = { _, _ in throw CocoaError(.fileWriteOutOfSpace) }
        var writes = 0
        let model = PageEditorModel(pageId: "p", client: BBClient(baseURL: a), store: store, read: { "base" },
                                   edit: { _, text in writes += 1; return text })
        await model.load()
        model.updateText("new unsaved typing")
        await model.save()
        XCTAssertEqual(writes, 0)
        XCTAssertNotNil(model.localError)
        XCTAssertFalse(model.canClose)
        XCTAssertEqual(try store.load(server: a, page: "p")?.text, "durable")
    }

    func testAcknowledgementPersistenceFailureRecoversPendingRecordAfterRestart() async throws {
        var store = storage()
        var failWrites = false
        store.write = { data, file in
            if failWrites { throw CocoaError(.fileWriteOutOfSpace) }
            try data.write(to: file, options: .atomic)
        }
        let model = PageEditorModel(pageId: "p", client: BBClient(baseURL: a), store: store,
                                   read: { "base" }, edit: { _, text in failWrites = true; return text })
        await model.load()
        model.updateText("sent")
        await model.save()
        XCTAssertNotNil(model.localError)
        let pending = try XCTUnwrap(store.load(server: a, page: "p"))
        XCTAssertEqual(pending.expected, "base")
        XCTAssertEqual(pending.submitted, "sent")
        failWrites = false
        var sends = 0
        let restarted = PageEditorModel(pageId: "p", client: BBClient(baseURL: a), store: store,
                                       read: { "sent" }, edit: { _, text in sends += 1; return text })
        await restarted.retry()
        XCTAssertEqual(sends, 0)
        XCTAssertEqual(restarted.text, "sent")
        XCTAssertFalse(restarted.dirty)
        XCTAssertNil(restarted.localError)
    }

    func testMissingPageStillRetainsDraftAndCorruptDraftIsNotOverwritten() async throws {
        let store = storage()
        try store.save(.init(serverURL: a, pageId: "p", kind: "edit", text: "recover me", expected: "base"))
        let model = PageEditorModel(pageId: "p", client: BBClient(baseURL: a), store: store,
                                   read: { throw BBError(status: 404, message: "Page not found") })
        await model.retry()
        XCTAssertEqual(model.text, "recover me")
        let file = store.url(server: a, page: "p")
        try Data("corrupted but preserve".utf8).write(to: file)
        let unreadable = PageEditorModel(pageId: "p", client: BBClient(baseURL: a), store: store, read: { "server" })
        await unreadable.load()
        unreadable.updateText("replacement")
        XCTAssertFalse(unreadable.canClose)
        XCTAssertEqual(try String(contentsOf: file, encoding: .utf8), "corrupted but preserve")
        XCTAssertEqual(store.pages(server: a), ["p"])
    }

    func testWorkPromptRestartAndDelayedSendPreserveFollowup() throws {
        let store = storage()
        let draft = PageWorkDraft(server: a, page: "p", store: store)
        draft.update(text: "first", projectId: "proj_a")
        draft.update(text: "follow-up")
        draft.sent("first")
        let recovered = PageWorkDraft(server: a, page: "p", store: store)
        XCTAssertEqual(recovered.text, "follow-up")
        XCTAssertEqual(recovered.projectId, "proj_a")
        XCTAssertEqual(PageWorkDraft(server: b, page: "p", store: store).text, "")
    }
}

private actor PageSaveGate {
    private var continuation: CheckedContinuation<Void, Never>?
    func wait() async { await withCheckedContinuation { continuation = $0 } }
    func release() { continuation?.resume(); continuation = nil }
}
