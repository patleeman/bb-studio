#if DEBUG
import UIKit

/// Simulator-only window resizing for the Duo fixture. The hosting controller,
/// navigation stack and transcript remain mounted; no fake scroll view is used.
@MainActor
enum DuoDemo {
    nonisolated static var phone: Bool { ProcessInfo.processInfo.arguments.contains("-qaDuoPhone") }

    static var surfaces: [String: CGRect] = [:]
    private static var recorder: Timer?
    private static var configured: Set<ObjectIdentifier> = []

    static func configure(_ window: UIWindow) {
        let args = ProcessInfo.processInfo.arguments
        if args.contains("-qaDark") { window.overrideUserInterfaceStyle = .dark }
        guard args.contains("-qaDuoColdWide"), configured.insert(ObjectIdentifier(window)).inserted else { return }
        window.frame = CGRect(x: 0, y: 0, width: 951, height: 669)
    }

    private static func layoutGeometry(_ window: UIWindow) -> [String: Any] {
        func scrolls(_ view: UIView) -> [[String: Any]] {
            var result = view.subviews.flatMap(scrolls)
            if let scroll = view as? UIScrollView, !scroll.isHidden {
                let rect = scroll.convert(scroll.bounds, to: window)
                result.append(["x": rect.minX, "y": rect.minY, "width": rect.width, "height": rect.height,
                    "contentWidth": scroll.contentSize.width, "contentHeight": scroll.contentSize.height,
                    "contentOffsetY": scroll.contentOffset.y,
                    "adjustedRight": scroll.adjustedContentInset.right,
                    "adjustedBottom": scroll.adjustedContentInset.bottom, "adjustedTop": scroll.adjustedContentInset.top,
                    "clips": scroll.clipsToBounds])
            }
            return result
        }
        return ["width": window.bounds.width, "height": window.bounds.height,
                "pane": DuoPaneState.shared.pane.rawValue,
                "safeRight": window.safeAreaInsets.right, "safeBottom": window.safeAreaInsets.bottom,
                "scrolls": scrolls(window),
                "surfaces": surfaces.mapValues { ["x": $0.minX, "y": $0.minY, "width": $0.width, "height": $0.height] }]
    }

    private static func pixel(_ image: UIImage, x: CGFloat, y: CGFloat) -> [UInt8] {
        guard let image = image.cgImage?.cropping(to: CGRect(x: x * image.scale, y: y * image.scale, width: 1, height: 1)) else { return [] }
        var rgba = [UInt8](repeating: 0, count: 4)
        rgba.withUnsafeMutableBytes { bytes in
            let context = CGContext(data: bytes.baseAddress, width: 1, height: 1, bitsPerComponent: 8,
                bytesPerRow: 4, space: CGColorSpaceCreateDeviceRGB(), bitmapInfo: CGImageAlphaInfo.premultipliedLast.rawValue)
            context?.draw(image, in: CGRect(x: 0, y: 0, width: 1, height: 1))
        }
        return Array(rgba.prefix(3))
    }

    static func handle(_ url: URL) -> Bool {
        guard BotDemo.variant != nil, url.host() == "qa-duo",
              let window = UIApplication.shared.connectedScenes.compactMap({ $0 as? UIWindowScene })
                .flatMap(\.windows).first(where: \.isKeyWindow) else { return false }
        let size: CGSize
        var origin = CGPoint.zero
        switch url.lastPathComponent {
        case "outer": size = CGSize(width: 466, height: 678)
        // The inner screen's two pages, shifted left so the right page is on
        // the simulator's screen (as wide as the outer one) and can be tapped.
        case "split-right":
            size = CGSize(width: 951, height: 669)
            origin.x = -476
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
        case "replies-end":
            func revealEnd(_ view: UIView) -> Bool {
                if let scroll = view as? UIScrollView, scroll.bounds.height < 100,
                   scroll.bounds.width > 100, scroll.contentSize.width > scroll.bounds.width,
                   scroll.convert(scroll.bounds, to: window).minX > window.bounds.width / 2 {
                    // The end includes a trailing inset where the row borders the status column.
                    let end = scroll.contentSize.width + scroll.adjustedContentInset.right - scroll.bounds.width
                    scroll.setContentOffset(CGPoint(x: end, y: scroll.contentOffset.y), animated: false)
                    return true
                }
                return view.subviews.contains(where: revealEnd)
            }
            _ = revealEnd(window)
            return true
        case "pane":
            guard let pane = url.query().flatMap(DuoPane.init) else { return false }
            DuoPaneState.shared.set(pane)
            return true
        case "layout":
            if let data = try? JSONSerialization.data(withJSONObject: layoutGeometry(window), options: .sortedKeys) {
                window.accessibilityValue = String(data: data, encoding: .utf8)
            }
            return true
        case "dismiss":
            window.endEditing(true)
            return true
        case "pasteboard":
            // What this app last copied (its own copy: no paste prompt); `?clear` empties it.
            if url.query() == "clear" { UIPasteboard.general.string = "" }
            window.accessibilityValue = UIPasteboard.general.string ?? ""
            return true
        case "say":
            BotDemo.Server.shared.say(url.query()?.removingPercentEncoding ?? "")
            return true
        case "stream":
            BotDemo.Server.shared.sendAndStream(url.query()?.removingPercentEncoding ?? "From another device")
            return true
        case "burst":
            BotDemo.Server.shared.burst(Int(url.query() ?? "") ?? 40)
            return true
        case "draft":
            NotificationCenter.default.post(name: Notification.Name("qa-draft"), object: Int(url.query() ?? "") ?? 0)
            return true
        case "attach":
            NotificationCenter.default.post(name: Notification.Name("qa-attach"), object: nil)
            return true
        case "inspect":
            NotificationCenter.default.post(name: Notification.Name("duo-qa-inspect"), object: nil)
            return true
        case "mid", "bottom":
            window.endEditing(true)
            NotificationCenter.default.post(name: Notification.Name("duo-qa-scroll"), object: url.lastPathComponent)
            return true
        case "capture":
            let name = url.query() ?? "phone-root"
            var metadata: [String: Any] = ["idiom": window.traitCollection.userInterfaceIdiom == .phone ? "phone" : "other",
                "width": window.bounds.width, "height": window.bounds.height,
                "appearance": window.traitCollection.userInterfaceStyle == .dark ? "dark" : "light",
                "safeTop": window.safeAreaInsets.top, "safeRight": window.safeAreaInsets.right,
                "screenWidth": window.screen.bounds.width, "screenHeight": window.screen.bounds.height,
                "windows": window.windowScene?.windows.map { ["class": String(describing: type(of: $0)),
                    "width": $0.bounds.width, "height": $0.bounds.height, "hidden": $0.isHidden] as [String: Any] } ?? []]
            metadata.merge(layoutGeometry(window)) { _, measured in measured }
            let format = UIGraphicsImageRendererFormat()
            format.scale = 3
            let image = UIGraphicsImageRenderer(bounds: window.bounds, format: format).image { _ in
                window.drawHierarchy(in: window.bounds, afterScreenUpdates: true)
                for overlay in window.windowScene?.windows ?? [] where overlay !== window && !overlay.isHidden {
                    overlay.drawHierarchy(in: window.convert(overlay.bounds, from: overlay), afterScreenUpdates: true)
                }
            }
            metadata["railCenter"] = pixel(image, x: 8, y: window.bounds.height / 2)
            metadata["railBottom"] = pixel(image, x: 8, y: window.bounds.height - 5)
            // Just inside the sidebar, left of its 16-point content margin.
            let sidebarX = window.safeAreaInsets.left + 64 + 6
            metadata["sidebarHeader"] = pixel(image, x: sidebarX, y: 20)
            metadata["sidebarBody"] = pixel(image, x: sidebarX, y: window.bounds.height / 2)
            metadata["sidebarRowBottom"] = pixel(image, x: sidebarX + 40, y: window.bounds.height - 6)
            if let data = try? JSONSerialization.data(withJSONObject: metadata, options: .sortedKeys) {
                try? data.write(to: URL.documentsDirectory.appending(path: name + ".json"))
                window.accessibilityValue = String(data: data, encoding: .utf8)
            }
            try? image.pngData()?.write(to: URL.documentsDirectory.appending(path: name + ".png"))
            return true
        case "focus":
            if let id = url.query() { AppModel.shared.replyThreadId = id }
            else if case .thread(let id)? = AppModel.shared.path.last { AppModel.shared.replyThreadId = id }
            return true
        case "record":
            // Frames of the whole window for docs: the simulator's own screen
            // recording shows only the outer screen.
            recorder?.invalidate()
            recorder = nil
            guard url.query() == "start" else { return true }
            let folder = URL.documentsDirectory.appending(path: "recording")
            try? FileManager.default.removeItem(at: folder)
            try? FileManager.default.createDirectory(at: folder, withIntermediateDirectories: true)
            var frame = 0
            recorder = Timer.scheduledTimer(withTimeInterval: 1.0 / 30, repeats: true) { _ in
                MainActor.assumeIsolated {
                    let format = UIGraphicsImageRendererFormat()
                    format.scale = 2
                    let image = UIGraphicsImageRenderer(bounds: window.bounds, format: format).image { _ in
                        window.drawHierarchy(in: window.bounds, afterScreenUpdates: false)
                    }
                    try? image.jpegData(compressionQuality: 0.8)?.write(to: folder.appending(path: String(format: "%05d.jpg", frame)))
                    frame += 1
                }
            }
            return true
        case "activate":
            // The simulator's screen is the outer one, so XCUITest can't touch
            // most of the stretched inner window. Activate a control as
            // VoiceOver does instead: it runs the same action as a tap.
            guard let id = url.query() else { return false }
            func identifier(_ element: NSObject) -> String? {
                let getter = #selector(getter: UIAccessibilityIdentification.accessibilityIdentifier)
                return element.responds(to: getter) ? element.perform(getter)?.takeUnretainedValue() as? String : nil
            }
            func find(_ element: NSObject) -> NSObject? {
                if identifier(element) == id { return element }
                var children = (element.accessibilityElements as? [NSObject]) ?? []
                let count = element.accessibilityElementCount()
                if children.isEmpty, count != NSNotFound, count > 0 {
                    children = (0..<count).compactMap { element.accessibilityElement(at: $0) as? NSObject }
                }
                children += (element as? UIView)?.subviews ?? []
                for child in children { if let found = find(child) { return found } }
                return nil
            }
            _ = find(window)?.accessibilityActivate()
            return true
        default: return false
        }
        window.accessibilityIdentifier = "duo-process-\(ProcessInfo.processInfo.processIdentifier)"
        window.frame = CGRect(origin: origin, size: size)
        window.rootViewController?.view.setNeedsLayout()
        window.layoutIfNeeded()
        return true
    }
}
#endif
