import ActivityKit
import Foundation

/// The one BB Studio Live Activity: what needs you and how much is running.
/// The mobile plugin pushes `ContentState` as JSON (`plugin/live.ts`), so the
/// type name and keys must match what it sends.
struct BBStatusAttributes: ActivityAttributes {
    struct ContentState: Codable, Hashable {
        var needsYou: Int
        var running: Int
        /// The thread that needs you, else the most recent running one.
        var headline: String?
        var headlineThreadId: String?
        /// The last notable event, like "✓ Lakenridge finished".
        var latest: String?
        /// Epoch seconds. A Double because pushed JSON can't carry `Date`'s encoding.
        var updatedAt: Double

        var isClear: Bool { needsYou == 0 && running == 0 }

        /// Opens the thread that needs you, or the inbox.
        var url: URL {
            if needsYou > 0, let headlineThreadId { return URL(string: "bbstudio://thread/\(headlineThreadId)")! }
            return URL(string: "bbstudio://inbox")!
        }
    }
}
