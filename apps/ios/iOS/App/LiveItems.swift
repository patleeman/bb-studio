import ActivityKit
import Foundation
import UIKit

@MainActor
enum LiveItems {
    static func isFollowing(_ id: String) -> Bool {
        Activity<BBThreadAttributes>.activities.contains { $0.attributes.threadId == id && $0.activityState == .active }
    }

    static func follow(_ thread: ThreadEntry) async throws {
        guard ActivityAuthorizationInfo().areActivitiesEnabled else { return }
        guard !isFollowing(thread.id) else { return }
        let state = BBThreadAttributes.ContentState(
            title: thread.displayTitle, status: thread.status, needsYou: thread.needsYou,
            updatedAt: Date().timeIntervalSince1970)
        let activity = try Activity.request(
            attributes: BBThreadAttributes(threadId: thread.id),
            content: ActivityContent(state: state, staleDate: Date().addingTimeInterval(300)), pushType: .token)
        watch(activity)
    }

    static func unfollow(_ id: String) async {
        for activity in Activity<BBThreadAttributes>.activities where activity.attributes.threadId == id {
            await activity.end(nil, dismissalPolicy: .immediate)
        }
    }

    static func start() {
        for activity in Activity<BBThreadAttributes>.activities { watch(activity) }
        Task {
            for await activity in Activity<BBThreadAttributes>.activityUpdates { watch(activity) }
        }
    }

    static func sync(_ threads: [ThreadEntry]) {
        let byId = Dictionary(threads.map { ($0.id, $0) }, uniquingKeysWith: { a, _ in a })
        Task {
            for activity in Activity<BBThreadAttributes>.activities {
                guard let thread = byId[activity.attributes.threadId] else {
                    await activity.end(nil, dismissalPolicy: .immediate)
                    continue
                }
                let state = BBThreadAttributes.ContentState(
                    title: thread.displayTitle, status: thread.status, needsYou: thread.needsYou,
                    updatedAt: Date().timeIntervalSince1970)
                if ["idle", "error"].contains(thread.status), !thread.needsYou {
                    await activity.end(ActivityContent(state: state, staleDate: nil), dismissalPolicy: .after(.now + 60))
                } else if activity.content.state.title != state.title || activity.content.state.status != state.status || activity.content.state.needsYou != state.needsYou {
                    await activity.update(ActivityContent(state: state, staleDate: Date().addingTimeInterval(300)))
                }
            }
        }
    }

    static func recordingStarted(_ id: String) {
        guard ActivityAuthorizationInfo().areActivitiesEnabled else { return }
        let now = Date().timeIntervalSince1970
        let state = BBRecordingAttributes.ContentState(phase: "recording", startedAt: now, updatedAt: now)
        _ = try? Activity.request(attributes: BBRecordingAttributes(recordingId: id), content: ActivityContent(state: state, staleDate: nil), pushType: nil)
    }

    static func recordingEnded(_ id: String) {
        Task {
            for activity in Activity<BBRecordingAttributes>.activities where activity.attributes.recordingId == id {
                let state = BBRecordingAttributes.ContentState(phase: "finishing", startedAt: activity.content.state.startedAt, updatedAt: Date().timeIntervalSince1970)
                await activity.end(ActivityContent(state: state, staleDate: nil), dismissalPolicy: .after(.now + 60))
            }
        }
    }

    private static var watched = Set<String>()
    private static func watch(_ activity: Activity<BBThreadAttributes>) {
        guard watched.insert(activity.id).inserted else { return }
        Task {
            for await token in activity.pushTokenUpdates {
                #if !targetEnvironment(simulator)
                let hex = token.map { String(format: "%02x", $0) }.joined()
                let _: JSONValue? = try? await AppModel.shared.client.rpc("mobile", "live_register", [
                    "threadId": .string(activity.attributes.threadId), "activityId": .string(activity.id),
                    "activityToken": .string(hex)])
                #endif
            }
        }
        Task {
            for await state in activity.activityStateUpdates where state == .ended || state == .dismissed {
                #if !targetEnvironment(simulator)
                let _: JSONValue? = try? await AppModel.shared.client.rpc("mobile", "live_register", [
                    "threadId": .string(activity.attributes.threadId), "endedActivityId": .string(activity.id)])
                #endif
                watched.remove(activity.id)
                return
            }
        }
    }
}
