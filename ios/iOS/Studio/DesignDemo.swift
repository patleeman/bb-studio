import Foundation

#if DEBUG
/// `-qaDesignDemo`: one design offline (`dsn_demo`, a phone screen and a
/// desktop one), its screens' pages served from here, for the zoom tests. Its
/// pages say `user-scalable=no`, as designs written for a desktop often do.
enum DesignDemo {
    static let id = "dsn_demo"
    static var on: Bool { ProcessInfo.processInfo.arguments.contains("-qaDesignDemo") }

    static func design() -> [String: Any] {
        let screens: [[String: Any]] = [
            ["id": "1a", "round": 1, "option": "a", "title": "Phone", "caption": "The phone's home", "viewport": "mobile", "updatedAt": 1],
            ["id": "1b", "round": 1, "option": "b", "title": "Desktop", "caption": "The desktop's home", "viewport": "desktop", "updatedAt": 1],
        ]
        return ["id": id, "name": "Zoom check", "projectId": "proj_personal", "threadId": NSNull(), "updatedAt": 1,
                "rounds": [["round": 1, "title": "Home", "intro": "Two sizes", "screens": screens]], "comments": [Any]()]
    }

    static func html(for url: URL) -> String? {
        guard on, url.path.contains("/designs/") else { return nil }
        let desktop = url.query?.contains("screen=1b") == true || url.path.contains("1b")
        let cards = (1...12).map { "<div class=\"card\"><b>Card \($0)</b><p>Small print to read when zoomed in.</p></div>" }.joined()
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
            <body style="width: \(desktop ? 1280 : 390)px"><h1>\(desktop ? "Desktop home" : "Phone home")</h1><div class="grid">\(cards)</div></body></html>
            """
    }
}
#endif
