import Foundation

#if DEBUG
/// `-qaDesignDemo`: one design offline (`dsn_demo`, a phone screen and a
/// desktop one), its screens' pages served from here, for the zoom and
/// comment tests. Its pages say `user-scalable=no`, as designs written for a
/// desktop often do, and carry a small stand-in for Studio's screen script
/// (comment picks), so comment mode works offline. Comments live in memory.
enum DesignDemo {
    static let id = "dsn_demo"
    static var on: Bool { ProcessInfo.processInfo.arguments.contains("-qaDesignDemo") }

    private static let lock = NSLock()
    nonisolated(unsafe) private static var comments: [[String: Any]] = [
        ["id": "dc_1", "screenId": "1a", "step": "", "selector": "h1", "elementText": "Phone home", "body": "Bigger title",
         "createdAt": 1, "sent": false],
    ]
    nonisolated(unsafe) private static var resolved: [[String: Any]] = []

    static func design() -> [String: Any] {
        let screens: [[String: Any]] = [
            ["id": "1a", "round": 1, "option": "a", "title": "Phone", "caption": "The phone's home", "viewport": "mobile", "updatedAt": 1],
            ["id": "1b", "round": 1, "option": "b", "title": "Desktop", "caption": "The desktop's home", "viewport": "desktop", "updatedAt": 1],
        ]
        return lock.withLock {
            ["id": id, "name": "Zoom check", "projectId": "proj_personal", "threadId": "thr_botdemo01", "updatedAt": 1,
             "rounds": [["round": 1, "title": "Home", "intro": "Two sizes", "screens": screens]],
             "comments": comments, "resolvedComments": resolved]
        }
    }

    /// The `designs.*` RPCs the viewer calls, answered from memory; nil for the rest.
    static func rpc(_ method: String, _ input: [String: Any]) -> Any? {
        lock.withLock {
            switch method {
            case "designs.addComment":
                let comment: [String: Any] = [
                    "id": "dc_\(comments.count + resolved.count + 1)", "screenId": input["screenId"] ?? "", "step": input["step"] ?? "",
                    "selector": input["selector"] ?? "", "elementText": input["elementText"] ?? "", "body": input["body"] ?? "",
                    "createdAt": Double(comments.count + resolved.count + 1), "sent": input["send"] as? Bool ?? false,
                ]
                comments.append(comment)
                return ["id": comment["id"]!, "sent": comment["sent"]!]
            case "designs.resolveComment":
                let id = input["id"] as? String
                if input["resolved"] as? Bool == false, let index = resolved.firstIndex(where: { $0["id"] as? String == id }) {
                    comments.append(resolved.remove(at: index))
                } else if let index = comments.firstIndex(where: { $0["id"] as? String == id }) {
                    var comment = comments.remove(at: index)
                    comment["resolvedAt"] = 2.0
                    resolved.append(comment)
                }
                return ["ok": true]
            case "designs.deleteComment":
                comments.removeAll { $0["id"] as? String == input["id"] as? String }
                resolved.removeAll { $0["id"] as? String == input["id"] as? String }
                return ["ok": true]
            case "designs.sendComment":
                if let index = comments.firstIndex(where: { $0["id"] as? String == input["id"] as? String }) { comments[index]["sent"] = true }
                return ["ok": true]
            default:
                return nil
            }
        }
    }

    static func html(for url: URL) -> String? {
        guard on, url.path.contains("/designs/") else { return nil }
        let desktop = url.query?.contains("screen=1b") == true || url.path.contains("1b")
        let cards = (1...12).map { "<div class=\"card\" id=\"card\($0)\"><b>Card \($0)</b><p>Small print to read when zoomed in.</p></div>" }.joined()
        return """
            <!doctype html><html><head><meta charset="utf-8">
            <meta name="viewport" content="width=device-width, initial-scale=1, user-scalable=no">
            <style>
            body { margin: 0; font: 15px -apple-system, sans-serif; background: #12151b; color: #f2f4f8; }
            h1 { font-size: 34px; margin: 24px; }
            .grid { display: grid; grid-template-columns: repeat(\(desktop ? 4 : 2), 1fr); gap: 12px; padding: 0 24px 24px; }
            .card { background: #232833; border-radius: 14px; padding: 14px; }
            .card p { font-size: 11px; color: #aab1bf; margin: 6px 0 0; }
            </style></head>
            <body style="width: \(desktop ? 1280 : 390)px"><h1>\(desktop ? "Desktop home" : "Phone home")</h1><div class="grid">\(cards)</div>
            <script>\(screenScript)</script></body></html>
            """
    }

    /// Studio's screen script, as far as the tests need it: the mode, and a pick on a tap in comment mode.
    private static let screenScript = """
        (function () {
          var commenting = false;
          var post = function (m) { window.parent.postMessage(Object.assign({ bbDesign: true }, m), "*"); };
          document.addEventListener("click", function (e) {
            if (!commenting || !(e.target instanceof Element) || e.target.closest("[data-bb-design-ui]")) return;
            e.preventDefault(); e.stopPropagation();
            var el = e.target.closest("[id]") || e.target;
            var r = el.getBoundingClientRect();
            post({ type: "pick", selector: el.id ? "#" + el.id : el.tagName.toLowerCase(), html: el.outerHTML.slice(0, 400),
                   text: (el.innerText || "").trim().slice(0, 300), rect: { x: r.left, y: r.top, width: r.width, height: r.height } });
          }, true);
          window.addEventListener("message", function (e) {
            if (e.source !== window.parent || !e.data || !e.data.bbDesign) return;
            if (e.data.type === "mode") commenting = Boolean(e.data.on);
          });
        })();
        """
}
#endif
