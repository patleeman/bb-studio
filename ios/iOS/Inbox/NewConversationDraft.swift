import Foundation

/// New conversation's unsent message, one per Bot (and one for a plain
/// thread), kept in the same stores as a conversation's draft (`Drafts`,
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

    /// Sent: nothing waits for the next New conversation.
    static func clear(botId: String?, serverURL: URL) {
        save(text: "", botId: botId, serverURL: serverURL)
        save(attachments: [], botId: botId, serverURL: serverURL)
    }
}
