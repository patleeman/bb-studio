import Foundation
import Combine

@MainActor
final class PageWorkDraft: ObservableObject {
    @Published private(set) var text = ""
    @Published private(set) var projectId: String?
    @Published private(set) var error: String?
    private let server: URL
    private let page: String
    private let store: PageDraftStore
    private var unreadable = false

    init(server: URL, page: String, store: PageDraftStore = PageDraftStore()) {
        self.server = server
        self.page = page
        self.store = store
        do {
            if let draft = try store.load(server: server, page: page, kind: "work") {
                text = draft.text
                projectId = draft.projectId
            }
        } catch {
            unreadable = true
            self.error = "Couldn't read the work draft. Its file has been preserved. \(error.localizedDescription)"
        }
    }

    var file: URL { store.url(server: server, page: page, kind: "work") }

    func discard() {
        do {
            try store.remove(server: server, page: page, kind: "work")
            unreadable = false
            text = ""
            projectId = nil
            error = nil
        } catch { self.error = "Couldn't discard the local work draft: \(error.localizedDescription)" }
    }

    func update(text: String? = nil, projectId: String? = nil) {
        guard !unreadable else { return }
        if let text { self.text = text }
        if let projectId { self.projectId = projectId }
        _ = persist()
    }

    @discardableResult
    func persist() -> Bool {
        guard !unreadable else { return false }
        do {
            if text.isEmpty {
                try store.remove(server: server, page: page, kind: "work")
            } else {
                try store.save(.init(serverURL: server, pageId: page, kind: "work", text: text, projectId: projectId))
            }
            error = nil
            return true
        } catch {
            self.error = "Work draft isn't saved on this phone. Copy it before leaving. \(error.localizedDescription)"
            return false
        }
    }

    func sent(_ submitted: String) {
        // A response cannot erase a follow-up typed while starting the first thread.
        if text == submitted { update(text: "") }
    }
}
