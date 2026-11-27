import SwiftUI
import WebKit

/// What a live screen is for: playing the prototype, picking an element to
/// comment on, or typing over its text. The same modes as the desktop canvas.
enum DesignMode: String, CaseIterable, Identifiable {
    case view, play, comment, edit
    var id: Self { self }

    var title: String {
        switch self {
        case .view: "View"
        case .play: "Play"
        case .comment: "Comment"
        case .edit: "Edit text"
        }
    }
}

/// A pin on the live screen: a comment's number at its element.
struct DesignPin: Equatable, Encodable {
    var id: String
    var n: Int
    var selector: String
    var sent: Bool
    var active: Bool
}

/// What the screen says back.
enum DesignFrameEvent: Equatable {
    case pick(DesignPick)
    case pin(String)
    /// Text typed over an element, as inner HTML before and after.
    case text(before: String, after: String)
    case notEditable
}

/// A design screen's live page, laid out at the screen's own width and
/// zoomed by WebKit (pinch to 6×, drag to pan). Studio adds its screen script
/// to every screen; this talks to it as the desktop canvas does, over
/// `postMessage`: the mode (comment, edit), and back the picked element and
/// the edited text. Pins are drawn inside the page, so they zoom and scroll
/// with it.
struct DesignLiveFrame: UIViewRepresentable {
    let url: URL
    let pageWidth: Double
    var mode: DesignMode
    var pins: [DesignPin]
    var event: (DesignFrameEvent) -> Void

    func makeUIView(context: Context) -> WKWebView {
        let configuration = UntrustedWeb.configuration()
        configuration.allowsInlineMediaPlayback = true
        configuration.ignoresViewportScaleLimits = true
        let scripts = configuration.userContentController
        scripts.addUserScript(Self.viewport(width: pageWidth))
        // The bridge and its handler live in the app's own script world: the screen's
        // scripts share the page's DOM but can't call `bbDesign` or `bbNative`.
        scripts.addUserScript(WKUserScript(source: Self.bridge, injectionTime: .atDocumentEnd, forMainFrameOnly: true, in: .defaultClient))
        scripts.add(context.coordinator, contentWorld: .defaultClient, name: "bbDesign")
        let view = WKWebView(frame: .zero, configuration: configuration)
        view.scrollView.contentInsetAdjustmentBehavior = .never
        view.isOpaque = false
        view.navigationDelegate = context.coordinator
        view.uiDelegate = context.coordinator
        view.accessibilityIdentifier = "designPlayerPage"
        context.coordinator.view = view
        context.coordinator.parent = self
        context.coordinator.loader.load(url, in: view)
        return view
    }

    func updateUIView(_ view: WKWebView, context: Context) {
        let coordinator = context.coordinator
        let previous = coordinator.parent
        coordinator.parent = self
        if coordinator.loader.loaded != url {
            coordinator.loader.load(url, in: view)
        } else if previous?.mode != mode || previous?.pins != pins {
            coordinator.apply()
        }
    }

    static func dismantleUIView(_ view: WKWebView, coordinator: Coordinator) {
        view.configuration.userContentController.removeScriptMessageHandler(forName: "bbDesign", contentWorld: .defaultClient)
    }

    func makeCoordinator() -> Coordinator { Coordinator() }

    final class Coordinator: NSObject, WKScriptMessageHandler, WKNavigationDelegate, WKUIDelegate {
        let loader = DesignPageLoader()
        weak var view: WKWebView?
        var parent: DesignLiveFrame?

        func webView(_ webView: WKWebView, didFinish navigation: WKNavigation!) { apply() }

        /// The screen's own page only (`UntrustedWeb`); a tapped link leaves for Safari.
        func webView(_ webView: WKWebView, decidePolicyFor action: WKNavigationAction) async -> WKNavigationActionPolicy {
            await UntrustedWeb.policy(for: action, allowed: loader.allowed)
        }

        func webView(_ webView: WKWebView, createWebViewWith configuration: WKWebViewConfiguration,
                     for action: WKNavigationAction, windowFeatures: WKWindowFeatures) -> WKWebView? {
            MainActor.assumeIsolated { UntrustedWeb.newWindow(for: action) }
            return nil
        }

        /// Tells the page the mode and the pins.
        func apply() {
            guard let view, let parent else { return }
            let pins = (try? String(data: JSONEncoder().encode(parent.pins), encoding: .utf8)) ?? "[]"
            let comment = parent.mode == .comment, edit = parent.mode == .edit
            view.evaluateJavaScript("window.bbNative && bbNative.mode(\(comment), \(edit)); window.bbNative && bbNative.pins(\(pins));",
                                    in: nil, in: .defaultClient, completionHandler: nil)
        }

        func userContentController(_ controller: WKUserContentController, didReceive message: WKScriptMessage) {
            guard let text = message.body as? String, let data = text.data(using: .utf8),
                  let json = try? JSONSerialization.jsonObject(with: data) as? [String: Any],
                  let event = DesignLiveFrame.event(json), let parent,
                  DesignLiveFrame.accepts(event, in: parent.mode) else { return }
            parent.event(event)
        }
    }

    /// Whether the page may say this in this mode. The page is untrusted and can post
    /// what the screen script posts: a pick counts only while commenting, typed text
    /// only while editing text, a pin's tap only where pins show.
    static func accepts(_ event: DesignFrameEvent, in mode: DesignMode) -> Bool {
        switch event {
        case .pick: mode == .comment
        case .pin: mode == .comment || mode == .play
        case .text, .notEditable: mode == .edit
        }
    }

    /// The screen script's messages (and the pins' taps) as events; nil for the rest.
    static func event(_ json: [String: Any]) -> DesignFrameEvent? {
        switch json["type"] as? String {
        case "pick":
            guard let selector = json["selector"] as? String else { return nil }
            let rect = json["rect"] as? [String: Double] ?? [:]
            return .pick(DesignPick(selector: selector, html: json["html"] as? String ?? "", text: json["text"] as? String ?? "",
                                    rect: CGRect(x: rect["x"] ?? 0, y: rect["y"] ?? 0, width: rect["width"] ?? 0, height: rect["height"] ?? 0)))
        case "pin":
            return (json["id"] as? String).map(DesignFrameEvent.pin)
        case "text":
            guard let before = json["before"] as? String, let after = json["text"] as? String else { return nil }
            return .text(before: before, after: after)
        case "not-editable":
            return .notEditable
        default:
            return nil
        }
    }

    /// Relays the screen script's posts to the app, sets its mode, and draws the pins.
    /// Studio's script posts to `window.parent`, which for a top-level page is the page itself.
    static let bridge = """
        (function () {
          var native = window.webkit.messageHandlers.bbDesign;
          var MARK = "data-bb-design-ui", layer = null, pins = [];
          window.addEventListener("message", function (event) {
            var data = event.data;
            if (event.source !== window || !data || !data.bbDesign || data.type === "mode" || data.type === "locate") return;
            native.postMessage(JSON.stringify(data));
          });
          function draw() {
            if (!document.body) return;
            if (!layer) {
              layer = document.createElement("div");
              layer.setAttribute(MARK, "");
              layer.style.cssText = "position:absolute;left:0;top:0;width:0;height:0;z-index:2147483646";
              document.documentElement.appendChild(layer);
            }
            layer.textContent = "";
            pins.forEach(function (pin) {
              var element = null;
              try { element = document.querySelector(pin.selector); } catch (error) {}
              if (!element) return;
              var rect = element.getBoundingClientRect();
              var button = document.createElement("button");
              button.setAttribute(MARK, "");
              button.setAttribute("aria-label", "Comment " + pin.n);
              button.textContent = pin.n;
              button.style.cssText = "position:absolute;width:26px;height:26px;padding:0;border-radius:13px 13px 13px 3px;" +
                "border:2px solid #4f7cff;font:600 12px -apple-system,sans-serif;box-shadow:0 1px 4px rgba(0,0,0,.3);" +
                "left:" + (rect.right + window.scrollX - 13) + "px;top:" + (rect.top + window.scrollY - 13) + "px;" +
                "color:" + (pin.active ? "#000" : pin.sent ? "#4f7cff" : "#fff") + ";" +
                "background:" + (pin.active ? "#ffd60a" : pin.sent ? "#fff" : "#4f7cff") + ";" +
                (pin.active ? "transform:scale(1.3);" : "");
              button.addEventListener("click", function (event) {
                event.preventDefault();
                event.stopPropagation();
                native.postMessage(JSON.stringify({ type: "pin", id: pin.id }));
              });
              layer.appendChild(button);
            });
          }
          window.bbNative = {
            mode: function (comment, edit) { window.postMessage({ bbDesign: true, type: "mode", on: comment, edit: edit }, "*"); },
            pins: function (list) { pins = list; draw(); }
          };
          new ResizeObserver(draw).observe(document.documentElement);
        })();
        """

    /// The page's viewport at the screen's width before its first layout, and kept there if the page changes it.
    static func viewport(width: Double) -> WKUserScript {
        WKUserScript(source: """
            (function () {
              var content = 'width=\(Int(width)), maximum-scale=6, user-scalable=yes';
              function apply() {
                var metas = document.querySelectorAll('meta[name=viewport]');
                if (!metas.length) {
                  var meta = document.createElement('meta'); meta.name = 'viewport';
                  (document.head || document.documentElement).appendChild(meta); metas = [meta];
                }
                metas.forEach(function (meta) { if (meta.content !== content) meta.content = content; });
              }
              apply();
              // Only the head, where the viewport is: not every change in the prototype.
              var watch = function () {
                if (document.head) new MutationObserver(apply).observe(document.head, { childList: true, subtree: true, attributes: true, attributeFilter: ['content'] });
              };
              if (document.head) watch(); else document.addEventListener('DOMContentLoaded', function () { apply(); watch(); });
            })();
            """, injectionTime: .atDocumentStart, forMainFrameOnly: true)
    }
}
