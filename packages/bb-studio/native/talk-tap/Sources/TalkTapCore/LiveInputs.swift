// The real inputs: a Core Audio process tap ("them") and the voice-processing mic ("me").
import Foundation

public enum LiveInputs {
    public static func make(_ args: CaptureArgs) throws -> [AudioInput] {
        throw CaptureError(.device, "live capture isn't built yet")
    }
}
