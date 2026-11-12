import Foundation
import SwiftUI

/// "Expand to page" for one thread: its open note (the "Notes in progress"
/// chip), making one from the composer's draft, and the note's done actions.
/// The desktop composer does the same (packages/bb-studio/src/pages/ui/notes).
///
/// No polling: it reads the note on appear, on Studio's `pages` signals about
/// this thread or its note, and after a reconnect.
@MainActor
final class ThreadNotes: ObservableObject {
    /// The thread's open note, or nil.
    @Published private(set) var note: StudioNote?
    /// The note open in the full-screen editor.
    @Published var editing: StudioNote?
    @Published private(set) var expanding = false
    let threadId: String
    private let serverURL = ServerScope.selectedURL
    private var api: NotesAPI
    private var listener: UUID?
    private weak var realtime: BBRealtime?
    private var request = 0

    init(threadId: String, api: NotesAPI? = nil) {
        self.threadId = threadId
        self.api = api ?? .live(BBClient())
    }

    // MARK: Pure parts

    /// What the composer's button says, from the thread's open note and the draft.
    static func expandLabel(hasNote: Bool, draftEmpty: Bool) -> String {
        guard hasNote else { return "Expand to page" }
        return draftEmpty ? "Open notes in progress" : "Add to notes in progress"
    }

    /// The composer's text once the page holds `moved`: empty, unless it was
    /// typed into meanwhile (then nil: leave it). Attachments aren't touched.
    static func draftAfterMove(current: String, moved: String) -> String? {
        guard !moved.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty, current == moved else { return nil }
        return ""
    }

    /// Whether a realtime event can change the thread's open note: Studio's
    /// `note` signal for this thread, the note's page deleted, a tree change
    /// while there's a note (a rename), or a reconnect that may have missed one.
    static func refreshes(_ event: RealtimeEvent, threadId: String, note: StudioNote?) -> Bool {
        switch event {
        case .connected:
            return true
        case .pluginSignal("studio", "pages", let payload):
            switch payload["type"]?.stringValue {
            case "note":
                return payload["threadId"]?.stringValue == threadId
            case "deleted":
                guard let pageId = note?.pageId else { return false }
                return payload["pageIds"]?.arrayValue?.contains { $0.stringValue == pageId } == true
            case "tree":
                return note != nil
            default:
                return false
            }
        default:
            return false
        }
    }

    // MARK: Lifecycle

    func attach(_ app: AppModel) {
        #if DEBUG
        if let demo = NotesDemo.variant {
            api = NotesDemo.api
            Task {
                await refresh()
                if demo.opensEditor { editing = note }
            }
            return
        }
        #endif
        guard app.serverURL == serverURL else { return }
        api = .live(app.client)
        detach()
        realtime = app.realtime
        listener = app.realtime.listen { [weak self] event in
            guard let self, Self.refreshes(event, threadId: self.threadId, note: self.note) else { return }
            Task { await self.refresh() }
        }
        Task { await refresh() }
    }

    func detach() {
        if let listener { realtime?.removeListener(listener) }
        listener = nil
        request += 1
    }

    func refresh() async {
        request += 1
        let id = request
        let next: StudioNote?
        do { next = try await api.forThread(threadId) } catch { return }  // A failed read keeps what the chip shows.
        guard id == request else { return }
        note = next.flatMap { $0.isOpen ? $0 : nil }
    }

    // MARK: Actions

    /// Moves `draft` into the thread's note (a new one, or the end of the open
    /// one) and opens it. Returns the composer's text once the server has saved
    /// it, or nil to leave the composer as it is.
    func expand(draft: String, current: () -> String) async throws -> String? {
        expanding = true
        defer { expanding = false }
        let made = try await api.create(threadId, draft)
        note = made
        editing = made
        return Self.draftAfterMove(current: current(), moved: draft)
    }

    /// Sends the note to the thread; says how it went.
    func send(_ pageId: String) async throws -> String {
        let sent = try await api.send(pageId)
        resolved(pageId)
        return sent == .content ? "Sent the notes to the thread." : "Asked the thread to summarize the notes."
    }

    func keep(_ pageId: String, title: String) async throws {
        try await api.keep(pageId, title)
        resolved(pageId)
    }

    func discard(_ pageId: String) async throws {
        try await api.discard(pageId)
        resolved(pageId)
    }

    private func resolved(_ pageId: String) {
        request += 1
        if note?.pageId == pageId { note = nil }
    }
}

/// The `notes.*` calls `ThreadNotes` makes, so the DEBUG fixture can stand in.
struct NotesAPI {
    var forThread: (String) async throws -> StudioNote?
    var create: (String, String) async throws -> StudioNote
    var send: (String) async throws -> NoteSent
    var keep: (String, String) async throws -> Void
    var discard: (String) async throws -> Void

    static func live(_ client: BBClient) -> NotesAPI {
        NotesAPI(
            forThread: { try await client.threadNote($0) },
            create: { try await client.createNote(threadId: $0, text: $1).note },
            send: { try await client.sendNote($0, mode: .auto).sent },
            keep: { _ = try await client.keepNote($0, title: $1) },
            discard: { try await client.discardNote($0) })
    }
}

/// Above the composer of a thread with an open note: reopens it.
struct NotesInProgressChip: View {
    let note: StudioNote
    let open: () -> Void

    var body: some View {
        Button(action: open) {
            ShelfCard(icon: "doc.text", tint: .accentColor) {
                HStack(spacing: 6) {
                    Text("Notes in progress").fontWeight(.medium).layoutPriority(1)
                    Text(note.shortTitle).foregroundStyle(.secondary).lineLimit(1)
                }
                .lineLimit(1)
            } trailing: {
                Text("Open").font(.footnote.weight(.semibold)).foregroundStyle(.tint).padding(.trailing, 8)
            }
            .contentShape(.rect)
        }
        .buttonStyle(.plain)
        .accessibilityElement(children: .combine)
        .accessibilityLabel("Notes in progress, \(note.shortTitle)")
        .accessibilityHint("Opens the notes")
        .accessibilityIdentifier("notesInProgress")
    }
}

/// A thread's open note in the page editor: Send to thread, Keep as page, Discard.
struct NoteDoneActions {
    let note: StudioNote
    let send: () async throws -> String
    let keep: (String) async throws -> Void
    let discard: () async throws -> Void

    @MainActor
    init(note: StudioNote, notes: ThreadNotes) {
        self.note = note
        let pageId = note.pageId ?? ""
        send = { try await notes.send(pageId) }
        keep = { try await notes.keep(pageId, title: $0) }
        discard = { try await notes.discard(pageId) }
    }
}
