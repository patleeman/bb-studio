import UserNotifications

/// Lock-screen buttons on Attention Router pushes (`BB_LOOP`, from the Mobile
/// relay). One category per loop kind; a decision with options gets one made
/// for its options by the notification extension. Built into the app too,
/// which registers the fixed ones and maps a tap back to `loops.act`. None
/// opens the app: iOS runs the app in the background to send the tap.
enum LoopCategories {
    static let category = "BB_LOOP"
    static let prefix = "BB_LOOP_"
    static let done = "BB_LOOP_DONE"
    static let gotIt = "BB_LOOP_GOT_IT"
    static let snoozeTonight = "BB_LOOP_SNOOZE_TONIGHT"
    static let snoozeHome = "BB_LOOP_SNOOZE_HOME"
    /// `BB_LOOP_CHOOSE_<index>`: one of a decision's options.
    static let choosePrefix = "BB_LOOP_CHOOSE_"
    /// iOS shows about four buttons on a notification; options leave room for Snooze.
    static let maxOptions = 3

    /// What a tap asks for.
    enum Tap: Equatable {
        case done, gotIt, snoozeTonight, snoozeHome
        case choose(String)
    }

    /// The category for a push: by its loop's kind, and for a decision with
    /// options, one named after them (made by the extension).
    static func identifier(kind: String?, options: [String]) -> String {
        switch kind {
        case "decide":
            let shown = Array(options.prefix(maxOptions))
            return shown.isEmpty ? "\(category).decide" : "\(category).decide." + shown.joined(separator: "\u{1F}")
        case "do", "read", "waiting": return "\(category).\(kind!)"
        default: return category
        }
    }

    /// The buttons for a category made by `identifier`.
    static func actions(kind: String?, options: [String]) -> [UNNotificationAction] {
        func action(_ id: String, _ title: String, _ symbol: String) -> UNNotificationAction {
            UNNotificationAction(identifier: id, title: title, options: [.authenticationRequired],
                                 icon: UNNotificationActionIcon(systemImageName: symbol))
        }
        let done = action(Self.done, "Done", "checkmark")
        let gotIt = action(Self.gotIt, "Got it", "checkmark")
        let tonight = action(snoozeTonight, "Snooze until tonight", "moon")
        let home = action(snoozeHome, "Snooze until I'm home", "house")
        switch kind {
        case "do", "waiting": return [done, tonight, home]
        case "read": return [gotIt, tonight]
        case "decide":
            let choices = options.prefix(maxOptions).enumerated().map { index, option in
                UNNotificationAction(identifier: "\(choosePrefix)\(index)", title: option, options: [.authenticationRequired])
            }
            return choices + (choices.isEmpty ? [tonight, home] : [tonight])
        default: return [done, tonight, home, gotIt]
        }
    }

    /// The fixed categories: one per kind, a decision without options, and
    /// the plain `BB_LOOP` for a push that names no kind.
    static func fixed() -> Set<UNNotificationCategory> {
        Set([nil, "do", "read", "waiting", "decide"].map { kind in
            UNNotificationCategory(identifier: identifier(kind: kind, options: []), actions: actions(kind: kind, options: []), intentIdentifiers: [])
        })
    }

    /// A tap on one of these buttons; nil for any other.
    static func tap(_ identifier: String, options: [String]) -> Tap? {
        switch identifier {
        case done: return .done
        case gotIt: return .gotIt
        case snoozeTonight: return .snoozeTonight
        case snoozeHome: return .snoozeHome
        default:
            guard identifier.hasPrefix(choosePrefix), let index = Int(identifier.dropFirst(choosePrefix.count)),
                  options.indices.contains(index) else { return nil }
            return .choose(options[index])
        }
    }
}
