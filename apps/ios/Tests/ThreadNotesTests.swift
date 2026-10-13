import XCTest
@testable import BBStudio

/// "Expand to page": the draft → note request, the composer after the move,
/// the "Notes in progress" chip, and the `notes.*` calls behind the done actions.
@MainActor
final class ThreadNotesTests: XCTestCase {
    private actor Calls {
        var requests: [(path: String, body: JSONValue)] = []
        func append(_ path: String, _ body: Data?) {
            requests.append((path, body.flatMap { try? JSONDecoder().decode(JSONValue.self, from: $0) } ?? .null))
        }
    }

    nonisolated private static func noteJSON(state: String = "open", pageId: String = "pg_1") -> String {
        #"{"pageId":"\#(pageId)","threadId":"thr_1","title":"Notes · Oct 13, 2:05 PM · Weekly sync","state":"\#(state)","href":"/plugins/studio/studio/pages/\#(pageId)","length":42,"createdAt":1,"updatedAt":2}"#
    }

    private func client(_ answer: @escaping @Sendable (String) -> String) -> (BBClient, Calls) {
        let client = BBClient(baseURL: URL(string: "https://notes.invalid")!)
        let calls = Calls()
        client.transport = { _, path, body in
            await calls.append(path, body)
            return (200, Data(#"{"ok":true,"result":\#(answer(path))}"#.utf8))
        }
        return (client, calls)
    }

    // MARK: Draft → note

    func testCreateRequestCarriesTheDraftAsTypedAndTheTimeZone() {
        let text = "Dana: copy is final\n- ship Friday\n"
        let body = NoteRequests.create(threadId: "thr_1", text: text, timeZone: "Europe/Paris")
        XCTAssertEqual(body, ["threadId": "thr_1", "text": .string(text), "timeZone": "Europe/Paris"])
        // No zone: the server's.
        XCTAssertEqual(NoteRequests.create(threadId: "thr_1", text: "x", timeZone: nil), ["threadId": "thr_1", "text": "x"])
    }

    func testTheComposerClearsOnlyWhenItStillHoldsTheMovedText() {
        XCTAssertEqual(ThreadNotes.draftAfterMove(current: "notes", moved: "notes"), "")
        // Typed into meanwhile: left as it is.
        XCTAssertNil(ThreadNotes.draftAfterMove(current: "notes and more", moved: "notes"))
        // Nothing moved (opening the open note): nothing to clear.
        XCTAssertNil(ThreadNotes.draftAfterMove(current: "  ", moved: "  "))
    }

    func testExpandLabelMatchesDesktop() {
        XCTAssertEqual(ThreadNotes.expandLabel(hasNote: false, draftEmpty: false), "Expand to page")
        XCTAssertEqual(ThreadNotes.expandLabel(hasNote: false, draftEmpty: true), "Expand to page")
        XCTAssertEqual(ThreadNotes.expandLabel(hasNote: true, draftEmpty: true), "Open notes in progress")
        XCTAssertEqual(ThreadNotes.expandLabel(hasNote: true, draftEmpty: false), "Add to notes in progress")
    }

    func testExpandCallsCreateClearsTheComposerAndOpensTheNote() async throws {
        let (client, calls) = client { _ in #"{"note":\#(Self.noteJSON()),"appended":false}"# }
        let notes = ThreadNotes(threadId: "thr_1", api: .live(client))
        let composer = try await notes.expand(draft: "Agenda\n- pricing", current: { "Agenda\n- pricing" })
        XCTAssertEqual(composer, "")
        XCTAssertEqual(notes.note?.pageId, "pg_1")
        XCTAssertEqual(notes.editing?.pageId, "pg_1")
        XCTAssertFalse(notes.expanding)
        let requests = await calls.requests
        XCTAssertEqual(requests.map(\.path), ["/api/v1/plugins/studio/rpc/notes.create"])
        XCTAssertEqual(requests.first?.body["threadId"], "thr_1")
        XCTAssertEqual(requests.first?.body["text"], "Agenda\n- pricing")
    }

    func testFailedExpandKeepsTheDraft() async {
        let client = BBClient(baseURL: URL(string: "https://notes.invalid")!)
        client.transport = { _, _, _ in (500, Data(#"{"ok":false,"error":{"message":"boom"}}"#.utf8)) }
        let notes = ThreadNotes(threadId: "thr_1", api: .live(client))
        do {
            _ = try await notes.expand(draft: "notes", current: { "notes" })
            XCTFail("A failing create must throw, so the composer keeps the draft")
        } catch {
            XCTAssertEqual((error as? BBError)?.message, "boom")
        }
        XCTAssertNil(notes.note)
        XCTAssertNil(notes.editing)
    }

    // MARK: Chip

    func testChipShowsTheOpenNoteOnly() async {
        let (open, _) = client { _ in #"{"note":\#(Self.noteJSON())}"# }
        let withNote = ThreadNotes(threadId: "thr_1", api: .live(open))
        await withNote.refresh()
        XCTAssertEqual(withNote.note?.shortTitle, "Oct 13, 2:05 PM · Weekly sync")

        let (none, calls) = client { _ in #"{"note":null}"# }
        let without = ThreadNotes(threadId: "thr_1", api: .live(none))
        await without.refresh()
        XCTAssertNil(without.note)
        let requests = await calls.requests
        XCTAssertEqual(requests.map(\.path), ["/api/v1/plugins/studio/rpc/notes.forThread"])
        XCTAssertEqual(requests.first?.body, ["threadId": "thr_1"])

        let (sent, _) = client { _ in #"{"note":\#(Self.noteJSON(state: "sent"))}"# }
        let resolved = ThreadNotes(threadId: "thr_1", api: .live(sent))
        await resolved.refresh()
        XCTAssertNil(resolved.note)
    }

    func testAFailedReadKeepsTheChip() async {
        var fail = false
        let api = NotesAPI(
            forThread: { _ in if fail { throw URLError(.timedOut) }; return try JSONDecoder().decode(StudioNote.self, from: Data(Self.noteJSON().utf8)) },
            create: { _, _ in throw URLError(.badURL) }, send: { _ in .content }, keep: { _, _ in }, discard: { _ in })
        let notes = ThreadNotes(threadId: "thr_1", api: api)
        await notes.refresh()
        fail = true
        await notes.refresh()
        XCTAssertEqual(notes.note?.pageId, "pg_1")
    }

    func testOnlyThisThreadsSignalsRefreshTheChip() throws {
        let note = try JSONDecoder().decode(StudioNote.self, from: Data(Self.noteJSON().utf8))
        let signal = { (payload: JSONValue) in RealtimeEvent.pluginSignal(pluginId: "studio", channel: "pages", payload: payload) }
        XCTAssertTrue(ThreadNotes.refreshes(signal(["type": "note", "pageId": "pg_9", "threadId": "thr_1"]), threadId: "thr_1", note: nil))
        XCTAssertFalse(ThreadNotes.refreshes(signal(["type": "note", "pageId": "pg_9", "threadId": "thr_2"]), threadId: "thr_1", note: note))
        XCTAssertTrue(ThreadNotes.refreshes(signal(["type": "deleted", "pageIds": ["pg_1"]]), threadId: "thr_1", note: note))
        XCTAssertFalse(ThreadNotes.refreshes(signal(["type": "deleted", "pageIds": ["pg_2"]]), threadId: "thr_1", note: note))
        XCTAssertTrue(ThreadNotes.refreshes(signal(["type": "tree"]), threadId: "thr_1", note: note))
        XCTAssertFalse(ThreadNotes.refreshes(signal(["type": "tree"]), threadId: "thr_1", note: nil))
        XCTAssertFalse(ThreadNotes.refreshes(signal(["type": "page", "id": "pg_1"]), threadId: "thr_1", note: note))
        XCTAssertFalse(ThreadNotes.refreshes(.pluginSignal(pluginId: "studio", channel: "design", payload: ["type": "note", "threadId": "thr_1"]), threadId: "thr_1", note: note))
        XCTAssertTrue(ThreadNotes.refreshes(.connected, threadId: "thr_1", note: nil))
        XCTAssertFalse(ThreadNotes.refreshes(.changed(entity: "thread", id: "thr_1", changes: []), threadId: "thr_1", note: note))
    }

    // MARK: Done actions

    func testSendIsAutoAndClearsTheChip() async throws {
        let (client, calls) = client { path in
            path.hasSuffix("notes.forThread") ? #"{"note":\#(Self.noteJSON())}"# : #"{"note":\#(Self.noteJSON(state: "sent")),"sent":"summarize"}"#
        }
        let notes = ThreadNotes(threadId: "thr_1", api: .live(client))
        await notes.refresh()
        let message = try await notes.send("pg_1")
        XCTAssertEqual(message, "Asked the thread to summarize the notes.")
        XCTAssertNil(notes.note)
        let requests = await calls.requests
        XCTAssertEqual(requests.last?.path, "/api/v1/plugins/studio/rpc/notes.send")
        XCTAssertEqual(requests.last?.body, ["pageId": "pg_1", "mode": "auto"])
    }

    func testKeepSendsTheTrimmedTitle() async throws {
        let (client, calls) = client { _ in #"{"note":\#(Self.noteJSON(state: "kept"))}"# }
        let notes = ThreadNotes(threadId: "thr_1", api: .live(client))
        try await notes.keep("pg_1", title: "  Launch sync  ")
        let requests = await calls.requests
        XCTAssertEqual(requests.map(\.path), ["/api/v1/plugins/studio/rpc/notes.keep"])
        XCTAssertEqual(requests.first?.body, ["pageId": "pg_1", "title": "Launch sync"])
    }

    func testDiscardCallsDiscardAndClearsTheChip() async throws {
        let (client, calls) = client { path in
            path.hasSuffix("notes.forThread") ? #"{"note":\#(Self.noteJSON())}"# : #"{"ok":true}"#
        }
        let notes = ThreadNotes(threadId: "thr_1", api: .live(client))
        await notes.refresh()
        XCTAssertNotNil(notes.note)
        try await notes.discard("pg_1")
        XCTAssertNil(notes.note)
        let requests = await calls.requests
        XCTAssertEqual(requests.last?.path, "/api/v1/plugins/studio/rpc/notes.discard")
        XCTAssertEqual(requests.last?.body, ["pageId": "pg_1"])
    }

    func testAFailedActionKeepsTheNoteOpen() async throws {
        let client = BBClient(baseURL: URL(string: "https://notes.invalid")!)
        client.transport = { _, path, _ in
            path.hasSuffix("notes.forThread")
                ? (200, Data(#"{"ok":true,"result":{"note":\#(Self.noteJSON())}}"#.utf8))
                : (400, Data(#"{"ok":false,"error":{"message":"The note is empty. Write something first, or discard it."}}"#.utf8))
        }
        let notes = ThreadNotes(threadId: "thr_1", api: .live(client))
        await notes.refresh()
        do {
            _ = try await notes.send("pg_1")
            XCTFail("An empty note can't be sent")
        } catch {}
        XCTAssertEqual(notes.note?.pageId, "pg_1")
    }
}
