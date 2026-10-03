import Foundation

/// Converts supported lock-screen actions to the Inbox source's action IDs.
/// Multi-question and choice forms must be opened in the app; their answer
/// format cannot be inferred safely from a notification button index.
public struct OfficeNotificationAction: Sendable, Equatable {
    public var key: String
    public var actionId: String
    public var text: String?

    public init?(key: String, identifier: String, text: String? = nil) {
        guard !key.isEmpty else { return nil }
        self.key = key
        switch identifier {
        case "BB_APPROVE": actionId = "approve"
        case "BB_DENY": actionId = "deny"
        case "BB_REPLY_TEXT":
            guard let answer = text?.trimmingCharacters(in: .whitespacesAndNewlines), !answer.isEmpty else { return nil }
            actionId = "answer"
            self.text = answer
        default: return nil
        }
    }

    public func perform(client: BBClient, serverId: String?) async throws {
        try await client.validateNotificationOrigin(serverId)
        // The identity lookup may have suspended while Settings switched servers.
        guard client.baseURL == BBClient.storedServerURL else {
            throw BBError(status: 409, message: "The selected server changed. Open Inbox to review this request.")
        }
        try await client.officeInboxAct(key: key, actionId: actionId, text: text)
    }
}

@MainActor public enum OfficePush {
    /// Called for foreground, background, and tapped pushes. A foreign server's
    /// notification must never refresh the currently selected office.
    @discardableResult public static func receive(_ info: [AnyHashable: Any], client: BBClient = BBClient()) async -> Bool {
        guard info["inboxKey"] is String || info["clearThreadIds"] is [String] || info["inboxChanged"] as? Bool == true else { return false }
        do {
            try await client.validateNotificationOrigin(info["serverId"] as? String)
            guard client.baseURL == BBClient.storedServerURL else { return false }
            NotificationCenter.default.post(name: InboxStore.didReceivePush, object: client.baseURL.absoluteString)
            return true
        } catch { return false }
    }
}
