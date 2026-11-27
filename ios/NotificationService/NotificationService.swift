import UserNotifications

enum NotificationChoiceCategory {
    static let prefix = "BB_CHOICE."
    static let maxDynamicCount = 20

    static func identifier(for choices: [String]) -> String {
        prefix + choices.joined(separator: "\u{1F}")
    }

    static func makeCategory(choices: [String], freeText: Bool) -> UNNotificationCategory {
        var actions: [UNNotificationAction] = choices.enumerated().map { index, label in
            UNNotificationAction(identifier: "BB_CHOICE_\(index)", title: label, options: [.authenticationRequired])
        }
        if freeText {
            actions.append(
                UNTextInputNotificationAction(
                    identifier: "BB_REPLY_TEXT", title: "Other…", options: [.authenticationRequired],
                    icon: UNNotificationActionIcon(systemImageName: "text.bubble"), textInputButtonTitle: "Send",
                    textInputPlaceholder: "Your answer"))
        }
        return UNNotificationCategory(identifier: identifier(for: choices), actions: actions, intentIdentifiers: [])
    }

    static func mergedCategories(
        existing: Set<UNNotificationCategory>,
        adding category: UNNotificationCategory
    ) -> Set<UNNotificationCategory> {
        var dynamic = existing.filter { $0.identifier.hasPrefix(prefix) }
        if dynamic.count >= maxDynamicCount { dynamic = [] }
        return existing.filter { !$0.identifier.hasPrefix(prefix) }
            .union(dynamic.filter { $0.identifier != category.identifier })
            .union([category])
    }
}

/// Gives a multiple-choice question one lock-screen button per option. iOS only offers the
/// actions of categories registered before the push arrives, so this registers a category for
/// the question's options and points the notification at it. The relay sends `BB_CHOICE` with
/// `choices` (labels) and `mutable-content`; the app maps `BB_CHOICE_<index>` back to an option.
final class NotificationService: UNNotificationServiceExtension {
    private var contentHandler: ((UNNotificationContent) -> Void)?
    private var content: UNMutableNotificationContent?

    override func didReceive(
        _ request: UNNotificationRequest, withContentHandler contentHandler: @escaping (UNNotificationContent) -> Void
    ) {
        guard let content = request.content.mutableCopy() as? UNMutableNotificationContent else {
            return contentHandler(request.content)
        }
        self.contentHandler = contentHandler
        self.content = content
        let info = content.userInfo
        guard content.categoryIdentifier == "BB_CHOICE", let choices = info["choices"] as? [String], !choices.isEmpty
        else { return finish() }

        let category = NotificationChoiceCategory.makeCategory(
            choices: choices,
            freeText: info["choiceFreeText"] as? Bool == true
        )
        let center = UNUserNotificationCenter.current()
        center.getNotificationCategories { existing in
            let categories = NotificationChoiceCategory.mergedCategories(existing: existing, adding: category)
            center.setNotificationCategories(categories)
            // Reading back waits until iOS has stored the category, so the notification can use it.
            center.getNotificationCategories { _ in
                content.categoryIdentifier = category.identifier
                self.finish()
            }
        }
    }

    override func serviceExtensionTimeWillExpire() {
        finish()
    }

    private func finish() {
        guard let contentHandler, let content else { return }
        self.contentHandler = nil
        contentHandler(content)
    }
}
