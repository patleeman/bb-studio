import ActivityKit
import Foundation
import OSLog
import UIKit

private let log = Logger(subsystem: "nyc.plee.bbgo", category: "live")

/// Owns the status Live Activity on the phone. The mobile plugin normally
/// starts, updates, and ends it by push; this reports the tokens it needs and,
/// while the app is open, keeps the activity current from the inbox directly.
@MainActor
final class LiveStatus {
    static let shared = LiveStatus()

    private var observing = false
    private var watched: Set<String> = []
    /// Last seen status per thread, to phrase "finished" / "failed" locally.
    private var lastStatus: [String: String] = [:]
    private var latest: String?

    private var client: BBClient { AppModel.shared.client }

    func start() {
        guard !observing else { return }
        observing = true
        Task {
            for await data in Activity<BBStatusAttributes>.pushToStartTokenUpdates {
                await register(["pushToStartToken": .string(data.hex)])
            }
        }
        Task {
            for activity in Activity<BBStatusAttributes>.activities { watch(activity) }
            for await activity in Activity<BBStatusAttributes>.activityUpdates { watch(activity) }
        }
    }

    /// Foreground fallback: mirror the inbox into the activity.
    func sync(_ threads: [ThreadEntry]) {
        let top = threads.filter { $0.parentThreadId == nil && $0.visibility != "hidden" }
        for thread in top {
            if let previous = lastStatus[thread.id], previous != thread.status, !["idle", "error"].contains(previous) {
                if thread.status == "idle" { latest = "✓ \(thread.displayTitle) finished" }
                if thread.status == "error" { latest = "✗ \(thread.displayTitle) failed" }
            }
        }
        lastStatus = Dictionary(top.map { ($0.id, $0.status) }, uniquingKeysWith: { a, _ in a })

        // Starting an activity needs the app in the foreground; `.inactive` covers launch.
        guard UIApplication.shared.applicationState != .background,
            ActivityAuthorizationInfo().areActivitiesEnabled
        else { return }
        let current = Activity<BBStatusAttributes>.activities.first { $0.activityState == .active }
        var state = Self.summarize(top)
        state.latest = latest ?? current?.content.state.latest
        Task { await apply(state, to: current) }
    }

    private func apply(_ state: BBStatusAttributes.ContentState, to current: Activity<BBStatusAttributes>?) async {
        let content = ActivityContent(state: state, staleDate: nil)
        if let current {
            if state.isClear {
                await current.end(content, dismissalPolicy: .after(.now + 60))
            } else if !Self.sameContent(current.content.state, state) {
                await current.update(content)
            }
        } else if !state.isClear {
            do {
                _ = try Activity.request(attributes: BBStatusAttributes(), content: content, pushType: .token)
            } catch {
                log.error("Live Activity request failed: \(error.localizedDescription, privacy: .public)")
            }
        }
    }

    static func summarize(_ threads: [ThreadEntry]) -> BBStatusAttributes.ContentState {
        let summary = ThreadSummary(threads)
        return .init(
            needsYou: summary.needsYou.count, running: summary.running.count, headline: summary.headline?.displayTitle,
            headlineThreadId: summary.headline?.id, latest: nil, updatedAt: Date().timeIntervalSince1970)
    }

    private static func sameContent(_ a: BBStatusAttributes.ContentState, _ b: BBStatusAttributes.ContentState) -> Bool {
        var a = a
        a.updatedAt = b.updatedAt
        return a == b
    }

    private func watch(_ activity: Activity<BBStatusAttributes>) {
        guard watched.insert(activity.id).inserted else { return }
        // Keep one: a push-to-start can race a foreground start.
        for other in Activity<BBStatusAttributes>.activities where other.id != activity.id && other.activityState == .active {
            Task { await other.end(nil, dismissalPolicy: .immediate) }
        }
        Task {
            for await data in activity.pushTokenUpdates {
                await register(["activityId": .string(activity.id), "activityToken": .string(data.hex)])
            }
        }
        Task {
            for await state in activity.activityStateUpdates where state == .ended || state == .dismissed {
                await register(["endedActivityId": .string(activity.id)])
                watched.remove(activity.id)
                return
            }
        }
    }

    /// Fails quietly when the mobile plugin isn't installed yet.
    private func register(_ input: [String: JSONValue]) async {
        let _: JSONValue? = try? await client.rpc("mobile", "live_register", .object(input))
    }
}

private extension Data {
    var hex: String { map { String(format: "%02x", $0) }.joined() }
}
