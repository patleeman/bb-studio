import ActivityKit
import Foundation
import UIKit

/// The Live Activity shown while a Talk recording is in progress.
@MainActor
enum LiveItems {
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
}
