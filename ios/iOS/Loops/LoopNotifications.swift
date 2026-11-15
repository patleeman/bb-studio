import UserNotifications

/// A tap on an Attention Router push's button: `loops.act` on the server the
/// push came from, in the background, with no app window.
enum LoopNotifications {
    /// The loop action a button stands for.
    static func action(_ identifier: String, options: [String]) -> LoopAction? {
        switch LoopCategories.tap(identifier, options: options) {
        case .done?: .done
        case .gotIt?: .gotIt
        case .snoozeTonight?: .snooze(.tonight)
        case .snoozeHome?: .snooze(.home)
        case .choose(let option)?: .choose(option)
        case nil: nil
        }
    }

    /// Runs the tap. Returns false when it isn't a loop's button.
    static func handle(_ response: UNNotificationResponse, client: BBClient = BBClient()) async -> Bool {
        let info = response.notification.request.content.userInfo
        guard let loopId = info["loopId"] as? String,
              let action = action(response.actionIdentifier, options: info["options"] as? [String] ?? [])
        else { return false }
        let serverId = info["serverId"] as? String
        do {
            try await client.validateNotificationOrigin(serverId)
            do {
                guard let task = taskAction(action) else { throw BBError(status: 404, message: "") }
                _ = try await client.taskAction(loopId, task)
            } catch where BBClient.isUnknownRPC(error) && loopId.hasPrefix("loop_") {
                try await client.loopAction(loopId, action)
            }
        } catch {
            await NotificationActions.confirm(info["threadId"] as? String ?? "", "Didn't go through: \(BBClient.describe(error))", serverId: serverId)
        }
        return true
    }

    static func taskAction(_ action: LoopAction) -> TaskAction? {
        switch action {
        case .done: .done
        case .gotIt: .gotIt
        case .choose(let option): .choose(option)
        case .snooze(let snooze): .snooze(snooze)
        default: nil
        }
    }
}
