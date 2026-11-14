import Foundation

public enum RelativeTime {
    /// "just now", "4m ago", "3h ago", "2d ago" (shared.ts `ago`).
    public static func ago(_ at: Double, now: Double) -> String {
        let seconds = max(0, ((now - at) / 1000).rounded())
        if seconds < 45 { return "just now" }
        let minutes = (seconds / 60).rounded()
        if minutes < 60 { return "\(Int(minutes))m ago" }
        let hours = (minutes / 60).rounded()
        if hours < 48 { return "\(Int(hours))h ago" }
        return "\(Int((hours / 24).rounded()))d ago"
    }
}
