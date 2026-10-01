import ActivityKit
import Foundation

/// Keep the content keys in sync with `threadActivityState` in mobile/live.ts.
struct BBThreadAttributes: ActivityAttributes {
    var threadId: String
    struct ContentState: Codable, Hashable {
        var title: String
        var status: String
        var needsYou: Bool
        var updatedAt: Double
    }
}

struct BBRecordingAttributes: ActivityAttributes {
    var recordingId: String
    struct ContentState: Codable, Hashable {
        var phase: String
        var startedAt: Double
        var updatedAt: Double
    }
}
