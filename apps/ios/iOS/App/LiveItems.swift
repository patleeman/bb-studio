import ActivityKit
import Foundation
import UIKit

/// Thread and recording Live Activities. The mobile plugin starts, updates,
/// and ends thread activities by push; this reports the tokens it needs and
/// clears ones the app can see are settled.
@MainActor
enum LiveItems {
    static func start() {
        Task {
            for await data in Activity<BBThreadAttributes>.pushToStartTokenUpdates {
                await register(["threadPushToStartToken": .string(data.hex)])
            }
        }
        for activity in Activity<BBThreadAttributes>.activities { watch(activity) }
        Task {
            for await activity in Activity<BBThreadAttributes>.activityUpdates { watch(activity) }
        }
        #if DEBUG
            if ProcessInfo.processInfo.arguments.contains("-qaThreadActivities") { stageDemo() }
        #endif
    }

    #if DEBUG
        /// Local activities for the simulator, which can't push-start them.
        private static func stageDemo() {
            let now = Date().timeIntervalSince1970
            let demos: [(String, BBThreadAttributes.ContentState)] = [
                ("thr_qademo1", .init(
                    title: "Fix flaky queue test", phase: "needsYou",
                    last: "I traced the flake to a race between the idle drain and recheck. The fix holds the group until the claim lands.",
                    ask: .init(id: "int_qademo", kind: "approval", text: "Run pnpm test --filter smart-decisions", choices: []),
                    updatedAt: now)),
                ("thr_qademo2", .init(
                    title: "Draft launch notes", phase: "running",
                    last: "Pulling the highlights from this week's commits: per-thread Live Activities, Smart Queue batching, and the Studio collection.",
                    ask: nil, updatedAt: now)),
                ("thr_qademo3", .init(
                    title: "Pick a chart style", phase: "needsYou", last: nil,
                    ask: .init(id: "int_qademo3", kind: "question", text: "Which chart should the usage page use?", choices: ["Bars", "Lines", "Area"]),
                    updatedAt: now)),
            ]
            for (threadId, state) in demos where !Activity<BBThreadAttributes>.activities.contains(where: { $0.attributes.threadId == threadId }) {
                _ = try? Activity.request(attributes: BBThreadAttributes(threadId: threadId), content: ActivityContent(state: state, staleDate: nil), pushType: nil)
            }
        }
    #endif

    /// Ends activities for threads that are gone, or settled and read. The plugin does the rest.
    static func sync(_ threads: [ThreadEntry]) {
        #if DEBUG
            if ProcessInfo.processInfo.arguments.contains("-qaThreadActivities") { return }
        #endif
        let byId = Dictionary(threads.map { ($0.id, $0) }, uniquingKeysWith: { a, _ in a })
        Task {
            for activity in Activity<BBThreadAttributes>.activities where activity.activityState == .active {
                let thread = byId[activity.attributes.threadId]
                if let thread, !["idle", "error"].contains(thread.status) || thread.needsYou || thread.isUnread { continue }
                await activity.end(nil, dismissalPolicy: .immediate)
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
        let threadId = JSONValue.string(activity.attributes.threadId)
        Task {
            for await token in activity.pushTokenUpdates {
                await register(["threadId": threadId, "activityId": .string(activity.id), "activityToken": .string(token.hex)])
            }
        }
        Task {
            for await state in activity.activityStateUpdates where state == .ended || state == .dismissed {
                await register(["threadId": threadId, "endedActivityId": .string(activity.id)])
                watched.remove(activity.id)
                return
            }
        }
    }

    /// Fails quietly when the mobile plugin isn't installed. The simulator never
    /// reports: its tokens aren't valid APNs tokens.
    private static func register(_ input: [String: JSONValue]) async {
        #if !targetEnvironment(simulator)
            let _: JSONValue? = try? await AppModel.shared.client.rpc("mobile", "live_register", .object(input))
        #endif
    }
}

private extension Data {
    var hex: String { map { String(format: "%02x", $0) }.joined() }
}
