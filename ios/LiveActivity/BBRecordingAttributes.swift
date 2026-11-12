import ActivityKit
import Foundation

/// The Live Activity shown while a Talk recording is in progress.
struct BBRecordingAttributes: ActivityAttributes {
    var recordingId: String
    struct ContentState: Codable, Hashable {
        var phase: String
        var startedAt: Double
        var updatedAt: Double
    }
}
