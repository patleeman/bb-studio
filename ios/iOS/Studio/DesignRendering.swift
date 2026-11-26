import CryptoKit
import SwiftUI
import UIKit
import WebKit

/// One load of untrusted HTML in a web view, awaited: it ends exactly once,
/// true when the page finished, false when it failed, its WebContent process
/// died, or the awaiting task was cancelled. It holds the view to
/// `UntrustedWeb`'s policy for its own document.
@MainActor
final class UntrustedPageLoad: NSObject, WKNavigationDelegate, WKUIDelegate {
    private let allowed: URL?
    private var continuation: CheckedContinuation<Bool, Never>?
    private var ended = false

    private init(allowed: URL?) { self.allowed = allowed }

    /// Loads `url` (or, in the offline demo, its HTML) in `view` and waits for the end.
    static func run(_ view: WKWebView, url: URL) async -> Bool {
        let load = UntrustedPageLoad(allowed: url)
        view.navigationDelegate = load
        view.uiDelegate = load
        let finished = await withTaskCancellationHandler {
            await withCheckedContinuation { continuation in
                load.continuation = continuation
                #if DEBUG
                if let html = DesignDemo.html(for: url) {
                    view.loadHTMLString(html, baseURL: nil)
                    return
                }
                #endif
                view.load(URLRequest(url: url))
            }
        } onCancel: {
            Task { @MainActor in
                view.stopLoading()
                load.end(false)
            }
        }
        view.navigationDelegate = nil
        view.uiDelegate = nil
        return finished
    }

    /// Resumes the waiting task the first time; later ends (a second didFinish, a crash after it) do nothing.
    func end(_ finished: Bool) {
        guard !ended else { return }
        ended = true
        continuation?.resume(returning: finished)
        continuation = nil
    }

    func webView(_ webView: WKWebView, decidePolicyFor action: WKNavigationAction) async -> WKNavigationActionPolicy {
        UntrustedWeb.policy(for: action, allowed: allowed)
    }

    func webView(_ webView: WKWebView, createWebViewWith configuration: WKWebViewConfiguration,
                 for action: WKNavigationAction, windowFeatures: WKWindowFeatures) -> WKWebView? { nil }

    func webView(_ webView: WKWebView, didFinish navigation: WKNavigation!) { end(true) }
    func webView(_ webView: WKWebView, didFail navigation: WKNavigation!, withError error: Error) { end(false) }
    func webView(_ webView: WKWebView, didFailProvisionalNavigation navigation: WKNavigation!, withError error: Error) { end(false) }
    func webViewWebContentProcessDidTerminate(_ webView: WKWebView) { end(false) }
}

/// Draws a design screen to a picture: the page at its own size, offscreen in a
/// window (a web view must be in one to draw), until its fonts and first frames
/// are in; then one snapshot, and the web view is gone.
@MainActor
enum DesignScreenRenderer {
    struct Still {
        var image: UIImage
        /// The page's height at its own width (a screen can be taller than its frame).
        var pageHeight: CGFloat
    }

    /// `fullPage` takes the whole page (the player's still); else the screen's frame (a thumbnail).
    /// `width` is the snapshot's width in points for a page height. Nil when it didn't draw.
    static func render(_ url: URL, size: CGSize, in host: UIView, fullPage: Bool,
                       width: (CGFloat) -> CGFloat) async -> Still? {
        let configuration = UntrustedWeb.configuration()
        configuration.suppressesIncrementalRendering = true
        let page = WKWebView(frame: CGRect(origin: .zero, size: size), configuration: configuration)
        // Opaque and in the window: a snapshot keeps the view's alpha, and a hidden view doesn't draw.
        page.isUserInteractionEnabled = false
        page.accessibilityElementsHidden = true
        page.scrollView.contentInsetAdjustmentBehavior = .never
        host.insertSubview(page, at: 0)
        defer { page.removeFromSuperview() }
        guard await UntrustedPageLoad.run(page, url: url), !Task.isCancelled else { return nil }
        let script = """
            if (document.fonts) { await document.fonts.ready; }
            await new Promise(done => requestAnimationFrame(() => requestAnimationFrame(done)));
            return Math.max(document.documentElement.scrollHeight, document.body ? document.body.scrollHeight : 0);
            """
        let measured = (try? await page.callAsyncJavaScript(script, contentWorld: .defaultClient)) as? Double
        let pageHeight = fullPage ? min(8000, max(size.height, CGFloat(measured ?? Double(size.height)))) : size.height
        page.frame.size.height = pageHeight
        try? await Task.sleep(for: .milliseconds(100))
        guard !Task.isCancelled else { return nil }
        let snapshot = WKSnapshotConfiguration()
        snapshot.rect = CGRect(x: 0, y: 0, width: size.width, height: pageHeight)
        snapshot.snapshotWidth = NSNumber(value: Double(width(pageHeight)))
        snapshot.afterScreenUpdates = true
        guard let image = try? await page.takeSnapshot(configuration: snapshot) else { return nil }
        return Still(image: image, pageHeight: pageHeight)
    }
}

/// Design thumbnails as pictures, not live pages (review S9): each screen
/// version is drawn once, one at a time, by a single offscreen web view that
/// is then released, and kept in memory and on disk. A screen's address
/// changes with every revision, so a kept picture is never stale.
@MainActor
final class DesignThumbnails {
    static let shared = DesignThumbnails()

    private let memory = NSCache<NSString, UIImage>()
    private var drawing: [String: Task<UIImage?, Never>] = [:]
    /// One render at a time: at most one web view for every thumbnail on screen.
    private var queue: Task<Void, Never>?
    private let folder = FileManager.default.urls(for: .cachesDirectory, in: .userDomainMask)[0].appending(path: "design-thumbnails")

    private init() { memory.totalCostLimit = 48 << 20 }

    /// The picture kept for this screen version, if any: no work.
    func cached(_ url: URL, height: CGFloat) -> UIImage? {
        let key = Self.key(url, height: height)
        if let hit = memory.object(forKey: key as NSString) { return hit }
        guard let data = try? Data(contentsOf: file(key)), let image = UIImage(data: data) else { return nil }
        keep(image, key)
        return image
    }

    /// The screen's top `size` (its frame), `height` points tall; drawn if not kept.
    func image(_ url: URL, size: CGSize, height: CGFloat) async -> UIImage? {
        if let hit = cached(url, height: height) { return hit }
        let key = Self.key(url, height: height)
        if let running = drawing[key] { return await running.value }
        let previous = queue
        let task = Task<UIImage?, Never> { [weak self] in
            await previous?.value
            guard let self, !Task.isCancelled, let host = Self.host() else { return nil }
            let scale = height / max(1, size.height)
            let still = await DesignScreenRenderer.render(url, size: size, in: host, fullPage: false) { _ in size.width * scale }
            guard let image = still?.image else { return nil }
            self.keep(image, key)
            try? FileManager.default.createDirectory(at: self.folder, withIntermediateDirectories: true)
            try? image.pngData()?.write(to: self.file(key))
            return image
        }
        drawing[key] = task
        queue = Task { _ = await task.value }
        let image = await task.value
        drawing[key] = nil
        return image
    }

    private func keep(_ image: UIImage, _ key: String) {
        memory.setObject(image, forKey: key as NSString, cost: Int(image.size.width * image.size.height * image.scale * image.scale * 4))
    }

    private func file(_ key: String) -> URL { folder.appending(path: "\(key).png") }

    /// A file-safe key for a screen version at a height.
    static func key(_ url: URL, height: CGFloat) -> String {
        let digest = SHA256.hash(data: Data("\(url.absoluteString)|\(Int(height))".utf8))
        return digest.prefix(16).map { String(format: "%02x", $0) }.joined()
    }

    /// Where the renderer draws: in the window (a web view must be in one to draw) but
    /// beneath everything, under the app's opaque views, so it's never seen.
    private static func host() -> UIView? {
        let windows = UIApplication.shared.connectedScenes.compactMap { $0 as? UIWindowScene }.flatMap(\.windows)
        guard let window = windows.first(where: \.isKeyWindow) ?? windows.first else { return nil }
        if let host = window.viewWithTag(Self.hostTag) { return host }
        let host = UIView(frame: window.bounds)
        host.tag = Self.hostTag
        host.isUserInteractionEnabled = false
        host.accessibilityElementsHidden = true
        host.autoresizingMask = [.flexibleWidth, .flexibleHeight]
        window.insertSubview(host, at: 0)
        return host
    }

    private static let hostTag = 0xD5_16
}

/// A screen's thumbnail: its picture from `DesignThumbnails`, `height` points
/// tall at the screen's proportions. No web view stays behind it.
struct DesignThumbnailImage: View {
    let url: URL
    let size: CGSize
    let height: CGFloat
    @State private var image: UIImage?
    @State private var failed = false

    var body: some View {
        Group {
            if let image {
                Image(uiImage: image).resizable().scaledToFill()
                    .accessibilityIdentifier("designThumbnail")
            } else if failed {
                Image(systemName: "rectangle.dashed").foregroundStyle(.tertiary)
            } else {
                ProgressView()
            }
        }
        .frame(width: size.width * height / max(1, size.height), height: height)
        .background(Color(.secondarySystemBackground))
        .task(id: url) {
            if let hit = DesignThumbnails.shared.cached(url, height: height) {
                image = hit
                return
            }
            image = await DesignThumbnails.shared.image(url, size: size, height: height)
            failed = image == nil && !Task.isCancelled
        }
    }
}
