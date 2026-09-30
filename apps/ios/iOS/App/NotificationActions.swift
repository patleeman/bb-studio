import UIKit
import UserNotifications

/// Lock-screen actions on BB pushes. The relay (plugin/apns.ts) picks the category.
enum NotificationActions {
    static let approve = "BB_APPROVE"
    static let deny = "BB_DENY"
    static let reply = "BB_REPLY_TEXT"
    /// `BB_CHOICE_<index>`: an option button added by the notification extension.
    static let choicePrefix = "BB_CHOICE_"

    static func register() {
        let approve = UNNotificationAction(
            identifier: approve, title: "Approve", options: [.authenticationRequired],
            icon: UNNotificationActionIcon(systemImageName: "checkmark"))
        let deny = UNNotificationAction(
            identifier: deny, title: "Deny", options: [.destructive, .authenticationRequired],
            icon: UNNotificationActionIcon(systemImageName: "xmark"))
        let approvePlan = UNNotificationAction(
            identifier: Self.approve, title: "Approve plan", options: [.authenticationRequired],
            icon: UNNotificationActionIcon(systemImageName: "checkmark"))
        let keepPlanning = UNNotificationAction(
            identifier: Self.deny, title: "Keep planning", options: [.authenticationRequired],
            icon: UNNotificationActionIcon(systemImageName: "pencil"))
        let answer = UNTextInputNotificationAction(
            identifier: reply, title: "Answer", options: [.authenticationRequired],
            icon: UNNotificationActionIcon(systemImageName: "text.bubble"), textInputButtonTitle: "Send",
            textInputPlaceholder: "Your answer")
        let replyAction = UNTextInputNotificationAction(
            identifier: reply, title: "Reply", options: [.authenticationRequired],
            icon: UNNotificationActionIcon(systemImageName: "arrowshape.turn.up.left"), textInputButtonTitle: "Send",
            textInputPlaceholder: "Message BB")
        let fixed: Set = [
            UNNotificationCategory(identifier: "BB_APPROVAL", actions: [approve, deny], intentIdentifiers: []),
            UNNotificationCategory(identifier: "BB_PLAN", actions: [approvePlan, keepPlanning], intentIdentifiers: []),
            UNNotificationCategory(identifier: "BB_QUESTION", actions: [answer], intentIdentifiers: []),
            // The extension swaps in a per-options category; this is the fallback if it doesn't run.
            UNNotificationCategory(identifier: "BB_CHOICE", actions: [answer], intentIdentifiers: []),
            UNNotificationCategory(identifier: "BB_REPLY", actions: [replyAction], intentIdentifiers: []),
        ]
        // Keep the extension's option categories, or delivered questions lose their buttons.
        let center = UNUserNotificationCenter.current()
        center.getNotificationCategories { existing in
            center.setNotificationCategories(fixed.union(existing.filter { $0.identifier.hasPrefix("BB_CHOICE.") }))
        }
    }

    /// Runs a lock-screen action. Returns false when the app should open the thread instead.
    static func handle(_ response: UNNotificationResponse) async -> Bool {
        let info = response.notification.request.content.userInfo
        guard let threadId = info["threadId"] as? String else { return false }
        let interactionId = info["interactionId"] as? String
        let client = BBClient()
        do {
            switch response.actionIdentifier {
            case approve, deny:
                guard let interactionId else { return false }
                try await client.resolve(
                    threadId: threadId, interactionId: interactionId,
                    decision: response.actionIdentifier == approve ? "allow_once" : "deny")
            case let action where action.hasPrefix(choicePrefix):
                guard let interactionId, let index = Int(action.dropFirst(choicePrefix.count)) else { return false }
                let pending = try await client.interactions(threadId)
                guard let interaction = pending.first(where: { $0.id == interactionId }),
                    let question = interaction.allQuestions?.first,
                    let options = question.options, options.indices.contains(index)
                else {
                    await confirm(threadId, "That question isn't waiting anymore. Tap to open the thread.")
                    return true
                }
                try await client.settle(interaction, interaction.answer([question.id: InteractionAnswer(selected: [options[index].value])]))
            case reply:
                let text = (response as? UNTextInputNotificationResponse)?.userText
                    .trimmingCharacters(in: .whitespacesAndNewlines) ?? ""
                guard !text.isEmpty else { return true }
                if let interactionId {
                    let pending = try await client.interactions(threadId)
                    guard let interaction = pending.first(where: { $0.id == interactionId }) ?? pending.first,
                        let resolution = interaction.textAnswer(text)
                    else {
                        await confirm(threadId, "Couldn't answer from here. Tap to open the thread.")
                        return true
                    }
                    try await client.settle(interaction, resolution)
                } else {
                    try await client.send(threadId, text: text)
                }
            default:
                return false
            }
        } catch {
            await confirm(threadId, "Didn't go through: \(BBClient.describe(error))")
        }
        return true
    }

    /// A quiet follow-up notification when an action fails.
    private static func confirm(_ threadId: String, _ body: String) async {
        let content = UNMutableNotificationContent()
        content.title = "BB"
        content.body = body
        content.userInfo = ["threadId": threadId]
        content.threadIdentifier = threadId
        try? await UNUserNotificationCenter.current().add(
            UNNotificationRequest(identifier: UUID().uuidString, content: content, trigger: nil))
    }
}
