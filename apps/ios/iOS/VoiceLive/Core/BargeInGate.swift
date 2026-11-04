import Foundation

/// Barge-in by level: GPT-Live's transcript of the user runs about 2 s behind
/// while it talks (live run, Nov 1), so the phone can't wait for words. While
/// the voice plays, a mic level that stays clearly above the voice's own echo
/// for a moment counts as the user talking: the voice is muted at once, and
/// the transcript then confirms it (words within about a second) or cancels it.
///
/// Echo-safe: while the voice plays the bar is higher, and it rises with the
/// voice's playback level (what's left of it after echo cancellation), so the
/// voice can't trigger itself; and speech must last `minDuration`, so a cough,
/// a bump or a click doesn't either. Levels are linear RMS, 0 to 1.
///
/// Nov 4: on the speaker, echo and room noise cleared the old bar (0.035, half
/// the playback plus 0.02, for 120 ms) and cut the voice off mid-sentence again
/// and again. The bar is now 0.06, 70% of the playback plus 0.02, for 250 ms.
struct BargeInGate: Equatable, Sendable {
    /// The bar while the voice is quiet.
    var quietThreshold: Float = 0.02
    /// While it plays: at least this much…
    var playingFloor: Float = 0.06
    /// …and above this share of the playback level plus a margin.
    var echoRatio: Float = 0.7
    var echoMargin: Float = 0.02
    /// Speech has to stay above the bar this long.
    var minDuration: TimeInterval = 0.25

    /// The bar before Nov 4, for comparisons.
    static let before = BargeInGate(playingFloor: 0.035, echoRatio: 0.5, minDuration: 0.12)

    private var aboveSince: TimeInterval?

    func threshold(playback: Float, voicePlaying: Bool) -> Float {
        voicePlaying ? max(playingFloor, playback * echoRatio + echoMargin) : quietThreshold
    }

    /// One mic frame. True once the user has been talking for `minDuration`.
    mutating func feed(level: Float, playback: Float, voicePlaying: Bool, at: TimeInterval) -> Bool {
        guard level > threshold(playback: playback, voicePlaying: voicePlaying) else {
            aboveSince = nil
            return false
        }
        let since = aboveSince ?? at
        aboveSince = since
        // A millisecond of slack: frame times add up in floating point.
        return at - since >= minDuration - 0.001
    }

    mutating func reset() {
        aboveSince = nil
    }
}
