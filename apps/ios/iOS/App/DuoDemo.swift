#if DEBUG
import UIKit

/// Simulator-only window resizing for the Duo fixture. The hosting controller,
/// navigation stack and transcript remain mounted; no fake scroll view is used.
@MainActor
enum DuoDemo {
    static func handle(_ url: URL) -> Bool {
        guard BotDemo.variant == "duo", url.host() == "qa-duo",
              let window = UIApplication.shared.connectedScenes.compactMap({ $0 as? UIWindowScene })
                .flatMap(\.windows).first(where: \.isKeyWindow) else { return false }
        let size: CGSize
        switch url.lastPathComponent {
        case "outer": size = CGSize(width: 466, height: 678)
        case "portrait": size = CGSize(width: 669, height: 951)
        case "landscape": size = CGSize(width: 951, height: 669)
        default: return false
        }
        window.accessibilityIdentifier = "duo-process-\(ProcessInfo.processInfo.processIdentifier)"
        window.frame = CGRect(origin: .zero, size: size)
        window.rootViewController?.view.setNeedsLayout()
        window.layoutIfNeeded()
        return true
    }
}
#endif
