import ActivityKit
import Foundation

/// One Live Activity per thread that's running, needs you, or just finished.
/// The mobile plugin starts, updates, and ends them by push; keep the keys in
/// sync with `ThreadActivityState` and `Ask` in mobile/live.ts.
struct BBThreadAttributes: ActivityAttributes {
    var threadId: String
    struct ContentState: Codable, Hashable {
        var title: String
        /// running, needsYou, failed, or done.
        var phase: String
        /// The tail of the latest reply.
        var last: String?
        var ask: Ask?
        var updatedAt: Double
    }

    /// What the thread is waiting on.
    struct Ask: Codable, Hashable {
        var id: String
        /// approval, plan, or question.
        var kind: String
        var text: String
        var choices: [String]
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
