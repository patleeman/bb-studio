import Foundation

/// A thread's draft expanded into a page: Studio's `notes.*` (packages/bb-studio/src/pages/notes.ts).
/// Every method answers with the same note shape.
public typealias StudioNote = Studio.NotesForThreadOutputNote

extension StudioNote: Identifiable {
    public var id: String { pageId ?? "" }

    public var isOpen: Bool { state == .open }

    /// The title without its "Notes · " prefix, for a chip that already says Notes.
    public var shortTitle: String {
        let title = title ?? ""
        let short = title.hasPrefix("Notes · ") ? String(title.dropFirst("Notes · ".count)) : title
        return short.isEmpty ? title : short
    }
}

/// How `notes.send` sent a note.
public enum NoteSent: String, Decodable, Sendable {
    case content, summarize
}

/// The `notes.*` inputs, from the generated contract, as RPC bodies.
public enum NoteRequests {
    public static func create(threadId: String, text: String, timeZone: String? = TimeZone.current.identifier) -> JSONValue {
        json(Studio.NotesCreateInput(threadId: threadId, text: text, timeZone: timeZone))
    }

    public static func forThread(_ threadId: String) -> JSONValue { json(Studio.NotesForThreadInput(threadId: threadId)) }

    public static func send(_ pageId: String, mode: Studio.NotesSendInputMode = .auto) -> JSONValue {
        json(Studio.NotesSendInput(pageId: pageId, mode: mode))
    }

    public static func keep(_ pageId: String, title: String) -> JSONValue {
        json(Studio.NotesKeepInput(pageId: pageId, title: title.trimmingCharacters(in: .whitespacesAndNewlines)))
    }

    public static func discard(_ pageId: String) -> JSONValue { json(Studio.NotesDiscardInput(pageId: pageId)) }

    private static func json<T: Encodable>(_ value: T) -> JSONValue {
        (try? JSONDecoder().decode(JSONValue.self, from: JSONEncoder().encode(value))) ?? .null
    }
}

extension BBClient {
    private struct NoteResult: Decodable { var note: StudioNote }

    /// Makes the thread's note from `text`, or adds it to the end of the open one.
    public func createNote(threadId: String, text: String) async throws -> (note: StudioNote, appended: Bool) {
        struct Result: Decodable { var note: StudioNote; var appended: Bool? }
        let result: Result = try await rpc("studio", Studio.Method.notes_create, NoteRequests.create(threadId: threadId, text: text))
        return (result.note, result.appended ?? false)
    }

    /// The thread's open note, or nil.
    public func threadNote(_ threadId: String) async throws -> StudioNote? {
        struct Result: Decodable { var note: StudioNote? }
        let result: Result = try await rpc("studio", Studio.Method.notes_forThread, NoteRequests.forThread(threadId))
        return result.note
    }

    /// Sends the note to its thread; `auto` sends the Markdown, or a link and "Summarize these notes" when it's long.
    public func sendNote(_ pageId: String, mode: Studio.NotesSendInputMode = .auto) async throws -> (note: StudioNote, sent: NoteSent) {
        struct Result: Decodable { var note: StudioNote; var sent: NoteSent }
        let result: Result = try await rpc("studio", Studio.Method.notes_send, NoteRequests.send(pageId, mode: mode))
        return (result.note, result.sent)
    }

    /// Keeps the note as an ordinary page with this title. It stays in Notes.
    public func keepNote(_ pageId: String, title: String) async throws -> StudioNote {
        let result: NoteResult = try await rpc("studio", Studio.Method.notes_keep, NoteRequests.keep(pageId, title: title))
        return result.note
    }

    /// Deletes the note's page.
    public func discardNote(_ pageId: String) async throws {
        struct Result: Decodable { var ok: Bool }
        let _: Result = try await rpc("studio", Studio.Method.notes_discard, NoteRequests.discard(pageId))
    }
}
