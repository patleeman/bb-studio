import UIKit
import WebKit

/// Web views that show HTML an agent wrote: design screens (live, stills,
/// thumbnails, print) and a page's HTML and Mermaid blocks. Each gets its own
/// non-persistent data store, so nothing it runs can read or keep BB web's
/// cookies and storage, and a strict policy: it shows its own document and
/// nothing else. A link the user taps leaves for Safari; anything else that
/// tries to move it (script, meta refresh, a form, a new window) stays put.
enum UntrustedWeb {
    /// A configuration with a fresh non-persistent store and no script-opened windows.
    @MainActor static func configuration() -> WKWebViewConfiguration {
        let configuration = WKWebViewConfiguration()
        configuration.websiteDataStore = .nonPersistent()
        configuration.preferences.javaScriptCanOpenWindowsAutomatically = false
        return configuration
    }

    enum Decision: Equatable {
        case allow
        case cancel
        /// A tapped link: opened outside the app, the view stays.
        case openOutside(URL)
    }

    /// Whether a navigation may happen. `allowed` is the view's own document
    /// (a screen's address, whatever its fragment, which is a step); nil when
    /// the view loads its HTML as a string (about:blank). Frames may only be
    /// about: documents (srcdoc).
    static func decide(url: URL?, allowed: URL?, mainFrame: Bool, linkActivated: Bool) -> Decision {
        guard let url else { return .cancel }
        if url.scheme?.lowercased() == "about" { return .allow }
        if mainFrame, let allowed, sameDocument(url, allowed) { return .allow }
        if linkActivated, ["http", "https", "mailto"].contains(url.scheme?.lowercased() ?? "") { return .openOutside(url) }
        return .cancel
    }

    /// The same address apart from its fragment.
    static func sameDocument(_ a: URL, _ b: URL) -> Bool {
        func strip(_ url: URL) -> String? {
            var components = URLComponents(url: url, resolvingAgainstBaseURL: true)
            components?.fragment = nil
            return components?.url?.absoluteString
        }
        return strip(a) != nil && strip(a) == strip(b)
    }

    /// The policy for a navigation action, opening a tapped link outside.
    @MainActor static func policy(for action: WKNavigationAction, allowed: URL?) -> WKNavigationActionPolicy {
        switch decide(url: action.request.url, allowed: allowed, mainFrame: action.targetFrame?.isMainFrame ?? true,
                      linkActivated: action.navigationType == .linkActivated) {
        case .allow: return .allow
        case .cancel: return .cancel
        case .openOutside(let url):
            UIApplication.shared.open(url)
            return .cancel
        }
    }

    /// `target=_blank` and `window.open`: never a new web view; a tapped link opens outside.
    @MainActor static func newWindow(for action: WKNavigationAction) {
        guard action.navigationType == .linkActivated, let url = action.request.url,
              ["http", "https", "mailto"].contains(url.scheme?.lowercased() ?? "") else { return }
        UIApplication.shared.open(url)
    }
}

/// Holds a web view to `UntrustedWeb`'s policy for one allowed document, for
/// views with no navigation delegate of their own.
class UntrustedWebGuard: NSObject, WKNavigationDelegate, WKUIDelegate {
    var allowed: URL?

    init(allowed: URL?) { self.allowed = allowed }

    func webView(_ webView: WKWebView, decidePolicyFor action: WKNavigationAction) async -> WKNavigationActionPolicy {
        await UntrustedWeb.policy(for: action, allowed: allowed)
    }

    func webView(_ webView: WKWebView, createWebViewWith configuration: WKWebViewConfiguration,
                 for action: WKNavigationAction, windowFeatures: WKWindowFeatures) -> WKWebView? {
        MainActor.assumeIsolated { UntrustedWeb.newWindow(for: action) }
        return nil
    }
}
