import UIKit
import WebKit

/// The desktop player's Export PDF and Download HTML, as files for the share
/// sheet. The PDF is Studio's print page (`/designs/print`: one page per
/// step), laid out at the screen's size and paged by WebKit's print formatter.
@MainActor
enum DesignExport {
    static func file(_ client: BBClient, designId: String, screen: DesignScreen, print: Bool) async throws -> URL {
        let name = "\(designId)-\(screen.id ?? "screen")"
        let folder = FileManager.default.temporaryDirectory.appending(path: "design-export-\(UUID().uuidString)")
        try FileManager.default.createDirectory(at: folder, withIntermediateDirectories: true)
        let url = client.designScreenFileURL(designId, screen, print: print)
        if print {
            let file = folder.appending(path: "\(name).pdf")
            try await PrintRenderer(size: CGSize(width: screen.size.width, height: screen.size.height)).pdf(of: url).write(to: file)
            return file
        }
        let (status, data) = try await client.raw(method: "GET", path: url.path() + "?" + (url.query() ?? ""), body: nil)
        guard (200..<300).contains(status) else { throw BBError(status: status, message: "Studio didn't send the screen (HTTP \(status)).") }
        let file = folder.appending(path: "\(name).html")
        try data.write(to: file)
        return file
    }
}

/// Loads a page offscreen and prints it to PDF pages of `size`.
@MainActor
private final class PrintRenderer: NSObject, WKNavigationDelegate, WKUIDelegate {
    let size: CGSize
    private var view: WKWebView?
    private var finished: CheckedContinuation<Void, Error>?
    private var allowed: URL?

    init(size: CGSize) { self.size = size }

    func pdf(of url: URL) async throws -> Data {
        let view = WKWebView(frame: CGRect(origin: .zero, size: size), configuration: UntrustedWeb.configuration())
        view.navigationDelegate = self
        view.uiDelegate = self
        allowed = url
        self.view = view
        try await withCheckedThrowingContinuation { continuation in
            finished = continuation
            view.load(URLRequest(url: url))
        }
        // Fonts and first frames before printing.
        try? await Task.sleep(for: .milliseconds(400))
        let renderer = UIPrintPageRenderer()
        renderer.addPrintFormatter(view.viewPrintFormatter(), startingAtPageAt: 0)
        let page = CGRect(origin: .zero, size: size)
        renderer.setValue(page, forKey: "paperRect")
        renderer.setValue(page, forKey: "printableRect")
        let data = NSMutableData()
        UIGraphicsBeginPDFContextToData(data, page, nil)
        renderer.prepare(forDrawingPages: NSRange(location: 0, length: renderer.numberOfPages))
        for index in 0..<renderer.numberOfPages {
            UIGraphicsBeginPDFPage()
            renderer.drawPage(at: index, in: UIGraphicsGetPDFContextBounds())
        }
        UIGraphicsEndPDFContext()
        self.view = nil
        return data as Data
    }

    /// The print page only (`UntrustedWeb`).
    func webView(_ webView: WKWebView, decidePolicyFor action: WKNavigationAction) async -> WKNavigationActionPolicy {
        UntrustedWeb.policy(for: action, allowed: allowed)
    }

    func webView(_ webView: WKWebView, createWebViewWith configuration: WKWebViewConfiguration,
                 for action: WKNavigationAction, windowFeatures: WKWindowFeatures) -> WKWebView? { nil }

    func webView(_ webView: WKWebView, didFinish navigation: WKNavigation!) {
        finished?.resume()
        finished = nil
    }

    func webView(_ webView: WKWebView, didFail navigation: WKNavigation!, withError error: Error) { fail(error) }
    func webView(_ webView: WKWebView, didFailProvisionalNavigation navigation: WKNavigation!, withError error: Error) { fail(error) }

    private func fail(_ error: Error) {
        finished?.resume(throwing: error)
        finished = nil
    }
}
