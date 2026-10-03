import Foundation
import Combine

@MainActor
final class PageEditorModel: ObservableObject {
    let client: BBClient
    let pageId: String
    private let store: PageDraftStore
    private let read: () async throws -> String
    private let edit: (String, String) async throws -> String
    @Published private(set) var text = ""
    @Published private(set) var expected: String?
    @Published private(set) var saved = ""
    @Published private(set) var saving = false
    @Published private(set) var error: String?
    @Published private(set) var localError: String?
    @Published private(set) var conflict = false
    @Published private(set) var serverMarkdown: String?
    private var submitted: String?
    private var verified = false
    private var loading = false
    private var unreadableDraft = false
    var dirty: Bool { text != saved }
    var canClose: Bool { !saving && localError == nil }
    var draftFile: URL { store.url(server: client.baseURL, page: pageId) }

    init(pageId: String, client: BBClient = BBClient(), store: PageDraftStore = PageDraftStore(),
         read: (() async throws -> String)? = nil,
         edit: ((String, String) async throws -> String)? = nil) {
        self.pageId = pageId
        self.client = client
        self.store = store
        let demo = pageId == "qa-demo" && ProcessInfo.processInfo.arguments.contains("-qaPageDemo")
        self.read = read ?? { demo ? "# Launch plan\n\nShip it" : try await client.editablePageMarkdown(pageId) }
        self.edit = edit ?? { base, text in demo ? text : try await client.editPageDocument(pageId, expected: base, markdown: text) }
        do {
            if let draft = try store.load(server: client.baseURL, page: pageId) {
                expected = draft.expected
                text = draft.text
                saved = draft.expected.map(Self.plain) ?? ""
                submitted = draft.submitted
            }
        } catch {
            unreadableDraft = true
            localError = "Couldn't read the local draft. Export it before discarding: \(error.localizedDescription)"
        }
    }

    func updateText(_ value: String) {
        guard !unreadableDraft else { return }
        text = value
        persist()
    }

    @discardableResult
    func persist() -> Bool {
        guard !unreadableDraft else { return false }
        do {
            // Keep a record even when text equals the base: an uncertain request may
            // still be in flight, and a later acknowledgement must not erase new typing.
            try store.save(.init(serverURL: client.baseURL, pageId: pageId, kind: "edit",
                                 text: text, expected: expected, submitted: submitted))
            localError = nil
            return true
        } catch {
            localError = "Changes aren't saved on this phone. Keep this editor open or copy the text. \(error.localizedDescription)"
            return false
        }
    }

    func load() async {
        guard !saving, !loading, !unreadableDraft else { return }
        loading = true
        defer { loading = false }
        do {
            let latest = try await read()
            serverMarkdown = latest
            if expected == nil {
                expected = latest
                text = Self.plain(latest)
                saved = text
            } else if latest == expected {
                // A read verifies the existing base; it never silently rebases edits.
            } else if let submitted, Self.plain(latest) == submitted {
                // The previous request succeeded but its acknowledgement was lost.
                expected = latest
                saved = submitted
                self.submitted = nil
                guard persist() else { return }
            } else if dirty || submitted != nil {
                conflict = true
                verified = false
                error = "The server page changed. Your draft is safe on this phone. Review the server text or copy your draft before discarding it."
                return
            } else {
                expected = latest
                text = Self.plain(latest)
                saved = text
            }
            verified = true
            conflict = false
            error = nil
        } catch {
            verified = false
            self.error = BBClient.describe(error, server: client.baseURL)
        }
    }

    func save() async {
        guard !saving, !loading, !conflict, !unreadableDraft, dirty else { return }
        guard persist() else { return }
        if !verified { await load() }
        guard verified, !conflict, localError == nil, let base = expected, dirty else { return }
        let sending = text
        submitted = sending
        guard persist() else { return }
        saving = true
        defer { saving = false }
        do {
            let result = try await edit(base, sending)
            expected = result
            saved = sending
            submitted = nil
            error = nil
            // Atomic replacement includes any typing received while awaiting the RPC.
            // On failure the prior on-disk pending request remains recoverable.
            guard persist() else { return }
            if !dirty {
                do { try store.remove(server: client.baseURL, page: pageId) }
                catch { localError = "Saved to the server, but couldn't clear the local draft: \(error.localizedDescription)" }
            }
        } catch {
            verified = false
            self.error = BBClient.describe(error, server: client.baseURL)
            // Do not automatically retry an uncertain request. Retry first reads and
            // compares the original base, or recognizes the acknowledged content.
        }
    }

    func retry() async {
        guard persist() else { return }
        await load()
        if !conflict { await save() }
    }

    func discardAndReload() async {
        guard !saving else { return }
        do { try store.remove(server: client.baseURL, page: pageId) }
        catch { localError = "Couldn't discard the local draft: \(error.localizedDescription)"; return }
        unreadableDraft = false
        expected = nil
        submitted = nil
        text = ""
        saved = ""
        localError = nil
        conflict = false
        verified = false
        await load()
    }

    static func plain(_ markdown: String) -> String {
        markdown.split(separator: "\n", omittingEmptySubsequences: false)
            .filter { !$0.trimmingCharacters(in: .whitespaces).hasPrefix("<!-- ^") }
            .joined(separator: "\n").replacing(/\n{3,}/, with: "\n\n").trimmingCharacters(in: .newlines)
    }
}
