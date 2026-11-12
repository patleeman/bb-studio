#if DEBUG
import Foundation

/// Debug builds: `-qaDashboardDemo` with `-openURL bbstudio://dashboard/qa-demo`
/// shows a local dashboard with every built-in widget type and each tile state
/// (fresh, waiting for push data, failed, needs approval), for screenshots
/// without a server. `qa-empty` is a dashboard with no widgets.
/// `-qaDashboardWidgets w_a,w_b` keeps only those widgets, to frame one part.
enum DashboardDemo {
    static var enabled: Bool { ProcessInfo.processInfo.arguments.contains("-qaDashboardDemo") }

    static func dashboard(_ id: String) -> Dashboard? {
        guard enabled else { return nil }
        switch id {
        case "qa-demo": return parse(full)
        case "qa-empty": return parse(#"{"id":"qa-empty","name":"Launch week","widgets":[],"layouts":{},"data":[]}"#)
        default: return nil
        }
    }

    private static func parse(_ json: String) -> Dashboard? {
        (try? OrderedJSON.parse(Data(json.utf8))).flatMap(Dashboard.init)
    }

    private static var only: [String] {
        (UserDefaults.standard.string(forKey: "qaDashboardWidgets") ?? "").split(separator: ",").map(String.init)
    }

    private static var full: String {
        let now = Date().timeIntervalSince1970 * 1000
        let minute = 60_000.0
        let today = ISO8601DateFormatter().string(from: Date().addingTimeInterval(-3 * 3600))
        let launch = ISO8601DateFormatter().string(from: Date().addingTimeInterval(3 * 86_400 + 4 * 3600 + 12 * 60))
        // (id, type, title, options, source, data value, status, fetchedAt, error)
        let widgets: [(String, String, String, String, String, String, String, Double?, String?)] = [
            ("w_mrr", "stat", "", #"{"label":"Monthly revenue","prefix":"$"}"#, "url",
             #"{"value":48210,"delta":"+6.4%","series":[39100,40250,41800,43020,44900,45300,48210],"caption":"vs. last month"}"#, "ok", now - 2 * minute, nil),
            ("w_churn", "stat", "", #"{"label":"Churn","unit":"%","invert":true}"#, "url",
             #"{"value":1.8,"delta":"-0.3 pts","trend":"down","series":[2.6,2.4,2.3,2.1,2.1,1.9,1.8]}"#, "ok", now - 2 * minute, nil),
            ("w_ticker", "ticker", "Markets", "{}", "url",
             #"[{"label":"AAPL","value":"231.40","delta":"+1.2%"},{"label":"MSFT","value":"428.15","delta":"-0.4%"},{"label":"NVDA","value":"131.02","delta":"+2.8%"},{"label":"BTC","value":"62,410","delta":"-1.1%"}]"#, "ok", now - 30_000, nil),
            ("w_signups", "line", "Signups this week", "{}", "push",
             #"[{"day":"Mon","web":120,"ios":64},{"day":"Tue","web":134,"ios":71},{"day":"Wed","web":128,"ios":90},{"day":"Thu","web":152,"ios":96},{"day":"Fri","web":171,"ios":104},{"day":"Sat","web":118,"ios":122},{"day":"Sun","web":109,"ios":131}]"#, "ok", now - 12 * minute, nil),
            ("w_builds", "bar", "Builds by status", "{}", "script",
             #"[{"team":"App","passed":42,"failed":3},{"team":"Server","passed":57,"failed":6},{"team":"Plugins","passed":31,"failed":1},{"team":"Docs","passed":12,"failed":0}]"#, "ok", now - 5 * minute, nil),
            ("w_traffic", "area", "Traffic", #"{"stacked":true,"unit":"k"}"#, "url",
             #"[{"hour":"09","search":12,"direct":8},{"hour":"10","search":15,"direct":9},{"hour":"11","search":19,"direct":11},{"hour":"12","search":17,"direct":13},{"hour":"13","search":21,"direct":12},{"hour":"14","search":24,"direct":14}]"#, "ok", now - 3 * minute, nil),
            ("w_plans", "pie", "Plans", "{}", "static",
             #"[{"plan":"Free","users":5400},{"plan":"Pro","users":2100},{"plan":"Team","users":860},{"plan":"Enterprise","users":140}]"#, "static", nil, nil),
            ("w_goal", "progress", "Q4 goal", #"{"unit":" users","label":"Paying users"}"#, "push",
             #"{"value":3100,"max":4000}"#, "ok", now - 45 * minute, nil),
            ("w_uptime", "progress", "Uptime", #"{"style":"gauge","unit":"%","label":"Last 30 days"}"#, "url",
             #"99.2"#, "ok", now - minute, nil),
            ("w_deploys", "table", "Recent deploys", "{}", "script",
             #"[{"service":"api","version":"2.14.0","status":"live","duration":"3m 12s"},{"service":"web","version":"5.2.1","status":"live","duration":"1m 48s"},{"service":"worker","version":"1.9.3","status":"rolled back","duration":"4m 02s"},{"service":"ios","version":"1.42","status":"in review","duration":"—"}]"#, "ok", now - 8 * minute, nil),
            ("w_news", "list", "Changelog", "{}", "url",
             #"[{"title":"Dashboards on iPhone","summary":"Read-only widgets, refreshed while you watch.","date":"\#(today)","link":"https://example.com/1"},{"title":"Faster Studio search","summary":"Content matches in under 100 ms.","date":"2026-10-09","link":"https://example.com/2"},{"title":"Talk notes","date":"2026-10-02"}]"#, "ok", now - 20 * minute, nil),
            ("w_note", "note", "On call", #"{"markdown":"**Dana** is on call this week. Page her in **#ops** for anything customer-facing; the runbook is pinned there."}"#, "none", "null", "none", nil, nil),
            ("w_clock", "clock", "Tokyo office", #"{"timeZone":"Asia/Tokyo"}"#, "none", "null", "none", nil, nil),
            ("w_launch", "clock", "Launch", #"{"mode":"countdown","target":"\#(launch)","label":"Public launch"}"#, "none", "null", "none", nil, nil),
            ("w_embed", "embed", "Status page", #"{"url":"https://status.example.com"}"#, "none", "null", "none", nil, nil),
            ("w_custom", "custom", "Release health", "{}", "push",
             #"{"crashFree":99.6,"sessions":"18.2k"}"#, "ok", now - 6 * minute, nil),
            ("w_waiting", "stat", "Open support tickets", "{}", "push", "null", "pending", nil, nil),
            ("w_failed", "line", "Error rate", "{}", "url", "null", "error", nil, "HTTP 503 from metrics.example.com"),
            ("w_approval", "table", "Disk usage", "{}", "script", "null", "approval", nil, nil),
        ].filter { only.isEmpty || only.contains($0.0) }
        let customHTML = #"<div id=r style=\"display:flex;gap:16px;padding:4px 0\"></div><script>addEventListener('bbwidget',function(e){var d=e.detail.data||{};document.getElementById('r').innerHTML='<div><div style=\"font-size:22px;font-weight:600\">'+d.crashFree+'%</div><div style=\"color:var(--bb-muted)\">crash-free</div></div><div><div style=\"font-size:22px;font-weight:600\">'+d.sessions+'</div><div style=\"color:var(--bb-muted)\">sessions</div></div>'})</script>"#
        func quoted(_ text: String) -> String { OrderedJSON.string(text).jsonText }
        let widgetJSON = widgets.map { w in
            var parts = [#""id":"\#(w.0)""#, #""type":"\#(w.1)""#, #""title":\#(quoted(w.2))"#, #""options":\#(w.3)"#,
                         #""source":{"kind":"\#(w.4)"}"#]
            if w.4 == "script" { parts.append(#""script":{"approved":\#(w.6 != "approval")}"#) }
            if w.1 == "custom" { parts.append(#""html":"\#(customHTML)""#) }
            return "{" + parts.joined(separator: ",") + "}"
        }.joined(separator: ",")
        let layout = widgets.enumerated().map { index, w in
            #"{"i":"\#(w.0)","x":0,"y":\#(index * 4),"w":12,"h":\#(w.1 == "custom" ? 2 : 4)}"#
        }.joined(separator: ",")
        let data = widgets.map { w in
            var parts = [#""widgetId":"\#(w.0)""#, #""value":\#(w.5)"#, #""status":"\#(w.6)""#]
            if let at = w.7 { parts.append(#""fetchedAt":\#(Int(at))"#) }
            if let error = w.8 { parts.append(#""error":\#(quoted(error)),"errorAt":\#(Int(now - 4 * minute))"#) }
            return "{" + parts.joined(separator: ",") + "}"
        }.joined(separator: ",")
        return #"{"id":"qa-demo","name":"Company pulse","updatedAt":\#(Int(now)),"widgets":[\#(widgetJSON)],"layouts":{"sm":[\#(layout)]},"data":[\#(data)]}"#
    }
}
#endif
