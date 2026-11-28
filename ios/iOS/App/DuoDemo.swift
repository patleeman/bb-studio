#if DEBUG
import UIKit

/// Simulator-only window resizing for the Duo fixture. The hosting controller,
/// navigation stack and transcript remain mounted; no fake scroll view is used.
@MainActor
enum DuoDemo {
    nonisolated static var phone: Bool { ProcessInfo.processInfo.arguments.contains("-qaDuoPhone") }

    /// The screen the resized window stands for. The simulator's screen is
    /// the outer one (466 × 678); nil keeps it.
    static var screenSize: CGSize?
    /// The keyboard's top edge in the window, from its last frame change.
    private static var keyboardTop: CGFloat?
    private static var keyboardObserver: NSObjectProtocol?
    private static var recorder: Timer?
    private static var configured: Set<ObjectIdentifier> = []

    static func configure(_ window: UIWindow) {
        let args = ProcessInfo.processInfo.arguments
        if args.contains("-qaDark") { window.overrideUserInterfaceStyle = .dark }
        if keyboardObserver == nil {
            keyboardObserver = NotificationCenter.default.addObserver(forName: UIResponder.keyboardWillChangeFrameNotification,
                                                                      object: nil, queue: .main) { note in
                guard let frame = note.userInfo?[UIResponder.keyboardFrameEndUserInfoKey] as? CGRect else { return }
                MainActor.assumeIsolated {
                    guard let window = UIApplication.shared.connectedScenes.compactMap({ $0 as? UIWindowScene })
                        .flatMap(\.windows).first(where: \.isKeyWindow) else { return }
                    // Off the bottom of the screen: the keyboard is down.
                    keyboardTop = frame.minY >= window.screen.bounds.maxY - 1 ? nil
                        : window.convert(frame, from: window.screen.coordinateSpace).minY
                }
            }
        }
        guard args.contains("-qaDuoColdWide"), configured.insert(ObjectIdentifier(window)).inserted else { return }
        screenSize = CGSize(width: 951, height: 669)
        window.frame = CGRect(x: 0, y: 0, width: 951, height: 669)
        DispatchQueue.main.async {
            innerScreenInsets(window)
            window.rootViewController?.view.setNeedsLayout()
            window.layoutIfNeeded()
        }
    }

    /// "ViewClass frame: keys" for each layer under the window with animations.
    static func runningAnimations(_ window: UIWindow) -> [String] {
        var out: [String] = []
        func walk(_ layer: CALayer, _ path: String) {
            let owner = (layer.delegate as? UIView).map { String(describing: type(of: $0)) } ?? String(describing: type(of: layer))
            let here = path.isEmpty ? owner : path + ">" + owner
            if let view = layer.delegate as? UIView, String(describing: type(of: view)) == "WKWebView", !view.isHidden, view.alpha > 0 {
                out.append("webview \(here.suffix(120)) \(layer.convert(layer.bounds, to: window.layer).integral)")
            }
            if let keys = layer.animationKeys(), !keys.isEmpty {
                let frame = layer.convert(layer.bounds, to: window.layer)
                // Finished ones a layer keeps (removedOnCompletion off) don't run: marked, so a test can tell.
                let now = layer.convertTime(CACurrentMediaTime(), from: nil)
                let details = keys.compactMap { key in layer.animation(forKey: key).map { animation in
                    let repeats = max(1, Double(animation.repeatCount))
                    // Paused (speed 0: a refresh control's, scrubbed by the pull), or over.
                    let done = layer.speed == 0 || animation.speed == 0
                        || (animation.repeatCount < 1000 && now > animation.beginTime + animation.duration * repeats + 0.05)
                    return "\(key) repeat=\(animation.repeatCount) dur=\(animation.duration)\(done ? " done" : "")"
                } }
                out.append("\(here.suffix(160)) \(frame.integral): \(details.joined(separator: ", "))")
            }
            for sub in layer.sublayers ?? [] { walk(sub, here) }
        }
        // Every window of every scene: an animation in another one keeps the app from idling too.
        let windows = UIApplication.shared.connectedScenes.compactMap { $0 as? UIWindowScene }.flatMap(\.windows)
        for each in windows.isEmpty ? [window] : windows {
            walk(each.layer, String(describing: type(of: each)))
        }
        return out
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
                    "indicator": scroll.showsVerticalScrollIndicator,
                    "indicatorRight": scroll.verticalScrollIndicatorInsets.right,
                    "safeRight": scroll.safeAreaInsets.right,
                    // Where UIKit draws its indicators (shown or faded out).
                    "indicators": scroll.subviews.filter { String(describing: type(of: $0)).contains("ScrollIndicator") }
                        .map { $0.convert($0.bounds, to: window) }
                        .map { ["x": $0.minX, "y": $0.minY, "width": $0.width, "height": $0.height] },
                    "adjustedBottom": scroll.adjustedContentInset.bottom, "adjustedTop": scroll.adjustedContentInset.top,
                    "clips": scroll.clipsToBounds])
            }
            return result
        }
        func composers(_ view: UIView) -> [[String: Any]] {
            if let field = view as? UITextView, field.accessibilityIdentifier == "composerField", field.window != nil,
               let host = sequence(first: field as UIView, next: \.superview).first(where: { $0.superview?.next is TranscriptController }) {
                let rect = field.convert(field.bounds, to: nil)
                let box = host.convert(host.bounds, to: nil)
                return [["field": ["x": rect.minX, "y": rect.minY, "width": rect.width, "height": rect.height],
                         "host": ["x": box.minX, "y": box.minY, "width": box.width, "height": box.height]]]
            }
            return view.subviews.flatMap(composers)
        }
        func transcripts(_ view: UIView) -> [[String: Any]] {
            if let controller = view.next as? TranscriptController, view.window != nil { return [controller.qaGeometry] }
            return view.subviews.flatMap(transcripts)
        }
        let transcripts = transcripts(window)
        // Each conversation's rows (`transcript-<thread>`), measured now: the composer lines up with them.
        var surfaces: [String: Any] = [:]
        for transcript in transcripts {
            if let key = transcript["key"] as? String, let rows = transcript["rows"] { surfaces["transcript-" + key] = rows }
        }
        return ["width": window.bounds.width, "height": window.bounds.height,
                "composers": (window.windowScene?.windows ?? [window]).flatMap(composers),
                "transcripts": transcripts,
                "safeRight": window.safeAreaInsets.right, "safeBottom": window.safeAreaInsets.bottom,
                "keyboardTop": keyboardTop ?? window.bounds.height,
                "scrolls": scrolls(window),
                "surfaces": surfaces]
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
        guard BotDemo.variant != nil || BurstDemo.enabled, url.host() == "qa-duo",
              let window = UIApplication.shared.connectedScenes.compactMap({ $0 as? UIWindowScene })
                .flatMap(\.windows).first(where: \.isKeyWindow) else { return false }
        let size: CGSize
        var origin = CGPoint.zero
        switch url.lastPathComponent {
        case "outer":
            size = CGSize(width: 466, height: 678)
            screenSize = nil
        // The inner screen's two pages, shifted left so the right page is on
        // the simulator's screen (as wide as the outer one) and can be tapped.
        case "split-right":
            size = CGSize(width: 951, height: 669)
            origin.x = -476
            screenSize = CGSize(width: 951, height: 669)
        // The inner screen shifted left by `?points`, to bring a control
        // anywhere in it to the middle of the simulator's screen.
        case "shift":
            size = CGSize(width: 951, height: 669)
            origin.x = -(url.query().flatMap(Double.init) ?? 0)
            screenSize = CGSize(width: 951, height: 669)
        case "shift-portrait":
            let parts = (url.query() ?? "").split(separator: ",").compactMap { Double($0) }
            size = CGSize(width: 669, height: 951)
            origin = CGPoint(x: -(parts.first ?? 0), y: -(parts.dropFirst().first ?? 0))
            screenSize = size
        // Beside another app in iOS's own split of the inner screen: the
        // right half of it, kept on the simulator's screen so it can be tapped.
        case "split":
            size = CGSize(width: 468, height: 669)
            screenSize = CGSize(width: 951, height: 669)
        case "portrait":
            size = CGSize(width: 669, height: 951)
            screenSize = size
        case "landscape":
            size = CGSize(width: 951, height: 669)
            screenSize = size
        case "tab":
            switch url.query() {
            case "bot": Router.shared.home([])
            case "studio": Router.shared.home([.studio])
            case "settings": Router.shared.home([.settings])
            case "home": Router.shared.tab = .home
            case "library": Router.shared.tab = .library
            case "memory": Router.shared.tab = .memory
            case "search": Router.shared.tab = .search
            default: return false
            }
            return true
        case "workbench":
            // The shown conversation's Workbench (`-qaWorkbenchDemo`): `?close` its shown tab, `?open` a page tab, `?drawing` a drawing.
            guard let threadId = Router.shared.conversation else { return false }
            let store = WorkbenchStore.shared
            switch url.query() {
            case "close": if let shown = store.selected(threadId) { store.close(shown.id, in: threadId) }
            case "open": store.open(.init(kind: "page", id: "qa-demo"), title: "Lisbon budget", in: threadId)
            // A screen the phone already has (`WorkbenchItemTab`): a drawing.
            case "drawing": store.open(.init(kind: "whiteboard", id: "qa-demo-drawing"), title: "Floor plan", in: threadId)
            default: return false
            }
            return true
        case "posture":
            // A posture the simulator can't make (it has no hinge); `?auto` goes back to measuring.
            ShellQA.override = url.query().flatMap(ShellPosture.init(rawValue:))
            Router.shared.objectWillChange.send()
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
        case "layout":
            window.layoutIfNeeded()
            if let data = try? JSONSerialization.data(withJSONObject: layoutGeometry(window), options: .sortedKeys) {
                window.accessibilityValue = String(data: data, encoding: .utf8)
            }
            return true
        case "animations":
            // Every layer with an animation running: what keeps the app from going idle.
            let running = Self.runningAnimations(window).joined(separator: "\n")
            window.accessibilityValue = running
            // Also a file, readable from outside while a test is stuck (simctl openurl, then the app's Documents).
            try? Data((running.isEmpty ? "none" : running).utf8).write(to: URL.documentsDirectory.appending(path: "animations.txt"))
            return true
        case "dismiss":
            window.endEditing(true)
            return true
        case "counts":
            // `?reset` starts over; otherwise the counts since then, as JSON.
            RenderCount.watchMainThread()
            if url.query() == "reset" { RenderCount.reset() }
            RenderCount.set("transcript.links", TranscriptDisplayLinkTarget.live)
            RenderCount.set("router.path", Router.shared.path.count)
            if let data = try? JSONSerialization.data(withJSONObject: RenderCount.counts, options: .sortedKeys) {
                window.accessibilityValue = String(data: data, encoding: .utf8)
            }
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
        case "space-photo":
            BotDemo.Server.shared.addSpacePhoto()
            return true
        case "busy":
            BotDemo.Server.shared.busy(Double(url.query() ?? "") ?? 10)
            return true
        case "ask":
            BotDemo.Server.shared.ask()
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
        case "covered":
            // Whether VoiceOver reaches a UIKit view (`?composerField`): hidden if it or a view above it is.
            guard let id = url.query() else { return false }
            func named(_ view: UIView) -> UIView? {
                view.accessibilityIdentifier == id ? view : view.subviews.lazy.compactMap(named).first
            }
            guard let found = named(window) else { return false }
            let hidden = sequence(first: found, next: \.superview).contains { $0.accessibilityElementsHidden }
            window.accessibilityValue = hidden ? "hidden" : "shown"
            return true
        case "inspect":
            NotificationCenter.default.post(name: Notification.Name("duo-qa-inspect"), object: nil)
            return true
        case "mid", "bottom", "top":
            window.endEditing(true)
            NotificationCenter.default.post(name: Notification.Name("duo-qa-scroll"), object: url.lastPathComponent)
            return true
        case "capture":
            let name = url.query() ?? "phone-root"
            var metadata: [String: Any] = ["idiom": window.traitCollection.userInterfaceIdiom == .phone ? "phone" : "other",
                "width": window.bounds.width, "height": window.bounds.height,
                "appearance": window.traitCollection.userInterfaceStyle == .dark ? "dark" : "light",
                "safeTop": window.safeAreaInsets.top, "safeRight": window.safeAreaInsets.right, "safeLeft": window.safeAreaInsets.left,
                "rootSafeLeft": window.rootViewController?.view.safeAreaInsets.left ?? -1,
                "rootSafeRight": window.rootViewController?.view.safeAreaInsets.right ?? -1,
                "additionalRight": window.rootViewController?.additionalSafeAreaInsets.right ?? 0,
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
            metadata["hingeCenter"] = window.bounds.width > window.bounds.height
                ? pixel(image, x: window.bounds.width / 2, y: window.bounds.height * 0.3)
                : pixel(image, x: window.bounds.width * 0.3, y: window.bounds.height / 2)
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
            if let id = url.query() { Router.shared.replyThreadId = id }
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
            func field(_ view: UIView) -> UIView? {
                if view is UITextInput, view.accessibilityIdentifier == id { return view }
                return view.subviews.lazy.compactMap(field).first
            }
            if let input = field(window) {
                input.becomeFirstResponder()
                return true
            }
            // The system's bars can sit in a window of their own (the Duo's right column).
            let windows = [window] + (window.windowScene?.windows ?? []).filter { $0 !== window }
            _ = windows.lazy.compactMap(find).first?.accessibilityActivate()
            return true
        default: return false
        }
        window.accessibilityIdentifier = "duo-process-\(ProcessInfo.processInfo.processIdentifier)"
        window.frame = CGRect(origin: origin, size: size)
        innerScreenInsets(window)
        window.rootViewController?.view.setNeedsLayout()
        window.layoutIfNeeded()
        return true
    }

    /// The simulator's screen is the outer one, whose status column UIKit keeps at the window's
    /// trailing edge (84 pt) however the window is stretched, and lays the system's bars out
    /// for. The inner screen has none: for its sizes, cancel it (as Kensico's inner-screen demo does).
    static func innerScreenInsets(_ window: UIWindow) {
        // The window's own safe area: what the root view controller adds isn't in it.
        window.rootViewController?.additionalSafeAreaInsets.right = screenSize == nil ? 0 : -window.safeAreaInsets.right
    }
}
#endif
