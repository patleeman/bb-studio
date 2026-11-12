import SwiftUI
import WebKit

/// What the board shows: the committed page, the page being written, and how to paint it.
struct VisualChatBoardState: Equatable {
    var html: String?
    var stream: String?
    var streamN: Int
    var rev: Int
    var look: String
    var mode: String
    var theme: JSONValue

    var json: JSONValue {
        [
            "html": .from(html), "stream": .from(stream), "streamN": .from(streamN), "rev": .from(rev),
            "look": .string(look), "mode": .string(mode), "theme": theme,
        ]
    }
}

/// The board: a web view whose top document is the app's own (a small host
/// page and the plugin's renderer script, kept by version). The agent's page
/// lives inside it in the same sandboxed frame (`allow-scripts`, an opaque
/// origin) as on the desktop, and embeds are frames beside it, placed by the
/// renderer. The top document never navigates; its only way out is the
/// bridge's few message types (VisualChatBridgeMessage).
@MainActor
final class VisualChatBoardHost: NSObject, WKNavigationDelegate, WKUIDelegate {
    /// The top document's origin. It's never fetched (.invalid can't resolve);
    /// embeds see it as their referrer, which YouTube needs.
    nonisolated static let origin = URL(string: "https://visual-chat.invalid/")!

    let renderer: VisualChatRenderer
    var onOpen: ((URL) -> Void)?
    var onWebpage: ((String) async -> JSONValue?)?
    var onRendered: ((_ rev: Int, _ streamN: Int, _ streaming: Bool) -> Void)?
    var onFailure: ((String) -> Void)?

    private weak var view: WKWebView?
    private var hostLoaded = false
    private var ready = false
    private var state: VisualChatBoardState?
    private var posted: VisualChatBoardState?
    private var crashes: [Date] = []

    init(renderer: VisualChatRenderer) {
        self.renderer = renderer
    }

    static let hostDocument = """
        <!doctype html><html><head><meta charset="utf-8">
        <meta name="viewport" content="width=device-width,initial-scale=1,maximum-scale=1,viewport-fit=cover">
        <meta http-equiv="Content-Security-Policy" content="default-src 'none'; script-src 'unsafe-inline'; style-src 'unsafe-inline'; img-src data: blob: https:; font-src data:; media-src data: blob: https:; connect-src 'none'; frame-src https:; form-action 'none'; base-uri 'none'">
        <meta name="referrer" content="strict-origin-when-cross-origin">
        <style id="vc-tokens"></style>
        <style>html,body{margin:0;padding:0;height:100%;overflow:hidden;background:var(--background,transparent);-webkit-text-size-adjust:100%;-webkit-user-select:none}#board{position:fixed;inset:0}</style>
        </head><body><div id="board"></div></body></html>
        """

    /// Mounts the renderer and relays the board's few messages to the app. It runs in the top document only.
    static let glue = """
        (function () {
          var R = globalThis.BBCanvasRenderer;
          var native = function (m) { try { webkit.messageHandlers.\(VisualChatBridgeMessage.handlerName).postMessage(JSON.stringify(m)); } catch (e) {} };
          if (!R || !R.mountBoard) return;
          var tokens = document.getElementById("vc-tokens");
          var seq = 0, waiting = {};
          var board = R.mountBoard(document.getElementById("board"), {
            title: "Visual Chat",
            services: {
              webpage: function (url) {
                return new Promise(function (resolve, reject) { var id = ++seq; waiting[id] = { resolve: resolve, reject: reject }; native({ type: "webpage", id: id, url: url }); });
              },
              openUrl: function (url) { native({ type: "open", url: url }); }
            },
            onRendered: function (s) { native({ type: "rendered", rev: s.rev, streamN: s.streamN, streaming: s.streaming, embeds: s.embeds }); }
          });
          window.__vc = {
            update: function (s) {
              var theme = R.themeFrom(s.mode, s.theme);
              tokens.textContent = R.hostTokenCss(theme);
              document.documentElement.style.colorScheme = theme.mode;
              board.update({ html: s.html, stream: s.stream, streamN: s.streamN, rev: s.rev, look: s.look, theme: theme });
            },
            answer: function (id, answer) {
              var w = waiting[id];
              if (!w) return;
              delete waiting[id];
              if (answer) w.resolve(answer); else w.reject(new Error("unchecked"));
            }
          };
          native({ type: "ready", protocol: R.protocol });
        })();
        """

    func makeWebView() -> WKWebView {
        if let view { return view }
        let configuration = WKWebViewConfiguration()
        // Nothing the board or its embeds store outlives the screen.
        configuration.websiteDataStore = .nonPersistent()
        // YouTube plays in place (and fullscreen or picture in picture on request); nothing plays by itself.
        configuration.allowsInlineMediaPlayback = true
        configuration.allowsPictureInPictureMediaPlayback = true
        configuration.allowsAirPlayForMediaPlayback = true
        configuration.mediaTypesRequiringUserActionForPlayback = .all
        configuration.preferences.isElementFullscreenEnabled = true
        configuration.preferences.javaScriptCanOpenWindowsAutomatically = false
        let controller = configuration.userContentController
        controller.addUserScript(WKUserScript(source: renderer.js + "\n;\n" + Self.glue, injectionTime: .atDocumentEnd, forMainFrameOnly: true, in: .page))
        controller.add(WeakMessageHandler(self), contentWorld: .page, name: VisualChatBridgeMessage.handlerName)
        let view = WKWebView(frame: .zero, configuration: configuration)
        view.isOpaque = false
        view.backgroundColor = .clear
        view.scrollView.backgroundColor = .clear
        // The page scrolls inside its frame; the host page is the screen.
        view.scrollView.isScrollEnabled = false
        view.scrollView.contentInsetAdjustmentBehavior = .never
        view.scrollView.bounces = false
        view.allowsLinkPreview = false
        view.navigationDelegate = self
        view.uiDelegate = self
        self.view = view
        load()
        return view
    }

    private func load() {
        hostLoaded = false
        ready = false
        posted = nil
        view?.loadHTMLString(Self.hostDocument, baseURL: Self.origin)
    }

    func update(_ next: VisualChatBoardState) {
        state = next
        post()
    }

    private func post() {
        guard ready, let state, state != posted, let view else { return }
        posted = state
        guard let data = try? JSONEncoder().encode(state.json), let json = String(data: data, encoding: .utf8) else { return }
        view.evaluateJavaScript("window.__vc && window.__vc.update(\(json)); void 0", in: nil, in: .page)
    }

    func close() {
        guard let view else { return }
        view.configuration.userContentController.removeAllScriptMessageHandlers()
        view.navigationDelegate = nil
        view.uiDelegate = nil
        view.stopLoading()
        self.view = nil
    }

    // MARK: Messages from the host page

    fileprivate func receive(_ message: WKScriptMessage) {
        // Only the top document speaks for the board: the agent's frame and embeds are other frames.
        let origin = message.frameInfo.securityOrigin
        guard message.name == VisualChatBridgeMessage.handlerName, message.frameInfo.isMainFrame,
              origin.protocol == "https", origin.host == Self.origin.host,
              let parsed = VisualChatBridgeMessage.parse(message.body)
        else { return }
        switch parsed {
        case .ready(let version):
            guard version == VisualChatPlugin.rendererProtocol else {
                onFailure?("This board needs a newer app.")
                return
            }
            ready = true
            post()
        case .open(let url):
            onOpen?(url)
        case .webpage(let id, let url):
            Task { [weak self] in
                let answer = await self?.onWebpage?(url) ?? nil
                self?.answer(id, answer)
            }
        case .rendered(let rev, let streamN, let streaming, _):
            onRendered?(rev, streamN, streaming)
        }
    }

    private func answer(_ id: Int, _ answer: JSONValue?) {
        let json = answer.flatMap { try? JSONEncoder().encode($0) }.flatMap { String(data: $0, encoding: .utf8) } ?? "null"
        view?.evaluateJavaScript("window.__vc && window.__vc.answer(\(id), \(json)); void 0", in: nil, in: .page)
    }

    // MARK: Navigation

    /// The top document loads once, from the app; after that it never
    /// navigates. Frames inside it load only the agent's page (srcdoc) and
    /// https embeds the renderer built.
    func webView(_ webView: WKWebView, decidePolicyFor action: WKNavigationAction,
                 decisionHandler: @escaping (WKNavigationActionPolicy) -> Void) {
        decisionHandler(Self.allows(action.request.url, mainFrame: action.targetFrame?.isMainFrame ?? true, hostLoaded: &hostLoaded) ? .allow : .cancel)
    }

    nonisolated static func allows(_ url: URL?, mainFrame: Bool, hostLoaded: inout Bool) -> Bool {
        guard let url else { return false }
        if mainFrame {
            guard !hostLoaded, url == origin else { return false }
            hostLoaded = true
            return true
        }
        switch url.scheme?.lowercased() {
        case "about": return url.absoluteString == "about:srcdoc" || url.absoluteString == "about:blank"
        case "https": return true
        default: return false
        }
    }

    /// A popup from an embed ("View larger map"): never a window; an https link opens in Safari's view.
    func webView(_ webView: WKWebView, createWebViewWith configuration: WKWebViewConfiguration,
                 for action: WKNavigationAction, windowFeatures: WKWindowFeatures) -> WKWebView? {
        if action.navigationType == .linkActivated, let url = VisualChatBridgeMessage.httpsURL(action.request.url?.absoluteString) { onOpen?(url) }
        return nil
    }

    func webViewWebContentProcessDidTerminate(_ webView: WKWebView) {
        let (reload, recent) = MiniRelay.reloadAfterCrash(crashes, now: Date())
        crashes = recent
        guard reload else {
            onFailure?("The board stopped responding. Open it again to retry.")
            return
        }
        load()
    }
}

/// The content controller keeps its handlers; this keeps the host from being kept by it.
private final class WeakMessageHandler: NSObject, WKScriptMessageHandler {
    weak var host: VisualChatBoardHost?
    init(_ host: VisualChatBoardHost) { self.host = host }

    func userContentController(_ controller: WKUserContentController, didReceive message: WKScriptMessage) {
        MainActor.assumeIsolated { host?.receive(message) }
    }
}

struct VisualChatBoardView: UIViewRepresentable {
    let host: VisualChatBoardHost
    let state: VisualChatBoardState

    func makeUIView(context: Context) -> WKWebView {
        let view = host.makeWebView()
        host.update(state)
        return view
    }

    func updateUIView(_ view: WKWebView, context: Context) {
        host.update(state)
    }

    static func dismantleUIView(_ view: WKWebView, coordinator: ()) {
        MainActor.assumeIsolated { (view.navigationDelegate as? VisualChatBoardHost)?.close() }
    }
}
