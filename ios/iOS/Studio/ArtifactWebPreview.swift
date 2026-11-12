import SwiftUI
import WebKit

/// Artifact content uses a sandboxing CSP. Keep its failure handling local to
/// this viewer rather than changing BB's other web surfaces.
struct ArtifactWebPreview: UIViewRepresentable {
    let url: URL
    let onFailure: (String) -> Void

    func makeUIView(context: Context) -> WKWebView {
        let configuration = WKWebViewConfiguration()
        configuration.allowsInlineMediaPlayback = true
        let view = WKWebView(frame: .zero, configuration: configuration)
        view.allowsBackForwardNavigationGestures = true
        view.navigationDelegate = context.coordinator
        context.coordinator.load(url, in: view)
        return view
    }

    func updateUIView(_ view: WKWebView, context: Context) {
        if context.coordinator.loaded != url { context.coordinator.load(url, in: view) }
    }

    func makeCoordinator() -> Coordinator { Coordinator(onFailure: onFailure) }

    static func dismantleUIView(_ view: WKWebView, coordinator: Coordinator) {
        coordinator.retired = true
        view.navigationDelegate = nil
        view.stopLoading()
    }

    final class Coordinator: NSObject, WKNavigationDelegate {
        var loaded: URL?
        var retired = false
        private var generation = 0
        private var navigation: WKNavigation?
        private var failed = false
        private let onFailure: (String) -> Void

        init(onFailure: @escaping (String) -> Void) { self.onFailure = onFailure }

        func load(_ url: URL, in view: WKWebView) {
            generation += 1
            failed = false
            loaded = url
            navigation = view.load(URLRequest(url: url, cachePolicy: .reloadIgnoringLocalCacheData))
        }

        private func fail(_ message: String) {
            guard !retired, !failed else { return }
            failed = true
            let request = generation
            // Navigation policy callbacks must finish before SwiftUI removes the view.
            DispatchQueue.main.async { [weak self] in
                guard let self, !self.retired, self.generation == request else { return }
                self.onFailure(message)
            }
        }

        func webView(_ webView: WKWebView, decidePolicyFor response: WKNavigationResponse,
                     decisionHandler: @escaping (WKNavigationResponsePolicy) -> Void) {
            guard !retired, response.isForMainFrame else {
                decisionHandler(retired ? .cancel : .allow)
                return
            }
            if let http = response.response as? HTTPURLResponse, !(200..<300).contains(http.statusCode) {
                fail("BB couldn't load this file (HTTP \(http.statusCode)). Try again, or share the file.")
                decisionHandler(.cancel)
            } else if !response.canShowMIMEType {
                fail("This file can't be previewed here. Try again, or share the file to open it in another app.")
                decisionHandler(.cancel)
            } else {
                decisionHandler(.allow)
            }
        }

        func webView(_ webView: WKWebView, didFail navigation: WKNavigation!, withError error: Error) {
            failed(navigation, error)
        }

        func webView(_ webView: WKWebView, didFailProvisionalNavigation navigation: WKNavigation!, withError error: Error) {
            failed(navigation, error)
        }

        func webViewWebContentProcessDidTerminate(_ webView: WKWebView) {
            fail("The preview stopped. Try again, or share the file.")
        }

        private func failed(_ completed: WKNavigation?, _ error: Error) {
            guard completed === navigation, !BBClient.isCancellation(error) else { return }
            fail(BBClient.describe(error, server: loaded ?? BBClient.storedServerURL))
        }
    }
}
