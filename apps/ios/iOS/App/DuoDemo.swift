#if DEBUG
import UIKit

/// Simulator-only window resizing for the Duo fixture. The hosting controller,
/// navigation stack and transcript remain mounted; no fake scroll view is used.
@MainActor
enum DuoDemo {
    nonisolated static var phone: Bool { ProcessInfo.processInfo.arguments.contains("-qaDuoPhone") }

    static func handle(_ url: URL) -> Bool {
        guard BotDemo.variant == "duo", url.host() == "qa-duo",
              let window = UIApplication.shared.connectedScenes.compactMap({ $0 as? UIWindowScene })
                .flatMap(\.windows).first(where: \.isKeyWindow) else { return false }
        let size: CGSize
        switch url.lastPathComponent {
        case "outer": size = CGSize(width: 466, height: 678)
        case "portrait": size = CGSize(width: 669, height: 951)
        case "landscape": size = CGSize(width: 951, height: 669)
        case "tab":
            switch url.query() {
            case "bot": AppModel.shared.tab = .bot
            case "threads": AppModel.shared.tab = .inbox
            case "studio": AppModel.shared.tab = .studio
            case "settings": AppModel.shared.tab = .settings
            default: return false
            }
            return true
        case "capture":
            let name = url.query() ?? "phone-root"
            let metadata: [String: Any] = ["idiom": window.traitCollection.userInterfaceIdiom == .phone ? "phone" : "other",
                "width": window.bounds.width, "height": window.bounds.height,
                "safeTop": window.safeAreaInsets.top, "safeRight": window.safeAreaInsets.right,
                "screenWidth": window.screen.bounds.width, "screenHeight": window.screen.bounds.height,
                "windows": window.windowScene?.windows.map { ["class": String(describing: type(of: $0)),
                    "width": $0.bounds.width, "height": $0.bounds.height, "hidden": $0.isHidden] as [String: Any] } ?? []]
            try? JSONSerialization.data(withJSONObject: metadata, options: .sortedKeys)
                .write(to: URL.documentsDirectory.appending(path: name + ".json"))
            let format = UIGraphicsImageRendererFormat()
            format.scale = 3
            let image = UIGraphicsImageRenderer(bounds: window.bounds, format: format).image { _ in
                window.drawHierarchy(in: window.bounds, afterScreenUpdates: true)
                for overlay in window.windowScene?.windows ?? [] where overlay !== window && !overlay.isHidden {
                    overlay.drawHierarchy(in: window.convert(overlay.bounds, from: overlay), afterScreenUpdates: true)
                }
            }
            try? image.pngData()?.write(to: URL.documentsDirectory.appending(path: name + ".png"))
            return true
        case "focus":
            if case .thread(let id)? = AppModel.shared.path.last { AppModel.shared.replyThreadId = id }
            return true
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
