import Foundation

/// WCAG contrast between two theme colours (`#rrggbb`), for the round 5 rules:
/// text steps (ink, muted, subtle) at least 4.5:1 on the canvas, the
/// needs-you amber at least 3:1 (a mark beside a word, not text alone).
public enum LookContrast {
    public static func ratio(_ a: String, _ b: String) -> Double? {
        guard let la = luminance(a), let lb = luminance(b) else { return nil }
        return (max(la, lb) + 0.05) / (min(la, lb) + 0.05)
    }

    /// `color`, stepped toward black on a light canvas (white on a dark one)
    /// until it reaches `minimum` against `canvas`: a light theme's pale amber
    /// still reads as a mark, and themes that already pass keep their colour.
    public static func legible(_ color: String, on canvas: String, minimum: Double) -> String {
        guard let canvasLuminance = luminance(canvas), let start = rgb(color) else { return color }
        let target: Double = canvasLuminance > 0.4 ? 0 : 1
        for step in 0...20 {
            let t = Double(step) / 20
            let mixed = start.map { $0 + (target - $0) * t }
            let hex = "#" + mixed.map { String(format: "%02x", Int(($0 * 255).rounded())) }.joined()
            if let ratio = ratio(hex, canvas), ratio >= minimum { return step == 0 ? color : hex }
        }
        return color
    }

    static func rgb(_ hex: String) -> [Double]? {
        let digits = hex.trimmingCharacters(in: CharacterSet(charactersIn: "#")).prefix(6)
        guard digits.count == 6, let value = UInt32(digits, radix: 16) else { return nil }
        return [(value >> 16) & 0xff, (value >> 8) & 0xff, value & 0xff].map { Double($0) / 255 }
    }

    static func luminance(_ hex: String) -> Double? {
        let digits = hex.trimmingCharacters(in: CharacterSet(charactersIn: "#")).prefix(6)
        guard digits.count == 6, let value = UInt32(digits, radix: 16) else { return nil }
        let channels = [(value >> 16) & 0xff, (value >> 8) & 0xff, value & 0xff].map { Double($0) / 255 }
        let linear = channels.map { $0 <= 0.03928 ? $0 / 12.92 : pow(($0 + 0.055) / 1.055, 2.4) }
        return 0.2126 * linear[0] + 0.7152 * linear[1] + 0.0722 * linear[2]
    }
}
