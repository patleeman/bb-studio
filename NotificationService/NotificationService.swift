import UserNotifications

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

        var actions = choices.enumerated().map { index, label in
            UNNotificationAction(identifier: "BB_CHOICE_\(index)", title: label, options: [.authenticationRequired])
        }
        if info["choiceFreeText"] as? Bool == true {
            actions.append(
                UNTextInputNotificationAction(
                    identifier: "BB_REPLY_TEXT", title: "Other…", options: [.authenticationRequired],
                    icon: UNNotificationActionIcon(systemImageName: "text.bubble"), textInputButtonTitle: "Send",
                    textInputPlaceholder: "Your answer"))
        }
        // Keyed by the labels, so repeated option sets reuse one category.
        let identifier = "BB_CHOICE." + choices.joined(separator: "\u{1F}")
        let center = UNUserNotificationCenter.current()
        center.getNotificationCategories { existing in
            var dynamic = existing.filter { $0.identifier.hasPrefix("BB_CHOICE.") }
            if dynamic.count >= 20 { dynamic = [] }
            let categories = existing.filter { !$0.identifier.hasPrefix("BB_CHOICE.") }
                .union(dynamic.filter { $0.identifier != identifier })
                .union([UNNotificationCategory(identifier: identifier, actions: actions, intentIdentifiers: [])])
            center.setNotificationCategories(categories)
            // Reading back waits until iOS has stored the category, so the notification can use it.
            center.getNotificationCategories { _ in
                content.categoryIdentifier = identifier
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
