import UIKit
import WebKit

/// The page a look web view loads from the app bundle.
enum LookPage: String {
    /// Desktop's scene renderer and its six JS drivers.
    case scene
    /// Desktop's presence forms, and its sandbox for agent-made ones.
    case presence
}

/// A sandboxed WKWebView that runs desktop's look code (`Resources/look.js`,
/// built by `scripts/build-look.mjs`). It has no network: pages come from the
/// `bblook:` scheme only, a content rule list blocks http(s), ws(s), ftp and file
/// loads, each page's CSP has `connect-src 'none'` (presence) or `bblook:` (scene),
/// navigation is limited to the page and about: frames, and storage is
/// non-persistent. The scene page may call two read-only Studio RPCs,
/// `theme.weather` and `theme.sky`, which the scheme handler forwards for it.
@MainActor
final class LookWebView: NSObject {
    static let scheme = "bblook"
    /// The only RPCs a scene driver may reach.
    static let sceneRPCs: Set<String> = ["theme.weather", "theme.sky"]

    let page: LookPage
    let webView: WKWebView
    private var ready = false
    private var waiters: [CheckedContinuation<Void, Never>] = []
    private let handler: LookSchemeHandler
    var onMessage: (([String: Any]) -> Void)?

    init(page: LookPage, frame: CGRect = CGRect(x: 0, y: 0, width: 64, height: 64),
         rpc: (@Sendable (String, Data) async throws -> Data)? = LookWebView.studioRPC) {
        self.page = page
        handler = LookSchemeHandler(page: page, rpc: page == .scene ? rpc : nil)
        let config = WKWebViewConfiguration()
        config.websiteDataStore = .nonPersistent()
        config.setURLSchemeHandler(handler, forURLScheme: Self.scheme)
        config.preferences.javaScriptCanOpenWindowsAutomatically = false
        config.defaultWebpagePreferences.allowsContentJavaScript = true
        config.mediaTypesRequiringUserActionForPlayback = .all
        config.allowsInlineMediaPlayback = false
        config.dataDetectorTypes = []
        config.suppressesIncrementalRendering = false
        webView = WKWebView(frame: frame, configuration: config)
        super.init()
        config.userContentController.add(WeakMessageHandler(self), name: "bbLook")
        webView.navigationDelegate = self
        webView.isOpaque = page == .scene
        webView.backgroundColor = .clear
        webView.scrollView.backgroundColor = .clear
        webView.scrollView.isScrollEnabled = false
        webView.scrollView.contentInsetAdjustmentBehavior = .never
        webView.isUserInteractionEnabled = false
        webView.accessibilityElementsHidden = true
        webView.isInspectable = false
        Task { await load() }
    }

    private func load() async {
        if let rules = await LookWebView.blockRules() { webView.configuration.userContentController.add(rules) }
        webView.load(URLRequest(url: URL(string: "\(Self.scheme)://look/\(page.rawValue).html")!))
    }

    func waitUntilReady() async {
        if ready { return }
        await withCheckedContinuation { waiters.append($0) }
    }

    /// Runs `body` (an async JS function body) with `arguments`, after the page is ready.
    @discardableResult
    func call(_ body: String, _ arguments: [String: Any] = [:]) async throws -> Any? {
        await waitUntilReady()
        return try await webView.callAsyncJavaScript(body, arguments: arguments, in: nil, contentWorld: .page)
    }

    fileprivate func received(_ body: Any) {
        guard let message = body as? [String: Any] else { return }
        if message["kind"] as? String == "ready" {
            ready = true
            let waiting = waiters
            waiters = []
            waiting.forEach { $0.resume() }
        }
        onMessage?(message)
    }

    func tearDown() {
        webView.configuration.userContentController.removeScriptMessageHandler(forName: "bbLook")
        webView.stopLoading()
        webView.removeFromSuperview()
        let waiting = waiters
        waiters = []
        waiting.forEach { $0.resume() }
    }

    // MARK: Network rules

    private static var compiledRules: WKContentRuleList?
    static let blockRulesJSON = #"[{"trigger":{"url-filter":"^(https?|wss?|ftp|file):"},"action":{"type":"block"}}]"#

    static func blockRules() async -> WKContentRuleList? {
        if let compiledRules { return compiledRules }
        let list = try? await WKContentRuleListStore.default().compileContentRuleList(forIdentifier: "bb-look-no-network", encodedContentRuleList: blockRulesJSON)
        compiledRules = list
        return list
    }

    /// Forwards a scene driver's RPC to Studio on the selected server.
    static let studioRPC: @Sendable (String, Data) async throws -> Data = { method, body in
        let client = await MainActor.run { AppModel.shared.client }
        return try await client.rpcData("studio", method, body: body)
    }
}

extension LookWebView: WKNavigationDelegate {
    func webView(_ webView: WKWebView, decidePolicyFor action: WKNavigationAction) async -> WKNavigationActionPolicy {
        LookWebView.allows(action.request.url, mainFrame: action.targetFrame?.isMainFrame ?? false) ? .allow : .cancel
    }

    /// The page itself, and the presence sandbox's srcdoc frames. Nothing else.
    nonisolated static func allows(_ url: URL?, mainFrame: Bool) -> Bool {
        guard let url, let scheme = url.scheme?.lowercased() else { return false }
        if mainFrame { return scheme == Self.scheme && url.host == "look" }
        return scheme == "about" || (scheme == Self.scheme && url.host == "look")
    }
}

private final class WeakMessageHandler: NSObject, WKScriptMessageHandler {
    weak var owner: LookWebView?
    init(_ owner: LookWebView) { self.owner = owner }
    func userContentController(_ controller: WKUserContentController, didReceive message: WKScriptMessage) {
        let body = message.body
        MainActor.assumeIsolated { owner?.received(body) }
    }
}

/// Serves `look.js` and the two pages from the bundle, and forwards the scene
/// page's two allowed RPCs. Everything else is a 404.
final class LookSchemeHandler: NSObject, WKURLSchemeHandler {
    let page: LookPage
    let rpc: (@Sendable (String, Data) async throws -> Data)?
    private var live: Set<ObjectIdentifier> = []

    init(page: LookPage, rpc: (@Sendable (String, Data) async throws -> Data)?) {
        self.page = page
        self.rpc = rpc
    }

    static let files: [String: (name: String, ext: String, type: String)] = [
        "/look.js": ("look", "js", "text/javascript"),
        "/scene.html": ("scene", "html", "text/html"),
        "/presence.html": ("presence", "html", "text/html"),
    ]

    /// The RPC method a request path names, if the page may call it.
    static func rpcMethod(path: String, page: LookPage) -> String? {
        let prefix = "/api/v1/plugins/studio/rpc/"
        guard page == .scene, path.hasPrefix(prefix) else { return nil }
        let method = String(path.dropFirst(prefix.count))
        return LookWebView.sceneRPCs.contains(method) ? method : nil
    }

    func webView(_ webView: WKWebView, start task: any WKURLSchemeTask) {
        let id = ObjectIdentifier(task)
        live.insert(id)
        guard let url = task.request.url, url.host == "look" else { return finish(task, status: 404, data: Data(), type: "text/plain") }
        if let file = Self.files[url.path], let resource = Bundle.main.url(forResource: file.name, withExtension: file.ext),
           let data = try? Data(contentsOf: resource) {
            return finish(task, status: 200, data: data, type: file.type)
        }
        if let method = Self.rpcMethod(path: url.path, page: page), task.request.httpMethod == "POST", let rpc {
            let body = task.request.httpBody ?? Data("{}".utf8)
            Task { @MainActor in
                let data = (try? await rpc(method, body)) ?? Data(#"{"ok":false}"#.utf8)
                guard self.live.contains(id) else { return }
                self.finish(task, status: 200, data: data, type: "application/json")
            }
            return
        }
        finish(task, status: 404, data: Data(), type: "text/plain")
    }

    func webView(_ webView: WKWebView, stop task: any WKURLSchemeTask) {
        live.remove(ObjectIdentifier(task))
    }

    private func finish(_ task: any WKURLSchemeTask, status: Int, data: Data, type: String) {
        guard live.remove(ObjectIdentifier(task)) != nil, let url = task.request.url else { return }
        let response = HTTPURLResponse(url: url, statusCode: status, httpVersion: "HTTP/1.1",
                                       headerFields: ["Content-Type": type, "Content-Length": "\(data.count)", "Cache-Control": "no-store"])!
        task.didReceive(response)
        task.didReceive(data)
        task.didFinish()
    }
}
