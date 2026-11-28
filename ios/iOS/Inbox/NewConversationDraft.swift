import Foundation

/// New conversation's unsent message, one per Bot it's with (and one for a
/// plain thread), kept in the same stores as a conversation's draft (`Drafts`,
/// `DraftAttachments`): it survives Back, another tab and a relaunch, and
/// goes only when it's sent or its text and photos are cleared.
enum NewConversationDraft {
    /// The store's key: the Bot's, or a plain thread's.
    static func key(botId: String?) -> String {
        guard let botId, !botId.isEmpty else { return "new-conversation" }
        return "new-conversation." + botId
    }

    /// What the field opens with: the saved draft, and text handed to New
    /// conversation (a Studio link, a transcript) after it, so neither is lost.
    static func opening(saved: String?, prefill: String) -> String {
        let saved = saved ?? ""
        if saved.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty { return prefill }
        if prefill.isEmpty || saved.hasSuffix(prefill) { return saved }
        return saved + (saved.hasSuffix("\n") ? "\n" : "\n\n") + prefill
    }

    static func load(botId: String?, serverURL: URL) -> (text: String?, attachments: [PendingAttachment]) {
        let key = key(botId: botId)
        return (Drafts.load(key, serverURL: serverURL)?.text, DraftAttachments.load(key, serverURL: serverURL))
    }

    static func save(text: String, botId: String?, serverURL: URL) {
        Drafts.save(key(botId: botId), text: text, mentions: [], serverURL: serverURL)
    }

    static func save(attachments: [PendingAttachment], botId: String?, serverURL: URL) {
        DraftAttachments.save(attachments, threadId: key(botId: botId), serverURL: serverURL)
    }

    /// The With chip moved from one Bot to another: the message goes with
    /// it, after any draft the new Bot already had, so neither is lost, and
    /// the old Bot keeps none. Returns what the composer shows now.
    static func switched(text: String, attachments: [PendingAttachment], from old: String?, to new: String?,
                         serverURL: URL) -> (text: String, attachments: [PendingAttachment]) {
        guard key(botId: old) != key(botId: new) else { return (text, attachments) }
        let waiting = load(botId: new, serverURL: serverURL)
        let merged = opening(saved: waiting.text, prefill: text)
        let files = waiting.attachments + attachments.filter { item in !waiting.attachments.contains { $0.id == item.id } }
        clear(botId: old, serverURL: serverURL)
        save(text: merged, botId: new, serverURL: serverURL)
        save(attachments: files, botId: new, serverURL: serverURL)
        return (merged, files)
    }

    /// Sent: nothing waits for the next New conversation.
    static func clear(botId: String?, serverURL: URL) {
        save(text: "", botId: botId, serverURL: serverURL)
        save(attachments: [], botId: botId, serverURL: serverURL)
    }
}
