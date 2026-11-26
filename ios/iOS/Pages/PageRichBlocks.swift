import SwiftUI
import WebKit

/// `> [!NOTE] …`: the desktop's callout, a tinted card with its tone's icon.
struct PageCallout: View {
    let tone: String
    let text: String

    private var style: (symbol: String, color: Color) {
        switch tone {
        case "success": ("lightbulb", .green)
        case "warning": ("exclamationmark.triangle", .orange)
        case "danger": ("exclamationmark.octagon", .red)
        default: ("info.circle", .blue)
        }
    }

    var body: some View {
        HStack(alignment: .firstTextBaseline, spacing: 10) {
            Image(systemName: style.symbol).foregroundStyle(style.color).accessibilityHidden(true)
            MarkdownText(text).frame(maxWidth: .infinity, alignment: .leading)
        }
        .padding(12)
        .background(style.color.opacity(0.1), in: .rect(cornerRadius: 10))
        .accessibilityElement(children: .combine)
        .accessibilityIdentifier("pageCallout-\(tone)")
    }
}

/// `<details>`: a toggle, closed as on the desktop; a toggle heading reads as a heading.
struct PageToggle: View {
    let summary: String
    let level: Int?
    let body_: String
    @State private var open = false

    init(summary: String, level: Int?, body: String) {
        self.summary = summary
        self.level = level
        body_ = body
    }

    var body: some View {
        DisclosureGroup(isExpanded: $open) {
            PageMarkdown(source: body_).padding(.top, 8)
        } label: {
            Text(MarkdownText.inline(summary))
                .font(level == 1 ? .title3.bold() : level == 2 ? .headline : level != nil ? .subheadline.bold() : .body)
        }
        // A heading, not a link: the desktop draws it in the text's colour.
        .tint(.primary)
        .accessibilityIdentifier("pageToggle")
    }
}

/// ```` ```html ````: the page's HTML, as the desktop's sandboxed frame shows it.
struct PageHTMLBlock: View {
    let html: String

    var body: some View {
        PageWebBlock(html: html).accessibilityIdentifier("pageHTML")
    }
}

/// ```` ```mermaid ````: the diagram, drawn by Studio's own Mermaid build.
struct PageMermaidBlock: View {
    let source: String
    @EnvironmentObject private var app: AppModel
    @Environment(\.colorScheme) private var colorScheme
    @State private var script: String?
    @State private var failed = false

    var body: some View {
        Group {
            if let script {
                PageWebBlock(html: Self.page(source: source, script: script, dark: colorScheme == .dark))
            } else if failed {
                CodeBlock(language: "mermaid", code: source)
            } else {
                ProgressView().frame(maxWidth: .infinity, minHeight: 80)
            }
        }
        .accessibilityIdentifier("pageMermaid")
        .task(id: app.serverURL) {
            script = await MermaidScript.shared.load(app.client)
            failed = script == nil
        }
    }

    static func page(source: String, script: String, dark: Bool) -> String {
        let encoded = (try? String(data: JSONEncoder().encode(source), encoding: .utf8)) ?? "\"\""
        return """
            <!doctype html><html><head><meta name="viewport" content="width=device-width, initial-scale=1">
            <style>body{margin:0;background:transparent;font:15px -apple-system,sans-serif}#d svg{max-width:100%;height:auto}</style>
            <script>\(script)</script></head><body><div id="d"></div><script>
            mermaid.initialize({ startOnLoad: false, securityLevel: "strict", theme: "\(dark ? "dark" : "default")" });
            mermaid.render("m", \(encoded)).then(r => { document.getElementById("d").innerHTML = r.svg; })
              .catch(e => { document.getElementById("d").textContent = "Diagram error: " + e.message; });
            </script></body></html>
            """
    }
}

/// Studio's Mermaid build (`/pages/mermaid.js`), read once with the app's credentials and kept.
@MainActor
final class MermaidScript {
    static let shared = MermaidScript()
    private var script: String?

    func load(_ client: BBClient) async -> String? {
        if let script { return script }
        guard let (status, data) = try? await client.raw(method: "GET", path: "/api/v1/plugins/studio/http/pages/mermaid.js", body: nil),
              (200..<300).contains(status), let text = String(data: data, encoding: .utf8) else { return nil }
        // Inlined in a <script>: a closing tag in the bundle would end it early.
        script = text.replacingOccurrences(of: "</script", with: "<\\/script")
        return script
    }
}

/// HTML in a page, sized to its content (80–2400 pt like the desktop's
/// frame). It scrolls with the page, keeps nothing between pages, and opens
/// links outside, in Safari.
struct PageWebBlock: View {
    let html: String
    @State private var height: CGFloat = 80

    var body: some View {
        PageWebFrame(html: html, height: $height)
            .frame(height: height)
            .clipShape(.rect(cornerRadius: 10))
    }
}

private struct PageWebFrame: UIViewRepresentable {
    let html: String
    @Binding var height: CGFloat

    static let sizeScript = """
        (function () {
          var post = function () {
            var h = Math.max(document.documentElement.scrollHeight, document.body ? document.body.scrollHeight : 0);
            window.webkit.messageHandlers.height.postMessage(h);
          };
          new ResizeObserver(post).observe(document.documentElement);
          window.addEventListener("load", post);
          post();
        })();
        """

    func makeUIView(context: Context) -> WKWebView {
        let configuration = WKWebViewConfiguration()
        configuration.websiteDataStore = .nonPersistent()
        configuration.userContentController.add(context.coordinator, name: "height")
        configuration.userContentController.addUserScript(
            WKUserScript(source: Self.sizeScript, injectionTime: .atDocumentEnd, forMainFrameOnly: true))
        let view = WKWebView(frame: .zero, configuration: configuration)
        view.isOpaque = false
        view.backgroundColor = .clear
        view.scrollView.isScrollEnabled = false
        view.navigationDelegate = context.coordinator
        context.coordinator.loaded = html
        view.loadHTMLString(html, baseURL: nil)
        return view
    }

    func updateUIView(_ view: WKWebView, context: Context) {
        context.coordinator.height = $height
        guard context.coordinator.loaded != html else { return }
        context.coordinator.loaded = html
        view.loadHTMLString(html, baseURL: nil)
    }

    static func dismantleUIView(_ view: WKWebView, coordinator: Coordinator) {
        view.configuration.userContentController.removeScriptMessageHandler(forName: "height")
    }

    func makeCoordinator() -> Coordinator { Coordinator(height: $height) }

    final class Coordinator: NSObject, WKScriptMessageHandler, WKNavigationDelegate {
        var height: Binding<CGFloat>
        var loaded: String?

        init(height: Binding<CGFloat>) { self.height = height }

        func userContentController(_ controller: WKUserContentController, didReceive message: WKScriptMessage) {
            guard let value = message.body as? Double else { return }
            let clamped = min(2400, max(80, CGFloat(value)))
            if abs(height.wrappedValue - clamped) > 1 { height.wrappedValue = clamped }
        }

        /// The block's own document loads; any link it follows opens in Safari instead.
        func webView(_ webView: WKWebView, decidePolicyFor action: WKNavigationAction) async -> WKNavigationActionPolicy {
            guard action.navigationType == .linkActivated, let url = action.request.url else { return .allow }
            if ["http", "https", "mailto"].contains(url.scheme?.lowercased() ?? "") { await UIApplication.shared.open(url) }
            return .cancel
        }
    }
}
