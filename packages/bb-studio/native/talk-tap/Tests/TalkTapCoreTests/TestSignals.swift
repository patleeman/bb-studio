import Foundation

/// Speech-like test audio at 16 kHz: voiced "syllables" (a 140 Hz buzz with harmonics,
/// shaped by an envelope) in utterances, with pauses between them.
enum TestSignals {
    static let rate = 16000

    static func silence(ms: Int) -> [Float] { [Float](repeating: 0, count: ms * rate / 1000) }

    /// Low background noise, below the speech threshold.
    static func noise(ms: Int, level: Float = 0.001, seed: UInt64 = 1) -> [Float] {
        var state = seed
        return (0..<(ms * rate / 1000)).map { _ in
            state = state &* 6364136223846793005 &+ 1442695040888963407
            return (Float(state >> 40) / Float(1 << 24) * 2 - 1) * level
        }
    }

    static func syllable(ms: Int = 200, pitch: Double = 140, amplitude: Float = 0.3) -> [Float] {
        let n = ms * rate / 1000
        return (0..<n).map { i in
            let t = Double(i) / Double(rate)
            let envelope = sin(Double.pi * Double(i) / Double(n))
            var v = 0.0
            for h in 1...5 { v += sin(2 * .pi * pitch * Double(h) * t) / Double(h) }
            return Float(v * envelope * 0.6) * amplitude
        }
    }

    /// An utterance of back-to-back syllables with tiny gaps (shorter than a pause).
    static func utterance(ms: Int, pitch: Double = 140) -> [Float] {
        var out: [Float] = []
        while out.count < ms * rate / 1000 {
            out += syllable(pitch: pitch)
            out += silence(ms: 40)
        }
        return Array(out.prefix(ms * rate / 1000))
    }

    /// A conversation-ish stream: utterances of `utteranceMs` separated by `pauseMs` of silence.
    static func talk(utterances: [Int], pauseMs: Int, leadMs: Int = 0, pitch: Double = 140) -> [Float] {
        var out = silence(ms: leadMs)
        for ms in utterances {
            out += utterance(ms: ms, pitch: pitch)
            out += silence(ms: pauseMs)
        }
        return out
    }
}
