#if DEBUG
import Foundation

/// Debug builds: `-qaNotesDemo draft|chip|editor|keep|discard`, with
/// `-qaBotDemo chat`, shows "Expand to page" in the Bot's chat from a local
/// fixture, for screenshots without a server:
///
/// - `draft`: meeting notes typed in the composer, beside the expand button.
/// - `chip`: the thread's open note as the "Notes in progress" chip.
/// - `editor`: the note open in the full-screen page editor, with its done actions.
/// - `keep`, `discard`: the editor with Keep's title prompt or Discard's confirmation.
enum NotesDemo {
    enum Variant: String {
        case draft, chip, editor, keep, discard
        var opensEditor: Bool { self == .editor || self == .keep || self == .discard }
    }

    static var variant: Variant? {
        let arguments = ProcessInfo.processInfo.arguments
        guard let index = arguments.firstIndex(of: "-qaNotesDemo"), arguments.indices.contains(index + 1) else { return nil }
        return Variant(rawValue: arguments[index + 1])
    }

    static let pageId = "qa-note"

    /// The composer's draft: meeting notes for `draft`, empty after the move otherwise.
    static var draft: String? {
        guard let variant else { return nil }
        guard variant == .draft else { return "" }
        return """
            Launch sync with Dana and Marco
            Pricing page copy is final, ships with the launch post
            App Store screenshots due Thursday
            - Move the beta invite to Friday
            - Ask legal about the EU privacy note
            """
    }

    /// The note's page, as the editor loads it.
    static func markdown(_ pageId: String) -> String? {
        guard variant != nil, pageId == Self.pageId else { return nil }
        return """
            Launch sync with Dana and Marco

            Pricing page copy is final, ships with the launch post

            App Store screenshots due Thursday

            - [ ] Move the beta invite to Friday
            - [ ] Ask legal about the EU privacy note

            ## Decisions

            Waitlist page stays up until the beta closes

            Marco owns the release notes
            """
    }

    static let note = StudioNote(
        pageId: pageId, threadId: BotDemo.threadId, title: "Notes · Oct 13, 2:05 PM · Juniper", state: .open,
        href: "/plugins/studio/studio/pages/\(pageId)", length: 320, createdAt: 1_760_378_700_000, updatedAt: 1_760_378_700_000)

    static var api: NotesAPI {
        NotesAPI(
            forThread: { _ in variant == .draft ? nil : note },
            create: { _, _ in note },
            send: { _ in .content },
            keep: { _, _ in },
            discard: { _ in })
    }
}
#endif
